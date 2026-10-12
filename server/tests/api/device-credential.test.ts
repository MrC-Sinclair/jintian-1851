/**
 * @file POST /api/game/device-credential API 集成测试
 *
 * 覆盖：首绑成功 / 重复注册 409 / 参数校验 / 注册关闭 403 / 方法限制 / DB 错误
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => {
  const returningMock = vi.fn((): any[] => [{ deviceId: 'device-1' }])
  const onConflictDoNothingMock = vi.fn(() => ({ returning: returningMock }))
  const valuesMock = vi.fn(() => ({ onConflictDoNothing: onConflictDoNothingMock }))
  const insertMock = vi.fn(() => ({ values: valuesMock }))

  return {
    db: { insert: insertMock },
    returningMock,
    onConflictDoNothingMock,
    valuesMock,
    insertMock
  }
})

vi.mock('../../server/db', () => ({ db: dbMock.db }))

import handler from '../../server/api/game/device-credential.post'

const readBodyMock = (globalThis as any).readBody as ReturnType<typeof vi.fn>

const DEVICE_ID = '550e8400-e29b-41d4-a716-446655440000'

// 双轨开关走可变对象：用例改字段即可，beforeEach 统一复位（避免覆盖 setup 的 mock 后回不去）
const authConfig = { deviceAuthEnforced: false, deviceAuthAllowFirstBind: true }
;(globalThis as any).useRuntimeConfig = () => authConfig

function makeEvent(): any {
  return { node: { res: { write: vi.fn(async () => {}), end: vi.fn() } } }
}

describe('POST /api/game/device-credential', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authConfig.deviceAuthEnforced = false
    authConfig.deviceAuthAllowFirstBind = true
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
