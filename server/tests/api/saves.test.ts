/**
 * @file GET /api/game/saves API 集成测试
 *
 * 覆盖：正常列表 / 摘要字段提取（含 saveData 缺字段的容错）/ 参数校验 / DB 错误
 *      / 凭据属主裁决（token 优先、无效凭据不降级、收紧后拒绝无凭据请求）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 用 vi.hoisted 创建链式 mock，供 vi.mock 工厂引用
// whereMock 同时返回 orderBy 与 limit：handler 走 where→orderBy→limit，
// device-auth 的凭据反查走 where→limit，两条链共用一组 mock 即可
const dbMock = vi.hoisted(() => {
  const limitMock = vi.fn((): any[] => [])
  const orderByMock = vi.fn(() => ({ limit: limitMock }))
  const whereMock = vi.fn(() => ({ orderBy: orderByMock, limit: limitMock }))
  const fromMock = vi.fn(() => ({ where: whereMock }))
  const selectMock = vi.fn(() => ({ from: fromMock }))

  return { db: { select: selectMock }, limitMock, orderByMock, whereMock, fromMock, selectMock }
})

vi.mock('../../server/db', () => ({ db: dbMock.db }))

import handler from '../../server/api/game/saves.get'

const getQueryMock = (globalThis as any).getQuery as ReturnType<typeof vi.fn>
const getHeaderMock = (globalThis as any).getHeader as ReturnType<typeof vi.fn>

// 双轨开关：覆盖 setup 的固定 mock，用例改字段、beforeEach 复位
const authConfig = { deviceAuthEnforced: false, deviceAuthAllowFirstBind: true }
;(globalThis as any).useRuntimeConfig = () => authConfig

/** 让 `x-device-token` 反查命中 ownerDeviceId（device-auth 的第一次 limit 调用即凭据查询） */
function stubTokenLookup(token: string, ownerDeviceId: string): void {
  getHeaderMock.mockImplementation((_: unknown, name: string) =>
    name === 'x-device-token' ? token : undefined
  )
  dbMock.limitMock.mockImplementationOnce(() => [{ deviceId: ownerDeviceId }])
}

function makeEvent(): any {
  return { node: { res: { write: vi.fn(async () => {}), end: vi.fn() } } }
}

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    saveId: '550e8400-e29b-41d4-a716-446655440000',
    saveVersion: 2,
    saveData: {
      character: { background: '文官', factionName: '清廷' },
      state: { turn: 7 }
    },
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    endedAt: null,
    endedReason: null,
    ...overrides
  }
}

describe('GET /api/game/saves', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // mockClear 不回收 mockImplementation，必须显式复位，否则凭据会漏到下一个用例
    getHeaderMock.mockImplementation(() => undefined)
    authConfig.deviceAuthEnforced = false
    authConfig.deviceAuthAllowFirstBind = true
    dbMock.limitMock.mockReturnValue([])
  })

  it('正常返回存档摘要列表（含 background/factionName/turn/ended 提取）', async () => {
    getQueryMock.mockReturnValueOnce({ deviceId: 'device-1' })
    dbMock.limitMock.mockReturnValueOnce([makeRow()])

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.saves).toHaveLength(1)
    const item = res.data.saves[0]
    expect(item.saveId).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(item.saveVersion).toBe(2)
    expect(item.updatedAt).toBeTypeOf('number')
    expect(item.endedAt).toBeNull()
    expect(item.summary).toEqual({
      background: '文官',
      factionName: '清廷',
      turn: 7,
      ended: false
    })
  })

  it('endedAt 非空时 ended=true 且时间戳为毫秒', async () => {
    getQueryMock.mockReturnValueOnce({ deviceId: 'device-1' })
    dbMock.limitMock.mockReturnValueOnce([
      makeRow({ endedAt: new Date('2026-01-03T00:00:00Z'), endedReason: 'victory' })
    ])

    const res = (await handler(makeEvent())) as any
    const item = res.data.saves[0]
    expect(item.endedAt).toBeTypeOf('number')
    expect(item.endedReason).toBe('victory')
    expect(item.summary.ended).toBe(true)
  })

  it('saveData 结构异常（缺 character/state）时摘要字段安全兜底', async () => {
    getQueryMock.mockReturnValueOnce({ deviceId: 'device-1' })
    dbMock.limitMock.mockReturnValueOnce([makeRow({ saveData: {} })])

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.saves[0].summary).toEqual({
      background: '',
      factionName: '',
      turn: 0,
      ended: false
    })
  })

  it('limit 参数生效（透传给 DB limit）', async () => {
    getQueryMock.mockReturnValueOnce({ deviceId: 'device-1', limit: '5' })

    await handler(makeEvent())
    expect(dbMock.limitMock).toHaveBeenCalledWith(5)
  })

  it('参数错误：deviceId 缺失 → 400', async () => {
    getQueryMock.mockReturnValueOnce({})

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
    expect(res.data.error.code).toBe('INVALID_PARAMS')
  })

  it('参数错误：limit 超上限（>50）→ 400', async () => {
    getQueryMock.mockReturnValueOnce({ deviceId: 'device-1', limit: '100' })

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
  })

  it('DB 查询失败：返回 500 DB_ERROR', async () => {
    getQueryMock.mockReturnValueOnce({ deviceId: 'device-1' })
    dbMock.selectMock.mockImplementationOnce(() => {
      throw new Error('DB down')
    })

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(500)
    expect(res.data.error.code).toBe('DB_ERROR')
  })

  describe('凭据属主裁决', () => {
    it('带有效凭据：query 不带 deviceId 也能列出（凭据即属主，无需自声明）', async () => {
      stubTokenLookup('tok-owner', 'device-owner')
      getQueryMock.mockReturnValueOnce({})
      dbMock.limitMock.mockReturnValueOnce([makeRow()])

      const res = (await handler(makeEvent())) as any
      expect(res.ok).toBe(true)
      expect(res.data.saves).toHaveLength(1)
      // 两次 limit：第一次是凭据反查，第二次是列表查询
      expect(dbMock.whereMock).toHaveBeenCalledTimes(2)
    })

    it('带有效凭据时 query 里的 deviceId 只是装饰：不影响查询执行', async () => {
      stubTokenLookup('tok-owner', 'device-owner')
      getQueryMock.mockReturnValueOnce({ deviceId: 'device-attacker' })
      dbMock.limitMock.mockReturnValueOnce([makeRow()])

      const res = (await handler(makeEvent())) as any
      expect(res.ok).toBe(true)
    })

    it('凭据无效：401 INVALID_DEVICE_TOKEN，不降级使用 query 里的 deviceId', async () => {
      getHeaderMock.mockImplementation((_: unknown, name: string) =>
        name === 'x-device-token' ? 'tok-bogus' : undefined
      )
      // 反查落空
      dbMock.limitMock.mockReturnValue([])
      getQueryMock.mockReturnValueOnce({ deviceId: 'device-1' })

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(401)
      expect(res.data.error.code).toBe('INVALID_DEVICE_TOKEN')
      // 未进入列表查询
      expect(dbMock.whereMock).toHaveBeenCalledTimes(1)
    })

    it('收紧后（enforced=true）无凭据请求一律 401，即便带了 deviceId', async () => {
      authConfig.deviceAuthEnforced = true
      getQueryMock.mockReturnValueOnce({ deviceId: 'device-1' })

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(401)
      expect(res.data.error.code).toBe('DEVICE_TOKEN_REQUIRED')
    })
  })
})
