/**
 * @file 设备凭据与属主解析单元测试（utils/device-auth.ts）
 *
 * 覆盖：凭据哈希 / 注册首绑即锁 / 注册并发裁决 / 四种属主解析分支 / 收紧开关
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => {
  const limitMock = vi.fn((): any[] => [])
  const whereMock = vi.fn(() => ({ limit: limitMock }))
  const fromMock = vi.fn(() => ({ where: whereMock }))
  const selectMock = vi.fn(() => ({ from: fromMock }))

  const returningMock = vi.fn((): any[] => [{ deviceId: 'device-1' }])
  const onConflictDoNothingMock = vi.fn(() => ({ returning: returningMock }))
  const valuesMock = vi.fn(() => ({ onConflictDoNothing: onConflictDoNothingMock }))
  const insertMock = vi.fn(() => ({ values: valuesMock }))

  return {
    db: { select: selectMock, insert: insertMock },
    limitMock,
    whereMock,
    fromMock,
    selectMock,
    returningMock,
    onConflictDoNothingMock,
    valuesMock,
    insertMock
  }
})

vi.mock('../../server/db', () => ({ db: dbMock.db }))

import {
  DEVICE_TOKEN_HEADER,
  generateDeviceSecret,
  hashDeviceSecret,
  registerDeviceCredential,
  resolveOwnerDeviceId
} from '../../server/utils/device-auth'

function setConfig(overrides: Record<string, unknown> = {}): void {
  ;(globalThis as any).useRuntimeConfig = () => ({
    deviceAuthEnforced: false,
    deviceAuthAllowFirstBind: true,
    ...overrides
  })
}

describe('device-auth 凭据原语', () => {
  it('请求头名与前端约定一致', () => {
    expect(DEVICE_TOKEN_HEADER).toBe('x-device-token')
  })

  it('生成的明文凭据为 64 位十六进制（256bit），且每次不同', () => {
    const a = generateDeviceSecret()
    const b = generateDeviceSecret()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })

  it('hashDeviceSecret 稳定且为 sha256 十六进制（库里不落明文）', () => {
    const h1 = hashDeviceSecret('secret-abc')
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(h1).toBe(hashDeviceSecret('secret-abc'))
    expect(h1).not.toBe(hashDeviceSecret('secret-abd'))
  })
})

describe('registerDeviceCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setConfig()
    dbMock.returningMock.mockReturnValue([{ deviceId: 'device-1' }])
  })

  it('首绑成功：插入 hash 而非明文，并返回一次明文凭据', async () => {
    const res = await registerDeviceCredential('device-1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.deviceId).toBe('device-1')
    expect(res.secret).toMatch(/^[0-9a-f]{64}$/)

    const values = (dbMock.valuesMock.mock.calls as any[][])[0][0] as Record<string, unknown>
    expect(values.deviceId).toBe('device-1')
    expect(values.secretHash).toBe(hashDeviceSecret(res.secret))
    expect(values.secretHash).not.toBe(res.secret)
  })

  it('重复注册（onConflictDoNothing 返回 0 行）→ 409 CREDENTIAL_EXISTS，不再发凭据', async () => {
    dbMock.returningMock.mockReturnValue([])

    const res = await registerDeviceCredential('device-1')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.statusCode).toBe(409)
    expect(res.code).toBe('CREDENTIAL_EXISTS')
  })

  it('首绑落在已有存档的设备：仍然放行，但额外记一条可报警事件', async () => {
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '))
    })
    dbMock.limitMock.mockReturnValueOnce([{ one: 1 }])

    const res = await registerDeviceCredential('device-1')
    spy.mockRestore()

    // 不拒绝：拒绝就是把"收紧前就在玩、只是没补注册"的属主永久挡在门外
    expect(res.ok).toBe(true)
    const events = logs.filter((l) => l.startsWith('[auth-event]'))
    expect(events.some((l) => l.includes('"kind":"enrolled"'))).toBe(true)
    expect(events.some((l) => l.includes('"kind":"enroll_over_existing_saves"'))).toBe(true)
    // 存在性查排在插入之后：属主裁决完全由主键约束完成，不留读后写窗口
    expect(dbMock.insertMock.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.selectMock.mock.invocationCallOrder[0]
    )
  })

  it('首绑在没有存档的新设备上：只记 enrolled，不误报警', async () => {
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '))
    })
    dbMock.limitMock.mockReturnValueOnce([])

    const res = await registerDeviceCredential('device-new')
    spy.mockRestore()

    expect(res.ok).toBe(true)
    expect(logs.some((l) => l.includes('enroll_over_existing_saves'))).toBe(false)
    expect(logs.some((l) => l.includes('"kind":"enrolled"'))).toBe(true)
  })

  it('注册关闭（allowFirstBind=false）→ 403 ENROLLMENT_CLOSED，且不碰数据库', async () => {
    setConfig({ deviceAuthAllowFirstBind: false })

    const res = await registerDeviceCredential('device-1')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.statusCode).toBe(403)
    expect(res.code).toBe('ENROLLMENT_CLOSED')
    expect(dbMock.insertMock).not.toHaveBeenCalled()
  })
})

describe('resolveOwnerDeviceId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setConfig()
    dbMock.limitMock.mockReturnValue([])
  })

  it('带有效凭据：属主取自凭据反查结果，与客户端声明无关', async () => {
    const token = generateDeviceSecret()
    dbMock.limitMock.mockReturnValueOnce([{ deviceId: 'device-owner' }])

    const res = await resolveOwnerDeviceId(token, 'device-attacker')
    expect(res).toEqual({ ok: true, deviceId: 'device-owner', via: 'token' })
    // 按 secret_hash 等值查，不是按明文
    expect(dbMock.fromMock).toHaveBeenCalled()
    expect(dbMock.whereMock).toHaveBeenCalled()
  })

  it('带无效凭据：一律 401，不静默降级到声明的 deviceId', async () => {
    dbMock.limitMock.mockReturnValueOnce([])

    const res = await resolveOwnerDeviceId('bogus-token', 'device-1')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.statusCode).toBe(401)
    expect(res.code).toBe('INVALID_DEVICE_TOKEN')
  })

  it('无凭据 + 已收紧（enforced=true）→ 401 DEVICE_TOKEN_REQUIRED', async () => {
    setConfig({ deviceAuthEnforced: true })

    const res = await resolveOwnerDeviceId(undefined, 'device-1')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.statusCode).toBe(401)
    expect(res.code).toBe('DEVICE_TOKEN_REQUIRED')
  })

  it('无凭据 + 兼容期 + 声明了 deviceId → 放行（via=legacy），且日志只记前 8 位', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const long = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

    const res = await resolveOwnerDeviceId(undefined, long)
    expect(res).toEqual({ ok: true, deviceId: long, via: 'legacy' })

    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('[auth-compat]')
    expect(logged).toContain('aaaaaaaa***')
    expect(logged).not.toContain(long)
    spy.mockRestore()
  })

  it('无凭据 + 兼容期 + 什么都没声明 → 400 INVALID_PARAMS（保持老语义）', async () => {
    const res = await resolveOwnerDeviceId(undefined, undefined)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.statusCode).toBe(400)
    expect(res.code).toBe('INVALID_PARAMS')
  })

  it('无凭据 + 兼容期 + 空串 deviceId → 视为未声明', async () => {
    const res = await resolveOwnerDeviceId(undefined, '')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.statusCode).toBe(400)
  })

  it('凭据路径不查库失败时不误放行：limit 返回空即 401', async () => {
    dbMock.limitMock.mockReturnValueOnce([])
    const res = await resolveOwnerDeviceId(generateDeviceSecret(), undefined)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_DEVICE_TOKEN')
  })
})

/**
 * [auth-event] 是收紧判断的唯一数据来源（auth-report 靠它算兼容占比与 401 分布），
 * 所以"每条裁决都留痕、且只留掩码"必须当契约测住，而不是等聚合时发现少一类事件。
 */
describe('鉴权事件日志 [auth-event]', () => {
  function eventsOf(spy: ReturnType<typeof vi.spyOn>): string {
    return spy.mock.calls.map((c) => String(c[0])).join('\n')
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setConfig()
    dbMock.limitMock.mockReturnValue([])
  })

  it('凭据反查成功：记 owner_by_token，且用权威 deviceId 而非客户端声明值', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const longOwner = '11111111-2222-4333-8444-555555555555'
    dbMock.limitMock.mockReturnValueOnce([{ deviceId: longOwner }])

    await resolveOwnerDeviceId(generateDeviceSecret(), 'ffffffff-0000-4000-8000-000000000000')

    const out = eventsOf(spy)
    expect(out).toContain('"kind":"owner_by_token"')
    expect(out).toContain('"device":"11111111"')
    // 冒领者的声明值不该进日志
    expect(out).not.toContain('ffffffff-0000')
    // 权威值也只做 8 位掩码
    expect(out).not.toContain(longOwner)
    spy.mockRestore()
  })

  it('无效凭据：记 invalid_token，device 为空（手上没有可信标识）', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    dbMock.limitMock.mockReturnValueOnce([])

    await resolveOwnerDeviceId('bogus-token', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')

    const out = eventsOf(spy)
    expect(out).toContain('"kind":"invalid_token"')
    expect(out).toContain('"device":""')
    expect(out).not.toContain('aaaaaaaa-bbbb')
    spy.mockRestore()
  })

  it('收紧后无凭据：记 token_required 并带上声明值前缀', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    setConfig({ deviceAuthEnforced: true })

    await resolveOwnerDeviceId(undefined, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')

    expect(eventsOf(spy)).toContain('"kind":"token_required"')
    expect(eventsOf(spy)).toContain('"device":"aaaaaaaa"')
    spy.mockRestore()
  })

  it('兼容通道：[auth-compat] 与 [auth-event] 各一条，两处都只有前 8 位', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const long = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

    await resolveOwnerDeviceId(undefined, long)

    const out = eventsOf(spy)
    expect(out).toContain('[auth-compat]')
    expect(out).toContain('"kind":"owner_by_compat"')
    expect(out).toContain('"device":"aaaaaaaa"')
    expect(out).not.toContain(long)
    spy.mockRestore()
  })

  it('注册成功/被拒分别留痕 enrolled / enroll_exists', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const long = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

    dbMock.returningMock.mockReturnValueOnce([{ deviceId: long }])
    await registerDeviceCredential(long)
    dbMock.returningMock.mockReturnValueOnce([])
    await registerDeviceCredential(long)

    const out = eventsOf(spy)
    expect(out).toContain('"kind":"enrolled"')
    expect(out).toContain('"kind":"enroll_exists"')
    expect(out).not.toContain(long)
    spy.mockRestore()
  })

  it('注册关闭：记 enroll_closed', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    setConfig({ deviceAuthAllowFirstBind: false })

    await registerDeviceCredential('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')

    expect(eventsOf(spy)).toContain('"kind":"enroll_closed"')
    spy.mockRestore()
  })

  it('事件里的 ts 是 ISO 字符串（聚合侧要按它排区间）', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await resolveOwnerDeviceId(undefined, undefined)

    const line = eventsOf(spy)
      .split('\n')
      .find((l) => l.includes('[auth-event]'))
    const parsed = JSON.parse((line || '').replace(/^\[auth-event\] /, ''))
    expect(parsed.kind).toBe('missing_identity')
    expect(new Date(parsed.ts).toISOString()).toBe(parsed.ts)
    spy.mockRestore()
  })
})
