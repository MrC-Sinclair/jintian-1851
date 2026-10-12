/**
 * @file npc-agent 提示词（多 Agent 并行）
 *
 * 每个活跃 NPC 势力作为独立 Agent 的 system prompt（design.md D4 / G3）。
 * 基于该势力的 summary + 实力 + 与玩家关系推导决策目标，使各 NPC 决策差异化。
 * 需要了解其他势力 / 玩家状态时自主调用工具（createNpcTools 注册 4 个核心工具）。
 *
 * AI 长期记忆（提案 任务6 / D8）：检索到该势力自身记忆时注入「你记得关于玩家势力的事」
 * 段落，正负分组呈现恩怨两面，只偏置意图与文案（不改数值结算）。
 *
 * 名望注入（存档之外的第二个「玩家形象」维度）：按 `reputation-bands.ts` 的档位注入一句
 * 态度倾向，与记忆段落同样**只偏置意图与文案**。此前 game-design.md:57 承诺名望
 * 「影响 NPC 态度」，但本文件里 reputation 出现 0 次——承诺没落地。
 *
 * 最后要求 LLM 只输出一个 JSON 对象（design.md D4：避免工具调用后的冗余文字），
 * 由 runNpcAgent 解析为 NpcAction 结构。
 */

import type { Faction } from '../../../types/game'
import type { ToolContext } from '../../utils/tool-context'
import { getReputationBand } from '../../utils/reputation-bands'

/** 注入 prompt 的势力记忆（已格式化为「第N回合：内容」字符串，按情感分组） */
export interface NpcMemories {
  positive: string[]
  negative: string[]
  neutral: string[]
}

/**
 * 构造记忆段落；三组全空或未传时返回空数组（不注入段落）。
 * D8：正负混合呈现，让 NPC 行为有跨回合因果（恩怨两面）。
 */
function buildMemoryLines(memories?: NpcMemories): string[] {
  if (!memories) return []
  const hasPos = memories.positive.length > 0
  const hasNeg = memories.negative.length > 0
  const hasNeu = memories.neutral.length > 0
  if (!hasPos && !hasNeg && !hasNeu) return []
  const lines = [
    '【你记得关于玩家势力的事】以下是你对玩家势力的历史记忆（恩怨两面），决策时请参考，使行为前后一致、有因果：'
  ]
  if (hasPos) {
    lines.push('· 善意 / 友好：', ...memories.positive.map((m) => `  - ${m}`))
  }
  if (hasNeg) {
    lines.push('· 敌意 / 怨恨：', ...memories.negative.map((m) => `  - ${m}`))
  }
  if (hasNeu) {
    lines.push('· 中性：', ...memories.neutral.map((m) => `  - ${m}`))
  }
  return lines
}

/**
 * 构造单个 NPC 势力的 Agent system prompt
 * @param faction 该 NPC 势力的完整信息（含 summary / power / relationship）
 * @param ctx 工具上下文（用于注入玩家势力信息，使决策更聚焦）
 * @param memories 该势力的历史记忆（可选；无记忆时不注入段落）
 */
export function buildNpcAgentPrompt(faction: Faction, ctx: ToolContext, memories?: NpcMemories): string {
  const relationship = faction.relationship
  let goal: string
  if (relationship < -30) {
    goal = '你的目标是削弱玩家势力，可挑衅/备战/扩张针对玩家'
  } else if (relationship > 30) {
    goal = '你的目标是与玩家势力维持盟约，可外交/休养/结盟'
  } else {
    goal = '你的目标是发展自身实力，可休养/扩张/备战'
  }

  const playerFaction = `${ctx.character.factionName}（${ctx.character.background}出身）`
  // 玩家名望 → 档位倾向（只偏置意图与文案，不改数值结算）。
  // 实测注入约 40-50 个中文字符 ≈ +50 tokens/Agent，占 npc-actions 单次输入(~1200)的 +4%，
  // 折算单局成本 +2%（口径见 docs/ai-cost.md）。
  // 用可选链是因为 resources 来自客户端 body，缺字段时应落到低档而不是炸掉整回合。
  const repBand = getReputationBand(ctx.stateSnapshot.resources?.reputation ?? 0)

  const lines = [
    `你是 ${faction.name} 的决策者。${faction.summary}`,
    `本势力当前实力 ${faction.power}，与玩家势力（${playerFaction}）的关系值为 ${relationship}（负数=敌对，正数=友好，±30 为分界）。`,
    `玩家如今的朝野名望：${repBand.label}。${repBand.npcStance}。`,
    `决策目标：${goal}`,
    '可选行动类型：扩张 / 结盟 / 备战 / 休养 / 挑衅 / 外交',
    '需要了解其他势力详情、全局格局、势力间关系或玩家状态时，可自主调用工具查询，不要凭空编造数据。',
    '行动须基于你的实力、与玩家的关系、当前局势合理推断。'
  ]

  // 记忆段落插在决策指令之后、JSON 输出要求之前（作为决策上下文而非输出格式的一部分）
  lines.push(...buildMemoryLines(memories))

  lines.push(
    '完成决策后，只输出一个 JSON 对象（不要包含 markdown 代码块、解释或多余文字），结构如下：',
    '{ "action": "行动类型", "target": "行动目标(可选)", "description": "50-150字古风描述", "effects": { "military": 数字, "economy": 数字, ...对玩家势力的影响(可选) } }'
  )

  return lines.join('\n')
}
