/**
 * @file npc-agent prompt 单元测试
 *
 * 覆盖不同 relationship 下决策目标（goal）的差异，以及玩家势力信息注入。
 */
import { describe, expect, it } from 'vitest'
import { buildNpcAgentPrompt } from '../../server/utils/prompts/npc-agent'
import type { Faction } from '../../types/game'
import type { ToolContext } from '../../server/utils/tool-context'

function makeFaction(overrides: Partial<Faction> = {}): Faction {
  return {
    id: 'xiang-jun',
    name: '湘军',
    summary: '曾国藩团练',
    power: 65,
    relationship: 0,
    status: 'active',
    ...overrides
  }
}

function makeCtx(): ToolContext {
  return {
    saveId: 's1',
    turn: 2,
    stateSnapshot: {
      turn: 2,
      date: { year: 1851, month: 2 },
      attributes: {
        military: 50,
        economy: 50,
        politics: 50,
        people: 50,
        diplomacy: 50
      },
      resources: { silver: 1000, troops: 500, food: 200, reputation: 30 }
    },
    character: {
      background: '文官',
      backgroundPerks: {},
      factionId: 'qing',
      factionName: '清廷',
      factionSummary: ''
    },
    factions: [],
    recentEvents: []
  }
}

describe('buildNpcAgentPrompt', () => {
  it('返回非空字符串且包含势力名与可选行动', () => {
    const p = buildNpcAgentPrompt(makeFaction(), makeCtx())
    expect(p.length).toBeGreaterThan(50)
    expect(p).toContain('湘军')
    expect(p).toContain('扩张')
    expect(p).toContain('结盟')
    expect(p).toContain('备战')
    expect(p).toContain('休养')
    expect(p).toContain('挑衅')
    expect(p).toContain('外交')
  })

  it('关系 < -30：敌对目标（削弱玩家）', () => {
    const p = buildNpcAgentPrompt(makeFaction({ relationship: -40 }), makeCtx())
    expect(p).toContain('削弱玩家势力')
    expect(p).toContain('挑衅')
  })

  it('关系 > 30：友好目标（维持盟约）', () => {
    const p = buildNpcAgentPrompt(makeFaction({ relationship: 50 }), makeCtx())
    expect(p).toContain('维持盟约')
    expect(p).toContain('外交')
    expect(p).toContain('结盟')
  })

  it('关系在 ±30 之间：中立目标（发展自身）', () => {
    const p = buildNpcAgentPrompt(makeFaction({ relationship: 0 }), makeCtx())
    expect(p).toContain('发展自身实力')
  })

  it('注入玩家势力信息（factionName + background）', () => {
    const p = buildNpcAgentPrompt(makeFaction(), makeCtx())
    expect(p).toContain('清廷')
    expect(p).toContain('文官')
  })

  it('要求输出 JSON 结构', () => {
    const p = buildNpcAgentPrompt(makeFaction(), makeCtx())
    expect(p).toContain('"action"')
    expect(p).toContain('"description"')
    expect(p).toContain('"effects"')
  })

  // ============ AI 长期记忆：记忆注入（任务6 / D8）============

  it('任务6：传入记忆时注入「你记得的事」段落（正负分组 + 内容）', () => {
    const p = buildNpcAgentPrompt(makeFaction(), makeCtx(), {
      positive: ['第3回合：玩家资助粮草'],
      negative: ['第7回合：玩家劫掠辎重'],
      neutral: []
    })
    expect(p).toContain('你记得关于玩家势力的事')
    expect(p).toContain('善意 / 友好')
    expect(p).toContain('第3回合：玩家资助粮草')
    expect(p).toContain('敌意 / 怨恨')
    expect(p).toContain('第7回合：玩家劫掠辎重')
    // 中性组为空时不渲染该分组
    expect(p).not.toContain('中性：')
  })

  it('任务6：无记忆（不传或全空）时不注入记忆段落', () => {
    const p1 = buildNpcAgentPrompt(makeFaction(), makeCtx())
    expect(p1).not.toContain('你记得关于玩家势力的事')
    const p2 = buildNpcAgentPrompt(makeFaction(), makeCtx(), { positive: [], negative: [], neutral: [] })
    expect(p2).not.toContain('你记得关于玩家势力的事')
  })

  it('任务6：记忆段落位于 JSON 输出要求之前（上下文不污染输出格式）', () => {
    const p = buildNpcAgentPrompt(makeFaction(), makeCtx(), {
      positive: [],
      negative: ['第2回合：旧怨'],
      neutral: []
    })
    const memIdx = p.indexOf('你记得关于玩家势力的事')
    const jsonIdx = p.indexOf('只输出一个 JSON 对象')
    expect(memIdx).toBeGreaterThan(-1)
    expect(jsonIdx).toBeGreaterThan(memIdx)
  })
})
