/**
 * @file init-factions API 集成测试
 *
 * 覆盖正常 / 参数错误 / LLM 失败降级
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// mock AI SDK 与底层 fetch，避免真实调用 LLM
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({ chat: vi.fn(() => 'mocked-model') }))
}))
vi.mock('ai', () => ({ generateObject: vi.fn() }))
vi.mock('../../server/utils/siliconflow-fetch', () => ({
  createSiliconFlowFetch: vi.fn(() => vi.fn())
}))

import { generateObject } from 'ai'
import handler from '../../server/api/game/init-factions'
import { getFallbackFactions } from '../../server/runtime/fallback-factions'

const generateObjectMock = vi.mocked(generateObject)
const readBodyMock = (globalThis as any).readBody as ReturnType<typeof vi.fn>

/** 构造最小 event 对象 */
function makeEvent(): any {
  return { node: { res: { write: vi.fn(async () => {}), end: vi.fn() } } }
}

/** 构造 6 个测试势力 */
function makeFactions() {
  return Array.from({ length: 6 }, (_, i) => ({
    id: `f${i}`,
    name: `势力${i}`,
    summary: `简介${i}`,
    initialPower: 50 + i * 5,
    initialRelationship: i * 10 - 30
  }))
}

describe('POST /api/game/init-factions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // setup.ts 未 mock setHeader，此处补上
    ;(globalThis as any).setHeader = vi.fn()
  })

  it('正常：LLM 返回 6 个势力', async () => {
    const factions = makeFactions()
    generateObjectMock.mockResolvedValueOnce({ object: { factions } } as any)
    readBodyMock.mockResolvedValueOnce({ background: '文官' })

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.factions).toEqual(factions)
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
  })

  it('参数错误：background 缺失', async () => {
    readBodyMock.mockResolvedValueOnce({})

    const res = (await handler(makeEvent())) as any
    expect(res).toBeInstanceOf(Error)
    expect(res.statusCode).toBe(400)
    expect(res.data.error.code).toBe('INVALID_PARAMS')
  })

  it('参数错误：background 非法值', async () => {
    readBodyMock.mockResolvedValueOnce({ background: '太监' })

    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
    expect(res.data.error.code).toBe('INVALID_PARAMS')
  })

  it('LLM 失败降级：返回预置势力 + X-Fallback header', async () => {
    generateObjectMock.mockRejectedValueOnce(new Error('LLM timeout'))
    readBodyMock.mockResolvedValueOnce({ background: '武将' })
    const event = makeEvent()

    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    expect(res.fallback).toBe(true)
    expect(res.data.factions).toHaveLength(6)
    expect(res.data.factions).toEqual(getFallbackFactions('武将'))
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Fallback', 'true')
  })
})
