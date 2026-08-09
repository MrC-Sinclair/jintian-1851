/**
 * @file 回合资源产出（资源产出机制提案）
 *
 * 每回合自动产出少量资源，避免长期消耗后无解（game-design.md:572）。
 * 产出在 endTurn 结算时注入，并以系统历史事件形式记录（可追溯）。
 */

import type { Resources } from '@/types/game'
import { TURN_YIELD } from '@/utils/constants'

/**
 * 返回本回合应自动产出的资源（副本，避免外部修改常量）
 */
export function calcTurnYield(): Partial<Resources> {
  return { ...TURN_YIELD }
}
