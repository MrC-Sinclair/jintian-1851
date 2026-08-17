/**
 * @file resolve-decision 提示词
 *
 * 输入：玩家决策文本、当前事件、当前局势
 * 输出：要求 LLM 解析玩家决策为结构化 effects
 */

import type { StateSnapshot, GameEvent, Faction } from '@/types/game'

interface ResolveDecisionArgs {
  /** 当前事件 */
  event: GameEvent
  /** 玩家输入的决策文本（≤200 字） */
  playerDecision: string
  /** 当前局势快照 */
  stateSnapshot: StateSnapshot
  /** 当前回合数 */
  turn: number
  /** 当前全部势力精简信息（可选，自由行动需此上下文才能关联势力） */
  factions?: Pick<Faction, 'id' | 'name' | 'relationship' | 'status' | 'power'>[]
}

/**
 * 构造 resolve-decision 提示词
 */
export function buildResolveDecisionPrompt(args: ResolveDecisionArgs): string {
  const { event, playerDecision, stateSnapshot, turn, factions } = args
  const dateStr = `${stateSnapshot.date.year}年${stateSnapshot.date.month}月`

  const optionStr = event.options
    .map((o) => `- [${o.id}] ${o.label}：${JSON.stringify(o.effects)}`)
    .join('\n')

  const factionStr =
    factions && factions.length > 0
      ? factions
          .map(
            (f) =>
              `- id="${f.id}" 名称=${f.name} 关系=${f.relationship} 状态=${f.status} 实力=${f.power}`
          )
          .join('\n')
      : '（无势力上下文）'

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

【势力列表（id / 名称 / 当前关系 / 状态 / 实力）】
${factionStr}

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
8. **势力影响（决策涉及势力时的必做项）**：
   - 当决策文本涉及与某势力的关系或实力变化——包括但不限于"资助/结善缘/示好/拉拢/结盟/亲近/疏远/敌对/打击/输送银两粮草给对方"——**必须**在 \`factionEffects\` 中返回对该势力的软性微调。这是必做项，不得省略。
   - 如何确定目标势力 id：
     - 若决策直接点名（如"资助湘军"），取【势力列表】中名称匹配的 id
     - 若决策用相对描述（如"关系最友好的势力""实力最强的势力""最忠诚的势力"），请在【势力列表】中比较对应字段（relationship / power），取数值最大者，将其 id 填入 \`factionId\`
   - \`factionId\`：必须是【势力列表】中存在的 id，禁止编造列表外 id（编造的会被丢弃）
   - \`relationshipDelta\`：关系变化，范围 -20~20（"资助/示好/结善缘"取正值，"敌对/疏远"取负值）
   - \`powerDelta\`：实力变化，范围 -30~30（"资助物资/输送粮草"取正值，"打击/削弱"取负值）
   - **禁止改变势力 \`status\`**（结盟/宣战/摧毁仍是确定性外交按钮的职责，本通道仅做软性微调）
   - 仅当决策完全不涉及任何势力时，才返回空数组或不返回 \`factionEffects\`
   - 资源代价（如"资助"→ silver 减少、"输送粮草"→ food 减少）仍须体现在 \`effects\` 中

【输出格式】
{ "effects": { "military": 3, "people": 5, "silver": -100 }, "factionEffects": [{ "factionId": "xiang-jun", "relationshipDelta": 15 }] }`
}