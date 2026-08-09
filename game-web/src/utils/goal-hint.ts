/**
 * @file 焦点提示生成（综合实力/危机/建议）
 *
 * 为 FocusPanel 与 GoalPanel 提供纯函数计算：
 * - calcOverallPower：复用 end-conditions.ts（避免重复实现）
 * - getCrisis：遍历 5 维属性，取 <30 中最低者（用于危机预警 toast + FocusPanel 危机行）
 * - generateFocusHint：综合实力 + 危机 + 规则建议（AI 简报返回时由 FocusPanel 覆盖 suggestion）
 *
 * 来源：openspec/changes/improve-ux-playability/tasks.md T1.6 + design.md D5
 */

import type { Attributes } from '@/types/game'
import { calcOverallPower } from '@/utils/end-conditions'
import { CRISIS_THRESHOLD, VICTORY_THRESHOLD } from '@/utils/constants'

// 复用 end-conditions 的 calcOverallPower，便于 StatusPanel 等组件直接从 goal-hint 导入
export { calcOverallPower }
// 阈值常量收口到 utils/constants.ts（C2 跨提案约定），此处仅 re-export 供既有调用方兼容
export { CRISIS_THRESHOLD, VICTORY_THRESHOLD }

/** 5 维属性键 → 中文名映射（用于危机提示文案） */
const ATTR_NAMES: Record<keyof Attributes, string> = {
  military: '军事',
  economy: '经济',
  politics: '政治',
  people: '民心',
  diplomacy: '外交'
}

/** 危机信息 */
export interface Crisis {
  /** 属性键（如 'military'） */
  attr: keyof Attributes
  /** 属性中文名（如 '军事'） */
  name: string
  /** 当前值 */
  value: number
}

/** 焦点提示（FocusPanel 渲染数据） */
export interface FocusHint {
  /** 综合实力（0-100） */
  overallPower: number
  /** 最紧急危机（取 <30 中最低者，无则 null） */
  crisis: Crisis | null
  /** 规则生成的建议（AI 简报返回时由 FocusPanel 覆盖） */
  suggestion: string
  /** 是否已达胜利阈值 */
  isVictory: boolean
}

/**
 * 获取最紧急的危机属性
 *
 * 遍历 5 维属性，返回 <30 中最低者；多个 <30 时取最低；无 <30 返回 null。
 *
 * @param attributes 5 维属性
 * @returns 危机信息或 null
 */
export function getCrisis(attributes: Attributes): Crisis | null {
  let crisis: Crisis | null = null

  for (const key of Object.keys(ATTR_NAMES) as Array<keyof Attributes>) {
    const value = attributes[key]
    if (value < CRISIS_THRESHOLD) {
      if (crisis === null || value < crisis.value) {
        crisis = {
          attr: key,
          name: ATTR_NAMES[key],
          value
        }
      }
    }
  }

  return crisis
}

/**
 * 生成焦点提示（综合实力 + 危机 + 规则建议）
 *
 * 建议规则：
 * - 综合实力 ≥ 90：提示即将胜利
 * - 有危机：提示优先应对危机
 * - 无危机：提示稳步发展
 *
 * 注意：AI 简报返回的 suggestion 由 FocusPanel 覆盖此处的规则建议。
 *
 * @param attributes 5 维属性
 * @returns FocusHint
 */
export function generateFocusHint(attributes: Attributes): FocusHint {
  const overallPower = calcOverallPower(attributes)
  const crisis = getCrisis(attributes)
  const isVictory = overallPower >= VICTORY_THRESHOLD

  let suggestion: string
  if (isVictory) {
    suggestion = '综合实力已达 90，再坚持数回合即可成就霸业'
  } else if (crisis) {
    suggestion = `优先应对${crisis.name}危机`
  } else {
    suggestion = '稳步发展各项实力'
  }

  return {
    overallPower,
    crisis,
    suggestion,
    isVictory
  }
}
