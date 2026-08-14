/**
 * @file 势力摘要压缩
 *
 * 传给 LLM 的 NPC 势力信息必须压缩为 4 字段以控制 token 成本（spec ai-npc-faction 要求）。
 * 不传 summary 字段（5 个势力约 250 tokens 输入）。
 */

/** 压缩后的势力摘要（仅 LLM 上下文必需字段） */
export interface FactionSummary {
  id: string
  name: string
  power: number
  relationship: number
  status: string
}

/** 完整势力结构（与前端 types/game.ts Faction 对齐） */
export interface Faction {
  id: string
  name: string
  summary?: string
  power: number
  relationship: number
  status: string
  lastAction?: string
}

/**
 * 压缩势力列表为 LLM 上下文所需的 4 字段
 * @param factions 完整势力列表
 * @returns 仅含 id/name/power/relationship/status 的摘要列表
 */
export function compressFactions(factions: Faction[]): FactionSummary[] {
  return factions.map((f) => ({
    id: f.id,
    name: f.name,
    power: f.power,
    relationship: f.relationship,
    status: f.status
  }))
}
