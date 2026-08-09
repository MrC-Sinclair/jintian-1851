/**
 * @file 属性短板计算（事件权重动态调整提案）
 *
 * 计算低于 CRISIS_THRESHOLD 的属性维度，供前端在 generate-event 请求中
 * 携带短板信号，引导后端 LLM 生成补短板事件。
 */

import type { Attributes } from '@/types/game'
import { CRISIS_THRESHOLD } from '@/utils/constants'

/** 单个短板维度（keyof Attributes + 当前值） */
export interface AttributeShortfall {
  dimension: keyof Attributes
  value: number
}

/**
 * 计算属性短板（值 < threshold 的维度）
 *
 * @param attrs 5 维属性
 * @param threshold 短板阈值（默认复用 CRISIS_THRESHOLD=30，与危机预警同源，避免同义常量散落）
 * @returns 短板维度数组（空数组表示无短板）
 */
export function calcAttributeShortfall(
  attrs: Attributes,
  threshold: number = CRISIS_THRESHOLD
): AttributeShortfall[] {
  const result: AttributeShortfall[] = []
  for (const key of Object.keys(attrs) as Array<keyof Attributes>) {
    const value = attrs[key]
    if (typeof value === 'number' && value < threshold) {
      result.push({ dimension: key, value })
    }
  }
  return result
}
