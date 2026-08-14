/**
 * @file generate-event 提示词
 *
 * 输入：玩家势力摘要、当前局势、最近 5 条事件标题、回合数
 * 输出：要求 LLM 生成 1 个事件（含 2-4 个选项，每个选项含预定义 effects）
 */

import type { StateSnapshot, Faction, HistoryEvent } from '@/types/game'

interface GenerateEventArgs {
  /** 玩家身份与势力 */
  character: { background: string; factionName: string; factionSummary: string }
  /** 当前局势快照 */
  stateSnapshot: StateSnapshot
  /** 玩家控制的势力列表（含自身） */
  factions: Faction[]
  /** 最近 5 条历史事件标题（首回合为空数组） */
  recentEvents: HistoryEvent[]
  /** 当前回合数（1 表示首回合，注入"游戏开场"上下文） */
  turn: number
  /**
   * 玩家属性短板信号（前端基于 attributes 计算，值 < 30 的维度）。
   * 仅作 LLM 输入提示，不强制概率；缺失时跳过短板导向段。
   */
  attributeShortfall?: { dimension: string; value: number }[]
}

/**
 * 构造 generate-event 提示词
 */
export function buildGenerateEventPrompt(args: GenerateEventArgs): string {
  const { character, stateSnapshot, factions, recentEvents, turn, attributeShortfall } = args
  const isFirstTurn = turn === 1
  const dateStr = `${stateSnapshot.date.year}年${stateSnapshot.date.month}月`

  const factionStr = factions
    .map((f) => `- ${f.name}（实力 ${f.power}，关系 ${f.relationship}，状态 ${f.status}）：${f.summary}`)
    .join('\n')

  const recentEventsStr =
    recentEvents.length > 0
      ? recentEvents
          .slice(-5)
          .map((e) => `- 第${e.turn}回合 [${e.eventType}] ${e.title}`)
          .join('\n')
      : '（无，首回合）'

  const openingContext = isFirstTurn
    ? `\n【游戏开场】1851 年 1 月，洪秀全于广西金田起义，建号太平天国，天下大乱。玩家于此时登场，需在乱世中图存。`
    : ''

  // 事件权重动态调整：玩家属性短板信号，引导 LLM 优先生成补短板类型事件（软偏好，非硬约束）
  const shortfallStr =
    attributeShortfall && attributeShortfall.length > 0
      ? `\n【短板导向】玩家当前存在属性短板（值 < 30）：${attributeShortfall
          .map((s) => `${s.dimension}=${s.value}`)
          .join('、')}。在生成事件类型时，优先选择能弥补以下短板的事件类型，相对基线约 +20% 倾向（示例：军事短板→军事/边患类事件，政治短板→吏治/朝堂类事件）。保持叙事合理，勿生硬堆砌。`
      : ''

  return `你是近代历史策略游戏的剧情生成器。请为玩家生成 1 个回合事件。

【玩家势力】${character.factionName}（${character.background}出身）：${character.factionSummary}
【当前时间】${dateStr}（第 ${turn} 回合）${openingContext}

【当前局势】
- 五维属性：军务 ${stateSnapshot.attributes.military} / 经济 ${stateSnapshot.attributes.economy} / 政治 ${stateSnapshot.attributes.politics} / 民心 ${stateSnapshot.attributes.people} / 外交 ${stateSnapshot.attributes.diplomacy}
- 资源：银两 ${stateSnapshot.resources.silver} / 兵力 ${stateSnapshot.resources.troops} / 粮草 ${stateSnapshot.resources.food} / 威望 ${stateSnapshot.resources.reputation}

【天下势力】
${factionStr}

【最近事件】
${recentEventsStr}
${shortfallStr}

【事件要求】
1. 事件类型从 5 类中选 1：民生 / 军事 / 外交 / 随机 / 历史剧情
2. 事件 title 8-15 字，description 50-120 字（古风半文言，符合近代背景）
3. 提供 2-4 个选项，每个选项：
   - id: 'a' / 'b' / 'c' / 'd'
   - label: 8-15 字选项描述
   - effects: 对 5 维属性（military/economy/politics/people/diplomacy）和 4 资源（silver/troops/food/reputation）的影响，数值范围属性 ±1~15，资源 ±50~500
4. 选项间应有取舍张力（无完美选项，每个都有代价）
5. 事件须与当前局势/势力关系/历史背景相关，不能凭空捏造

【输出格式】
{
  "title": "...",
  "description": "...",
  "eventType": "民生|军事|外交|随机|历史剧情",
  "options": [
    { "id": "a", "label": "...", "effects": { "military": 5, "silver": -100 } },
    { "id": "b", "label": "...", "effects": { "people": -5, "reputation": 3 } }
  ]
}`
}
