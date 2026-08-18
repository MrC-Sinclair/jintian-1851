/**
 * @file resolve-decision API 集成测试
 *
 * 覆盖正常 / 参数错误 / 降级 / 并发锁
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({ chat: vi.fn(() => 'mocked-model') }))
}))
vi.mock('ai', () => ({ generateObject: vi.fn() }))
vi.mock('../../server/utils/siliconflow-fetch', () => ({
  createSiliconFlowFetch: vi.fn(() => vi.fn())
}))

import { generateObject } from 'ai'
import handler from '../../server/api/game/resolve-decision'
import { acquireLock, clearLocks } from '../../server/utils/concurrency-lock'

const generateObjectMock = vi.mocked(generateObject)
const readBodyMock = (globalThis as any).readBody as ReturnType<typeof vi.fn>
const SAVE_ID = '550e8400-e29b-41d4-a716-446655440000'

function makeEvent(): any {
  return { node: { res: { write: vi.fn(async () => {}), end: vi.fn() } } }
}

function makeBody(overrides = {}) {
  return {
    saveId: SAVE_ID,
    turn: 2,
    playerDecision: '开仓放粮赈济灾民',
    stateSnapshot: {
      turn: 2,
      date: { year: 1851, month: 2 },
      attributes: { military: 50, economy: 50, politics: 50, people: 50, diplomacy: 50 },
      resources: { silver: 1000, troops: 500, food: 200, reputation: 30 }
    },
    event: {
      title: '粮价飞涨',
      description: '江南粮价飞涨',
      eventType: '民生',
      options: [
        { id: 'a', label: '开仓放粮', effects: { people: 10, silver: -200 } },
        { id: 'b', label: '强令平价', effects: { people: 4, economy: -8 } }
      ]
    },
    ...overrides
  }
}

/** 前端精简传入的势力上下文（id/name/relationship/status/power） */
function makeFactions() {
  return [
    { id: 'xiang-jun', name: '湘军', relationship: 10, status: 'active', power: 60 },
    { id: 'qing-ting', name: '清廷', relationship: 0, status: 'active', power: 80 }
  ]
}

describe('POST /api/game/resolve-decision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).setHeader = vi.fn()
    clearLocks()
  })

  it('正常：LLM 返回 effects', async () => {
    const effects = { people: 10, silver: -200 }
    generateObjectMock.mockResolvedValueOnce({ object: { effects } } as any)
    readBodyMock.mockResolvedValueOnce(makeBody())

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.effects).toEqual(effects)
    // 未传 factions 时 factionEffects 恒为空数组（向后兼容）
    expect(res.data.factionEffects).toEqual([])
  })

  it('自由行动势力变化：携带 factions 时返回有效 factionEffects', async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        effects: { silver: -50 },
        factionEffects: [{ factionId: 'xiang-jun', relationshipDelta: 15 }]
      }
    } as any)
    readBodyMock.mockResolvedValueOnce(
      makeBody({ playerDecision: '我想暗中资助湘军', factions: makeFactions() })
    )

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.effects).toEqual({ silver: -50 })
    expect(res.data.factionEffects).toEqual([{ factionId: 'xiang-jun', relationshipDelta: 15 }])
  })

  it('幻觉防护：无效 factionId 被 sanitize 丢弃，仅保留有效条目', async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        effects: { silver: -30 },
        factionEffects: [
          { factionId: 'bu-cun-zai', relationshipDelta: 20 }, // AI 编造的势力 → 丢弃
          { factionId: 'qing-ting', powerDelta: -10 } // 有效条目 → 保留
        ]
      }
    } as any)
    readBodyMock.mockResolvedValueOnce(
      makeBody({ playerDecision: '我想削弱清廷', factions: makeFactions() })
    )

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.factionEffects).toEqual([{ factionId: 'qing-ting', powerDelta: -10 }])
  })

  it('疑问句守卫：犹豫签名 factionEffects 恒为空数组且不调 LLM', async () => {
    readBodyMock.mockResolvedValueOnce(
      makeBody({ playerDecision: '怎么能打赢湘军', factions: makeFactions() })
    )

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.hesitation).toBe(true)
    expect(res.data.factionEffects).toEqual([]) // 提问不得改变势力关系
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  it('参数错误：playerDecision 为空', async () => {
    readBodyMock.mockResolvedValueOnce(makeBody({ playerDecision: '' }))
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
    expect(res.data.error.code).toBe('INVALID_PARAMS')
  })

  it('参数错误：playerDecision 超长（>200）', async () => {
    readBodyMock.mockResolvedValueOnce(makeBody({ playerDecision: 'a'.repeat(201) }))
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
  })

  it('参数错误：saveId 非 UUID', async () => {
    readBodyMock.mockResolvedValueOnce(makeBody({ saveId: 'bad' }))
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
  })

  it('降级：LLM 2 次失败后返回默认 effects（全属性 -3）+ 空 factionEffects', async () => {
    generateObjectMock.mockRejectedValueOnce(new Error('fail1'))
    generateObjectMock.mockRejectedValueOnce(new Error('fail2'))
    readBodyMock.mockResolvedValueOnce(
      makeBody({ playerDecision: '我想暗中资助湘军', factions: makeFactions() })
    )
    const event = makeEvent()

    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    expect(res.fallback).toBe(true)
    expect(res.data.effects).toEqual({
      military: -3,
      economy: -3,
      politics: -3,
      people: -3,
      diplomacy: -3
    })
    // 降级不得改动任何势力
    expect(res.data.factionEffects).toEqual([])
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Fallback', 'true')
  })

  it('并发锁冲突：429', async () => {
    const release = await acquireLock(SAVE_ID)
    try {
      readBodyMock.mockResolvedValueOnce(makeBody())
      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(429)
      expect(res.data.error.code).toBe('CONCURRENT_REQUEST')
      expect(generateObjectMock).not.toHaveBeenCalled()
    } finally {
      release()
    }
  })
})
