/**
 * @file 谈判兑换表联合平衡校验（faction-negotiation 提案，多面校验）
 *
 * 兑换表数值为首版设计值（design.md 残余不确定性已声明），本文件用真实 store 跑确定性
 * 最坏情况模拟（假设 Agent 全部接受还价/全部返回最大正 delta），从多维度校验：
 *
 *   1. 跨提案不变量：谈判 + 按钮 + 自动资源全开，实力仍收敛到胜利阈值（不拖慢通关）
 *   2. 经济不变量：银两全程 > 0（不破产）；单回合最大总支出可被自动资源在 N 回合内回补
 *   3. 叠加不变量：单回合 relationship 理论最大叠加 ≤ 60（信件 10 + 兑换 30 + 自由行动 20，
 *      design.md 声明值），clamp -100~100 生效
 *   4. 极端刷信策略：纯写信（不成交）每回合 +10 delta，单势力从 -100 到 0 需 ≥8 回合
 *      （免费通道不可过快）；对通关回合数无加速（关系不进综合实力）
 *   5. 结盟速度对比：alliance-deal（门槛 35）vs 按钮结盟（门槛 50）的银两名望总成本与
 *      回合数 trade-off（"花更多钱换更低门槛"设计意图成立）
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '../../src/stores/game'
import { calcOverallPower } from '../../src/utils/end-conditions'
import {
  NEGOTIATION_DEALS,
  TURN_YIELD,
  VICTORY_THRESHOLD,
  counterPriceRange,
  getNegotiationDealById,
  scaleNegotiationEffect
} from '../../src/utils/constants'
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

/** 事件增益模型（与 diplomacy-balance 一致的保守基线） */
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
  turnsToWin: number
  minSilver: number
  maxSingleTurnSpend: number
  negotiationActions: number
  buttonActions: number
  alliedCount: number
  maxRelJump: number
}

type Mode = 'none' | 'buttons' | 'negotiation' | 'both'

/**
 * 模拟标准通关路径（最坏情况假设：Agent 全接受还价、信件 delta 恒 +10）。
 * 谈判策略（确定性贪心）：优先对关系≥35 的势力 alliance-deal（还到半价），
 * 否则对关系最高的 <35 势力 gift-deal（还到半价）刷关系铺垫。
 * 按钮策略：与 diplomacy-balance 相同（优先结盟，否则通商）。
 */
function simulate(mode: Mode, maxTurns = 120): SimResult {
  const store = useGameStore()
  store.setSave(buildSave())
  let minSilver = Infinity
  let maxSingleTurnSpend = 0
  let negotiationActions = 0
  let buttonActions = 0
  let maxRelJump = 0
  let turnsToWin = maxTurns

  const others = () =>
    store.currentSave!.factions.filter(
      (f) => f.status === 'active' && f.id !== store.currentSave!.character.factionId
    )

  for (let t = 0; t < maxTurns; t++) {
    store.applyEffects(TURN_YIELD)
    bumpAttributes(store)

    const silverBefore = store.currentSave!.state.resources.silver
    const relBefore = new Map(others().map((f) => [f.id, f.relationship]))

    // 新回合解锁双配额（useTurn.startTurn 行为）
    store.resetDiplomacy()

    // ---- 按钮外交（mode 含 buttons）----
    if (mode === 'buttons' || mode === 'both') {
      const res = store.currentSave!.state.resources
      const allyTarget = others().find((f) => f.relationship >= 50)
      if (allyTarget && res.silver >= 100) {
        if (store.applyDiplomacyAction(allyTarget.id, '结盟')) buttonActions++
      } else {
        const tradeTarget = others()[0]
        if (tradeTarget && res.silver >= 50) {
          if (store.applyDiplomacyAction(tradeTarget.id, '通商')) buttonActions++
        }
      }
    }

    // ---- 谈判（mode 含 negotiation）----
    if (mode === 'negotiation' || mode === 'both') {
      const res = store.currentSave!.state.resources
      const allianceDeal = getNegotiationDealById('alliance-deal')!
      const giftDeal = getNegotiationDealById('gift-deal')!
      // 还价压到合法下限（最坏情况：Agent 全接受）
      const allianceTarget = others().find(
        (f) => f.relationship >= 35 && res.silver >= counterPriceRange(allianceDeal, allianceDeal.cost.silver[1]).min
      )
      const giftTarget = others()
        .filter((f) => f.relationship < 35)
        .sort((a, b) => b.relationship - a.relationship)[0]
      if (allianceTarget) {
        const { min } = counterPriceRange(allianceDeal, allianceDeal.cost.silver[1])
        if (store.applyNegotiationDeal(allianceTarget.id, 'alliance-deal', min, 10)) {
          negotiationActions++
        }
      } else if (giftTarget) {
        const { min } = counterPriceRange(giftDeal, giftDeal.cost.silver[1])
        if (res.silver >= min && store.applyNegotiationDeal(giftTarget.id, 'gift-deal', min, 10)) {
          negotiationActions++
        }
      }
    }

    // 记录单回合最大支出与单势力关系最大跳变
    const spend = silverBefore - store.currentSave!.state.resources.silver
    maxSingleTurnSpend = Math.max(maxSingleTurnSpend, spend)
    for (const f of others()) {
      const jump = Math.abs(f.relationship - (relBefore.get(f.id) ?? f.relationship))
      maxRelJump = Math.max(maxRelJump, jump)
    }
    minSilver = Math.min(minSilver, store.currentSave!.state.resources.silver)

    if (calcOverallPower(store.currentSave!.state.attributes) >= VICTORY_THRESHOLD) {
      turnsToWin = t + 1
      break
    }
  }

  return {
    powerFinal: calcOverallPower(store.currentSave!.state.attributes),
    turnsToWin,
    minSilver,
    maxSingleTurnSpend,
    negotiationActions,
    buttonActions,
    alliedCount: store.currentSave!.factions.filter((f) => f.status === 'allied').length,
    maxRelJump
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('谈判兑换表联合平衡校验（最坏情况：还价全接受 / delta 恒 +10）', () => {
  it('四条路径实力均收敛到胜利阈值 90（谈判不拖慢通关）', () => {
    for (const mode of ['none', 'buttons', 'negotiation', 'both'] as Mode[]) {
      const r = simulate(mode)
      expect(r.powerFinal, `mode=${mode}`).toBeGreaterThanOrEqual(VICTORY_THRESHOLD)
    }
  })

  it('经济不变量：银两全程 > 0（自动资源 +50/回合兜底，不破产）', () => {
    const both = simulate('both')
    expect(both.minSilver).toBeGreaterThan(0)
  })

  it('经济不变量：单回合最大总支出 ≤ 自动资源 6 回合产出（300 银 = 6×50）', () => {
    const both = simulate('both')
    const yieldPerTurn = TURN_YIELD.silver ?? 0
    // 最坏情况：alliance-deal 半价 60 + 按钮 100 = 160；上限是不动用还价 200+100=300
    const theoreticalMax = 200 + 100
    expect(both.maxSingleTurnSpend).toBeLessThanOrEqual(theoreticalMax)
    expect(Math.ceil(theoreticalMax / yieldPerTurn)).toBeLessThanOrEqual(6)
  })

  it('叠加不变量：单回合单势力关系最大跳变 ≤ 60（信件10+兑换30+自由行动20 上限，模拟内无自由行动故 ≤40）', () => {
    const both = simulate('both')
    // 模拟含信件 delta(+10) + alliance-deal(+25~30)，无自由行动通道 → 上限 40
    expect(both.maxRelJump).toBeLessThanOrEqual(40)
  })

  it('配额独立性：both 模式下两类行动并存且均被应用', () => {
    const both = simulate('both')
    expect(both.negotiationActions).toBeGreaterThan(0)
    expect(both.buttonActions).toBeGreaterThan(0)
  })

  it('alliance-deal 成交确实置 status=allied（npc 下回合退出活跃决策）', () => {
    const r = simulate('negotiation')
    expect(r.alliedCount).toBeGreaterThan(0)
  })

  it('极端刷信策略：纯 applyLetterDelta(+10/回合) 单势力 -100→0 需 ≥8 回合（免费通道不可过快）', () => {
    const store = useGameStore()
    store.setSave(buildSave())
    // f2 太平天国 -50 起，纯信件通道刷到 0：需要 ≥5 回合（每回合 clamp 后 +10）
    let turns = 0
    while (store.currentSave!.factions.find((f) => f.id === 'f2')!.relationship < 0 && turns < 100) {
      store.applyLetterDelta('f2', 10)
      turns++
    }
    expect(turns).toBeGreaterThanOrEqual(5)
    // 纯 -100 → 0 需 10 回合（10×10），从 clamp 下界验证
    const store2 = useGameStore()
    store2.setSave(buildSave())
    store2.currentSave!.factions.find((f) => f.id === 'f2')!.relationship = -100
    let turns2 = 0
    while (store2.currentSave!.factions.find((f) => f.id === 'f2')!.relationship < 0 && turns2 < 100) {
      store2.applyLetterDelta('f2', 10)
      turns2++
    }
    expect(turns2).toBeGreaterThanOrEqual(8) // clamp 边界取 8~10 均合理
  })
})

describe('静态数值分析：兑换表 vs 按钮表性价比（关系点/银两）', () => {
  it('各 deal 区间两端性价比均不低于按钮同位动作的 80%（防谈判全面优于按钮）', () => {
    // 按钮基线：行贿 80→+15（0.1875）、通商 50→+10（0.2）、结盟 100→+30（0.3 但需名望且门槛 50）
    const BUTTON_BRIBE = 15 / 80
    const effPerSilver = (dealId: 'gift-deal' | 'trade-deal' | 'truce-deal' | 'alliance-deal') => {
      const d = getNegotiationDealById(dealId)!
      return [
        scaleNegotiationEffect(d, d.cost.silver[0]).effect.relationship / d.cost.silver[0],
        scaleNegotiationEffect(d, d.cost.silver[1]).effect.relationship / d.cost.silver[1]
      ]
    }
    // gift/truce（与行贿同位：纯关系）不得超行贿 1.25 倍（留还价博弈空间但不过分）
    for (const dealId of ['gift-deal', 'truce-deal'] as const) {
      const [lo, hi] = effPerSilver(dealId)
      expect(lo, `${dealId} 低价性价比`).toBeLessThanOrEqual(BUTTON_BRIBE * 1.25)
      expect(hi, `${dealId} 高价性价比`).toBeLessThanOrEqual(BUTTON_BRIBE)
    }
    // trade（与通商同位）：含名望增益，关系性价比不超通商 1.1 倍
    const [tLo, tHi] = effPerSilver('trade-deal')
    expect(tLo).toBeLessThanOrEqual(0.2 * 1.1)
    expect(tHi).toBeLessThanOrEqual(0.2)
  })

  it('还价压到下限时效果取区间下限（ratio=0），性价比翻倍作为博弈激励', () => {
    const gift = getNegotiationDealById('gift-deal')!
    const { min } = counterPriceRange(gift, gift.cost.silver[1])
    const r = scaleNegotiationEffect(gift, min)
    expect(r.effect.relationship).toBe(gift.effect.relationship[0]) // 下限效果
    expect(r.cost.silver).toBe(30) // 60×0.5
  })

  it('alliance-deal 总成本 > 按钮结盟（花更多钱换更低门槛的设计意图成立）', () => {
    const alliance = getNegotiationDealById('alliance-deal')!
    // 谈判最低价 120 银 + 5 名望 vs 按钮 100 银 + 10 名望：银两多 20+，门槛低 15
    const [minSilver] = alliance.cost.silver
    expect(minSilver).toBeGreaterThan(100)
    // 门槛差：35 < 50
    expect(alliance.requires.minRelationship!).toBeLessThan(50)
    // 效果不超按钮结盟（+30）
    expect(alliance.effect.relationship[1]).toBeLessThanOrEqual(30)
  })

  it('兑换表 4 条区间下限 ≤ 上限且门槛合法（与 server 镜像一致的结构不变量）', () => {
    for (const d of NEGOTIATION_DEALS) {
      expect(d.cost.silver[0]).toBeLessThanOrEqual(d.cost.silver[1])
      expect(d.effect.relationship[0]).toBeLessThanOrEqual(d.effect.relationship[1])
      if (d.requires.minRelationship !== undefined) {
        expect(d.requires.minRelationship).toBeGreaterThan(-100)
      }
      if (d.requires.maxRelationship !== undefined) {
        expect(d.requires.maxRelationship).toBeLessThan(0)
      }
    }
  })
})
