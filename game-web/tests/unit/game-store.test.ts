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
