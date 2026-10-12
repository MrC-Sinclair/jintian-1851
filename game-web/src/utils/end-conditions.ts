/**
 * @file utils/end-conditions.ts — 结局判定
 *
 * 设计依据：design.md D5 + D10 + turn-equals-year-clock 提案
 *   - 任一属性 ≤ 0 触发对应「势力崩溃」结局（立即结束）
 *   - **1 回合 = 1 年**：结局只在 `date.year > 1912` 时结算，中途不结束游戏
 *   - 结算时：曾锁定「中兴」（`save.zenithYear`）或当时实力 ≥ 85 → `victory`；否则 `time_up`
 *   - 「中兴已定」由 `useTurn` 在实力首次达阈值时写入，只记年份不结束
 *
 * 综合实力定义：5 维属性（military/economy/politics/people/diplomacy）的加权平均
 * （game-design.md 治世之要：politics/people 权重更高，权重见 utils/constants.ts 的 POWER_WEIGHTS）
 *
 * 判定优先级：属性崩溃 > （1912 结算）胜利 / 时光尽头 > continue
 * 理由：崩溃是不可恢复的失败，应优先于任何结算；胜利与时光尽头互斥（同一次结算的两种结果）
 *
 * 本文件另有两组**纯展示派生**（史评 getHistoryRating / 链完成度 getChainCompletion）：
 * 它们兑现 game-design.md 的「名望影响结局评分」「剧情链完成度参与结局」，
 * 但刻意**不参与** checkEndConditions —— 理由见各自函数上的注释。
 */

import type { Attributes, EndedReason, GameSave, StateSnapshot } from '@/types/game'
import { CHAIN_META } from '@/data/story-chains'
import { HISTORY_RATINGS, POWER_WEIGHTS, VICTORY_THRESHOLD, type HistoryRating } from '@/utils/constants'

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
  // 取整为 0-100 整数，与 5 维属性（整数）及胜利阈值对齐，避免小数显示（如 43.6785）
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
  const isSave = 'state' in state
  const snapshot: StateSnapshot = isSave ? state.state : state
  const { attributes, date } = snapshot

  // 1. 属性崩溃（任一 ≤ 0）—— 优先级不变：崩溃是不可恢复的失败，
  //    不因"还没走到 1912 年"而被救回
  if (attributes.military <= 0) return 'military_collapse'
  if (attributes.economy <= 0) return 'economy_collapse'
  if (attributes.politics <= 0) return 'politics_collapse'
  if (attributes.people <= 0) return 'people_collapse'
  if (attributes.diplomacy <= 0) return 'diplomacy_collapse'

  // 2. 走到 1912 年之后才结算结局。
  //    胜利**不再**由"中途 power 达线"即时触发 —— 实测月钟下那样会让 200 局
  //    全部恰好在第 22 回合必胜、终局 1865 年，「1851—1912」根本走不完。
  //    现在：曾锁定「中兴」（save.zenithYear 有值）或结算时实力达标 → victory；否则 time_up。
  if (date.year > TIME_UP_YEAR) {
    const zenithLocked = isSave && (state as GameSave).zenithYear !== undefined
    const powerOk = calcOverallPower(attributes) >= VICTORY_THRESHOLD
    return zenithLocked || powerOk ? 'victory' : 'time_up'
  }

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
  victory: '历六十年而势不坠，运筹帷幄，终成中兴大业，名垂青史。',
  time_up: '六十年光阴走尽，实力未足以言中兴，大清命数已终，后世自有评说。'
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

/**
 * 史评档位（名望 → 称号与评语）
 *
 * 兑现 game-design.md:57「名望影响结局评分」的方式是**展示档位，不参与胜利判定**。
 * 实测原因：200 局终局名望中位 162（未封顶时），远高于五维属性的 0-100 刻度，
 * 把它计入 `calcOverallPower` 会把胜率从 95.5% 抬到 100%、time_up 与崩溃结局几乎消失——
 * 那是打穿平衡，不是接通一个字段。名望要影响胜负得先解决它的量级问题（见 constants 的 TURN_YIELD 注释）。
 *
 * 划线基于「封顶 100 + 每回合 -3 衰减」后的分布：p90≈88 / 中位≈56 / p10≈20。
 */
export function getHistoryRating(reputation: number): HistoryRating {
  return HISTORY_RATINGS.find((r) => reputation >= r.min) ?? HISTORY_RATINGS[HISTORY_RATINGS.length - 1]
}

// ====================== 剧情链完成度（结局展示，不参与胜负判定） ======================

/**
 * 链完成度档位（按「终局年份之前可达的链数」归一）
 *
 * 分母**刻意不用全集 23**：剧本是按年代逐条解锁的，22 回合赢在 1865 的人
 * 本来就碰不到 1894 以后的链。用 23 当分母等于惩罚"通关太快"，
 * 而同样的完成度在走到 1911 的存档上会算出完全不同的等级 —— 那是口径错误不是难度。
 */
const CHAIN_TIERS: Array<{ minRatio: number; label: string; remark: string }> = [
  { minRatio: 0.8, label: '亲历全局', remark: '凡当世大事，皆身与其间。' },
  { minRatio: 0.5, label: '半壁经行', remark: '大势已动，而未尽处尚多。' },
  { minRatio: 0, label: '未竟之局', remark: '史册翻到一半便合上了，余下的留给旁人。' }
]

/** 可达链数低于此值时不分级：2/2 = 100% 这种"满级"毫无信息量，只会把早期存档吹成完人 */
const TIER_MIN_REACHABLE = 3

/** 剧情链完成度（全部为展示用派生值，MUST NOT 进入 checkEndConditions） */
export interface ChainCompletion {
  /** 已完成的链条数（save.completedChainIds 中能在镜像表里查到的部分） */
  completed: number
  /** 终局年份之前（含当年）可达的链条数 —— 分母 */
  reachable: number
  /** 终局时仍在进行中的链数（activeChainIds） */
  inProgress: number
  /** completed / reachable；reachable 为 0 时取 0 */
  ratio: number
  /** 已完成链的标题，按 startYear 升序（供结局页逐条列出） */
  completedTitles: string[]
  /** 终局年份 */
  endYear: number
}

/**
 * @param save 存档；传 null（尚未加载）时返回全零结果，便于模板直接取值不用判空
 */
export function getChainCompletion(save: GameSave | null): ChainCompletion {
  if (!save) {
    return { completed: 0, reachable: 0, inProgress: 0, ratio: 0, completedTitles: [], endYear: 0 }
  }
  const endYear = save.state.date.year
  const done = save.completedChainIds ?? []
  const active = save.activeChainIds ?? []
  const all = Object.values(CHAIN_META)
  const reachableChains = all.filter((c) => c.startYear <= endYear)
  const completedChains = reachableChains
    .filter((c) => done.includes(c.chainId))
    .sort((a, b) => a.startYear - b.startYear)
  return {
    completed: completedChains.length,
    reachable: reachableChains.length,
    inProgress: active.filter((id) => !done.includes(id)).length,
    ratio: reachableChains.length === 0 ? 0 : completedChains.length / reachableChains.length,
    completedTitles: completedChains.map((c) => c.title),
    endYear
  }
}

/**
 * 完成度档位；可达链数不足或一条也没完成时返回 null（结局页此时只展示原始数字，不给称号）
 */
export function getChainTier(
  completion: ChainCompletion
): { label: string; remark: string } | null {
  if (completion.reachable < TIER_MIN_REACHABLE) return null
  if (completion.completed === 0) return null
  const tier = CHAIN_TIERS.find((t) => completion.ratio >= t.minRatio)
  return tier ?? null
}
