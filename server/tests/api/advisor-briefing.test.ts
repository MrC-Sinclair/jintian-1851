/**
 * @file advisor-briefing API 集成测试（T1.14）
 *
 * 覆盖场景：
 *   - 正常：LLM 返回 summary/suggestion
 *   - 参数错误：saveId 非 UUID / turn 非正整数 / stateSnapshot 缺字段
 *   - LLM 失败降级：generateObject 抛错 → 空简报 + X-Fallback: true
 *   - 超时降级：generateObject 抛 AbortError → 同降级路径
 *   - 开关关闭：enableBriefing=false → 空简报 + disabled: true
 *   - 不占用 concurrency-lock（验证未调用 acquireLock/isLocked）
 *   - 10s 超时配置（abortSignal 传给 generateObject）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({ chat: vi.fn(() => 'mocked-model') }))
}))
vi.mock('ai', () => ({ generateObject: vi.fn() }))
vi.mock('../../server/utils/siliconflow-fetch', () => ({
  createSiliconFlowFetch: vi.fn(() => vi.fn())
}))
// 并发锁 mock：spy 调用次数验证"不占用锁"
vi.mock('../../server/utils/concurrency-lock', () => ({
  acquireLock: vi.fn(async () => () => {}),
  isLocked: vi.fn(() => false),
  clearLocks: vi.fn()
}))

import { generateObject } from 'ai'
import handler from '../../server/api/game/advisor-briefing.post'
import { acquireLock, isLocked } from '../../server/utils/concurrency-lock'

const generateObjectMock = vi.mocked(generateObject)
const readBodyMock = (globalThis as any).readBody as ReturnType<typeof vi.fn>

const SAVE_ID = '550e8400-e29b-41d4-a716-446655440000'

/** 默认 useRuntimeConfig（与 tests/setup.ts 一致） */
const DEFAULT_RUNTIME_CONFIG = {
  openaiApiKey: 'test-api-key',
  openaiBaseUrl: 'https://api.siliconflow.cn/v1',
  llmModel: 'Qwen/Qwen3-8B',
  databaseUrl: 'postgresql://test:test@localhost:5434/test',
  enableBriefing: true
}

function makeStateSnapshot(turn = 1) {
  return {
    turn,
    date: { year: 1851, month: 1 },
    attributes: { military: 50, economy: 50, politics: 50, people: 50, diplomacy: 50 },
    resources: { silver: 1000, troops: 500, food: 200, reputation: 30 }
  }
}

function makeBody(turn = 1, overrides: Record<string, unknown> = {}) {
  return {
    saveId: SAVE_ID,
    turn,
    stateSnapshot: makeStateSnapshot(turn),
    ...overrides
  }
}

function makeEvent(): any {
  return { node: { res: { write: vi.fn(async () => {}), end: vi.fn() } } }
}

describe('POST /api/game/advisor-briefing', () => {
  let originalUseRuntimeConfig: unknown

  beforeEach(() => {
    vi.clearAllMocks()
    originalUseRuntimeConfig = (globalThis as any).useRuntimeConfig
    ;(globalThis as any).useRuntimeConfig = () => ({ ...DEFAULT_RUNTIME_CONFIG })
  })

  afterEach(() => {
    ;(globalThis as any).useRuntimeConfig = originalUseRuntimeConfig
  })

  it('正常：LLM 返回 summary/suggestion', async () => {
    const briefing = { summary: '局势平稳，可稳步发展', suggestion: '建议优先提升军事' }
    generateObjectMock.mockResolvedValueOnce({ object: briefing } as any)
    readBodyMock.mockResolvedValueOnce(makeBody(2))

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data).toEqual(briefing)
    expect(res.fallback).toBeUndefined()
    expect(res.disabled).toBeUndefined()
    // 未设置 X-Fallback header
    expect((globalThis as any).setHeader).not.toHaveBeenCalled()
  })

  it('参数错误：saveId 非 UUID → 400', async () => {
    readBodyMock.mockResolvedValueOnce(makeBody(2, { saveId: 'not-uuid' }))
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
    expect(res.data.error.code).toBe('INVALID_PARAMS')
    // 参数错误时不调用 LLM
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  it('参数错误：turn 非正整数 → 400', async () => {
    readBodyMock.mockResolvedValueOnce(makeBody(0))
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
    expect(res.data.error.code).toBe('INVALID_PARAMS')
  })

  it('参数错误：stateSnapshot 缺 attributes → 400', async () => {
    readBodyMock.mockResolvedValueOnce({
      saveId: SAVE_ID,
      turn: 1,
      stateSnapshot: { turn: 1, date: { year: 1851, month: 1 }, resources: {} }
    })
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
    expect(res.data.error.code).toBe('INVALID_PARAMS')
  })

  it('请求体解析失败 → 400', async () => {
    readBodyMock.mockRejectedValueOnce(new Error('parse error'))
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
    expect(res.data.error.code).toBe('INVALID_PARAMS')
  })

  it('LLM 失败降级：返回空简报 + X-Fallback: true，不 throw', async () => {
    generateObjectMock.mockRejectedValueOnce(new Error('LLM boom'))
    readBodyMock.mockResolvedValueOnce(makeBody(2))

    const event = makeEvent()
    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ summary: '', suggestion: '' })
    expect(res.fallback).toBe(true)
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Fallback', 'true')
  })

  it('超时降级：generateObject 抛 AbortError → 同降级路径', async () => {
    const abortErr = new DOMException('The operation was aborted', 'AbortError')
    generateObjectMock.mockRejectedValueOnce(abortErr)
    readBodyMock.mockResolvedValueOnce(makeBody(2))

    const event = makeEvent()
    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ summary: '', suggestion: '' })
    expect(res.fallback).toBe(true)
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Fallback', 'true')
  })

  it('开关关闭：enableBriefing=false → 空简报 + disabled: true，不调用 LLM', async () => {
    ;(globalThis as any).useRuntimeConfig = () => ({
      ...DEFAULT_RUNTIME_CONFIG,
      enableBriefing: false
    })
    readBodyMock.mockResolvedValueOnce(makeBody(2))

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ summary: '', suggestion: '' })
    expect(res.disabled).toBe(true)
    expect(res.fallback).toBeUndefined()
    // 不调用 LLM
    expect(generateObjectMock).not.toHaveBeenCalled()
    // 不设置 X-Fallback header
    expect((globalThis as any).setHeader).not.toHaveBeenCalled()
  })

  it('不占用 concurrency-lock（验证未调用 acquireLock/isLocked）', async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: { summary: 's', suggestion: 'g' }
    } as any)
    readBodyMock.mockResolvedValueOnce(makeBody(2))

    await handler(makeEvent())

    expect(acquireLock).not.toHaveBeenCalled()
    expect(isLocked).not.toHaveBeenCalled()
  })

  it('调用 generateObject 时传入 10s 超时的 abortSignal', async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: { summary: 's', suggestion: 'g' }
    } as any)
    readBodyMock.mockResolvedValueOnce(makeBody(2))

    await handler(makeEvent())

    expect(generateObjectMock).toHaveBeenCalledTimes(1)
    const callArgs = generateObjectMock.mock.calls[0][0] as any
    expect(callArgs.abortSignal).toBeInstanceOf(AbortSignal)
    // abortSignal 已通过 AbortSignal.timeout(10000) 创建，无法直接读取超时值
    // 但可验证其存在且为 AbortSignal 实例
    expect(callArgs.model).toBe('mocked-model')
    expect(callArgs.schema).toBeDefined()
    expect(typeof callArgs.prompt).toBe('string')
    expect(callArgs.prompt).toContain('第 2 回合')
  })

  it('使用 Qwen/Qwen3-8B 模型 + createSiliconFlowFetch(false)（关闭思考）', async () => {
    const { createOpenAI } = await import('@ai-sdk/openai')
    const { createSiliconFlowFetch } = await import('../../server/utils/siliconflow-fetch')
    generateObjectMock.mockResolvedValueOnce({
      object: { summary: 's', suggestion: 'g' }
    } as any)
    readBodyMock.mockResolvedValueOnce(makeBody(1))

    await handler(makeEvent())

    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-api-key',
        baseURL: 'https://api.siliconflow.cn/v1'
      })
    )
    expect(createSiliconFlowFetch).toHaveBeenCalledWith(false)
  })
})
