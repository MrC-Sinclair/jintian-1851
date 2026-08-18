/**
 * @file 平衡相关常量集中管理（跨提案收口）
 *
 * 避免 CRISIS_THRESHOLD / VICTORY_THRESHOLD 在 goal-hint.ts 与 end-conditions.ts
 * 各定义一份导致后期调阈值漏改（C2 跨提案约定）。
 * 同时承载三份平衡提案（事件权重/资源产出/加权实力）的新增常量。
 */

import type {
  Attributes,
  FactionStatus,
  NegotiationDealId,
  PlayerDiplomacyAction,
  Resources
} from '@/types/game'

/** 危机/短板阈值：属性 < 30 视为危机（事件权重提案复用此阈值，不另建常量） */
export const CRISIS_THRESHOLD = 30

/** 胜利阈值：综合实力 ≥ 90 */
export const VICTORY_THRESHOLD = 90

/** 事件短板偏好强度：+20% 方向性引导（game-design.md:570 示例） */
export const SHORTFALL_BONUS = 20

/**
 * 综合实力权重（game-design.md:573 治世之要）
 * politics/people 权重更高，引导玩家注重内政；权重和用于归一化。
 */
export const POWER_WEIGHTS: Record<keyof Attributes, number> = {
  military: 1,
  economy: 1,
  politics: 1.3,
  people: 1.3,
  diplomacy: 1
}

/** 每回合自动产出资源（game-design.md:572） */
export const TURN_YIELD: Partial<Resources> = { silver: 50 }

/**
 * 数值夹紧工具（store/组件共用，避免各组件重复实现 clampPercent）
 */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/**
 * 玩家主动外交：每回合最多可发起的行动次数（player-active-diplomacy 提案 D3）
 */
export const MAX_DIPLOMACY_PER_TURN = 1

/**
 * 单条外交动作规则（player-active-diplomacy 提案 D2）
 *
 * - minRelationship：关系门槛，relationship < 该值则不可发动（无门槛用 -100 表达）
 * - cost：资源成本（负值，经 applyEffects 扣减）
 * - relDelta：对目标 relationship 的增量（clamp -100~100）
 * - setRelationship：若指定，relationship 直接设为此值（如宣战 -100），优先级高于 relDelta
 * - setStatus：状态覆写（如结盟 → 'allied'）
 * - powerDelta：对目标 power 的增量（离间用负值，Math.max(0, ...) 防负）
 * - bonus：除 relationship 外的额外正增量（如通商 reputation+5），经 applyEffects 应用
 */
export interface DiplomacyRule {
  minRelationship: number
  cost: Partial<Resources>
  relDelta?: number
  setRelationship?: number
  setStatus?: FactionStatus
  powerDelta?: number
  bonus?: Partial<Attributes & Resources>
}

/**
 * 6 动作确定性规则表（初版平衡值，待联合校验回调）
 *
 * 成本均偏高（与自动资源/加权实力/事件权重三提案一并做联合平衡校验），
 * 避免次级操作喧宾夺主。
 */
export const DIPLOMACY_RULES: Record<PlayerDiplomacyAction, DiplomacyRule> = {
  结盟: { minRelationship: 50, cost: { silver: -100, reputation: -10 }, relDelta: 30, setStatus: 'allied' },
  宣战: { minRelationship: -100, cost: { troops: -100 }, setRelationship: -100 },
  行贿: { minRelationship: -100, cost: { silver: -80 }, relDelta: 15 },
  通商: { minRelationship: -100, cost: { silver: -50 }, relDelta: 10, bonus: { reputation: 5 } },
  离间: { minRelationship: -100, cost: { silver: -60, reputation: -10 }, powerDelta: -20 },
  质子: { minRelationship: -100, cost: { troops: -50 }, relDelta: 20 }
}

/**
 * 校验资源是否足够支付成本（cost 为负值，逐项取绝对值比较）
 */
export function canAfford(cost: Partial<Resources>, resources: Resources): boolean {
  return (Object.keys(cost) as (keyof Resources)[]).every((k) => {
    const need = Math.abs(cost[k] ?? 0)
    return (resources[k] ?? 0) >= need
  })
}

// ====================== 谈判（faction-negotiation 提案 D2/D4） ======================

/** 谈判：每回合最多发起次数（与按钮外交配额 diplomacyUsedThisTurn 互不占用） */
export const MAX_NEGOTIATION_PER_TURN = 1

/** 信件本身的软性关系影响上限（弱于行贿按钮 +15） */
export const NEGOTIATION_LETTER_DELTA_LIMIT = 10

/**
 * 谈判条件兑换表（单条定义）
 *
 * ⚠️ 与 server/server/utils/negotiation-deals.ts 的 NEGOTIATION_DEALS 镜像，
 *    修改任一处必须同步另一处（spec 强制）。
 * - cost：资源价格区间（均为扣减量，正值）；silver 为主资源锚，其余资源按同一 ratio 缩放
 * - effect：效果区间；status 仅 alliance-deal 有（前端按表映射，LLM 不产出）
 * - requires：关系门槛（发起该 deal 的前置条件，后端 sanitize 同款校验）
 */
export interface NegotiationDealDef {
  id: NegotiationDealId
  label: string
  cost: { silver: [number, number]; reputation?: [number, number] }
  effect: { relationship: [number, number]; reputation?: [number, number]; status?: 'allied' }
  requires: { minRelationship?: number; maxRelationship?: number }
}

export const NEGOTIATION_DEALS: readonly NegotiationDealDef[] = [
  {
    id: 'gift-deal',
    label: '馈赠通好',
    cost: { silver: [60, 120] },
    effect: { relationship: [10, 20] },
    requires: {}
  },
  {
    id: 'trade-deal',
    label: '互市通商',
    cost: { silver: [40, 80] },
    effect: { relationship: [8, 15], reputation: [3, 5] },
    requires: { minRelationship: 0 }
  },
  {
    id: 'truce-deal',
    label: '破财止战',
    cost: { silver: [80, 150] },
    effect: { relationship: [15, 25] },
    requires: { maxRelationship: -30 }
  },
  {
    id: 'alliance-deal',
    label: '歃血为盟',
    cost: { silver: [120, 200], reputation: [5, 10] },
    effect: { relationship: [25, 30], status: 'allied' },
    requires: { minRelationship: 35 }
  }
]

export function getNegotiationDealById(dealId: string): NegotiationDealDef | undefined {
  return NEGOTIATION_DEALS.find((d) => d.id === dealId)
}

/**
 * 按价格线性缩放效果与副资源成本（与 server scaleDealValues 同款算法）
 * ratio = (price − silverMin) / (silverMax − silverMin)，clamp 0~1；
 * 每个值 = min + ratio × (max − min) 后取整。
 */
export function scaleNegotiationEffect(deal: NegotiationDealDef, price: number): {
  cost: { silver: number; reputation?: number }
  effect: { relationship: number; reputation?: number; status?: 'allied' }
} {
  const [min, max] = deal.cost.silver
  const ratio = Math.min(Math.max((price - min) / (max - min), 0), 1)
  const scale = (range: readonly [number, number]) =>
    Math.round(range[0] + ratio * (range[1] - range[0]))

  return {
    cost: {
      silver: price,
      reputation: deal.cost.reputation ? scale(deal.cost.reputation) : undefined
    },
    effect: {
      relationship: scale(deal.effect.relationship),
      reputation: deal.effect.reputation ? scale(deal.effect.reputation) : undefined,
      status: deal.effect.status
    }
  }
}

/**
 * 玩家还价合法区间：[floor(silverMin×0.5), 原价]（design.md D2）
 */
export function counterPriceRange(deal: NegotiationDealDef, originalPrice: number): {
  min: number
  max: number
} {
  return { min: Math.floor(deal.cost.silver[0] * 0.5), max: originalPrice }
}
