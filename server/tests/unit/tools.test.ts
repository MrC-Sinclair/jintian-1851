/**
 * @file 6 个核心工具单元测试
 *
 * 覆盖：正常返回结构、失败场景（FACTION_NOT_FOUND / INVALID_PARAMS）、
 * 边界值（limit 1-20）、空数据（note）、内部异常（INTERNAL_ERROR 不 throw）。
 *
 * 注：createTools 返回的工具对象中 execute 在 v5 类型为「可选 + 需 2 参数」，
 * 这里将 tools 断言为 any 以便直接调用 execute（运行时 options 可选）。
 */

import { describe, expect, it } from 'vitest'
import { createTools, type ToolContext } from '../../server/utils/tool-context'
import type { Faction, Character, StateSnapshot, HistoryEvent } from '../../types/game'

function makeCtx(): ToolContext {
  const factions: Faction[] = [
    { id: 'xiang-jun', name: '湘军', summary: '曾国藩组建', power: 65, relationship: 20, status: 'active', lastAction: '扩张' },
    { id: 'huai-jun', name: '淮军', summary: '李鸿章组建', power: 55, relationship: -10, status: 'active' }
  ]
  const character: Character = {
    background: '文官',
    backgroundPerks: {},
    factionId: 'player',
    factionName: '玩家',
    factionSummary: '主角势力'
  }
  const stateSnapshot: StateSnapshot = {
    turn: 6,
    date: { year: 1851, month: 6 },
    attributes: { military: 10, economy: 10, politics: 10, people: 10, diplomacy: 10 },
    resources: { silver: 100, troops: 50, food: 200, reputation: 5 }
  }
  const recentEvents: HistoryEvent[] = [
    { turn: 1, eventType: '民生', title: '开办义学', description: 'd', playerChoice: '兴办', effects: { people: 5 } },
    { turn: 3, eventType: '军事', title: '剿匪', description: 'd', playerChoice: '出兵', effects: { military: 3 } },
    { turn: 5, eventType: '外交', title: '结盟', description: 'd', playerChoice: '结盟', effects: { diplomacy: 4 } },
    { turn: 6, eventType: '随机', title: '旱灾', description: 'd', playerChoice: '赈灾', effects: { food: -20 } }
  ]
  return { saveId: 's1', turn: 6, stateSnapshot, character, factions, recentEvents }
}

describe('get-faction-info', () => {
  it('正常返回势力详情（不查库/不调 LLM）', async () => {
    const tools = createTools(makeCtx()) as any
    const r = await tools['get-faction-info'].execute({ factionId: 'xiang-jun' })
    expect(r.faction.id).toBe('xiang-jun')
    expect(r.faction.name).toBe('湘军')
    expect(r.faction).toHaveProperty('lastAction')
  })

  it('势力不存在返回 FACTION_NOT_FOUND 不 throw', async () => {
    const tools = createTools(makeCtx()) as any
    const r = await tools['get-faction-info'].execute({ factionId: 'unknown' })
    expect(r).toEqual({ error: 'FACTION_NOT_FOUND', detail: '势力 ID unknown 不存在' })
  })

  it('空 factionId 返回 INVALID_PARAMS', async () => {
    const tools = createTools(makeCtx()) as any
    const r = await tools['get-faction-info'].execute({ factionId: '' })
    expect(r.error).toBe('INVALID_PARAMS')
  })
})

describe('get-all-factions', () => {
  it('返回压缩四字段且不带 summary', async () => {
    const tools = createTools(makeCtx()) as any
    const r = await tools['get-all-factions'].execute({})
    expect(r.factions).toHaveLength(2)
    for (const f of r.factions) {
      expect(Object.keys(f).sort()).toEqual(['id', 'name', 'power', 'relationship', 'status'].sort())
    }
  })
})

describe('get-character-status', () => {
  it('返回玩家状态（合并 character + stateSnapshot）', async () => {
    const tools = createTools(makeCtx()) as any
    const r = await tools['get-character-status'].execute({})
    expect(r.character.background).toBe('文官')
    expect(r.character.factionId).toBe('player')
    expect(r.character.attributes.military).toBe(10)
    expect(r.character.resources.silver).toBe(100)
    expect(r.character.turn).toBe(6)
    expect(r.character.date).toEqual({ year: 1851, month: 6 })
  })
})

describe('get-recent-events', () => {
  it('默认返回最多 5 条（实际 4 条）', async () => {
    const tools = createTools(makeCtx()) as any
    const r = await tools['get-recent-events'].execute({})
    expect(r.events).toHaveLength(4)
  })

  it('自定义 limit 生效', async () => {
    const tools = createTools(makeCtx()) as any
    const r = await tools['get-recent-events'].execute({ limit: 2 })
    expect(r.events).toHaveLength(2)
    expect(r.events[1].turn).toBeGreaterThanOrEqual(r.events[0].turn)
  })

  it('limit 超过 20 按 20 处理（不超过实际数量）', async () => {
    const tools = createTools(makeCtx()) as any
    const r = await tools['get-recent-events'].execute({ limit: 99 })
    expect(r.events.length).toBeLessThanOrEqual(20)
    expect(r.events).toHaveLength(4)
  })

  it('无历史事件返回 note', async () => {
    const ctx = makeCtx()
    ctx.recentEvents = []
    const tools = createTools(ctx) as any
    const r = await tools['get-recent-events'].execute({})
    expect(r.events).toEqual([])
    expect(r.note).toBe('尚无历史事件')
  })
})

describe('get-relationship', () => {
  it('返回两势力关系平均值', async () => {
    const tools = createTools(makeCtx()) as any
    const r = await tools['get-relationship'].execute({ factionIdA: 'xiang-jun', factionIdB: 'huai-jun' })
    expect(r.relationship).toBe(Math.round((20 + -10) / 2))
    expect(r.factionA).toBe('湘军')
    expect(r.factionB).toBe('淮军')
  })

  it('势力不存在返回 FACTION_NOT_FOUND', async () => {
    const tools = createTools(makeCtx()) as any
    const r = await tools['get-relationship'].execute({ factionIdA: 'x', factionIdB: 'huai-jun' })
    expect(r.error).toBe('FACTION_NOT_FOUND')
  })

  it('缺参数返回 INVALID_PARAMS', async () => {
    const tools = createTools(makeCtx()) as any
    const r = await tools['get-relationship'].execute({ factionIdA: '', factionIdB: 'huai-jun' })
    expect(r.error).toBe('INVALID_PARAMS')
  })
})

describe('get-current-date', () => {
  it('返回日期/回合/年号', async () => {
    const tools = createTools(makeCtx()) as any
    const r = await tools['get-current-date'].execute({})
    expect(r.date).toEqual({ year: 1851, month: 6 })
    expect(r.turn).toBe(6)
    expect(r.note).toBe('咸丰元年六月')
  })

  it('同治年号正确', async () => {
    const ctx = makeCtx()
    ctx.stateSnapshot.date = { year: 1865, month: 3 }
    const tools = createTools(ctx) as any
    const r = await tools['get-current-date'].execute({})
    expect(r.note).toBe('同治四年三月')
  })

  it('1912 为民国元年', async () => {
    const ctx = makeCtx()
    ctx.stateSnapshot.date = { year: 1912, month: 1 }
    const tools = createTools(ctx) as any
    const r = await tools['get-current-date'].execute({})
    expect(r.note).toBe('民国元年正月')
  })
})

describe('工具失败容错', () => {
  it('内部异常返回 INTERNAL_ERROR 不 throw', async () => {
    const ctx = makeCtx()
    const badCtx = { ...ctx, factions: null } as unknown as ToolContext
    const tools = createTools(badCtx) as any
    const r = await tools['get-faction-info'].execute({ factionId: 'x' })
    expect(r.error).toBe('INTERNAL_ERROR')
  })
})
