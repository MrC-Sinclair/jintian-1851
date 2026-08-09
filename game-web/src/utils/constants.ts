/**
 * @file 平衡相关常量集中管理（跨提案收口）
 *
 * 避免 CRISIS_THRESHOLD / VICTORY_THRESHOLD 在 goal-hint.ts 与 end-conditions.ts
 * 各定义一份导致后期调阈值漏改（C2 跨提案约定）。
 * 同时承载三份平衡提案（事件权重/资源产出/加权实力）的新增常量。
 */

import type { Attributes, FactionStatus, PlayerDiplomacyAction, Resources } from '@/types/game'

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
