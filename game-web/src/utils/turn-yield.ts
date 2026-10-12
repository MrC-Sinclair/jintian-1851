/**
 * @file 回合资源流转（产出 + 养饷）
 *
 * 每回合自动产出少量资源，避免长期消耗后无解（game-design.md:572）。
 * 产出在 endTurn 结算时注入，并以系统历史事件形式记录（可追溯）。
 *
 * 银两不是「+50 净赚」：还要按在编兵员发饷（`TROOP_UPKEEP_SILVER_PER_100`），
 * 所以本函数返回的是**净额**——兵越多，饷越重，财政越紧。
 */

import type { Resources } from '@/types/game'
import { TROOP_UPKEEP_SILVER_PER_100, TURN_YIELD } from '@/utils/constants'

/**
 * 按在编兵员算本回合要发的饷（银两支出，正数表示消耗量）
 * @param troops 当前兵员数（可为 0/负数，按 0 处理）
 */
export function calcTroopUpkeep(troops: number): number {
  if (!(troops > 0)) return 0
  return Math.ceil(troops / 100) * TROOP_UPKEEP_SILVER_PER_100
}

/**
 * 返回本回合的资源净流转（副本，避免外部修改常量）
 * @param troops 当前在编兵员数，用于计算养饷
 */
export function calcTurnYield(troops: number): Partial<Resources> {
  const upkeep = calcTroopUpkeep(troops)
  return {
    ...TURN_YIELD,
    silver: (TURN_YIELD.silver ?? 0) - upkeep
  }
}
