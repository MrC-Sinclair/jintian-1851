/**
 * @file DELETE /api/game/saves API 集成测试
 *
 * 覆盖：正常删除（含记忆行清理）/ 归属不符或不存在 404 / 参数校验 / 记忆清理失败不阻断 / DB 错误
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 用 vi.hoisted 创建链式 mock，供 vi.mock 工厂引用
// 链式结构：db.delete(t) → { where } → { returning }（三次 delete 共用同一组 mock，
// 调用顺序为 saves → events → memories：属主证明只能来自主删除的返回行数，
// 记忆清理必须排在它后面，否则 404 请求也能擦除他人的记忆行）
const dbMock = vi.hoisted(() => {
  const returningMock = vi.fn((): any[] => [])
  const whereMock = vi.fn(() => ({ returning: returningMock }))
  const deleteMock = vi.fn(() => ({ where: whereMock }))

  return { db: { delete: deleteMock }, returningMock, whereMock, deleteMock }
})

vi.mock('../../server/db', () => ({ db: dbMock.db }))

import handler from '../../server/api/game/saves.delete'

const getQueryMock = (globalThis as any).getQuery as ReturnType<typeof vi.fn>

function makeEvent(): any {
  return { node: { res: { write: vi.fn(async () => {}), end: vi.fn() } } }
}

const SAVE_ID = '550e8400-e29b-41d4-a716-446655440000'

describe('DELETE /api/game/saves', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.returningMock.mockReturnValue([])
  })

  it('正常删除：返回 deleted=true，且按 saves→events→memories 顺序清理', async () => {
    getQueryMock.mockReturnValueOnce({ saveId: SAVE_ID, deviceId: 'device-1' })
    // 主删除命中 1 行（属主校验通过），随后两次记忆清理不调用 returning
    dbMock.returningMock.mockReturnValueOnce([{ saveId: SAVE_ID }])

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.deleted).toBe(true)
    expect(dbMock.deleteMock).toHaveBeenCalledTimes(3)
  })

  it('0 行命中（不存在或归属其他设备）→ 404，且不得清理任何记忆行', async () => {
    getQueryMock.mockReturnValueOnce({ saveId: SAVE_ID, deviceId: 'device-other' })
    // returning 空 → saves 主删除 0 行
    dbMock.returningMock.mockReturnValue([])

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(404)
    expect(res.data.error.code).toBe('SAVE_NOT_FOUND')
    // 回归护栏：属主未证实前擦除 game_events/faction_memories 是越权删除
    expect(dbMock.deleteMock).toHaveBeenCalledTimes(1)
  })

  it('参数错误：saveId 非 UUID → 400', async () => {
    getQueryMock.mockReturnValueOnce({ saveId: 'not-a-uuid', deviceId: 'device-1' })

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
    expect(res.data.error.code).toBe('INVALID_PARAMS')
  })

  it('参数错误：deviceId 缺失且无凭据 → 400（兼容期仍要求某种属主声明）', async () => {
    getQueryMock.mockReturnValueOnce({ saveId: SAVE_ID })

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
  })

  it('记忆行清理失败仅告警，不阻断已成功的存档删除', async () => {
    getQueryMock.mockReturnValueOnce({ saveId: SAVE_ID, deviceId: 'device-1' })
    // 第 1 次 delete = 主删除（走默认链并命中 1 行），第 2 次 = game_events 抛错
    dbMock.deleteMock
      .mockImplementationOnce(() => ({ where: dbMock.whereMock }))
      .mockImplementationOnce(() => {
        throw new Error('memory delete failed')
      })
    dbMock.returningMock.mockReturnValueOnce([{ saveId: SAVE_ID }])

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.deleted).toBe(true)
  })

  it('主删除 DB 失败 → 500 DB_ERROR', async () => {
    getQueryMock.mockReturnValueOnce({ saveId: SAVE_ID, deviceId: 'device-1' })
    // 主删除是唯一调用 returning 的位置：Once 抛错即主删除 DB 失败
    dbMock.returningMock.mockImplementationOnce(() => {
      throw new Error('DB down')
    })

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(500)
    expect(res.data.error.code).toBe('DB_ERROR')
    // 主删除失败同样不能碰记忆行
    expect(dbMock.deleteMock).toHaveBeenCalledTimes(1)
  })
})
