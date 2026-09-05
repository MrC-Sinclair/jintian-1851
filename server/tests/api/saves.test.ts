/**
 * @file GET /api/game/saves API 集成测试
 *
 * 覆盖：正常列表 / 摘要字段提取（含 saveData 缺字段的容错）/ 参数校验 / DB 错误
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 用 vi.hoisted 创建链式 mock，供 vi.mock 工厂引用
const dbMock = vi.hoisted(() => {
  const limitMock = vi.fn((): any[] => [])
  const orderByMock = vi.fn(() => ({ limit: limitMock }))
  const whereMock = vi.fn(() => ({ orderBy: orderByMock }))
  const fromMock = vi.fn(() => ({ where: whereMock }))
  const selectMock = vi.fn(() => ({ from: fromMock }))

  return { db: { select: selectMock }, limitMock, orderByMock, whereMock, fromMock, selectMock }
})

vi.mock('../../server/db', () => ({ db: dbMock.db }))

import handler from '../../server/api/game/saves.get'

const getQueryMock = (globalThis as any).getQuery as ReturnType<typeof vi.fn>

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
})
