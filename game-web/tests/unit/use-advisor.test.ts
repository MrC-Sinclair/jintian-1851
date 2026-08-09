/**
 * @file useAdvisor.ts 单元测试
 *
 * 覆盖：
 *   - send 立即把用户消息写入 store
 *   - onChunk 累积到 streamingText
 *   - onDone 把完整 assistant 消息追加到 save.advisorMessages
 *   - onError 显示「军师沉默」占位 + 触发 onError 回调
 *   - 重复 send 被忽略（isStreaming=true）
 *   - 空内容 send 直接返回 false
 *   - 无存档 send 返回 false + 触发 onError('NO_SAVE')
 *   - persistSave 在 onDone 后被调用（异步持久化）
 *   - abort 取消流式 + 重置状态
 *   - advisorMessages 超过 20 条自动截断（store 行为）
 *
 * 通过 mock useSSE 的 connect 拦截请求，避免真实网络调用。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '../../src/stores/game'
import { useAdvisor } from '../../src/composables/useAdvisor'
import type { GameSave } from '../../src/types/game'

// ====================== mock useSSE & useGameState ======================
// vi.hoisted 保证变量在 vi.mock 提升前已初始化
// 用 holder 对象避免重新赋值，测试中通过 mocks.xxx.value 访问
const mocks = vi.hoisted(() => ({
  capturedCallbacks: {
    value: null as {
      onChunk: (delta: string) => void
      onDone: () => void
      onError: (code: string) => void
    } | null
  },
  capturedOptions: {
    value: null as { firstChunkTimeoutMs?: number } | null
  },
  abortFn: vi.fn(),
  persistSaveMock: vi.fn()
}))

vi.mock('../../src/composables/useSSE', () => ({
  useSSE: () => ({
    connect: (
      _url: string,
      _body: unknown,
      options: {
        callbacks: {
          onChunk: (delta: string) => void
          onDone: () => void
          onError: (code: string) => void
        }
        firstChunkTimeoutMs?: number
      }
    ) => {
      mocks.capturedCallbacks.value = options.callbacks
      mocks.capturedOptions.value = options
      return {
        abort: mocks.abortFn
      }
    }
  })
}))

vi.mock('../../src/composables/useGameState', () => ({
  useGameState: () => ({
    save: mocks.persistSaveMock
  })
}))

// 测试用便捷访问器
const capturedCallbacks = () => mocks.capturedCallbacks.value
const capturedOptions = () => mocks.capturedOptions.value
const abortFn = mocks.abortFn
const persistSaveMock = mocks.persistSaveMock

// ====================== 工具函数 ======================

function createMockSave(): GameSave {
  return {
    saveVersion: 1,
    saveId: 'test-save-id',
    deviceId: 'test-device',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    character: {
      background: '文官',
      backgroundPerks: { politics: 10 },
      factionId: 'f1',
      factionName: '清廷',
      factionSummary: '晚清朝廷'
    },
    state: {
      turn: 3,
      date: { year: 1851, month: 3 },
      attributes: {
        military: 50,
        economy: 50,
        politics: 55,
        people: 50,
        diplomacy: 50
      },
      resources: {
        silver: 1000,
        troops: 500,
        food: 800,
        reputation: 10
      }
    },
    factions: [],
    events: [],
    advisorMessages: [],
    ended: false
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  mocks.capturedCallbacks.value = null
  mocks.capturedOptions.value = null
  mocks.abortFn.mockClear()
  mocks.persistSaveMock.mockReset()
  mocks.persistSaveMock.mockResolvedValue(undefined)
  // T2.6：重置模块级 briefing 状态（避免跨测试污染）
  const { setBriefing } = useAdvisor()
  setBriefing(null, 0)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ====================== 测试 ======================

describe('useAdvisor - 前置校验', () => {
  it('无存档时返回 false + 触发 onError(NO_SAVE)', async () => {
    const onError = vi.fn()
    const { send } = useAdvisor({ onError })
    const result = await send('你好')
    expect(result).toBe(false)
    expect(onError).toHaveBeenCalledWith('NO_SAVE')
  })

  it('空内容返回 false，不触发 onError', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const onError = vi.fn()
    const { send } = useAdvisor({ onError })
    const result = await send('   ')
    expect(result).toBe(false)
    expect(onError).not.toHaveBeenCalled()
  })

  it('流式中重复 send 返回 false', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const { send } = useAdvisor()
    const p1 = send('第一条')
    // 此时 isStreaming=true（send 内部已设置）
    const result2 = await send('第二条')
    expect(result2).toBe(false)
    // 触发 onDone 让 p1 完成，避免悬挂
    capturedCallbacks()!.onDone()
    await p1
  })
})

describe('useAdvisor - 正常流式', () => {
  it('send 立即把用户消息写入 store', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const { send } = useAdvisor()

    const p = send('主公如何应对太平军？')
    // 立即检查用户消息已入 store（不等 onDone）
    expect(store.currentSave!.advisorMessages).toHaveLength(1)
    expect(store.currentSave!.advisorMessages[0].role).toBe('user')
    expect(store.currentSave!.advisorMessages[0].content).toBe('主公如何应对太平军？')
    expect(store.currentSave!.advisorMessages[0].turn).toBe(3)

    // 完成流式
    capturedCallbacks()!.onChunk('当以')
    capturedCallbacks()!.onChunk('稳守为上')
    capturedCallbacks()!.onDone()
    await p
  })

  it('onChunk 累积到 streamingText', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const { send, streamingText } = useAdvisor()

    expect(streamingText.value).toBe('')
    const p = send('test')
    expect(streamingText.value).toBe('')

    capturedCallbacks()!.onChunk('第一')
    expect(streamingText.value).toBe('第一')

    capturedCallbacks()!.onChunk('第二')
    expect(streamingText.value).toBe('第一第二')

    capturedCallbacks()!.onDone()
    await p
  })

  it('onDone 追加 assistant 消息 + 持久化', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const { send, isStreaming } = useAdvisor()

    const p = send('test')
    expect(isStreaming.value).toBe(true)

    capturedCallbacks()!.onChunk('军师建议')
    capturedCallbacks()!.onDone()
    const result = await p

    expect(result).toBe(true)
    expect(isStreaming.value).toBe(false)
    // store.isAdvisorStreaming 也复位
    expect(store.isAdvisorStreaming).toBe(false)
    // advisorMessages 含 user + assistant
    expect(store.currentSave!.advisorMessages).toHaveLength(2)
    expect(store.currentSave!.advisorMessages[1].role).toBe('assistant')
    expect(store.currentSave!.advisorMessages[1].content).toBe('军师建议')
    expect(store.currentSave!.advisorMessages[1].turn).toBe(3)
    // 持久化被调用
    expect(persistSaveMock).toHaveBeenCalledTimes(1)
  })

  it('onDone 时空文本不追加 assistant 消息', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const { send } = useAdvisor()

    const p = send('test')
    // 直接触发 onDone，streamingText 仍为空
    capturedCallbacks()!.onDone()
    const result = await p

    expect(result).toBe(true)
    // 只有 user 消息，无 assistant
    expect(store.currentSave!.advisorMessages).toHaveLength(1)
    // 持久化不被调用
    expect(persistSaveMock).not.toHaveBeenCalled()
  })

  it('firstChunkTimeoutMs 可通过 options 覆盖', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const { send } = useAdvisor({ firstChunkTimeoutMs: 5000 })

    const p = send('test')
    expect(capturedOptions()!.firstChunkTimeoutMs).toBe(5000)
    capturedCallbacks()!.onDone()
    await p
  })
})

describe('useAdvisor - 错误处理', () => {
  it('onError 追加「军师沉默」占位 + 触发 onError 回调', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const onError = vi.fn()
    const { send, isStreaming, errorCode } = useAdvisor({ onError })

    const p = send('test')
    capturedCallbacks()!.onError('AI_CALL_FAILED')
    const result = await p

    expect(result).toBe(false)
    expect(isStreaming.value).toBe(false)
    expect(errorCode.value).toBe('AI_CALL_FAILED')
    expect(store.isAdvisorStreaming).toBe(false)
    // 占位消息
    expect(store.currentSave!.advisorMessages).toHaveLength(2)
    expect(store.currentSave!.advisorMessages[1].role).toBe('assistant')
    expect(store.currentSave!.advisorMessages[1].content).toContain('军师沉默')
    expect(onError).toHaveBeenCalledWith('AI_CALL_FAILED')
    // 失败时不持久化
    expect(persistSaveMock).not.toHaveBeenCalled()
  })

  it('onError 后可继续发送（state 已重置）', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const { send, isStreaming } = useAdvisor()

    const p1 = send('first')
    capturedCallbacks()!.onError('TIMEOUT')
    await p1
    expect(isStreaming.value).toBe(false)

    // 第二次发送应能正常进入流式
    const p2 = send('second')
    expect(isStreaming.value).toBe(true)
    capturedCallbacks()!.onDone()
    await p2
    expect(isStreaming.value).toBe(false)
  })
})

describe('useAdvisor - abort', () => {
  it('abort 调用底层 task.abort + 重置状态', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const { send, abort, isStreaming } = useAdvisor()

    const p = send('test')
    expect(isStreaming.value).toBe(true)

    abort()
    expect(abortFn).toHaveBeenCalledOnce()
    expect(isStreaming.value).toBe(false)
    expect(store.isAdvisorStreaming).toBe(false)

    // 注意：abort 不触发 onDone/onError，promise 保持悬挂
    // 测试中通过 onDone 显式完成避免悬挂
    capturedCallbacks()!.onDone()
    await p
  })

  it('无流式任务时 abort 不报错', () => {
    const { abort } = useAdvisor()
    expect(() => abort()).not.toThrow()
  })
})

describe('useAdvisor - 截断', () => {
  it('advisorMessages 超过 20 条自动截断（store 行为）', async () => {
    const store = useGameStore()
    const save = createMockSave()
    // 预填 19 条消息，本次 send 会追加 user + assistant = 21 条，触发截断
    for (let i = 1; i <= 19; i++) {
      save.advisorMessages.push({
        role: i % 2 === 0 ? 'assistant' : 'user',
        content: `历史消息${i}`,
        turn: 1,
        timestamp: Date.now() + i
      })
    }
    store.setSave(save)

    const { send } = useAdvisor()
    const p = send('新消息')
    capturedCallbacks()!.onChunk('军师回复')
    capturedCallbacks()!.onDone()
    await p

    // 19 + 2 = 21，截断为 20
    expect(store.currentSave!.advisorMessages).toHaveLength(20)
    // 最新一条是本次 assistant 回复
    expect(store.currentSave!.advisorMessages[19].content).toBe('军师回复')
    // 最旧一条被截断（历史消息1 应已被剔除）
    expect(store.currentSave!.advisorMessages[0].content).not.toBe('历史消息1')
  })
})

// ====================== T2.4: 工具调用过程记录 ======================
describe('useAdvisor - T2.4 工具调用过程', () => {
  it('onToolCall 追加 calling 状态记录', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const { send, toolCalls } = useAdvisor()
    const p = send('test')
    expect(toolCalls.value).toHaveLength(0)
    capturedCallbacks()!.onToolCall!('get-faction-info', { factionId: 'xiang-jun' })
    expect(toolCalls.value).toHaveLength(1)
    expect(toolCalls.value[0].toolName).toBe('get-faction-info')
    expect(toolCalls.value[0].label).toBe('势力详情')
    expect(toolCalls.value[0].status).toBe('calling')
    expect(toolCalls.value[0].args).toEqual({ factionId: 'xiang-jun' })
    capturedCallbacks()!.onDone()
    await p
  })

  it('onToolResult 成功 → 匹配最近 calling 记录并更新为 done', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const { send, toolCalls } = useAdvisor()
    const p = send('test')
    capturedCallbacks()!.onToolCall!('get-recent-events', { limit: 3 })
    capturedCallbacks()!.onToolResult!('get-recent-events', { events: [{ id: 'e1' }] })
    expect(toolCalls.value[0].status).toBe('done')
    expect(toolCalls.value[0].result).toEqual({ events: [{ id: 'e1' }] })
    capturedCallbacks()!.onDone()
    await p
  })

  it('onToolResult 失败（result 含 error）→ 更新为 fail', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const { send, toolCalls } = useAdvisor()
    const p = send('test')
    capturedCallbacks()!.onToolCall!('get-faction-info', { factionId: 'nope' })
    capturedCallbacks()!.onToolResult!('get-faction-info', {
      error: 'FACTION_NOT_FOUND',
      detail: '不存在'
    })
    expect(toolCalls.value[0].status).toBe('fail')
    expect(toolCalls.value[0].result).toEqual({ error: 'FACTION_NOT_FOUND', detail: '不存在' })
    capturedCallbacks()!.onDone()
    await p
  })

  it('多次同工具调用，结果匹配最近一条 calling 记录', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const { send, toolCalls } = useAdvisor()
    const p = send('test')
    capturedCallbacks()!.onToolCall!('get-all-factions', {})
    capturedCallbacks()!.onToolCall!('get-all-factions', {})
    expect(toolCalls.value).toHaveLength(2)
    capturedCallbacks()!.onToolResult!('get-all-factions', { factions: [{ id: 'a' }] })
    // 最近的第二条变为 done，第一条仍为 calling
    expect(toolCalls.value[1].status).toBe('done')
    expect(toolCalls.value[0].status).toBe('calling')
    capturedCallbacks()!.onToolResult!('get-all-factions', { factions: [{ id: 'b' }] })
    expect(toolCalls.value[0].status).toBe('done')
    capturedCallbacks()!.onDone()
    await p
  })

  it('新一次 send 清空上次的 toolCalls', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const { send, toolCalls } = useAdvisor()
    const p1 = send('first')
    capturedCallbacks()!.onToolCall!('get-recent-events', { limit: 5 })
    capturedCallbacks()!.onDone()
    await p1
    expect(toolCalls.value).toHaveLength(1)
    // 第二次发送应清空
    const p2 = send('second')
    expect(toolCalls.value).toHaveLength(0)
    capturedCallbacks()!.onDone()
    await p2
  })
})

// ====================== T2.6: briefing 模块级单例 ======================
describe('useAdvisor - T2.6 briefing 模块级单例', () => {
  it('初始 briefing 为 null, briefingTurn 为 null', () => {
    const { briefing, briefingTurn } = useAdvisor()
    expect(briefing.value).toBeNull()
    expect(briefingTurn.value).toBeNull()
  })

  it('setBriefing(b, turn) 写入 briefing + briefingTurn', () => {
    const { setBriefing, briefing, briefingTurn } = useAdvisor()
    setBriefing({ summary: '局势紧张', suggestion: '建议备战' }, 5)
    expect(briefing.value).toEqual({ summary: '局势紧张', suggestion: '建议备战' })
    expect(briefingTurn.value).toBe(5)
  })

  it('setBriefing(null, turn) 失败降级：briefing/turn 均重置为 null', () => {
    const { setBriefing, briefing, briefingTurn } = useAdvisor()
    setBriefing({ summary: 'x', suggestion: 'y' }, 5)
    expect(briefing.value).not.toBeNull()
    // 失败降级：传 null 后 briefing 和 briefingTurn 都应为 null
    setBriefing(null, 5)
    expect(briefing.value).toBeNull()
    expect(briefingTurn.value).toBeNull()
  })

  it('briefing/briefingTurn 跨 useAdvisor() 实例共享（模块级单例）', () => {
    // 实例 A 写入
    const { setBriefing } = useAdvisor()
    setBriefing({ summary: '共享', suggestion: '共享建议' }, 7)
    // 实例 B 读取
    const { briefing, briefingTurn } = useAdvisor()
    expect(briefing.value).toEqual({ summary: '共享', suggestion: '共享建议' })
    expect(briefingTurn.value).toBe(7)
  })
})
