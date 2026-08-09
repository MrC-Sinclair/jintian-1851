/**
 * @file 联合平衡校验（player-active-diplomacy 提案 T7 跨提案校验）
 *
 * 将玩家主动外交与三份已落地平衡提案一并评估：
 *   - 自动资源产出（resource-per-turn-yield）：每回合 applyEffects(TURN_YIELD) 银两 +50
 *   - 加权综合实力（weighted-overall-power）：calcOverallPower 政治/民心权重 1.3
 *   - 事件权重动态调整（event-weight-dynamic-adjust）：短板事件 +20% 概率
 *     → 模拟中简化为「每回合全维 +1，当前最低维额外 +2」（保守基线假设）
 *
 * 模拟器用真实 store（applyEffects / applyDiplomacyAction / updateState）跑确定性路径，
 * 分别开启/关闭外交，验证：
 *   1. 两条路径综合实力都能收敛到胜利阈值 90（可通关）
 *   2. 含外交路径最终实力与不含外交几乎相同（外交不改玩家属性，不拖慢主平衡）
 *   3. 含外交路径银两全程 > 0（自动资源 +50 兜底，不破产）
 *   4. 外交行动确实被应用（每回合上限 1 次，受 resetDiplomacy 解锁）
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '../../src/stores/game'
import { calcOverallPower } from '../../src/utils/end-conditions'
import { TURN_YIELD, VICTORY_THRESHOLD } from '../../src/utils/constants'
import type { Attributes, GameSave } from '../../src/types/game'

function buildSave(): GameSave {
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
      resources: { silver: 1000, troops: 500, food: 800, reputation: 10 }
    },
    factions: [
      { id: 'f1', name: '清廷', summary: '', power: 70, relationship: 80, status: 'active' },
      { id: 'f2', name: '太平天国', summary: '', power: 60, relationship: -50, status: 'active' },
      { id: 'f3', name: '湘军', summary: '', power: 50, relationship: 20, status: 'active' },
      { id: 'f4', name: '革命党', summary: '', power: 40, relationship: -20, status: 'active' },
      { id: 'f5', name: '北洋', summary: '', power: 45, relationship: 0, status: 'active' },
      { id: 'f6', name: '淮军', summary: '', power: 55, relationship: 30, status: 'active' }
    ],
    events: [],
    advisorMessages: [],
    pendingChainNodes: [],
    completedChainIds: [],
    activeChainIds: [],
    ended: false
  }
}

/**
 * 事件增益模型（保守基线假设，对应事件权重短板指引 +20%）：
 * 每回合全维 +1，当前最低维额外 +2，clamp 0-100。
 */
function bumpAttributes(store: ReturnType<typeof useGameStore>): void {
  const a = { ...store.currentSave!.state.attributes }
  const keys = Object.keys(a) as (keyof Attributes)[]
  let lowest = keys[0]
  for (const k of keys) if (a[k] < a[lowest]) lowest = k
  for (const k of keys) a[k] = Math.min(100, a[k] + 1)
  a[lowest] = Math.min(100, a[lowest] + 2)
  store.updateState({ attributes: a })
}

interface SimResult {
  powerFinal: number
  minSilver: number
  diplomacyActions: number
}

/** 模拟标准通关路径（useDiplomacy 控制是否叠加外交次级操作） */
function simulate(useDiplomacy: boolean, maxTurns = 120): SimResult {
  const store = useGameStore()
  store.setSave(buildSave())
  let minSilver = Infinity
  let diplomacyActions = 0

  for (let t = 0; t < maxTurns; t++) {
    // 自动资源产出（resource-per-turn-yield 提案）
    store.applyEffects(TURN_YIELD)
    // 事件增益（事件权重提案的短板偏置，保守基线）
    bumpAttributes(store)

    if (useDiplomacy) {
      // 新回合解锁外交上限（useTurn.startTurn 行为）
      store.resetDiplomacy()
      // 每回合最多 1 次：优先结盟一个关系达标且未结盟的势力，否则对活跃势力通商
      const allyTarget = store.currentSave!.factions.find(
        (f) => f.status === 'active' && f.id !== store.currentSave!.character.factionId && f.relationship >= 50
      )
      const res = store.currentSave!.state.resources
      if (allyTarget && res.silver >= 100) {
        if (store.applyDiplomacyAction(allyTarget.id, '结盟')) diplomacyActions++
      } else {
        const tradeTarget = store.currentSave!.factions.find(
          (f) => f.status === 'active' && f.id !== store.currentSave!.character.factionId
        )
        if (tradeTarget && res.silver >= 50) {
          if (store.applyDiplomacyAction(tradeTarget.id, '通商')) diplomacyActions++
        }
      }
    }

    minSilver = Math.min(minSilver, store.currentSave!.state.resources.silver)

    const power = calcOverallPower(store.currentSave!.state.attributes)
    if (power >= VICTORY_THRESHOLD) break
  }

  return {
    powerFinal: calcOverallPower(store.currentSave!.state.attributes),
    minSilver,
    diplomacyActions
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('联合平衡校验：外交 + 自动资源 + 加权实力 + 事件权重', () => {
  it('两条路径综合实力都能收敛到胜利阈值 90（可通关）', () => {
    const withDiplo = simulate(true)
    const withoutDiplo = simulate(false)
    expect(withDiplo.powerFinal).toBeGreaterThanOrEqual(VICTORY_THRESHOLD)
    expect(withoutDiplo.powerFinal).toBeGreaterThanOrEqual(VICTORY_THRESHOLD)
  })

  it('外交不改玩家属性，不拖慢主平衡（两路径最终实力几乎相同）', () => {
    const withDiplo = simulate(true)
    const withoutDiplo = simulate(false)
    // 外交只改 faction 字段，不触碰 5 维属性，故实力成长曲线应一致
    expect(Math.abs(withDiplo.powerFinal - withoutDiplo.powerFinal)).toBeLessThan(0.5)
  })

  it('含外交路径银两全程 > 0（自动资源 +50/回合兜底，不破产）', () => {
    const withDiplo = simulate(true)
    expect(withDiplo.minSilver).toBeGreaterThan(0)
  })

  it('外交行动确实被应用（每回合上限 1 次，受 resetDiplomacy 解锁）', () => {
    const withDiplo = simulate(true)
    expect(withDiplo.diplomacyActions).toBeGreaterThan(0)
  })

  it('单回合最大外交成本可被自动资源在 2 回合内回补（不变量）', () => {
    // 结盟成本银两 100，自动资源 50/回合 → 上限 2 回合回补，不会不可逆崩盘
    const maxCost = 100
    const yieldPerTurn = TURN_YIELD.silver ?? 0
    expect(Math.ceil(maxCost / yieldPerTurn)).toBeLessThanOrEqual(2)
  })
})
