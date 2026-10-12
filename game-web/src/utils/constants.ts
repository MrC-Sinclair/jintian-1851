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

/**
 * 胜利阈值：综合实力 ≥ 85
 *
 * 原值 90 是在「属性可无上限堆叠」的前提下标定的——单维冲到 129 就能把加权平均抬过线。
 * 封顶 0-100 后重跑 200 局：最优策略 bot 胜率从 99.5% 掉到 48.5%，且 avgPower 88.2
 * 说明大量对局卡在 89 附近撞回合上限。降到 85 是随封顶一起重新标定，不是单独调难度。
 */
export const VICTORY_THRESHOLD = 85

/**
 * 五维属性上限（game-design.md:32「每维取值范围 0-100」）
 *
 * 只夹上限、不夹下限：属性可以累加到负数，由 checkEndConditions 判 ≤0 崩溃，
 * 这是 game-store.test.ts 里显式锁住的设计（负值保留真实赤字，便于展示与判定）。
 * 此前 applyEffects 完全不夹，实测军事涨到 129 超出 0-100 刻度、进度条溢出，
 * 且单维堆叠能把综合实力轻松推过胜利线。
 */
export const ATTRIBUTE_MAX = 100

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

/**
 * 每回合自动产出资源（game-design.md:572）
 *
 * 兵员必须给产出：200 局模拟实测兵员下限会跌到 -115（真实归零），
 * 而 resource-penalty 规定兵员 ≤ 0 每回合掉军事——没有产出的话就是
 * 一旦打光就永久下滑的死亡螺旋。+15/回合的含义是「归零后一回合即可喘过来」，
 * 惩罚变成刹车而非绞索。
 *
 * 粮草刻意**不给**产出：模拟实测全局粮草最低值 770（起始 800），
 * 说明现有内容里根本没有粮草消耗压力，给它加产出只是把一个死数字涨得更快。
 * 「断粮→饥荒」惩罚保留（长局与后续内容补充粮草消耗时才会触发），
 * 真正的缺口在内容侧：需要更多以粮草为代价的事件，而不是靠数值掩盖。
 *
 * 名望刻意给**负**产出（-3/回合，「人走茶凉」）：实测 200 局每回合名望净漂移
 * 中位 +4.40（p25 3.71 / p75 4.92），中位 36 回合打完能涨到 162、最高 305——
 * 完全脱离 game-design.md 的 0-100「朝野声望」刻度。给它加 100 封顶后，
 * 200 局会 100% 撞顶（区分度归零），所以封顶必须配衰减才有意义。
 * 衰减 3 档实测终局中位 56、p10=20、p90=88、仅 7% 撞顶，是分布最好的一档。
 * 副作用：结盟/离间要花 10 点名望，衰减后攒够更难——属预期（名望本就该是稀缺资源）。
 */
export const TURN_YIELD: Partial<Resources> = { silver: 50, troops: 15, reputation: -3 }

/**
 * 养饷：每 100 名兵员每回合消耗的银两（`ceil(troops/100) × K`）
 *
 * 为什么要有这个：兵员此前只有「事件扣数」和「+15/回合 产出」两条线，
 * 养一支大军毫无成本。实测单加兵员消耗（直接扣 troops）几乎无效——
 * K=10 的兵员消耗会被 +15/回合 的产出整个吃掉（200 局里与不加消耗的结局分布完全相同），
 * 所以改成「兵多 → 饷重」的联动，让大军成为财政负担而不是一个数字。
 *
 * K=4 的标定依据（200 局模拟，含破产后果与断粮/兵溃惩罚补算）：
 *   均饷 29.1 银/回合（对 +50 产出仍有 ~21 净余量）、银两归零回合占比 7.1%、
 *   胜率 95.5% → 86.0%。
 * ⚠️ 不要再往上调：K=6 时均饷 43.6 已几乎吃光产出，银两常年归零会持续触发破产惩罚，
 *   胜率断崖到 55.5%。养饷率必须给银两留净收入余量。
 */
export const TROOP_UPKEEP_SILVER_PER_100 = 4

/**
 * 名望上限（与五维同刻度的 0-100「朝野声望」）
 *
 * 只给名望封顶，不给银两/兵员/粮草封顶：那三个是**存量计数**（起始 1000/500/800），
 * 没有刻度语义；名望是评分刻度，不封顶就会涨到 300+ 让档位与 UI 都失真。
 */
export const REPUTATION_MAX = 100

/** 史评档位（名望 → 称号、评语、NPC 态度倾向）：结局页展示与后端 NPC 决策共用同一张表 */
export interface HistoryRating {
  /** 该档下限（名望 ≥ 此值即入档） */
  min: number
  label: string
  remark: string
  /**
   * 给 NPC 的态度倾向提示（后端 prompt 用）。
   * 前端不读这个字段，但**刻意保留在同一张表里**：两个子项目无法互相 import，
   * 靠 mirror-consistency.test.ts 直接 import 后端副本做深比较来防漂移——
   * 表结构一致才能让 `toEqual` 一把梭，拆成两张表就退化成注释约定。
   */
  npcStance: string
}

/**
 * 档位划线对应实测分位：**年钟（1 回合 = 1 年）下** 600 局合并分布
 *   p10=9 / p20=21 / 中位=54 / p75=65 / p90=77
 * 划线 78/60/42/22 → 实测占比 9% / 30% / 25% / 16% / 20%，最高档刻意留约 top 10%。
 *
 * ⚠️ 这组数字是随「时钟从月改成年」一起重标的：月钟下中位局长 37 回合、年钟下 63 回合，
 * 名望的累计衰减（−3/回合）与累计增益同时放大，旧划线（85/65/40/20）会把五档压成两档
 * （开链组实测 0%/36%/64%/0%/0%）。**刻意不动 −3 本身**：把它降到 −2 会让分布整体上移约 63，
 * 反而全员撞封顶 —— 衰减率与增益率是同一架天平的两端，只能重划刻度，不能单边改。
 */
export const HISTORY_RATINGS: HistoryRating[] = [
  {
    min: 78,
    label: '天下归心',
    remark: '口碑载道，四方望风而归。',
    npcStance: '玩家名望天下归心，你轻举妄动会招清议围攻，宜先示好或观望'
  },
  {
    min: 60,
    label: '朝野称望',
    remark: '名动京师，士民称贤。',
    npcStance: '玩家名望朝野称望，你须给它三分面子，挑衅代价高'
  },
  {
    min: 42,
    label: '声名平平',
    remark: '无功无过，时人评价不一。',
    npcStance: '玩家名望平平，你的行动不受舆论掣肘，按自身利益决断即可'
  },
  {
    min: 22,
    label: '物议沸然',
    remark: '非议四起，信誉渐失。',
    npcStance: '玩家物议沸然、信誉低落，你可公开藐视、趁机施压'
  },
  {
    min: -Infinity,
    label: '身败名裂',
    remark: '口碑崩坏，为天下笑。',
    npcStance: '玩家身败名裂为天下笑，你可毫不顾忌地进逼吞并'
  }
]

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
