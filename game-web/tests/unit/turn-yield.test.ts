/**
 * @file utils/turn-yield.ts 单元测试
 *
 * 提案：2026-08-07-resource-per-turn-yield（T1）
 * 覆盖 calcTurnYield 的固定产出与副本隔离。
 */

import { describe, expect, it } from 'vitest'
import { calcTurnYield } from '../../src/utils/turn-yield'
import { TURN_YIELD } from '../../src/utils/constants'

describe('calcTurnYield', () => {
  it('返回固定产出值（初版 silver +50）', () => {
    expect(calcTurnYield()).toEqual({ silver: 50 })
  })

  it('返回副本，外部修改不影响常量 TURN_YIELD', () => {
    const result = calcTurnYield()
    result.silver = 999
    expect(TURN_YIELD.silver).toBe(50)
    // 再次调用仍返回初始值
    expect(calcTurnYield()).toEqual({ silver: 50 })
  })
})
