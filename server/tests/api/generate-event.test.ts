/**
 * @file generate-event API 集成测试
 *
 * 覆盖正常 / 缓存命中 / 参数错误 / 首回合 / 并发锁 / 降级
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({ chat: vi.fn(() => 'mocked-model') }))
}))
vi.mock('ai', () => ({ generateObject: vi.fn(), tool: vi.fn((def) => def) }))
vi.mock('../../server/utils/siliconflow-fetch', () => ({
  createSiliconFlowFetch: vi.fn(() => vi.fn())
}))
vi.mock('../../server/tools/get-recent-events', () => ({
  createGetRecentEventsTool: vi.fn(() => ({
    execute: vi.fn(async ({ limit }: { limit?: number }) => ({
      events: [
        {
          turn: 1,
          eventType: '随机' as const,
          title: `工具注入事件${limit ?? 5}`,
          description: '测试注入事件',
          playerChoice: '测试选择',
          effects: {}
        }
      ]
    }))
  }))
}))
// AI 长期记忆（任务5）：隔离 memory 模块，默认无命中、写入为 no-op，避免真实网络/DB 调用
vi.mock('../../server/utils/memory', () => ({
  searchEventMemories: vi.fn(() => Promise.resolve([])),
  writeEventMemory: vi.fn(() => Promise.resolve())
}))

import { generateObject } from 'ai'
import handler from '../../server/api/game/generate-event'
import { clearCache } from '../../server/utils/ai-cache'
import { acquireLock, clearLocks } from '../../server/utils/concurrency-lock'
import { createGetRecentEventsTool } from '../../server/tools/get-recent-events'
import { searchEventMemories, writeEventMemory } from '../../server/utils/memory'

const generateObjectMock = vi.mocked(generateObject)
const readBodyMock = (globalThis as any).readBody as ReturnType<typeof vi.fn>
const searchEventMemoriesMock = vi.mocked(searchEventMemories)
const writeEventMemoryMock = vi.mocked(writeEventMemory)

const SAVE_ID = '550e8400-e29b-41d4-a716-446655440000'

/**
 * 默认年份取 1912（全部剧情链锚点都已过去）。
 *
 * 旧默认值 1850 的作用是「不命中任何链 → 走 LLM 分支」，因为当时按 `startYear === 当前年`
 * 严格匹配。改为「取下一条 startYear ≥ 当前年 的链」后，1850~1911 之间任何年份都会命中
 * 未来锚点并触发时光跳跃，只有晚于最后一条链（1911）的年份才真正落到 LLM 分支。
 */
function makeStateSnapshot(turn = 1, year = 1912) {
  return {
    turn,
    date: { year, month: 1 },
    attributes: { military: 50, economy: 50, politics: 50, people: 50, diplomacy: 50 },
    resources: { silver: 1000, troops: 500, food: 200, reputation: 30 }
  }
}

function makeBody(turn = 1, overrides: Record<string, any> = {}) {
  return {
    saveId: SAVE_ID,
    turn,
    stateSnapshot: makeStateSnapshot(turn),
    character: {
      background: '文官',
      factionName: '清廷',
      factionSummary: '大清朝廷'
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
    recentEvents: [],
    ...overrides
  }
}

function makeEvent(): any {
  return { node: { res: { write: vi.fn(async () => {}), end: vi.fn() } } }
}

function makeGameEvent() {
  return {
    title: '粮价飞涨',
    description: '江南粮价飞涨，百姓怨声载道',
    eventType: '民生',
    options: [
      { id: 'a', label: '开仓放粮', effects: { people: 10, silver: -200 } },
      { id: 'b', label: '强令平价', effects: { people: 4, economy: -8 } }
    ]
  }
}

describe('POST /api/game/generate-event', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).setHeader = vi.fn()
    clearCache()
    clearLocks()
  })

  it('正常：LLM 返回事件', async () => {
    const gameEvent = makeGameEvent()
    generateObjectMock.mockResolvedValueOnce({ object: gameEvent } as any)
    readBodyMock.mockResolvedValueOnce(makeBody(2))

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.event).toEqual(gameEvent)
  })

  it('缓存命中：返回缓存 + X-Cache: HIT header', async () => {
    const gameEvent = makeGameEvent()
    generateObjectMock.mockResolvedValueOnce({ object: gameEvent } as any)
    readBodyMock.mockResolvedValueOnce(makeBody(2))
    // 第一次调用：写缓存
    await handler(makeEvent())

    // 第二次相同 body：应命中缓存
    readBodyMock.mockResolvedValueOnce(makeBody(2))
    const event2 = makeEvent()
    const res = (await handler(event2)) as any
    expect(res.ok).toBe(true)
    expect(res.data.event).toEqual(gameEvent)
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event2, 'X-Cache', 'HIT')
    // generateObject 只调用 1 次（第二次命中缓存不调 LLM）
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
  })

  it('参数错误：saveId 非 UUID', async () => {
    readBodyMock.mockResolvedValueOnce(makeBody(2, { saveId: 'not-uuid' }))
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
    expect(res.data.error.code).toBe('INVALID_PARAMS')
  })

  it('参数错误：turn 非正整数', async () => {
    readBodyMock.mockResolvedValueOnce(makeBody(0))
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
  })

  it('首回合特殊处理：turn=1 prompt 含"游戏开场"', async () => {
    const gameEvent = makeGameEvent()
    generateObjectMock.mockResolvedValueOnce({ object: gameEvent } as any)
    readBodyMock.mockResolvedValueOnce(makeBody(1))

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    const promptArg = (generateObjectMock.mock.calls[0][0] as any).prompt
    expect(promptArg).toContain('游戏开场')
  })

  it('并发锁冲突：isLocked 返回 true 时 429', async () => {
    // 先获取锁，让 isLocked 返回 true
    const release = await acquireLock(SAVE_ID)
    try {
      readBodyMock.mockResolvedValueOnce(makeBody(2))
      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(429)
      expect(res.data.error.code).toBe('CONCURRENT_REQUEST')
      expect(generateObjectMock).not.toHaveBeenCalled()
    } finally {
      release()
    }
  })

  it('降级：LLM 2 次失败后返回预置事件', async () => {
    generateObjectMock.mockRejectedValueOnce(new Error('fail1'))
    generateObjectMock.mockRejectedValueOnce(new Error('fail2'))
    readBodyMock.mockResolvedValueOnce(makeBody(3))
    const event = makeEvent()

    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    expect(res.fallback).toBe(true)
    expect(res.data.event).toBeDefined()
    expect(res.data.event.options.length).toBeGreaterThanOrEqual(2)
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Fallback', 'true')
    expect(generateObjectMock).toHaveBeenCalledTimes(2)
  })

  // ============ 剧情链三层触发（T2.1）============

  it('挂起节点优先：pendingChainNodes 非空时返回该节点且不调 LLM', async () => {
    readBodyMock.mockResolvedValueOnce(
      makeBody(2, {
        pendingChainNodes: [{ chainId: 'tai-ping-tian-guo', nodeId: 'node-3', scheduledTurn: 2 }]
      })
    )
    const event = makeEvent()
    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    // 返回金田起义链的 node-3（天京事变）
    expect(res.data.event.chainId).toBe('tai-ping-tian-guo')
    expect(res.data.event.chainNodeId).toBe('node-3')
    expect(res.data.event.chainProgress).toEqual({ current: 3, total: 5 })
    expect(res.data.event.eventType).toBe('历史剧情')
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Event-Source', 'pending-chain')
    // 不调 LLM
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  it('时间窗口匹配：1851 年命中太平天国首节点', async () => {
    // stateSnapshot.year = 1851，completed/active 为空，无前置依赖
    readBodyMock.mockResolvedValueOnce(makeBody(2, { stateSnapshot: makeStateSnapshot(2, 1851) }))
    const event = makeEvent()
    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    expect(res.data.event.chainId).toBe('tai-ping-tian-guo')
    expect(res.data.event.chainNodeId).toBe('node-1')
    expect(res.data.event.chainProgress).toEqual({ current: 1, total: 5 })
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Event-Source', 'time-window')
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  it('时间窗口被过滤：completedChainIds 含该链时不触发', async () => {
    readBodyMock.mockResolvedValueOnce(makeBody(2, { completedChainIds: ['tai-ping-tian-guo'] }))
    const gameEvent = makeGameEvent()
    generateObjectMock.mockResolvedValueOnce({ object: gameEvent } as any)
    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.event.chainId).toBeUndefined()
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(expect.anything(), 'X-Event-Source', 'llm')
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
  })

  it('前置未满足时跳过该链，取下一条无前置的链并时光跳跃', async () => {
    // 1894 年，甲午战争前置 yang-wu-yun-dong 未完成 → 不触发甲午；
    // 改取下一条 startYear ≥ 1894 且无前置的链（戊戌变法 1898），日历随之跳到 1898-01
    readBodyMock.mockResolvedValueOnce(
      makeBody(2, {
        stateSnapshot: {
          ...makeStateSnapshot(2),
          date: { year: 1894, month: 1 }
        }
      })
    )
    const event = makeEvent()
    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    expect(res.data.event.chainId).toBe('wu-xu-bian-fa')
    expect(res.data.event.eventDate).toEqual({ year: 1898, month: 1 })
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Event-Source', 'time-window')
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  it('时光跳跃：锚点晚于当前年时下发 eventDate 并补「岁月流逝」过场文案', async () => {
    // 日历 1853，太平天国与捻军均已完成 → 下一条是第二次鸦片战争（1856）
    readBodyMock.mockResolvedValueOnce(
      makeBody(2, {
        stateSnapshot: makeStateSnapshot(2, 1853),
        completedChainIds: ['tai-ping-tian-guo', 'nian-jun-zhi-luan']
      })
    )
    const res = (await handler(makeEvent())) as any
    expect(res.data.event.chainId).toBe('er-ci-ya-pian')
    expect(res.data.event.eventDate).toEqual({ year: 1856, month: 1 })
    // 过场文案要交代空档年份与该链大势，不能让玩家觉得回合凭空跳了 3 年
    // （链名由 EventCard 的角标单独展示，此处只补年代与史实概述）
    expect(res.data.event.description).toContain('1853—1856')
    expect(res.data.event.description).toContain('亚罗号事件')
  })

  it('时光跳跃只在链首触发：pending-chain 路径不下发 eventDate', async () => {
    // 链内后续节点走 pending-chain 接续，日历应停在链开始的年代，
    // 否则一条 5 节点的链会把时间往前推 5 次
    readBodyMock.mockResolvedValueOnce(
      makeBody(2, {
        stateSnapshot: makeStateSnapshot(2, 1850),
        pendingChainNodes: [
          { chainId: 'tai-ping-tian-guo', nodeId: 'node-2', scheduledTurn: 3 }
        ]
      })
    )
    const res = (await handler(makeEvent())) as any
    expect(res.data.event.chainId).toBe('tai-ping-tian-guo')
    expect(res.data.event.chainNodeId).toBe('node-2')
    expect(res.data.event.eventDate).toBeUndefined()
  })

  it('时间窗口前置满足：洋务运动完成后 1894 命中甲午', async () => {
    readBodyMock.mockResolvedValueOnce(
      makeBody(2, {
        stateSnapshot: { ...makeStateSnapshot(2), date: { year: 1894, month: 1 } },
        completedChainIds: ['yang-wu-yun-dong']
      })
    )
    const event = makeEvent()
    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    expect(res.data.event.chainId).toBe('jia-wu-zhan-zheng')
    expect(res.data.event.chainNodeId).toBe('node-1')
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Event-Source', 'time-window')
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  it('时间窗口匹配：1851 命中太平天国（seed 中各 startYear 互不相同，无同年多链）', async () => {
    // 1851 仅命中 tai-ping-tian-guo（seed 中捻军 startYear=1853，不与太平天国同年）
    readBodyMock.mockResolvedValueOnce(makeBody(2, { stateSnapshot: makeStateSnapshot(2, 1851) }))
    const event = makeEvent()
    const res = (await handler(event)) as any
    expect(res.data.event.chainId).toBe('tai-ping-tian-guo')
  })

  it('挂起节点 ID 找不到：降级走 LLM 并设 X-Fallback', async () => {
    readBodyMock.mockResolvedValueOnce(
      makeBody(2, { pendingChainNodes: [{ chainId: '不存在', nodeId: 'node-x', scheduledTurn: 2 }] })
    )
    const gameEvent = makeGameEvent()
    generateObjectMock.mockResolvedValueOnce({ object: gameEvent } as any)
    const event = makeEvent()
    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    expect(res.data.event.chainId).toBeUndefined()
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Fallback', 'true')
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Event-Source', 'llm')
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
  })

  it('兼容老客户端：不传剧情链字段时按 default([]) 处理', async () => {
    const gameEvent = makeGameEvent()
    generateObjectMock.mockResolvedValueOnce({ object: gameEvent } as any)
    readBodyMock.mockResolvedValueOnce(makeBody(2, { stateSnapshot: makeStateSnapshot(2, 1912) }))
    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.event.chainId).toBeUndefined()
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
  })

  // ============ 缓存键扩展（T2.2）============

  it('缓存键差异：同 turn 不同 pendingChainNodes 时缓存键不同', async () => {
    const gameEvent = makeGameEvent()
    // 第一次：year=1912 已过全部锚点，不命中剧情链，走 LLM 写入缓存
    generateObjectMock.mockResolvedValueOnce({ object: gameEvent } as any)
    readBodyMock.mockResolvedValueOnce(makeBody(2, { stateSnapshot: makeStateSnapshot(2, 1912), pendingChainNodes: [] }))
    await handler(makeEvent())

    // 第二次：year=1851 触发时间窗口匹配（缓存键因 year 不同而不命中），返回剧情链首节点
    readBodyMock.mockResolvedValueOnce(
      makeBody(2, {
        stateSnapshot: makeStateSnapshot(2, 1851),
        pendingChainNodes: [{ chainId: 'tai-ping-tian-guo', nodeId: 'node-1', scheduledTurn: 2 }]
      })
    )
    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.event.chainId).toBe('tai-ping-tian-guo')
    // 第一次 LLM 调用 1 次（第二次命中时间窗口，不调 LLM）
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
  })

  // ============ 工具结果注入（Stage 4 / T4.1 / T4.2）============

  it('T4.1：LLM 路径前调用 get-recent-events 工具（limit 10），结果注入 prompt', async () => {
    // body recentEvents 为空，prompt 中最近事件只能来自工具注入
    generateObjectMock.mockResolvedValueOnce({ object: makeGameEvent() } as any)
    readBodyMock.mockResolvedValueOnce(makeBody(2, { recentEvents: [] }))
    const event = makeEvent()

    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    const promptArg = (generateObjectMock.mock.calls[0][0] as any).prompt
    // 工具以 limit=10 调用，注入了标题为「工具注入事件10」的事件
    expect(promptArg).toContain('工具注入事件10')
    expect((globalThis as any).setHeader).not.toHaveBeenCalledWith(event, 'X-Tool-Fallback', 'true')
  })

  it('T4.2：工具调用失败降级到 body recentEvents，并设 X-Tool-Fallback: true', async () => {
    // 让 createGetRecentEventsTool 工厂抛错，使 createTools 失败
    vi.mocked(createGetRecentEventsTool).mockImplementationOnce(() => {
      throw new Error('tool boom')
    })
    generateObjectMock.mockResolvedValueOnce({ object: makeGameEvent() } as any)
    readBodyMock.mockResolvedValueOnce(makeBody(3, { recentEvents: [] }))
    const event = makeEvent()

    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Tool-Fallback', 'true')
    // 降级后 prompt 不含有工具注入内容（recentEvents 为空 → 渲染占位）
    const promptArg = (generateObjectMock.mock.calls[0][0] as any).prompt
    expect(promptArg).not.toContain('工具注入事件')
  })

  // ============ AI 长期记忆：generate-event 接入（任务5）============

  it('任务5：LLM 路径前检索历史事件命中 → prompt 注入避重清单 + X-Dedup-Applied: true', async () => {
    searchEventMemoriesMock.mockResolvedValueOnce([
      { content: '粮价飞涨百姓怨声载道', turn: 2, similarity: 0.82 },
      { content: '江南水患官府赈灾', turn: 3, similarity: 0.79 }
    ])
    generateObjectMock.mockResolvedValueOnce({ object: makeGameEvent() } as any)
    readBodyMock.mockResolvedValueOnce(makeBody(5))
    const event = makeEvent()
    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    const promptArg = (generateObjectMock.mock.calls[0][0] as any).prompt
    expect(promptArg).toContain('避免重复')
    expect(promptArg).toContain('粮价飞涨百姓怨声载道')
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Dedup-Applied', 'true')
  })

  it('任务5：去重检索无命中 → 不注入避重清单且不设 X-Dedup-Applied', async () => {
    searchEventMemoriesMock.mockResolvedValueOnce([])
    generateObjectMock.mockResolvedValueOnce({ object: makeGameEvent() } as any)
    readBodyMock.mockResolvedValueOnce(makeBody(5))
    const event = makeEvent()
    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    const promptArg = (generateObjectMock.mock.calls[0][0] as any).prompt
    expect(promptArg).not.toContain('避免重复')
    expect((globalThis as any).setHeader).not.toHaveBeenCalledWith(event, 'X-Dedup-Applied', 'true')
  })

  it('任务5：去重检索抛错 → 降级跳过不阻断生成 + 设 X-Memory-Skip', async () => {
    searchEventMemoriesMock.mockRejectedValueOnce(new Error('pg down'))
    generateObjectMock.mockResolvedValueOnce({ object: makeGameEvent() } as any)
    readBodyMock.mockResolvedValueOnce(makeBody(5))
    const event = makeEvent()
    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
    const promptArg = (generateObjectMock.mock.calls[0][0] as any).prompt
    expect(promptArg).not.toContain('避免重复')
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Memory-Skip', 'true')
  })

  it('任务5：LLM 成功路径 fire-and-forget 写入 game_events（仅 llm 路径）', async () => {
    searchEventMemoriesMock.mockResolvedValueOnce([])
    const gameEvent = makeGameEvent()
    generateObjectMock.mockResolvedValueOnce({ object: gameEvent } as any)
    readBodyMock.mockResolvedValueOnce(makeBody(5))
    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(writeEventMemoryMock).toHaveBeenCalledTimes(1)
    const arg = writeEventMemoryMock.mock.calls[0][0]
    expect(arg.saveId).toBe(SAVE_ID)
    expect(arg.turn).toBe(5)
    expect(arg.eventType).toBe(gameEvent.eventType)
    expect(arg.content).toBe(`${gameEvent.title} ${gameEvent.description}`)
    expect(typeof arg.eventId).toBe('string')
    expect(arg.eventId.length).toBeGreaterThan(0)
  })
})
