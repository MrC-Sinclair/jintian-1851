/**
 * @file utils/attribute-shortfall.ts 单元测试
 *
 * 提案：2026-08-07-event-weight-dynamic-adjust（T1）
 * 覆盖 calcAttributeShortfall 的短板识别逻辑。
 */

import { describe, expect, it } from 'vitest'
import { calcAttributeShortfall } from '../../src/utils/attribute-shortfall'
import { CRISIS_THRESHOLD } from '../../src/utils/constants'
import type { Attributes } from '../../src/types/game'

describe('calcAttributeShortfall', () => {
  it('无属性低于阈值时返回空数组', () => {
    const attrs: Attributes = {
      military: 50,
      economy: 50,
      politics: 50,
      people: 50,
      diplomacy: 50
    }
    expect(calcAttributeShortfall(attrs)).toEqual([])
  })

  it('恰好等于阈值（30）不算短板', () => {
    const attrs: Attributes = {
      military: CRISIS_THRESHOLD, // 30
      economy: 50,
      politics: 50,
      people: 50,
      diplomacy: 50
    }
    expect(calcAttributeShortfall(attrs)).toEqual([])
  })

  it('低于阈值的维度被识别为短板（含 value）', () => {
    const attrs: Attributes = {
      military: 15,
      economy: 50,
      politics: 50,
      people: 20,
      diplomacy: 50
    }
    const result = calcAttributeShortfall(attrs)
    expect(result).toHaveLength(2)
    expect(result).toContainEqual({ dimension: 'military', value: 15 })
    expect(result).toContainEqual({ dimension: 'people', value: 20 })
  })

  it('支持自定义阈值', () => {
    const attrs: Attributes = {
      military: 25,
      economy: 50,
      politics: 50,
      people: 50,
      diplomacy: 50
    }
    // 默认阈值 30：military=25 < 30 命中
    expect(calcAttributeShortfall(attrs)).toEqual([{ dimension: 'military', value: 25 }])
    expect(calcAttributeShortfall(attrs, 30)).toEqual([{ dimension: 'military', value: 25 }])
    // 阈值 26：military=25 < 26 仍命中
    expect(calcAttributeShortfall(attrs, 26)).toEqual([{ dimension: 'military', value: 25 }])
    // 阈值 24：military=25 >= 24 不命中
    expect(calcAttributeShortfall(attrs, 24)).toEqual([])
  })
})
