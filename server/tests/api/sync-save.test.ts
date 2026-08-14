/**
 * @file sync-save API 集成测试
 *
 * 覆盖首次上传 / 二次覆盖 / 并发 / strict 拒绝 / 拉取 / 参数错误
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 用 vi.hoisted 创建链式 mock，供 vi.mock 工厂引用
const dbMock = vi.hoisted(() => {
  const returningMock = vi.fn(() => [
    {
      saveId: '550e8400-e29b-41d4-a716-446655440000',
      updatedAt: new Date('2026-01-01'),
      endedAt: null,
      endedReason: null
    }
  ])
  const onConflictMock = vi.fn(() => ({ returning: returningMock }))
  const valuesMock = vi.fn(() => ({ onConflictDoUpdate: onConflictMock }))
  const insertMock = vi.fn(() => ({ values: valuesMock }))

  const limitMock = vi.fn((): any[] => [])
  const whereMock = vi.fn(() => ({ limit: limitMock }))
  const fromMock = vi.fn(() => ({ where: whereMock }))
  const selectMock = vi.fn(() => ({ from: fromMock }))

  return {
    db: { insert: insertMock, select: selectMock },
    returningMock,
    limitMock,
    insertMock,
    selectMock,
    valuesMock,
    onConflictMock
  }
})

vi.mock('../../server/db', () => ({ db: dbMock.db }))

import handler from '../../server/api/game/sync-save'

const readBodyMock = (globalThis as any).readBody as ReturnType<typeof vi.fn>
const getQueryMock = (globalThis as any).getQuery as ReturnType<typeof vi.fn>
const SAVE_ID = '550e8400-e29b-41d4-a716-446655440000'

function makeEvent(): any {
  return { node: { res: { write: vi.fn(async () => {}), end: vi.fn() } } }
}

function makeSaveData(overrides = {}): any {
  return {
    saveVersion: 1,
    saveId: SAVE_ID,
    deviceId: 'device-1',
    createdAt: 1700000000000,
    character: {
      background: '文官',
      backgroundPerks: { politics: 5 },
      factionId: 'qing-ting',
      factionName: '清廷',
      factionSummary: '大清朝廷'
    },
    state: {
      turn: 1,
      date: { year: 1851, month: 1 },
      attributes: { military: 50, economy: 50, politics: 50, people: 50, diplomacy: 50 },
      resources: { silver: 1000, troops: 500, food: 200, reputation: 30 }
    },
    factions: [
      {
        id: 'qing-ting',
        name: '清廷',
        summary: '大清朝廷',
        power: 70,
        relationship: 50,
        status: 'active'
      }
    ],
    events: [],
    advisorMessages: [],
    ended: false,
    ...overrides
  }
}

describe('POST/GET /api/game/sync-save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).getMethod = vi.fn(() => 'POST')
    dbMock.returningMock.mockReturnValue([
      {
        saveId: SAVE_ID,
        updatedAt: new Date('2026-01-01'),
        endedAt: null,
        endedReason: null
      }
    ])
    dbMock.limitMock.mockReturnValue([])
  })

  describe('POST 上传/覆盖', () => {
    it('首次上传：返回 ok + saveId + updatedAt', async () => {
      readBodyMock.mockResolvedValueOnce(makeSaveData())

      const res = (await handler(makeEvent())) as any
      expect(res.ok).toBe(true)
      expect(res.data.saveId).toBe(SAVE_ID)
      expect(res.data.updatedAt).toBeTypeOf('number')
      expect(dbMock.insertMock).toHaveBeenCalledTimes(1)
    })

    it('二次覆盖：走 onConflictDoUpdate', async () => {
      readBodyMock.mockResolvedValueOnce(makeSaveData())

      await handler(makeEvent())

      expect(dbMock.valuesMock).toHaveBeenCalledTimes(1)
      expect(dbMock.onConflictMock).toHaveBeenCalledTimes(1)
    })

    it('strict 模式拒绝 updatedAt 字段', async () => {
      readBodyMock.mockResolvedValueOnce(makeSaveData({ updatedAt: 1700000000000 }))

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(400)
      expect(res.data.error.message).toContain('updatedAt')
    })

    it('参数错误：saveId 非 UUID', async () => {
      readBodyMock.mockResolvedValueOnce(makeSaveData({ saveId: 'bad' }))

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(400)
      expect(res.data.error.code).toBe('INVALID_PARAMS')
    })

    it('saveVersion 2（扩充事件引擎 v2 存档）被接受', async () => {
      readBodyMock.mockResolvedValueOnce(
        makeSaveData({
          saveVersion: 2,
          pendingChainNodes: [{ chainId: 'tai-ping-tian-guo', nodeId: 'node-1', scheduledTurn: 2 }],
          completedChainIds: [],
          activeChainIds: []
        })
      )

      const res = (await handler(makeEvent())) as any
      expect(res.ok).toBe(true)
      expect(dbMock.insertMock).toHaveBeenCalledTimes(1)
    })

    it('参数错误：saveVersion 为未支持的值（如 3）', async () => {
      readBodyMock.mockResolvedValueOnce(makeSaveData({ saveVersion: 3 as any }))

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(400)
    })

    it('DB 写入失败：返回 500', async () => {
      dbMock.insertMock.mockImplementationOnce(() => {
        throw new Error('DB down')
      })
      readBodyMock.mockResolvedValueOnce(makeSaveData())

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(500)
      expect(res.data.error.code).toBe('DB_ERROR')
    })

    it('并发：两次 POST 都成功（无锁，DB 层 ON CONFLICT）', async () => {
      readBodyMock.mockResolvedValueOnce(makeSaveData())
      readBodyMock.mockResolvedValueOnce(makeSaveData())

      const [res1, res2] = await Promise.all([handler(makeEvent()), handler(makeEvent())])
      expect((res1 as any).ok).toBe(true)
      expect((res2 as any).ok).toBe(true)
      expect(dbMock.insertMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('GET 拉取', () => {
    it('拉取成功：返回存档数据', async () => {
      ;(globalThis as any).getMethod = vi.fn(() => 'GET')
      getQueryMock.mockReturnValueOnce({ saveId: SAVE_ID })
      const saveData = makeSaveData()
      dbMock.limitMock.mockReturnValueOnce([
        { saveData, updatedAt: new Date('2026-01-01') }
      ])

      const res = (await handler(makeEvent())) as any
      expect(res.ok).toBe(true)
      expect(res.data.save).toEqual(saveData)
      expect(res.data.updatedAt).toBeTypeOf('number')
    })

    it('拉取不存在：404', async () => {
      ;(globalThis as any).getMethod = vi.fn(() => 'GET')
      getQueryMock.mockReturnValueOnce({ saveId: SAVE_ID })
      dbMock.limitMock.mockReturnValueOnce([])

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(404)
      expect(res.data.error.code).toBe('SAVE_NOT_FOUND')
    })

    it('拉取参数错误：saveId 缺失', async () => {
      ;(globalThis as any).getMethod = vi.fn(() => 'GET')
      getQueryMock.mockReturnValueOnce({})

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(400)
    })

    it('拉取参数错误：saveId 非 UUID', async () => {
      ;(globalThis as any).getMethod = vi.fn(() => 'GET')
      getQueryMock.mockReturnValueOnce({ saveId: 'not-uuid' })

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(400)
    })
  })

  it('不支持的方法：405', async () => {
    ;(globalThis as any).getMethod = vi.fn(() => 'DELETE')
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(405)
    expect(res.data.error.code).toBe('METHOD_NOT_ALLOWED')
  })
})
