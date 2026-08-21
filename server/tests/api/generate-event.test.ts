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

import { generateObject } from 'ai'
import handler from '../../server/api/game/generate-event'
import { clearCache } from '../../server/utils/ai-cache'
import { acquireLock, clearLocks } from '../../server/utils/concurrency-lock'
import { createGetRecentEventsTool } from '../../server/tools/get-recent-events'

const generateObjectMock = vi.mocked(generateObject)
const readBodyMock = (globalThis as any).readBody as ReturnType<typeof vi.fn>

const SAVE_ID = '550e8400-e29b-41d4-a716-446655440000'

function makeStateSnapshot(turn = 1, year = 1850) {
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

  it('时间窗口前置未满足：甲午战争需洋务运动先完成', async () => {
    // 1894 年，甲午战争前置 yang-wu-yun-dong 未完成 → 不触发甲午，走 LLM
    readBodyMock.mockResolvedValueOnce(
      makeBody(2, {
        stateSnapshot: {
          ...makeStateSnapshot(2),
          date: { year: 1894, month: 1 }
        }
      })
    )
    const gameEvent = makeGameEvent()
    generateObjectMock.mockResolvedValueOnce({ object: gameEvent } as any)
    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.event.chainId).toBeUndefined()
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
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
    readBodyMock.mockResolvedValueOnce(makeBody(2, { stateSnapshot: makeStateSnapshot(2, 1850) }))
    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.event.chainId).toBeUndefined()
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
  })

  // ============ 缓存键扩展（T2.2）============

  it('缓存键差异：同 turn 不同 pendingChainNodes 时缓存键不同', async () => {
    const gameEvent = makeGameEvent()
    // 第一次：year=1850 不触发时间窗口，走 LLM 写入缓存
    generateObjectMock.mockResolvedValueOnce({ object: gameEvent } as any)
    readBodyMock.mockResolvedValueOnce(makeBody(2, { stateSnapshot: makeStateSnapshot(2, 1850), pendingChainNodes: [] }))
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
})
