/**
 * @file prompts 单元测试
 *
 * 验证函数返回非空字符串且包含关键变量
 */

import { describe, expect, it } from 'vitest'
import { buildInitFactionsPrompt } from '../../server/utils/prompts/init-factions'
import { buildGenerateEventPrompt } from '../../server/utils/prompts/generate-event'
import { buildResolveDecisionPrompt } from '../../server/utils/prompts/resolve-decision'
import { buildNpcActionsPrompt } from '../../server/utils/prompts/npc-actions'
import { buildAdvisorSystemPrompt } from '../../server/utils/prompts/advisor-chat'
import type {
  StateSnapshot,
  Faction,
  HistoryEvent,
  GameEvent,
  Character
} from '../../types/game'

const mockState: StateSnapshot = {
  turn: 1,
  date: { year: 1851, month: 1 },
  attributes: { military: 50, economy: 50, politics: 50, people: 50, diplomacy: 50 },
  resources: { silver: 1000, troops: 500, food: 300, reputation: 30 }
}

const mockFactions: Faction[] = [
  {
    id: 'qing-ting',
    name: '清廷',
    summary: '大清朝廷',
    power: 70,
    relationship: 50,
    status: 'active'
  }
]

const mockCharacter: Character = {
  background: '文官',
  backgroundPerks: { politics: 5 },
  factionId: 'qing-ting',
  factionName: '清廷',
  factionSummary: '大清朝廷，中央集权虽衰，仍有正统之名'
}

const mockEvent: GameEvent = {
  title: '粮价飞涨',
  description: '连月不雨，粮价涨三倍。',
  eventType: '民生',
  options: [
    { id: 'a', label: '开仓放粮', effects: { people: 10, silver: -200 } },
    { id: 'b', label: '平价售粮', effects: { people: 4, economy: -8 } }
  ]
}

const mockRecentEvents: HistoryEvent[] = [
  {
    turn: 1,
    eventType: '民生',
    title: '粮价飞涨',
    description: '连月不雨',
    playerChoice: '开仓放粮',
    effects: { people: 10, silver: -200 }
  }
]

describe('prompts - init-factions', () => {
  it('返回非空字符串且包含关键变量', () => {
    const p = buildInitFactionsPrompt('文官')
    expect(typeof p).toBe('string')
    expect(p.length).toBeGreaterThan(100)
    expect(p).toContain('文官')
    expect(p).toContain('近代')
    expect(p).toContain('6-8')
    expect(p).toContain('initialPower')
    expect(p).toContain('initialRelationship')
  })

  it('5 类 background 均能生成', () => {
    for (const bg of ['文官', '武将', '商贾', '士绅', '宗室'] as const) {
      const p = buildInitFactionsPrompt(bg)
      expect(p).toContain(bg)
    }
  })
})

describe('prompts - generate-event', () => {
  it('返回非空字符串且包含关键变量', () => {
    const p = buildGenerateEventPrompt({
      character: mockCharacter,
      stateSnapshot: mockState,
      factions: mockFactions,
      recentEvents: mockRecentEvents,
      turn: 1
    })
    expect(p.length).toBeGreaterThan(100)
    expect(p).toContain('清廷')
    expect(p).toContain('1851年1月')
    expect(p).toContain('第 1 回合')
    expect(p).toContain('军务 50')
    expect(p).toContain('银两 1000')
  })

  it('首回合注入"游戏开场"上下文', () => {
    const p = buildGenerateEventPrompt({
      character: mockCharacter,
      stateSnapshot: mockState,
      factions: mockFactions,
      recentEvents: [],
      turn: 1
    })
    expect(p).toContain('游戏开场')
    expect(p).toContain('1851')
    expect(p).toContain('金田起义')
  })

  it('非首回合不注入"游戏开场"', () => {
    const p = buildGenerateEventPrompt({
      character: mockCharacter,
      stateSnapshot: { ...mockState, turn: 5, date: { year: 1851, month: 6 } },
      factions: mockFactions,
      recentEvents: mockRecentEvents,
      turn: 5
    })
    expect(p).not.toContain('游戏开场')
  })
})

describe('prompts - resolve-decision', () => {
  it('返回非空字符串且包含关键变量', () => {
    const p = buildResolveDecisionPrompt({
      event: mockEvent,
      playerDecision: '开仓放粮',
      stateSnapshot: mockState,
      turn: 1
    })
    expect(p.length).toBeGreaterThan(100)
    expect(p).toContain('粮价飞涨')
    expect(p).toContain('开仓放粮')
    expect(p).toContain('effects')
  })
})

describe('prompts - npc-actions', () => {
  it('返回非空字符串且包含关键变量', () => {
    const p = buildNpcActionsPrompt({
      character: mockCharacter,
      stateSnapshot: mockState,
      npcFactions: [{ id: 'xiang-jun', name: '湘军', power: 65, relationship: 30, status: 'active' }],
      turn: 1
    })
    expect(p.length).toBeGreaterThan(100)
    expect(p).toContain('湘军')
    expect(p).toContain('扩张')
    expect(p).toContain('结盟')
    expect(p).toContain('备战')
    expect(p).toContain('休养')
    expect(p).toContain('挑衅')
    expect(p).toContain('外交')
  })
})

describe('prompts - advisor-chat', () => {
  it('返回非空字符串且包含关键变量', () => {
    const p = buildAdvisorSystemPrompt({
      character: mockCharacter,
      stateSnapshot: mockState,
      turn: 1
    })
    expect(p.length).toBeGreaterThan(100)
    expect(p).toContain('清廷')
    expect(p).toContain('军师')
    expect(p).toContain('文官')
    expect(p).toContain('1851年1月')
    expect(p).toContain('200 字')
    expect(p).toContain('文言')
  })

  it('包含风格约束关键词', () => {
    const p = buildAdvisorSystemPrompt({
      character: mockCharacter,
      stateSnapshot: mockState,
      turn: 1
    })
    expect(p).toContain('不超过 200 字')
    expect(p).toContain('具体策略')
    expect(p).toContain('不可出戏')
  })

  it('T2.3：包含 6 个工具调用指引与禁止编造约束', () => {
    const p = buildAdvisorSystemPrompt({
      character: mockCharacter,
      stateSnapshot: mockState,
      turn: 1
    })
    for (const t of [
      'get-faction-info',
      'get-all-factions',
      'get-character-status',
      'get-recent-events',
      'get-relationship',
      'get-current-date'
    ]) {
      expect(p).toContain(t)
    }
    expect(p).toContain('未通过工具查询的数据不可凭空编造')
  })

  it('T2.5：turn <= 3 时注入新玩家引导段落', () => {
    const p = buildAdvisorSystemPrompt({
      character: mockCharacter,
      stateSnapshot: mockState,
      turn: 1
    })
    // 新玩家引导段落关键词
    expect(p).toContain('新玩家引导')
    expect(p).toContain('新手期')
    expect(p).toContain('多用白话')
    expect(p).toContain('解释专业术语')
    expect(p).toContain('军队战力')
    expect(p).toContain('可执行建议')
    expect(p).toContain('鼓励')
    // 风格约束也调整
    expect(p).toContain('可适当用白话降低理解门槛')
  })

  it('T2.5：turn = 3 仍属新手期（边界值）', () => {
    const p = buildAdvisorSystemPrompt({
      character: mockCharacter,
      stateSnapshot: { ...mockState, turn: 3 },
      turn: 3
    })
    expect(p).toContain('新玩家引导')
    expect(p).toContain('新手期')
  })

  it('T2.5：turn > 3 时不注入新玩家引导段落', () => {
    const p = buildAdvisorSystemPrompt({
      character: mockCharacter,
      stateSnapshot: { ...mockState, turn: 4 },
      turn: 4
    })
    // 不应包含新玩家引导段落
    expect(p).not.toContain('新玩家引导')
    expect(p).not.toContain('新手期')
    expect(p).not.toContain('可适当用白话降低理解门槛')
    // 但仍应包含基础风格约束
    expect(p).toContain('不超过 200 字')
    expect(p).toContain('文言')
  })
})
