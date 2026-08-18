/**
 * @file 谈判 Agent 提示词（design.md D1/D2/D3）
 *
 * 单势力谈判 Agent 的 system prompt。复用 npc-agent 的人格分支（relationship 三分支），
 * letter 阶段输出 { stance, reply, relationshipDelta, deal? }，settle 阶段输出最终裁定。
 *
 * 关键约束：
 * - deal 只能从 NEGOTIATION_DEALS 表内选（dealId + 区间内 price），LLM 不产出最终数值与 status
 * - settle 阶段只允许 accept / reject，不再提新条件
 * - 只输出一个 JSON 对象（由端点做鲁棒提取 + sanitize）
 */

import type { Faction } from '../../../types/game'
import { NEGOTIATION_DEALS, type NegotiationDealDef } from '../negotiation-deals'

export interface NegotiationPromptOpts {
  /** settle 阶段：letter 阶段 Agent 的回信（上下文） */
  previousReply?: string
  /** settle 阶段：Agent 上轮提出的条件（已 sanitize） */
  deal?: { deal: NegotiationDealDef; price: number }
  /** settle 阶段：玩家响应（接受原价 / 还价） */
  playerResponse?: 'accept' | 'counter'
  /** playerResponse='counter' 时的还价（silver） */
  counterPrice?: number
}

/** 该 deal 是否满足当前关系门槛 */
function isDealEligible(deal: NegotiationDealDef, relationship: number): boolean {
  if (deal.requires.minRelationship !== undefined && relationship < deal.requires.minRelationship) {
    return false
  }
  if (deal.requires.maxRelationship !== undefined && relationship > deal.requires.maxRelationship) {
    return false
  }
  return true
}

/** 将兑换表格式化为提示词用的紧凑清单（含门槛，防 LLM 选不符合条件的 deal） */
function formatDealsTable(relationship: number): string {
  return NEGOTIATION_DEALS.map((d) => {
    const req: string[] = []
    if (d.requires.minRelationship !== undefined) req.push(`关系≥${d.requires.minRelationship}`)
    if (d.requires.maxRelationship !== undefined) req.push(`关系≤${d.requires.maxRelationship}`)
    const repCost = d.cost.reputation ? `、名望 ${d.cost.reputation[0]}~${d.cost.reputation[1]}` : ''
    const repEff = d.effect.reputation
      ? `、名望 +${d.effect.reputation[0]}~+${d.effect.reputation[1]}`
      : ''
    const ineligible = isDealEligible(d, relationship)
      ? ''
      : `（当前关系 ${relationship} 不满足 ${req.join('且')}，禁止选用）`
    return `- ${d.id}「${d.label}」：玩家耗银两 ${d.cost.silver[0]}~${d.cost.silver[1]}${repCost}；效果：关系 +${d.effect.relationship[0]}~+${d.effect.relationship[1]}${repEff}${d.effect.status ? '；结为盟友' : ''}${ineligible}`
  }).join('\n')
}

/**
 * 构造谈判 Agent system prompt
 * @param faction 目标势力（含 summary/power/relationship）
 * @param character 玩家身份（background + factionName）
 * @param relationship 当前关系值（人格分支 + deal 门槛过滤）
 * @param phase letter（写信）/ settle（还价裁定）
 * @param letter 玩家信件原文（1-200 字）
 * @param opts settle 阶段上下文
 */
export function buildNegotiationPrompt(
  faction: Faction,
  character: { background: string; factionName: string },
  relationship: number,
  phase: 'letter' | 'settle',
  letter: string,
  opts: NegotiationPromptOpts = {}
): string {
  // 人格分支（与 npc-agent 一致：<-30 敌对 / >30 友好 / 中立）
  let persona: string
  if (relationship < -30) {
    persona = '你对玩家势力怀有敌意，轻易不松口，除非条件足够有利才肯谈。'
  } else if (relationship > 30) {
    persona = '你对玩家势力素来友好，愿意在合理条件下加深合作。'
  } else {
    persona = '你与玩家势力不亲不仇，一切以本势力实际利益为准。'
  }

  const header = [
    `你是 ${faction.name} 的决策者。${faction.summary}`,
    `本势力当前实力 ${faction.power}，与玩家势力（${character.factionName}，${character.background}出身）的关系值为 ${relationship}（负数=敌对，正数=友好，±30 为分界）。`,
    `性格倾向：${persona}`,
    '需要了解其他势力详情、全局格局、势力间关系或玩家状态时，可自主调用工具查询，不要凭空编造数据。'
  ]

  if (phase === 'letter') {
    return [
      ...header,
      '',
      `玩家来信如下（原样）：`,
      `「${letter}」`,
      '',
      '请以该势力决策者的身份回信并表态。规则：',
      '1. stance 三选一：accept（无需交易即可应允）/ reject（拒绝）/ counter（提出条件还价）。',
      '2. 仅当 stance=counter 时可提条件：从下方兑换表中选一个 dealId，并给出区间内的 price（整数，银两）。不得编造表外条件，不得改价格区间。',
      '3. relationshipDelta：这封信的语气与内容对你的态度影响，取 -10~10 的整数（拒绝时可为小负值，允诺时可为正值）。',
      '4. reply：80~160 字的古风回信，符合势力身份与你的态度。',
      '',
      '可用兑换表：',
      formatDealsTable(relationship),
      '',
      '完成后只输出一个 JSON 对象（不要 markdown 代码块、解释或多余文字）：',
      '{ "stance": "accept|reject|counter", "reply": "回信", "relationshipDelta": 整数, "deal": { "dealId": "表内id", "price": 整数 } }',
      'deal 仅 stance=counter 时输出，否则省略该字段。'
    ].join('\n')
  }

  // settle 阶段：最终裁定
  const dealInfo = opts.deal
    ? `${opts.deal.deal.id}「${opts.deal.deal.label}」（定价银两 ${opts.deal.price}）`
    : '（无）'
  const playerAction =
    opts.playerResponse === 'counter'
      ? `玩家还价：愿意出银两 ${opts.counterPrice}（低于原价）。请你最终裁定是否接受这一价格成交。`
      : '玩家接受了你提出的条件，愿意按原价成交。'

  return [
    ...header,
    '',
    '此前谈判上下文：',
    `玩家来信：「${letter}」`,
    `你的回信：「${opts.previousReply ?? ''}」`,
    `你提出的条件：${dealInfo}`,
    playerAction,
    '',
    '请做最终裁定。规则：',
    '1. stance 只允许 accept（成交）或 reject（拒绝），不得再提新条件、不得输出 deal。',
    '2. 裁定应基于你的性格倾向、关系值与还价幅度合理推断（还价过低可拒绝）。',
    '3. relationshipDelta：玩家此次回应对你的态度影响，取 -10~10 的整数。',
    '4. reply：80~160 字的古风回信。',
    '',
    '完成后只输出一个 JSON 对象（不要 markdown 代码块、解释或多余文字）：',
    '{ "stance": "accept|reject", "reply": "回信", "relationshipDelta": 整数 }'
  ].join('\n')
}
