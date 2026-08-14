/**
 * @file npc-actions 提示词
 *
 * 输入：玩家势力摘要、所有活跃 NPC 势力摘要（仅 4 字段，控 token）、当前局势
 * 输出：要求 LLM 为每个 NPC 势力生成 1 个行动
 */

import type { StateSnapshot } from '@/types/game'
import type { FactionSummary } from '../faction-summary'

interface NpcActionsArgs {
  /** 玩家身份与势力 */
  character: { background: string; factionName: string }
  /** 当前局势快照 */
  stateSnapshot: StateSnapshot
  /** 活跃 NPC 势力摘要（已压缩为 4 字段，剔除 summary） */
  npcFactions: FactionSummary[]
  /** 当前回合数 */
  turn: number
}

/**
 * 构造 npc-actions 提示词
 */
export function buildNpcActionsPrompt(args: NpcActionsArgs): string {
  const { character, stateSnapshot, npcFactions, turn } = args
  const dateStr = `${stateSnapshot.date.year}年${stateSnapshot.date.month}月`

  const factionStr = npcFactions
    .map(
      (f) =>
        `- ${f.name}（id=${f.id}, 实力 ${f.power}, 与玩家关系 ${f.relationship}, 状态 ${f.status}）`
    )
    .join('\n')

  return `你是近代策略游戏的 NPC 决策引擎。请为每个 NPC 势力生成 1 个本回合行动。

【玩家势力】${character.factionName}（${character.background}出身）
【当前时间】${dateStr}（第 ${turn} 回合）

【玩家当前局势】
- 军务 ${stateSnapshot.attributes.military} / 经济 ${stateSnapshot.attributes.economy} / 政治 ${stateSnapshot.attributes.politics} / 民心 ${stateSnapshot.attributes.people} / 外交 ${stateSnapshot.attributes.diplomacy}

【活跃 NPC 势力】
${factionStr}

【行动规则】
1. 为每个 NPC 势力生成 1 个行动，行动类型从 6 类中选 1：
   - 扩张：攻城略地，增强自身实力
   - 结盟：与其他势力结盟（含玩家）
   - 备战：囤积兵力粮草，准备大战
   - 休养：恢复实力，巩固内部
   - 挑衅：挑衅敌对势力，制造冲突
   - 外交：进行外交活动（通商、和亲、谈判等）
2. 行动须基于该势力的实力、与玩家的关系、当前局势合理推断
3. 每个行动含：
   - factionId / factionName：势力标识
   - action：行动类型（上述 6 类）
   - target：行动目标（可选，如扩张目标地、结盟对象）
   - description：50-150 字古风描述
   - effects：对玩家势力的影响（可选，含 military/economy/politics/people/diplomacy/silver/troops/food/reputation）
4. 与玩家关系为负的势力更倾向"挑衅"或"扩张"，关系为正的更倾向"结盟"或"外交"

【输出格式】
{
  "actions": [
    {
      "factionId": "xiang-jun",
      "factionName": "湘军",
      "action": "扩张",
      "target": "安徽",
      "description": "曾国藩遣鲍超率霆军北上安徽，意图截断捻军粮道。",
      "effects": { "military": -3, "diplomacy": 2 }
    }
  ]
}`
}
