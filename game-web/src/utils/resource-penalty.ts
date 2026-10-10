/**
 * @file 资源枯竭惩罚（game-design.md:50「断粮触发饥荒」）
 *
 * 兵员与粮草在所有事件、剧情链、选项中**只减不增**（TURN_YIELD 只产银两），
 * 此前归零后毫无后果——通关模拟实测资源可跌到 -550 而游戏照常推进，
 * 等于两条资源线只是不断缩水的装饰数字。本模块把「断粮 / 兵员枯竭」变成真实代价。
 *
 * 纯函数、无副作用，供 useTurn.endTurn 在回合产出之后调用。
 */

import type { Attributes, Resources } from '@/types/game'

/** 断粮饥荒：粮草见底，民心与军事同时受损 */
const FAMINE_PENALTY: Partial<Attributes> = { people: -3, military: -2 }

/** 兵员枯竭：无兵可用，军事受损 */
const DESERTION_PENALTY: Partial<Attributes> = { military: -3 }

export interface ResourcePenalty {
  /** 需叠加到本回合结算的属性损失（空对象表示无惩罚） */
  effects: Partial<Attributes>
  /** 供历史时间线展示的中文说明，一条资源线一句 */
  reasons: string[]
}

/**
 * 按当前资源存量计算本回合的枯竭惩罚
 *
 * 只判 ≤0：资源为负本身已由 clamp 兜住，这里给的是「持续亏空」的代价，
 * 不是又一次扣数——所以粮草一旦回正，惩罚立刻停止。
 */
export function calcResourcePenalty(resources: Resources): ResourcePenalty {
  const effects: Partial<Attributes> = {}
  const reasons: string[] = []

  if (resources.food <= 0) {
    effects.people = (effects.people ?? 0) + FAMINE_PENALTY.people!
    effects.military = (effects.military ?? 0) + FAMINE_PENALTY.military!
    reasons.push('粮草断绝，军中饥荒')
  }

  if (resources.troops <= 0) {
    effects.military = (effects.military ?? 0) + DESERTION_PENALTY.military!
    reasons.push('兵员耗尽，队伍溃散')
  }

  return { effects, reasons }
}
