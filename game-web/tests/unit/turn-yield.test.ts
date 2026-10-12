/**
 * @file utils/turn-yield.ts 单元测试
 *
 * 提案：2026-08-07-resource-per-turn-yield（T1）
 * 覆盖 calcTurnYield 的净产出（产出 − 养饷）、副本隔离，与 calcTroopUpkeep 的分档。
 */

import { describe, expect, it } from 'vitest'
import { calcTroopUpkeep, calcTurnYield } from '../../src/utils/turn-yield'
import { TROOP_UPKEEP_SILVER_PER_100, TURN_YIELD } from '../../src/utils/constants'

describe('calcTroopUpkeep', () => {
  it('每 100 兵收 K 两，不足 100 按一档算（ceil）', () => {
    expect(calcTroopUpkeep(0)).toBe(0)
    expect(calcTroopUpkeep(1)).toBe(TROOP_UPKEEP_SILVER_PER_100)
    expect(calcTroopUpkeep(100)).toBe(TROOP_UPKEEP_SILVER_PER_100)
    expect(calcTroopUpkeep(101)).toBe(TROOP_UPKEEP_SILVER_PER_100 * 2)
    expect(calcTroopUpkeep(500)).toBe(TROOP_UPKEEP_SILVER_PER_100 * 5)
  })

  it('负数与 NaN 按 0 处理（不产生「负养饷 = 凭空进账」）', () => {
    expect(calcTroopUpkeep(-300)).toBe(0)
    expect(calcTroopUpkeep(NaN)).toBe(0)
  })
})

describe('calcTurnYield', () => {
  it('银两是「产出 − 养饷」的净额，兵员与名望照原样', () => {
    // 兵员 500 → 饷 20；产出 +50 → 净 +30
    expect(calcTurnYield(500)).toEqual({ silver: 30, troops: 15, reputation: -3 })
  })

  it('大军压垮财政：兵员超过 1250 后净产出转负', () => {
    expect(calcTurnYield(1200).silver).toBe(50 - 48)
    expect(calcTurnYield(1300).silver).toBe(50 - 52)
    expect(calcTurnYield(1300).silver).toBeLessThan(0)
  })

  it('无兵则无饷，退回全额产出', () => {
    expect(calcTurnYield(0)).toEqual({ silver: 50, troops: 15, reputation: -3 })
  })

  it('返回副本，外部修改不影响常量 TURN_YIELD', () => {
    const result = calcTurnYield(500)
    result.silver = 999
    expect(TURN_YIELD.silver).toBe(50)
    expect(calcTurnYield(500).silver).toBe(30)
  })
})
