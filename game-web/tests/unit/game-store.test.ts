/**
 * @file stores/game.ts 单元测试
 *
 * 覆盖 actions：
 *   - setSave / clear
 *   - updateState（部分字段更新）
 *   - applyEffects（增量）
 *   - appendEvent（含截断）
 *   - appendAdvisorMessage（含截断）
 *   - markEnded（ended/endedAt/endedReason 同步）
 *   - setEvent / setNpcActions
 *   - setProcessingTurn / setAdvisorStreaming / setSyncing
 *   - applyFreeFactionEffects（自由行动势力软性微调：clamp/不可变/两通道叠加/反馈记录）
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '../../src/stores/game'
import type { GameSave } from '../../src/types/game'

function createMockSave(): GameSave {
  return {
    saveVersion: 1,
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
    factions: [
      {
        id: 'f1',
        name: '清廷',
        summary: '晚清朝廷',
        power: 70,
        relationship: 100,
        status: 'active'
      }
    ],
    events: [],
    advisorMessages: [],
    ended: false
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('setSave / clear', () => {
  it('setSave 设置存档', () => {
    const store = useGameStore()
    expect(store.currentSave).toBeNull()
    const save = createMockSave()
    store.setSave(save)
    expect(store.currentSave).toStrictEqual(save)
  })

  it('clear 清空所有状态', () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    store.setEvent({ title: '事件', description: '', eventType: '随机', options: [] })
    store.setNpcActions([
      { factionId: 'f1', factionName: '清廷', action: '扩张', description: '' }
    ])
    store.setProcessingTurn(true)

    store.clear()

    expect(store.currentSave).toBeNull()
    expect(store.currentEvent).toBeNull()
    expect(store.npcActions).toEqual([])
    expect(store.isProcessingTurn).toBe(false)
  })
})

describe('currentTurn 计算属性', () => {
  it('无存档返回 0', () => {
    const store = useGameStore()
    expect(store.currentTurn).toBe(0)
  })

  it('有存档返回当前回合', () => {
    const store = useGameStore()
    const save = createMockSave()
    save.state.turn = 5
    store.setSave(save)
    expect(store.currentTurn).toBe(5)
  })
})

describe('updateState', () => {
  it('部分更新 attributes', () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const originalUpdatedAt = store.currentSave!.updatedAt

    store.updateState({ attributes: { military: 60 } })

    expect(store.currentSave!.state.attributes.military).toBe(60)
    // 未传字段保留原值
    expect(store.currentSave!.state.attributes.economy).toBe(50)
    expect(store.currentSave!.state.attributes.politics).toBe(55)
    // updatedAt 更新
    expect(store.currentSave!.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt)
  })

  it('部分更新 date 与 turn', () => {
    const store = useGameStore()
    store.setSave(createMockSave())

    store.updateState({ turn: 2, date: { year: 1851, month: 2 } })

    expect(store.currentSave!.state.turn).toBe(2)
    expect(store.currentSave!.state.date).toEqual({ year: 1851, month: 2 })
  })

  it('无存档时不报错', () => {
    const store = useGameStore()
    expect(() => store.updateState({ turn: 1 })).not.toThrow()
  })
})

describe('applyEffects', () => {
  it('增量应用属性与资源', () => {
    const store = useGameStore()
    store.setSave(createMockSave())

    store.applyEffects({
      military: 10,
      economy: -5,
      silver: 200,
      food: -100
    })

    expect(store.currentSave!.state.attributes.military).toBe(60)
    expect(store.currentSave!.state.attributes.economy).toBe(45)
    expect(store.currentSave!.state.attributes.politics).toBe(55) // 未传保留
    expect(store.currentSave!.state.resources.silver).toBe(1200)
    expect(store.currentSave!.state.resources.food).toBe(700)
    expect(store.currentSave!.state.resources.troops).toBe(500) // 未传保留
  })

  it('负值减到低于 0 也直接累加（结局判定在 useTurn 处理）', () => {
    const store = useGameStore()
    store.setSave(createMockSave())

    store.applyEffects({ military: -100 })
    expect(store.currentSave!.state.attributes.military).toBe(-50)
  })

  it('同义词 army/soldiers/forces/兵 重命名为 troops（避免 LLM 写错字段名）', () => {
    const store = useGameStore()
    store.setSave(createMockSave())

    // 模拟 LLM 用 army 字段
    store.applyEffects({ army: 200, silver: -300 })
    expect(store.currentSave!.state.resources.troops).toBe(700) // 500 + 200
    expect(store.currentSave!.state.resources.silver).toBe(700) // 1000 - 300
  })

  it('同义词 soldiers 和 troops 累加（不互相覆盖）', () => {
    const store = useGameStore()
    store.setSave(createMockSave())

    store.applyEffects({ soldiers: 100, troops: 50, army: -30 } as never)
    expect(store.currentSave!.state.resources.troops).toBe(620) // 500 + 100 + 50 - 30
  })

  it('同义词 银两/银子/银 重命名为 silver', () => {
    const store = useGameStore()
    store.setSave(createMockSave())

    store.applyEffects({ 银两: 500, silver: -100 } as never)
    expect(store.currentSave!.state.resources.silver).toBe(1400) // 1000 + 500 - 100
  })

  it('非数字 value 静默忽略（防止 LLM 返回 "500" 字符串）', () => {
    const store = useGameStore()
    store.setSave(createMockSave())

    store.applyEffects({ troops: '+200', silver: -100 } as never)
    expect(store.currentSave!.state.resources.troops).toBe(500) // 字符串被忽略，原值不变
    expect(store.currentSave!.state.resources.silver).toBe(900) // 数字正常
  })
})

describe('appendEvent - 截断', () => {
  it('追加单个事件', () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    store.appendEvent({
      turn: 1,
      eventType: '随机',
      title: '事件1',
      description: '',
      playerChoice: '选项A',
      effects: { military: 5 }
    })

    expect(store.currentSave!.events).toHaveLength(1)
    expect(store.currentSave!.events[0].title).toBe('事件1')
  })

  it('超过 50 条自动截断保留最新 50', () => {
    const store = useGameStore()
    store.setSave(createMockSave())

    for (let i = 1; i <= 55; i++) {
      store.appendEvent({
        turn: i,
        eventType: '随机',
        title: `事件${i}`,
        description: '',
        playerChoice: '',
        effects: {}
      })
    }

    expect(store.currentSave!.events).toHaveLength(50)
    // 最新 50 条是 6~55
    expect(store.currentSave!.events[0].title).toBe('事件6')
    expect(store.currentSave!.events[49].title).toBe('事件55')
  })
})

describe('appendAdvisorMessage - 截断', () => {
  it('超过 20 条自动截断保留最新 20', () => {
    const store = useGameStore()
    store.setSave(createMockSave())

    for (let i = 1; i <= 25; i++) {
      store.appendAdvisorMessage({
        role: i % 2 === 0 ? 'assistant' : 'user',
        content: `消息${i}`,
        turn: 1,
        timestamp: Date.now() + i
      })
    }

    expect(store.currentSave!.advisorMessages).toHaveLength(20)
    expect(store.currentSave!.advisorMessages[0].content).toBe('消息6')
    expect(store.currentSave!.advisorMessages[19].content).toBe('消息25')
  })
})

describe('markEnded', () => {
  it('同步设置 ended/endedAt/endedReason', () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    expect(store.currentSave!.ended).toBe(false)

    const before = Date.now()
    store.markEnded('victory')
    const after = Date.now()

    expect(store.currentSave!.ended).toBe(true)
    expect(store.currentSave!.endedReason).toBe('victory')
    expect(store.currentSave!.endedAt).toBeGreaterThanOrEqual(before)
    expect(store.currentSave!.endedAt).toBeLessThanOrEqual(after)
    // updatedAt 也同步更新
    expect(store.currentSave!.updatedAt).toBe(store.currentSave!.endedAt)
  })
})

describe('加载态操作', () => {
  it('setProcessingTurn', () => {
    const store = useGameStore()
    expect(store.isProcessingTurn).toBe(false)
    store.setProcessingTurn(true)
    expect(store.isProcessingTurn).toBe(true)
    // isLoading 兼容
    expect(store.isLoading).toBe(true)
  })

  it('setAdvisorStreaming', () => {
    const store = useGameStore()
    store.setAdvisorStreaming(true)
    expect(store.isAdvisorStreaming).toBe(true)
  })

  it('setSyncing', () => {
    const store = useGameStore()
    store.setSyncing(true)
    expect(store.isSyncing).toBe(true)
  })
})

describe('setEvent / setNpcActions', () => {
  it('setEvent 设置当前回合事件', () => {
    const store = useGameStore()
    const event = {
      title: '事件',
      description: '描述',
      eventType: '随机' as const,
      options: [{ id: 'o1', label: '选项', effects: { military: 5 } }]
    }
    store.setEvent(event)
    expect(store.currentEvent).toEqual(event)
  })

  it('setNpcActions 设置 NPC 行动列表', () => {
    const store = useGameStore()
    const actions = [
      {
        factionId: 'f1',
        factionName: '清廷',
        action: '扩张' as const,
        description: '扩张领土'
      }
    ]
    store.setNpcActions(actions)
    expect(store.npcActions).toEqual(actions)
  })
})

describe('applyFreeFactionEffects', () => {
  /** 双势力存档：f1 关系接近上限 / f2 关系接近下限、实力低，便于验证 clamp */
  function createFactionSave(): GameSave {
    const save = createMockSave()
    save.updatedAt = 0
    save.factions = [
      { id: 'f1', name: '清廷', summary: '晚清朝廷', power: 10, relationship: 95, status: 'active' },
      { id: 'f2', name: '湘军', summary: '地方团练武装', power: 5, relationship: -95, status: 'active' }
    ]
    return save
  }

  it('应用 relationshipDelta/powerDelta 并刷新 updatedAt（不可变更新）', () => {
    const store = useGameStore()
    store.setSave(createFactionSave())
    const originalFactions = store.currentSave!.factions
    const originalF2 = originalFactions.find((f) => f.id === 'f2')!

    store.applyFreeFactionEffects([{ factionId: 'f2', relationshipDelta: 15, powerDelta: 10 }])

    const f2 = store.currentSave!.factions.find((f) => f.id === 'f2')!
    expect(f2.relationship).toBe(-80)
    expect(f2.power).toBe(15)
    // updatedAt 刷新（初始置 0，应用后必然 > 0）
    expect(store.currentSave!.updatedAt).toBeGreaterThan(0)
    // 不可变更新：存档换新数组，原数组与原对象保持不变
    expect(store.currentSave!.factions).not.toBe(originalFactions)
    expect(originalF2.relationship).toBe(-95)
    expect(originalF2.power).toBe(5)
  })

  it('clamp：delta 超限压回 ±20/±30，relationship 限 [-100,100]，power 下限 0', () => {
    const store = useGameStore()
    store.setSave(createFactionSave())

    store.applyFreeFactionEffects([
      { factionId: 'f1', relationshipDelta: 50 }, // 超出 +20 → 实际 +20；95+20=115 → clamp 100
      { factionId: 'f2', powerDelta: -30 } // 5-30=-25 → Math.max(0) → 0
    ])

    const f1 = store.currentSave!.factions.find((f) => f.id === 'f1')!
    const f2 = store.currentSave!.factions.find((f) => f.id === 'f2')!
    expect(f1.relationship).toBe(100)
    expect(f2.power).toBe(0)
  })

  it('无效 factionId 条目被忽略，不影响其他有效条目', () => {
    const store = useGameStore()
    store.setSave(createFactionSave())

    store.applyFreeFactionEffects([
      { factionId: 'bu-cun-zai', relationshipDelta: 20 },
      { factionId: 'f2', relationshipDelta: 10 }
    ])

    const f1 = store.currentSave!.factions.find((f) => f.id === 'f1')!
    const f2 = store.currentSave!.factions.find((f) => f.id === 'f2')!
    expect(f1.relationship).toBe(95) // 未命中条目原样保留
    expect(f2.relationship).toBe(-85) // 有效条目正常应用
  })

  it('与 applyEffects 两通道叠加（资源扣减 + 关系上升互不干扰）', () => {
    const store = useGameStore()
    store.setSave(createFactionSave())

    store.applyEffects({ silver: -50 })
    store.applyFreeFactionEffects([{ factionId: 'f2', relationshipDelta: 20 }])

    expect(store.currentSave!.state.resources.silver).toBe(950)
    expect(store.currentSave!.factions.find((f) => f.id === 'f2')!.relationship).toBe(-75)
  })

  it('lastFreeFactionEffects 记录反馈供 UI 展示，clearLastFreeFactionEffects 清空', () => {
    const store = useGameStore()
    store.setSave(createFactionSave())

    store.applyFreeFactionEffects([{ factionId: 'f2', relationshipDelta: 15 }])
    expect(store.lastFreeFactionEffects).toEqual([{ name: '湘军', relationshipDelta: 15 }])

    store.clearLastFreeFactionEffects()
    expect(store.lastFreeFactionEffects).toEqual([])
  })

  it('无存档或空数组时安全早退', () => {
    const store = useGameStore()
    // 无存档不抛错
    expect(() => store.applyFreeFactionEffects([{ factionId: 'f1', relationshipDelta: 5 }])).not.toThrow()

    store.setSave(createFactionSave())
    // 空数组不产生任何变更
    expect(() => store.applyFreeFactionEffects([])).not.toThrow()
    expect(store.currentSave!.factions.find((f) => f.id === 'f2')!.relationship).toBe(-95)
  })
})
