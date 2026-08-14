/**
 * @file npc-actions API 集成测试（多 Agent 并行）
 *
 * 覆盖正常 / 参数错误 / 无活跃势力 / 锁冲突 / 部分失败 / 全部失败 / NPC 决策差异化。
 *
 * 注意：必须保留 ai 模块原生的 tool（createNpcTools 依赖），仅替换 streamText / stepCountIs。
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
import handler from '../../server/api/game/npc-actions'
import { acquireLock, clearLocks } from '../../server/utils/concurrency-lock'

const streamTextMock = vi.mocked(streamText)
const readBodyMock = (globalThis as any).readBody as ReturnType<typeof vi.fn>
const SAVE_ID = '550e8400-e29b-41d4-a716-446655440000'

function makeEvent(): any {
  return { node: { res: { write: vi.fn(async () => {}), end: vi.fn() } } }
}

function makeFaction(
  id: string,
  name: string,
  relationship: number,
  status: 'active' | 'destroyed' | 'allied' = 'active'
) {
  return { id, name, summary: `${name}摘要`, power: 60, relationship, status }
}

function makeBody(factions: any[]) {
  return {
    saveId: SAVE_ID,
    turn: 2,
    character: { background: '文官', factionName: '清廷' },
    stateSnapshot: {
      turn: 2,
      date: { year: 1851, month: 2 },
      attributes: { military: 50, economy: 50, politics: 50, people: 50, diplomacy: 50 },
      resources: { silver: 1000, troops: 500, food: 200, reputation: 30 }
    },
    factions
  }
}

/** 默认成功 mock：依据 system 中的关系关键词返回差异化行动 */
function mockSuccessByRelationship() {
  streamTextMock.mockImplementation((opts: any) => {
    const system: string = opts?.system ?? ''
    let action = '休养'
    if (system.includes('削弱玩家势力')) action = '挑衅'
    else if (system.includes('维持盟约')) action = '外交'
    return {
      text: Promise.resolve(
        JSON.stringify({ action, description: '行动描述', effects: { military: -2 } })
      )
    } as any
  })
}

describe('POST /api/game/npc-actions（多 Agent）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).setHeader = vi.fn()
    clearLocks()
  })

  it('正常：单个 NPC Agent 返回行动', async () => {
    mockSuccessByRelationship()
    readBodyMock.mockResolvedValueOnce(makeBody([makeFaction('xiang-jun', '湘军', 0)]))

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.actions).toHaveLength(1)
    expect(res.data.actions[0].factionId).toBe('xiang-jun')
    expect(res.data.failedFactionIds).toBeUndefined()
  })

  it('NPC 决策差异化：敌对 vs 友好产生不同行动', async () => {
    mockSuccessByRelationship()
    readBodyMock.mockResolvedValueOnce(
      makeBody([
        makeFaction('taiping', '太平军', -50),
        makeFaction('huai-jun', '淮军', 50)
      ])
    )

    const res = (await handler(makeEvent())) as any
    expect(res.data.actions).toHaveLength(2)
    const taiping = res.data.actions.find((a: any) => a.factionId === 'taiping')
    const huai = res.data.actions.find((a: any) => a.factionId === 'huai-jun')
    expect(taiping.action).toBe('挑衅')
    expect(huai.action).toBe('外交')
  })

  it('参数错误：factions 为空数组（min(1) 校验）', async () => {
    readBodyMock.mockResolvedValueOnce(makeBody([]))
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
    expect(res.data.error.code).toBe('INVALID_PARAMS')
  })

  it('参数错误：saveId 缺失', async () => {
    const body = makeBody([makeFaction('xiang-jun', '湘军', 0)])
    readBodyMock.mockResolvedValueOnce({ ...body, saveId: undefined })
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(400)
  })

  it('无活跃势力：直接返回空 actions（不调 LLM）', async () => {
    readBodyMock.mockResolvedValueOnce(
      makeBody([makeFaction('a', 'A', 0, 'destroyed'), makeFaction('b', 'B', 0, 'allied')])
    )
    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.actions).toEqual([])
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it('部分失败：单个 NPC 失败标记 X-Partial-Failure + failedFactionIds', async () => {
    streamTextMock.mockImplementation((opts: any) => {
      const system: string = opts?.system ?? ''
      if (system.includes('太平军')) {
        throw new Error('llm down')
      }
      return {
        text: Promise.resolve(
          JSON.stringify({ action: '休养', description: '休养', effects: {} })
        )
      } as any
    })
    readBodyMock.mockResolvedValueOnce(
      makeBody([
        makeFaction('taiping', '太平军', -50),
        makeFaction('huai-jun', '淮军', 50)
      ])
    )
    const event = makeEvent()

    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    expect(res.data.actions).toHaveLength(1)
    expect(res.data.actions[0].factionId).toBe('huai-jun')
    expect(res.data.failedFactionIds).toEqual(['taiping'])
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Partial-Failure', 'true')
  })

  it('全部失败：返回空 actions + fallback + X-Fallback', async () => {
    streamTextMock.mockImplementation(() => {
      throw new Error('llm down')
    })
    readBodyMock.mockResolvedValueOnce(makeBody([makeFaction('xiang-jun', '湘军', 0)]))
    const event = makeEvent()

    const res = (await handler(event)) as any
    expect(res.ok).toBe(true)
    expect(res.fallback).toBe(true)
    expect(res.data.actions).toEqual([])
    expect(res.data.failedFactionIds).toEqual(['xiang-jun'])
    expect((globalThis as any).setHeader).toHaveBeenCalledWith(event, 'X-Fallback', 'true')
  })

  it('锁冲突：429', async () => {
    const release = await acquireLock(SAVE_ID)
    try {
      readBodyMock.mockResolvedValueOnce(makeBody([makeFaction('xiang-jun', '湘军', 0)]))
      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(429)
      expect(res.data.error.code).toBe('CONCURRENT_REQUEST')
    } finally {
      release()
    }
  })
})
