/**
 * @file POST /api/game/device-credential API 集成测试
 *
 * 覆盖：首绑成功 / 重复注册 409 / 参数校验 / 注册关闭 403 / 方法限制 / DB 错误
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => {
  // 首绑成功后的"该设备是否已有存档"观测查询走 select → from → where → limit
  const limitMock = vi.fn((): any[] => [])
  const whereMock = vi.fn(() => ({ limit: limitMock }))
  const fromMock = vi.fn(() => ({ where: whereMock }))
  const selectMock = vi.fn(() => ({ from: fromMock }))

  const returningMock = vi.fn((): any[] => [{ deviceId: 'device-1' }])
  const onConflictDoNothingMock = vi.fn(() => ({ returning: returningMock }))
  const valuesMock = vi.fn(() => ({ onConflictDoNothing: onConflictDoNothingMock }))
  const insertMock = vi.fn(() => ({ values: valuesMock }))

  return {
    db: { insert: insertMock, select: selectMock },
    returningMock,
    onConflictDoNothingMock,
    valuesMock,
    insertMock,
    selectMock,
    limitMock
  }
})

vi.mock('../../server/db', () => ({ db: dbMock.db }))

import handler from '../../server/api/game/device-credential.post'

const readBodyMock = (globalThis as any).readBody as ReturnType<typeof vi.fn>

const DEVICE_ID = '550e8400-e29b-41d4-a716-446655440000'

// 双轨开关走可变对象：用例改字段即可，beforeEach 统一复位（避免覆盖 setup 的 mock 后回不去）
const authConfig = {
  deviceAuthEnforced: false,
  deviceAuthAllowFirstBind: true,
  deviceAuthRequirePossession: false
}
;(globalThis as any).useRuntimeConfig = () => authConfig

function makeEvent(): any {
  return { node: { res: { write: vi.fn(async () => {}), end: vi.fn() } } }
}

describe('POST /api/game/device-credential', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authConfig.deviceAuthEnforced = false
    authConfig.deviceAuthAllowFirstBind = true
    authConfig.deviceAuthRequirePossession = false
    ;(globalThis as any).getMethod = vi.fn(() => 'POST')
    dbMock.returningMock.mockReturnValue([{ deviceId: DEVICE_ID }])
  })

  it('首绑成功：返回一次性明文凭据', async () => {
    readBodyMock.mockResolvedValueOnce({ deviceId: DEVICE_ID })

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.deviceId).toBe(DEVICE_ID)
    expect(res.data.token).toMatch(/^[0-9a-f]{64}$/)
    expect(dbMock.insertMock).toHaveBeenCalledTimes(1)
  })

  it('首绑落在"已有存档却没有凭据"的设备上：照常 200 下发凭据', async () => {
    dbMock.limitMock.mockReturnValueOnce([{ one: 1 }])
    readBodyMock.mockResolvedValueOnce({ deviceId: DEVICE_ID })

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.token).toMatch(/^[0-9a-f]{64}$/)
    expect(dbMock.selectMock).toHaveBeenCalledTimes(1)
  })

  // 凭据此刻已经落库，而路由把任何抛出都变成 500；明文只在这一次下发，
  // 所以观测查询失败绝不能连带注册一起失败 —— 那等于把设备永久锁在 409 上
  it('观测查询抛错不影响注册：凭据照常返回', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    dbMock.selectMock.mockImplementationOnce(() => {
      throw new Error('db down')
    })
    readBodyMock.mockResolvedValueOnce({ deviceId: DEVICE_ID })

    const res = (await handler(makeEvent())) as any
    warnSpy.mockRestore()

    expect(res.ok).toBe(true)
    expect(res.data.token).toMatch(/^[0-9a-f]{64}$/)
    expect(dbMock.insertMock).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBeUndefined()
  })

  // ===== 持有证明闸门 =====

  it('body 带 proof 不被 strict 模式拒绝（观测期照旧发凭据）', async () => {
    dbMock.limitMock.mockReturnValueOnce([{ one: 1 }]).mockReturnValueOnce([{ one: 1 }])
    readBodyMock.mockResolvedValueOnce({
      deviceId: DEVICE_ID,
      proof: { saveId: DEVICE_ID, createdAt: 1700000000000 }
    })

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('proof 字段形状不对（createdAt 非整数）→ 400 INVALID_PARAMS', async () => {
    readBodyMock.mockResolvedValueOnce({
      deviceId: DEVICE_ID,
      proof: { saveId: DEVICE_ID, createdAt: 'abc' }
    })

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
    expect(res.data.error.code).toBe('INVALID_PARAMS')
    expect(dbMock.insertMock).not.toHaveBeenCalled()
  })

  it('开关打开 + 有存档却缺 proof → 403 PROOF_REQUIRED，且不落绑定', async () => {
    authConfig.deviceAuthRequirePossession = true
    dbMock.limitMock.mockReturnValueOnce([{ one: 1 }])
    readBodyMock.mockResolvedValueOnce({ deviceId: DEVICE_ID })

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(403)
    expect(res.data.error.code).toBe('PROOF_REQUIRED')
    expect(dbMock.insertMock).not.toHaveBeenCalled()
  })

  it('开关打开 + proof 正确 → 合法属主仍能注册回来', async () => {
    authConfig.deviceAuthRequirePossession = true
    dbMock.limitMock.mockReturnValueOnce([{ one: 1 }]).mockReturnValueOnce([{ one: 1 }])
    readBodyMock.mockResolvedValueOnce({
      deviceId: DEVICE_ID,
      proof: { saveId: DEVICE_ID, createdAt: 1700000000000 }
    })

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(dbMock.insertMock).toHaveBeenCalledTimes(1)
  })

  it('重复注册 → 409 CREDENTIAL_EXISTS（首绑即锁，冒领方换不到凭据）', async () => {
    dbMock.returningMock.mockReturnValue([])
    readBodyMock.mockResolvedValueOnce({ deviceId: DEVICE_ID })

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(409)
    expect(res.data.error.code).toBe('CREDENTIAL_EXISTS')
  })

  it('参数错误：deviceId 非 UUID → 400', async () => {
    readBodyMock.mockResolvedValueOnce({ deviceId: 'not-a-uuid' })

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
    expect(res.data.error.code).toBe('INVALID_PARAMS')
    expect(dbMock.insertMock).not.toHaveBeenCalled()
  })

  it('参数错误：多余字段被 strict 模式拒绝 → 400', async () => {
    readBodyMock.mockResolvedValueOnce({ deviceId: DEVICE_ID, admin: true })

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
  })

  it('注册关闭（allowFirstBind=false）→ 403 ENROLLMENT_CLOSED', async () => {
    authConfig.deviceAuthAllowFirstBind = false
    readBodyMock.mockResolvedValueOnce({ deviceId: DEVICE_ID })

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(403)
    expect(res.data.error.code).toBe('ENROLLMENT_CLOSED')
    expect(dbMock.insertMock).not.toHaveBeenCalled()
  })

  it('请求体解析失败 → 400', async () => {
    readBodyMock.mockRejectedValueOnce(new Error('bad json'))

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
  })

  it('非 POST 方法 → 405', async () => {
    ;(globalThis as any).getMethod = vi.fn(() => 'GET')

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(405)
    expect(res.data.error.code).toBe('METHOD_NOT_ALLOWED')
  })

  it('DB 写入失败 → 500 DB_ERROR', async () => {
    dbMock.insertMock.mockImplementationOnce(() => {
      throw new Error('DB down')
    })
    readBodyMock.mockResolvedValueOnce({ deviceId: DEVICE_ID })

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(500)
    expect(res.data.error.code).toBe('DB_ERROR')
  })
})
