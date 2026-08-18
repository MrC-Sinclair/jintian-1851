/**
 * @file faction-negotiate API 集成测试
 *
 * 覆盖：letter 正常/counter / settle 裁定 / schema 边界（counterPrice 联动、letter 长度、
 * factionId 一致性）/ sanitize（非法 dealId、price/delta clamp、reply 截断、settle 禁 counter）/
 * 降级（AI 异常、JSON 不可解析）/ 并发锁。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({ chat: vi.fn(() => 'mocked-model') }))
}))
vi.mock('ai', async (importOriginal) => {
  const mod = await importOriginal<typeof import('ai')>()
  return {
    ...mod,
    streamText: vi.fn(),
    stepCountIs: vi.fn(() => ({ type: 'step-count' }))
  }
})
vi.mock('../../server/utils/siliconflow-fetch', () => ({
  createSiliconFlowFetch: vi.fn(() => vi.fn())
}))

import { streamText } from 'ai'
import handler from '../../server/api/game/faction-negotiate'
import { acquireLock, clearLocks } from '../../server/utils/concurrency-lock'

const streamTextMock = vi.mocked(streamText)
const readBodyMock = (globalThis as any).readBody as ReturnType<typeof vi.fn>
const SAVE_ID = '550e8400-e29b-41d4-a716-446655440000'

function makeEvent(): any {
  return { node: { res: { write: vi.fn(async () => {}), end: vi.fn() } } }
}

function makeFaction(overrides = {}) {
  return {
    id: 'huai-jun',
    name: '淮军',
    summary: '李鸿章统领的淮勇武装',
    power: 60,
    relationship: 40,
    status: 'active',
    ...overrides
  }
}

function makeLetterBody(overrides = {}) {
  return {
    saveId: SAVE_ID,
    turn: 2,
    phase: 'letter',
    factionId: 'huai-jun',
    letter: '久闻贵军威名，愿以银钱相赠，共谋大业。',
    character: { background: '文官', factionName: '清廷' },
    stateSnapshot: {
      turn: 2,
      date: { year: 1851, month: 2 },
      attributes: { military: 50, economy: 50, politics: 50, people: 50, diplomacy: 50 },
      resources: { silver: 1000, troops: 500, food: 200, reputation: 30 }
    },
    faction: makeFaction(),
    ...overrides
  }
}

function makeSettleBody(overrides = {}) {
  return makeLetterBody({
    phase: 'settle',
    previousReply: '条件已开，静候佳音。',
    deal: { dealId: 'alliance-deal', price: 160 },
    playerResponse: 'accept',
    ...overrides
  })
}

/** mock streamText 返回指定 JSON 文本 */
function mockAgentJson(obj: unknown) {
  streamTextMock.mockImplementationOnce(() => ({
    text: Promise.resolve(JSON.stringify(obj))
  }) as any)
}

describe('POST /api/game/faction-negotiate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).setHeader = vi.fn()
    clearLocks()
  })

  it('letter 正常：返回 counter + 表内条件', async () => {
    mockAgentJson({
      stance: 'counter',
      reply: '结盟非小事，需银两为证。',
      relationshipDelta: 3,
      deal: { dealId: 'alliance-deal', price: 160 }
    })
    readBodyMock.mockResolvedValueOnce(makeLetterBody())

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.stance).toBe('counter')
    expect(res.data.deal).toEqual({ dealId: 'alliance-deal', price: 160 })
    expect(res.data.relationshipDelta).toBe(3)
    expect(res.fallback).toBeUndefined()
  })

  it('letter 正常：直接应允（accept，无 deal）', async () => {
    mockAgentJson({ stance: 'accept', reply: '允了。', relationshipDelta: 5 })
    readBodyMock.mockResolvedValueOnce(makeLetterBody())

    const res = (await handler(makeEvent())) as any
    expect(res.data.stance).toBe('accept')
    expect(res.data.deal).toBeUndefined()
  })

  it('sanitize：非法 dealId → 丢 deal 且 stance 降 reject', async () => {
    mockAgentJson({
      stance: 'counter',
      reply: '开个条件吧。',
      relationshipDelta: 0,
      deal: { dealId: 'war-deal', price: 100 }
    })
    readBodyMock.mockResolvedValueOnce(makeLetterBody())

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.stance).toBe('reject')
    expect(res.data.deal).toBeUndefined()
  })

  it('sanitize：deal 门槛不满足（alliance-deal 需关系≥35）→ 降 reject', async () => {
    mockAgentJson({
      stance: 'counter',
      reply: '结盟可议。',
      relationshipDelta: 0,
      deal: { dealId: 'alliance-deal', price: 160 }
    })
    readBodyMock.mockResolvedValueOnce(
      makeLetterBody({ faction: makeFaction({ relationship: 10 }) })
    )

    const res = (await handler(makeEvent())) as any
    expect(res.data.stance).toBe('reject')
    expect(res.data.deal).toBeUndefined()
  })

  it('sanitize：越界价格 clamp 回区间（gift-deal 500→120）', async () => {
    mockAgentJson({
      stance: 'counter',
      reply: '薄礼一份。',
      relationshipDelta: 1,
      deal: { dealId: 'gift-deal', price: 500 }
    })
    readBodyMock.mockResolvedValueOnce(makeLetterBody())

    const res = (await handler(makeEvent())) as any
    expect(res.data.deal).toEqual({ dealId: 'gift-deal', price: 120 })
  })

  it('sanitize：relationshipDelta 越界 clamp ±10', async () => {
    mockAgentJson({ stance: 'accept', reply: '允了。', relationshipDelta: 50 })
    readBodyMock.mockResolvedValueOnce(makeLetterBody())

    const res = (await handler(makeEvent())) as any
    expect(res.data.relationshipDelta).toBe(10)
  })

  it('sanitize：reply 超长截断 200 字 / 非法 stance 降 reject / 空 reply 兜底', async () => {
    mockAgentJson({ stance: 'maybe', reply: '字'.repeat(300), relationshipDelta: 2 })
    readBodyMock.mockResolvedValueOnce(makeLetterBody())

    const res = (await handler(makeEvent())) as any
    expect(res.data.stance).toBe('reject')
    expect(res.data.reply.length).toBeLessThanOrEqual(200)

    // 空 reply 兜底
    mockAgentJson({ stance: 'accept', relationshipDelta: 1 })
    readBodyMock.mockResolvedValueOnce(makeLetterBody())
    const res2 = (await handler(makeEvent())) as any
    expect(res2.data.reply).toBe('（无回信）')
  })

  it('settle 正常：accept 成交（无 deal 字段返回）', async () => {
    mockAgentJson({ stance: 'accept', reply: '一言为定。', relationshipDelta: 2 })
    readBodyMock.mockResolvedValueOnce(makeSettleBody())

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.stance).toBe('accept')
    expect(res.data.deal).toBeUndefined()
  })

  it('settle sanitize：LLM 返回 counter → 降 reject（不再提新条件）', async () => {
    mockAgentJson({
      stance: 'counter',
      reply: '再加点。',
      relationshipDelta: 0,
      deal: { dealId: 'gift-deal', price: 80 }
    })
    readBodyMock.mockResolvedValueOnce(makeSettleBody())

    const res = (await handler(makeEvent())) as any
    expect(res.data.stance).toBe('reject')
    expect(res.data.deal).toBeUndefined()
  })

  it('schema：settle counter 缺 counterPrice → 400', async () => {
    readBodyMock.mockResolvedValueOnce(
      makeSettleBody({ playerResponse: 'counter', counterPrice: undefined })
    )
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
    expect(res.data.error.code).toBe('INVALID_PARAMS')
  })

  it('schema：settle 带非法 dealId → 400（防篡改）', async () => {
    readBodyMock.mockResolvedValueOnce(
      makeSettleBody({ deal: { dealId: 'hack-deal', price: 1 } })
    )
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
  })

  it('schema：letter 为空 / 超 200 字 → 400', async () => {
    readBodyMock.mockResolvedValueOnce(makeLetterBody({ letter: '' }))
    expect(((await handler(makeEvent())) as any).statusCode).toBe(400)

    readBodyMock.mockResolvedValueOnce(makeLetterBody({ letter: '字'.repeat(201) }))
    expect(((await handler(makeEvent())) as any).statusCode).toBe(400)
  })

  it('schema：factionId 与 faction.id 不一致 → 400', async () => {
    readBodyMock.mockResolvedValueOnce(makeLetterBody({ factionId: 'xiang-jun' }))
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it('降级：AI 异常 → fallback:true + X-Fallback，不重试', async () => {
    streamTextMock.mockImplementationOnce(() => {
      throw new Error('llm down')
    })
    readBodyMock.mockResolvedValueOnce(makeLetterBody())
    const event = makeEvent()

    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    expect(res.fallback).toBe(true)
    expect(res.data).toEqual({ stance: 'reject', reply: '', relationshipDelta: 0 })
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Fallback', 'true')
    expect(streamTextMock).toHaveBeenCalledTimes(1) // 不重试
  })

  it('降级：LLM 返回不可解析 JSON → fallback', async () => {
    streamTextMock.mockImplementationOnce(() => ({
      text: Promise.resolve('这不是 JSON')
    }) as any)
    readBodyMock.mockResolvedValueOnce(makeLetterBody())

    const res = (await handler(makeEvent())) as any
    expect(res.fallback).toBe(true)
    expect(res.data.stance).toBe('reject')
  })

  it('并发锁冲突：429', async () => {
    const release = await acquireLock(SAVE_ID)
    try {
      readBodyMock.mockResolvedValueOnce(makeLetterBody())
      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(429)
      expect(res.data.error.code).toBe('CONCURRENT_REQUEST')
      expect(streamTextMock).not.toHaveBeenCalled()
    } finally {
      release()
    }
  })
})
