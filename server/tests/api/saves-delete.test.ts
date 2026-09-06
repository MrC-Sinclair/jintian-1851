/**
 * @file DELETE /api/game/saves API 集成测试
 *
 * 覆盖：正常删除（含记忆行清理）/ 归属不符或不存在 404 / 参数校验 / 记忆清理失败不阻断 / DB 错误
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 用 vi.hoisted 创建链式 mock，供 vi.mock 工厂引用
// 链式结构：db.delete(t) → { where } → { returning }（三次 delete 共用同一组 mock，
// 调用顺序用 deleteMock.mock.calls 断言：events → memories → saves）
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

describe('DELETE /api/game/saves', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.returningMock.mockReturnValue([])
  })

  it('正常删除：返回 deleted=true，且按 events→memories→saves 顺序清理', async () => {
    getQueryMock.mockReturnValueOnce({
      saveId: '550e8400-e29b-41d4-a716-446655440000',
      deviceId: 'device-1'
    })
    // 记忆清理的 delete 不调用 returning；仅存档主删除命中 1 行
    dbMock.returningMock.mockReturnValueOnce([
      { saveId: '550e8400-e29b-41d4-a716-446655440000' }
    ])

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.deleted).toBe(true)
    expect(dbMock.deleteMock).toHaveBeenCalledTimes(3)
  })

  it('0 行命中（不存在或归属其他设备）→ 404 SAVE_NOT_FOUND', async () => {
    getQueryMock.mockReturnValueOnce({
      saveId: '550e8400-e29b-41d4-a716-446655440000',
      deviceId: 'device-other'
    })
    // returning 全部空 → saves 主删除 0 行
    dbMock.returningMock.mockReturnValue([])

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(404)
    expect(res.data.error.code).toBe('SAVE_NOT_FOUND')
  })

  it('参数错误：saveId 非 UUID → 400', async () => {
    getQueryMock.mockReturnValueOnce({ saveId: 'not-a-uuid', deviceId: 'device-1' })

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
    expect(res.data.error.code).toBe('INVALID_PARAMS')
  })

  it('参数错误：deviceId 缺失 → 400', async () => {
    getQueryMock.mockReturnValueOnce({
      saveId: '550e8400-e29b-41d4-a716-446655440000'
    })

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
  })

  it('记忆行清理失败仅告警，不阻断存档删除', async () => {
    getQueryMock.mockReturnValueOnce({
      saveId: '550e8400-e29b-41d4-a716-446655440000',
      deviceId: 'device-1'
    })
    // 第一次 delete（game_events）抛错，主删除仍命中
    dbMock.deleteMock.mockImplementationOnce(() => {
      throw new Error('memory delete failed')
    })
    dbMock.returningMock.mockReturnValueOnce([
      { saveId: '550e8400-e29b-41d4-a716-446655440000' }
    ])

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.deleted).toBe(true)
  })

  it('主删除 DB 失败 → 500 DB_ERROR', async () => {
    getQueryMock.mockReturnValueOnce({
      saveId: '550e8400-e29b-41d4-a716-446655440000',
      deviceId: 'device-1'
    })
    // 主删除是唯一调用 returning 的位置：Once 抛错即主删除 DB 失败
    dbMock.returningMock.mockImplementationOnce(() => {
      throw new Error('DB down')
    })

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(500)
    expect(res.data.error.code).toBe('DB_ERROR')
  })
})
