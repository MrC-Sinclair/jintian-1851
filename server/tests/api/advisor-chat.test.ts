/**
 * @file advisor-chat API 集成测试（SSE 流式）
 *
 * 覆盖正常流式 / 参数错误 / 锁冲突 / LLM 失败 / reasoning 过滤 / 截断
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({ chat: vi.fn(() => 'mocked-model') }))
}))
vi.mock('ai', () => ({
  streamText: vi.fn(),
  tool: vi.fn((def) => def),
  stepCountIs: vi.fn((n) => n)
}))
vi.mock('../../server/utils/siliconflow-fetch', () => ({
  createSiliconFlowFetch: vi.fn(() => vi.fn())
}))

import { streamText } from 'ai'
import handler from '../../server/api/game/advisor-chat'
import { acquireLock, clearLocks } from '../../server/utils/concurrency-lock'

const streamTextMock = vi.mocked(streamText)
const readBodyMock = (globalThis as any).readBody as ReturnType<typeof vi.fn>
const SAVE_ID = '550e8400-e29b-41d4-a716-446655440000'

function makeEvent(): any {
  return {
    node: {
      res: {
        write: vi.fn(async () => {}),
        end: vi.fn()
      }
    }
  }
}

function makeBody(overrides = {}) {
  return {
    saveId: SAVE_ID,
    turn: 2,
    messages: [
      {
        role: 'user',
        content: '军师，眼下粮价飞涨，当如何处之？',
        turn: 2,
        timestamp: 1700000000000
      }
    ],
    character: {
      background: '文官',
      backgroundPerks: { politics: 5 },
      factionId: 'qing-ting',
      factionName: '清廷',
      factionSummary: '大清朝廷'
    },
    stateSnapshot: {
      turn: 2,
      date: { year: 1851, month: 2 },
      attributes: { military: 50, economy: 50, politics: 50, people: 50, diplomacy: 50 },
      resources: { silver: 1000, troops: 500, food: 200, reputation: 30 }
    },
    recentEvents: [],
    ...overrides
  }
}

/** 构造 mock fullStream 异步迭代器 */
function makeFullStream(chunks: Array<{ type: string; text?: string; textDelta?: string }>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk
      }
    }
  }
}

describe('POST /api/game/advisor-chat (SSE)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLocks()
  })

  it('正常流式：text-delta 写为 SSE，最后 [DONE]', async () => {
    streamTextMock.mockReturnValueOnce({
      fullStream: makeFullStream([
        { type: 'text-delta', text: '主公' },
        { type: 'text-delta', text: '莫慌' }
      ])
    } as any)
    readBodyMock.mockResolvedValueOnce(makeBody())
    const event = makeEvent()

    await handler(event)

    const write = event.node.res.write as ReturnType<typeof vi.fn>
    expect(write).toHaveBeenCalledWith('data: {"delta":"主公"}\n\n')
    expect(write).toHaveBeenCalledWith('data: {"delta":"莫慌"}\n\n')
    expect(write).toHaveBeenCalledWith('data: [DONE]\n\n')
    expect(event.node.res.end).toHaveBeenCalled()
  })

  it('reasoning-delta 被过滤（不写入 SSE）', async () => {
    streamTextMock.mockReturnValueOnce({
      fullStream: makeFullStream([
        { type: 'text-delta', text: '主公' },
        { type: 'reasoning-delta', textDelta: '思考中...' },
        { type: 'text-delta', text: '莫慌' }
      ])
    } as any)
    readBodyMock.mockResolvedValueOnce(makeBody())
    const event = makeEvent()

    await handler(event)

    const write = event.node.res.write as ReturnType<typeof vi.fn>
    const allCalls = write.mock.calls.map((c: any[]) => c[0])
    expect(allCalls).toEqual([
      'data: {"delta":"主公"}\n\n',
      'data: {"delta":"莫慌"}\n\n',
      'data: [DONE]\n\n'
    ])
    expect(allCalls.some((s: string) => s.includes('思考中'))).toBe(false)
  })

  it('参数错误：最后一条消息 role 非 user', async () => {
    readBodyMock.mockResolvedValueOnce(
      makeBody({
        messages: [
          { role: 'assistant', content: '上回所言', turn: 1, timestamp: 1 },
          { role: 'assistant', content: '再次建言', turn: 2, timestamp: 2 }
        ]
      })
    )
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
    expect(res.data.error.code).toBe('INVALID_PARAMS')
  })

  it('参数错误：saveId 非 UUID', async () => {
    readBodyMock.mockResolvedValueOnce(makeBody({ saveId: 'bad' }))
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
  })

  it('参数错误：messages 为空数组', async () => {
    readBodyMock.mockResolvedValueOnce(makeBody({ messages: [] }))
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
  })

  it('锁冲突：429（不写流式响应）', async () => {
    const release = await acquireLock(SAVE_ID)
    try {
      readBodyMock.mockResolvedValueOnce(makeBody())
      const event = makeEvent()
      const res = (await handler(event)) as any
      expect(res.statusCode).toBe(429)
      expect(res.data.error.code).toBe('CONCURRENT_REQUEST')
      expect(event.node.res.write).not.toHaveBeenCalled()
    } finally {
      release()
    }
  })

  it('LLM 失败：写 error SSE 后 end', async () => {
    streamTextMock.mockImplementationOnce(() => {
      throw new Error('LLM boom')
    })
    readBodyMock.mockResolvedValueOnce(makeBody())
    const event = makeEvent()

    await handler(event)

    const write = event.node.res.write as ReturnType<typeof vi.fn>
    expect(write).toHaveBeenCalledWith('data: {"error":"AI_CALL_FAILED"}\n\n')
    expect(event.node.res.end).toHaveBeenCalled()
  })

  it('消息超 20 条截断：设置 X-Truncated-Messages header', async () => {
    streamTextMock.mockReturnValueOnce({
      fullStream: makeFullStream([{ type: 'text-delta', text: '好' }])
    } as any)
    const manyMessages = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg${i}`,
      turn: 1,
      timestamp: i
    }))
    // 最后一条必须是 user
    manyMessages[24] = { role: 'user', content: 'last', turn: 1, timestamp: 24 }
    readBodyMock.mockResolvedValueOnce(makeBody({ messages: manyMessages }))
    const event = makeEvent()

    await handler(event)

    expect((globalThis as any).setResponseHeader).toHaveBeenCalledWith(
      event,
      'X-Truncated-Messages',
      'true'
    )
  })
})
