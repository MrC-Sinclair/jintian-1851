/**
 * @file resolve-decision 提示词
 *
 * 输入：玩家决策文本、当前事件、当前局势
 * 输出：要求 LLM 解析玩家决策为结构化 effects
 */

import type { StateSnapshot, GameEvent } from '@/types/game'

interface ResolveDecisionArgs {
  /** 当前事件 */
  event: GameEvent
  /** 玩家输入的决策文本（≤200 字） */
  playerDecision: string
  /** 当前局势快照 */
  stateSnapshot: StateSnapshot
  /** 当前回合数 */
  turn: number
}

/**
 * 构造 resolve-decision 提示词
 */
export function buildResolveDecisionPrompt(args: ResolveDecisionArgs): string {
  const { event, playerDecision, stateSnapshot, turn } = args
  const dateStr = `${stateSnapshot.date.year}年${stateSnapshot.date.month}月`

  const optionStr = event.options
    .map((o) => `- [${o.id}] ${o.label}：${JSON.stringify(o.effects)}`)
    .join('\n')

  return `你是近代策略游戏的决策解析器。玩家面对一个事件并做出决策，请将决策解析为结构化的属性与资源影响。

【事件标题】${event.title}
【事件描述】${event.description}
【事件类型】${event.eventType}

【预设选项】
${optionStr}

【玩家决策】${playerDecision}

【当前时间】${dateStr}（第 ${turn} 回合）
【当前局势】
- 军务 ${stateSnapshot.attributes.military} / 经济 ${stateSnapshot.attributes.economy} / 政治 ${stateSnapshot.attributes.politics} / 民心 ${stateSnapshot.attributes.people} / 外交 ${stateSnapshot.attributes.diplomacy}
- 银两 ${stateSnapshot.resources.silver} / 兵力 ${stateSnapshot.resources.troops} / 粮草 ${stateSnapshot.resources.food} / 威望 ${stateSnapshot.resources.reputation}

【解析规则】
1. 判断玩家决策与哪个预设选项最接近：
   - 若完全匹配某选项，返回该选项的 effects
   - 若是玩家自定义决策（不匹配任何选项），根据决策文本合理推断 effects
2. **疑问句判定**：若玩家决策以"怎么 / 如何 / 为什么 / 帮帮我 / 我想 X"开头，或仅表达诉求无具体行动指令：
   - 返回 { "effects": { "people": -1, "silver": -10 } }（极小"决策犹豫"代价，不消耗兵力）
   - 玩家应使用"军师"按钮提问，不要用"自由行动"提问
3. effects 字段可包含：military / economy / politics / people / diplomacy（属性 ±1~15）+ silver / troops / food / reputation（资源 ±50~500）
4. **字段名严格使用英文**：仅可用 silver / troops / food / reputation。禁止 army / soldiers / forces / 兵 等同义词（前端无法识别）
5. **资源联动约束**：
   - 征兵类决策（如"招募/征召/练兵"）：必须同时返回 troops+（至少 +50）与 silver-（或 food-）
   - 敛财类决策（如"征税/劫掠"）：必须同时返回 silver+ 与 people- 或 reputation-
   - 禁止"只扣不加"或"只加不扣"的不平衡 effects
6. effects 数值须合理，与决策逻辑一致（如"开仓放粮"应使 people+、silver-、food-）
7. 不要返回 effects 之外的字段

【输出格式】
{ "effects": { "military": 3, "people": 5, "silver": -100 } }`
}
