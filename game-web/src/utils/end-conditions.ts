/**
 * @file utils/end-conditions.ts — 结局判定
 *
 * 设计依据：design.md D5 + D10
 *   - 任一属性 ≤ 0 触发对应「势力崩溃」结局
 *   - 综合实力 ≥ 90 触发「胜利」结局
 *   - date.year > 1912 触发「时光尽头」结局
 *   - 否则继续游戏
 *
 * 综合实力定义：5 维属性（military/economy/politics/people/diplomacy）的加权平均
 * （game-design.md:573 治世之要：politics/people 权重更高，权重见 utils/constants.ts 的 POWER_WEIGHTS）
 *
 * 判定优先级：属性崩溃 > 胜利 > 时光尽头 > continue
 * 理由：崩溃是不可恢复的失败，应优先于胜利；时光尽头是时间硬上限，自然最后判定
 */

import type { Attributes, EndedReason, GameSave, StateSnapshot } from '@/types/game'
import { POWER_WEIGHTS, VICTORY_THRESHOLD } from '@/utils/constants'

/** 结局类型（含 'continue'） */
export type EndReason = EndedReason | 'continue'

/** 时光尽头阈值：year > 1912 */
const TIME_UP_YEAR = 1912

/**
 * 计算 5 维属性的综合实力（按 POWER_WEIGHTS 加权平均，clamp 0-100）
 *
 * Σ(attr × w) / Σ(w)，权重和归一化，避免权重总和变化影响刻度。
 * 等权退化：若所有权重为 1，结果等价于原等权平均（回归保护）。
 */
export function calcOverallPower(attrs: Attributes): number {
  const keys = Object.keys(POWER_WEIGHTS) as Array<keyof Attributes>
  const totalW = keys.reduce((s, k) => s + POWER_WEIGHTS[k], 0)
  const weighted = keys.reduce((s, k) => s + (attrs[k] ?? 0) * POWER_WEIGHTS[k], 0)
  // 取整为 0-100 整数，与 5 维属性（整数）及 90 胜利阈值对齐，避免小数显示（如 43.6785）
  return Math.round(Math.max(0, Math.min(100, weighted / totalW)))
}

/**
 * 判定存档当前状态是否触发结局
 *
 * @param state 当前游戏状态快照（或完整存档）
 * @returns 结局类型（'continue' 表示继续游戏）
 */
export function checkEndConditions(
  state: StateSnapshot | GameSave
): EndReason {
  const snapshot: StateSnapshot = 'state' in state ? state.state : state
  const { attributes, date } = snapshot

  // 1. 属性崩溃（任一 ≤ 0）
  if (attributes.military <= 0) return 'military_collapse'
  if (attributes.economy <= 0) return 'economy_collapse'
  if (attributes.politics <= 0) return 'politics_collapse'
  if (attributes.people <= 0) return 'people_collapse'
  if (attributes.diplomacy <= 0) return 'diplomacy_collapse'

  // 2. 综合实力 ≥ 90 胜利
  if (calcOverallPower(attributes) >= VICTORY_THRESHOLD) return 'victory'

  // 3. 时光尽头（年份超过 1912）
  if (date.year > TIME_UP_YEAR) return 'time_up'

  return 'continue'
}

/**
 * 结局类型中文描述（用于 UI 展示）
 */
const END_REASON_LABELS: Record<EndedReason, string> = {
  military_collapse: '军备崩溃',
  economy_collapse: '经济崩塌',
  politics_collapse: '政治瓦解',
  people_collapse: '民心尽失',
  diplomacy_collapse: '外交断绝',
  victory: '中兴大业',
  time_up: '时光尽头'
}

/**
 * 结局类型详细文案（用于结局页面叙述）
 */
const END_REASON_DESCRIPTIONS: Record<EndedReason, string> = {
  military_collapse: '军力耗尽，无以御敌，势力遂亡于刀兵之间。',
  economy_collapse: '财政枯竭，府库空虚，势力遂亡于匮乏之中。',
  politics_collapse: '政令不通，纲纪废弛，势力遂亡于内乱之中。',
  people_collapse: '民怨沸腾，众叛亲离，势力遂亡于民心尽失之中。',
  diplomacy_collapse: '四面楚歌，孤立无援，势力遂亡于外交断绝。',
  victory: '运筹帷幄，决胜千里，终成中兴大业，名垂青史。',
  time_up: '岁月如梭，时局已尽，大清命数已终，后世自有评说。'
}

export function getEndReasonLabel(reason: EndedReason): string {
  return END_REASON_LABELS[reason]
}

export function getEndReasonDescription(reason: EndedReason): string {
  return END_REASON_DESCRIPTIONS[reason]
}

/**
 * 判断结局是否为「失败」（用于 UI 配色等）
 */
export function isFailureEnd(reason: EndedReason): boolean {
  return reason !== 'victory' && reason !== 'time_up'
}
