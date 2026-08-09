/**
 * @file 玩家主动外交（player-active-diplomacy 提案）单元测试
 *
 * 覆盖：
 *   - DIPLOMACY_RULES 规则表完整性（6 动作字段齐全）
 *   - canAfford / clamp 纯函数
 *   - store.applyDiplomacyAction 行为（门槛/成本/每回合上限/clamp/状态变更/二次守卫）
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '../../src/stores/game'
import {
  DIPLOMACY_RULES,
  MAX_DIPLOMACY_PER_TURN,
  canAfford,
  clamp
} from '../../src/utils/constants'
import type { GameSave, PlayerDiplomacyAction, Resources } from '../../src/types/game'

const ACTIONS: PlayerDiplomacyAction[] = ['结盟', '宣战', '行贿', '通商', '离间', '质子']

function buildResources(overrides: Partial<Resources> = {}): Resources {
  return { silver: 1000, troops: 500, food: 800, reputation: 50, ...overrides }
}

function buildMockSave(resources: Resources = buildResources()): GameSave {
  return {
    saveVersion: 2,
    saveId: '550e8400-e29b-41d4-a716-446655440000',
    deviceId: 'test-device-id',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    character: {
      background: '文官',
      backgroundPerks: { politics: 5 },
      factionId: 'f1',
      factionName: '清廷',
      factionSummary: '晚清朝廷'
    },
    state: {
      turn: 1,
      date: { year: 1851, month: 1 },
      attributes: { military: 50, economy: 50, politics: 55, people: 50, diplomacy: 50 },
      resources
    },
    factions: [
      { id: 'f1', name: '清廷', summary: '晚清朝廷', power: 70, relationship: 100, status: 'active' },
      { id: 'f2', name: '太平天国', summary: '起义军', power: 60, relationship: -50, status: 'active' },
      { id: 'f3', name: '湘军', summary: '地方武装', power: 50, relationship: 20, status: 'active' },
      { id: 'f4', name: '革命党', summary: '反清力量', power: 40, relationship: -20, status: 'active' }
    ],
    events: [],
    advisorMessages: [],
    pendingChainNodes: [],
    completedChainIds: [],
    activeChainIds: [],
    ended: false
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('DIPLOMACY_RULES 规则表完整性', () => {
  it('6 个动作均有完整规则定义', () => {
    for (const action of ACTIONS) {
      const rule = DIPLOMACY_RULES[action]
      expect(rule, `动作 ${action} 应有规则`).toBeDefined()
      expect(typeof rule.minRelationship).toBe('number')
      expect(rule.cost).toBeTypeOf('object')
      // 宣战用 setRelationship，其余用 relDelta
      if (action === '宣战') {
        expect(rule.setRelationship).toBe(-100)
      } else if (action === '离间') {
        // 离间只削弱 power，不改 relationship，故无 relDelta
        expect(rule.powerDelta).toBe(-20)
      } else {
        expect(typeof rule.relDelta).toBe('number')
      }
    }
  })

  it('结盟门槛为 50 且置 allied 状态', () => {
    const rule = DIPLOMACY_RULES['结盟']
    expect(rule.minRelationship).toBe(50)
    expect(rule.setStatus).toBe('allied')
    expect(rule.cost).toEqual({ silver: -100, reputation: -10 })
  })

  it('通商附带 reputation+5 的 bonus', () => {
    const rule = DIPLOMACY_RULES['通商']
    expect(rule.bonus).toEqual({ reputation: 5 })
  })

  it('离间削减目标 power -20', () => {
    const rule = DIPLOMACY_RULES['离间']
    expect(rule.powerDelta).toBe(-20)
  })

  it('每回合外交上限常量', () => {
    expect(MAX_DIPLOMACY_PER_TURN).toBe(1)
  })
})

describe('canAfford / clamp 纯函数', () => {
  it('clamp 夹取边界', () => {
    expect(clamp(120, 0, 100)).toBe(100)
    expect(clamp(-200, -100, 100)).toBe(-100)
    expect(clamp(50, -100, 100)).toBe(50)
  })

  it('canAfford 按绝对值比较成本', () => {
    const res = buildResources()
    expect(canAfford({ silver: -100 }, res)).toBe(true)
    expect(canAfford({ silver: -100 }, buildResources({ silver: 50 }))).toBe(false)
    expect(canAfford({}, res)).toBe(true)
    expect(canAfford({ troops: -100 }, buildResources({ troops: 99 }))).toBe(false)
  })
})

describe('applyDiplomacyAction - 成功路径', () => {
  it('结盟友好势力：relationship 封顶 + 置 allied + 扣资源', () => {
    const store = useGameStore()
    store.setSave(buildMockSave())
    const ok = store.applyDiplomacyAction('f1', '结盟')
    expect(ok).toBe(true)
    const fac = store.currentSave!.factions.find((f) => f.id === 'f1')!
    expect(fac.relationship).toBe(100) // 100+30 被 clamp 封顶
    expect(fac.status).toBe('allied')
    expect(fac.lastAction).toBe('结盟')
    expect(store.currentSave!.state.resources.silver).toBe(900)
    expect(store.currentSave!.state.resources.reputation).toBe(40)
    expect(store.diplomacyUsedThisTurn).toBe(true)
  })

  it('宣战：relationship 直接设为 -100 + 扣兵员', () => {
    const store = useGameStore()
    store.setSave(buildMockSave())
    const ok = store.applyDiplomacyAction('f2', '宣战')
    expect(ok).toBe(true)
    const fac = store.currentSave!.factions.find((f) => f.id === 'f2')!
    expect(fac.relationship).toBe(-100)
    expect(store.currentSave!.state.resources.troops).toBe(400)
  })

  it('行贿：relationship 增量', () => {
    const store = useGameStore()
    store.setSave(buildMockSave())
    store.applyDiplomacyAction('f3', '行贿')
    const fac = store.currentSave!.factions.find((f) => f.id === 'f3')!
    expect(fac.relationship).toBe(35) // 20 + 15
  })

  it('通商：relationship 增量且名望 +5', () => {
    const store = useGameStore()
    store.setSave(buildMockSave())
    store.applyDiplomacyAction('f3', '通商')
    const fac = store.currentSave!.factions.find((f) => f.id === 'f3')!
    expect(fac.relationship).toBe(30) // 20 + 10
    expect(store.currentSave!.state.resources.reputation).toBe(55) // 50 + 5
  })

  it('离间：削减目标 power', () => {
    const store = useGameStore()
    store.setSave(buildMockSave())
    store.applyDiplomacyAction('f2', '离间')
    const fac = store.currentSave!.factions.find((f) => f.id === 'f2')!
    expect(fac.power).toBe(40) // 60 - 20
  })

  it('质子：relationship 增量且扣兵员', () => {
    const store = useGameStore()
    store.setSave(buildMockSave())
    store.applyDiplomacyAction('f4', '质子')
    const fac = store.currentSave!.factions.find((f) => f.id === 'f4')!
    expect(fac.relationship).toBe(0) // -20 + 20
    expect(store.currentSave!.state.resources.troops).toBe(450)
  })

  it('成功后追加 eventType 为「外交」的历史事件', () => {
    const store = useGameStore()
    store.setSave(buildMockSave())
    store.applyDiplomacyAction('f1', '结盟')
    const evt = store.currentSave!.events[store.currentSave!.events.length - 1]
    expect(evt.eventType).toBe('外交')
    expect(evt.title).toContain('清廷')
    expect(evt.playerChoice).toBe('结盟')
  })
})

describe('applyDiplomacyAction - 守卫与失败路径', () => {
  it('关系不足时拒绝对中立势力结盟', () => {
    const store = useGameStore()
    store.setSave(buildMockSave())
    const ok = store.applyDiplomacyAction('f3', '结盟') // relationship 20 < 50
    expect(ok).toBe(false)
    expect(store.currentSave!.factions.find((f) => f.id === 'f3')!.status).toBe('active')
    expect(store.diplomacyUsedThisTurn).toBe(false)
  })

  it('资源不足时拒绝结盟', () => {
    const store = useGameStore()
    store.setSave(buildMockSave(buildResources({ silver: 50 }))) // 需 100
    const ok = store.applyDiplomacyAction('f1', '结盟')
    expect(ok).toBe(false)
    expect(store.diplomacyUsedThisTurn).toBe(false)
  })

  it('每回合上限：第二次行动被拒绝', () => {
    const store = useGameStore()
    store.setSave(buildMockSave())
    expect(store.applyDiplomacyAction('f1', '结盟')).toBe(true)
    expect(store.applyDiplomacyAction('f2', '宣战')).toBe(false)
  })

  it('resetDiplomacy 解锁新回合上限', () => {
    const store = useGameStore()
    store.setSave(buildMockSave())
    store.applyDiplomacyAction('f1', '结盟')
    expect(store.applyDiplomacyAction('f2', '宣战')).toBe(false)
    store.resetDiplomacy()
    expect(store.diplomacyUsedThisTurn).toBe(false)
    expect(store.applyDiplomacyAction('f2', '宣战')).toBe(true)
  })

  it('回合处理中禁用', () => {
    const store = useGameStore()
    store.setSave(buildMockSave())
    store.setProcessingTurn(true)
    expect(store.applyDiplomacyAction('f1', '结盟')).toBe(false)
  })

  it('势力不存在返回 false', () => {
    const store = useGameStore()
    store.setSave(buildMockSave())
    expect(store.applyDiplomacyAction('nope', '宣战')).toBe(false)
  })

  it('无存档返回 false', () => {
    const store = useGameStore()
    expect(store.applyDiplomacyAction('f1', '宣战')).toBe(false)
  })
})
