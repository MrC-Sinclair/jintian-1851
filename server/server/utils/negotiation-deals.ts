/**
 * @file 谈判条件兑换表（design.md D2）
 *
 * 预定义 4 条"议价版"交易：LLM 只能从表中选 dealId 并在价格区间内定价（silver 为主资源锚），
 * 效果随价格线性缩放；最终数值由前端按镜像表确定性执行（server 不产出最终数值，防幻觉破坏平衡）。
 *
 * ⚠️ 与 game-web/src/utils/constants.ts 的 NEGOTIATION_DEALS 镜像，修改任一处必须同步另一处。
 */

export type NegotiationDealId = 'gift-deal' | 'trade-deal' | 'truce-deal' | 'alliance-deal'

export interface NegotiationDealDef {
  id: NegotiationDealId
  label: string
  /** 资源价格区间（均为扣减量，正值）；silver 为主资源锚，其余资源按同一 ratio 缩放 */
  cost: { silver: [number, number]; reputation?: [number, number] }
  /** 效果区间；status 仅 alliance-deal 有，由前端按表映射（LLM 不产出 status） */
  effect: { relationship: [number, number]; reputation?: [number, number]; status?: 'allied' }
  /** 关系门槛（发起该 deal 的前置条件） */
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
] as const

/** 信件本身的软性关系影响上限（弱于行贿按钮 +15） */
export const NEGOTIATION_LETTER_DELTA_LIMIT = 10

export function getDealById(dealId: string): NegotiationDealDef | undefined {
  return NEGOTIATION_DEALS.find((d) => d.id === dealId)
}

/**
 * 防幻觉 sanitize：校验 Agent 提出的 deal
 * - dealId 必须 ∈ 表内
 * - 关系门槛必须满足（requires）
 * - price clamp 回 silver 区间
 * @param input LLM 输出的 deal（任意形状，内部逐字段防御）
 * @returns 合法化后的 { dealId, price }；非法（不在表内 / 门槛不满足）返回 null
 */
export function sanitizeDeal(
  input: unknown,
  relationship: number
): { dealId: NegotiationDealId; price: number } | null {
  if (!input || typeof input !== 'object') return null
  const { dealId, price } = input as { dealId?: unknown; price?: unknown }
  if (typeof dealId !== 'string') return null
  const deal = getDealById(dealId)
  if (!deal) return null

  // 关系门槛校验（alliance-deal ≥35 / truce-deal ≤-30 等）
  if (deal.requires.minRelationship !== undefined && relationship < deal.requires.minRelationship) {
    return null
  }
  if (deal.requires.maxRelationship !== undefined && relationship > deal.requires.maxRelationship) {
    return null
  }

  const sanitizedPrice =
    typeof price === 'number' && Number.isFinite(price)
      ? Math.round(Math.min(Math.max(price, deal.cost.silver[0]), deal.cost.silver[1]))
      : deal.cost.silver[1] // 非法价格兜底取上限（对玩家最贵的合法价，宁严勿松）

  return { dealId: deal.id, price: sanitizedPrice }
}

/**
 * 按价格线性缩放效果与副资源成本（design.md D2）
 * ratio = (price − silverMin) / (silverMax − silverMin)，clamp 0~1；
 * 每个值 = min + ratio × (max − min) 后取整。
 */
export function scaleDealValues(deal: NegotiationDealDef, price: number): {
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
