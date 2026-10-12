/**
 * @file 资源枯竭惩罚（game-design.md:50「断粮触发饥荒」+ 破产后果）
 *
 * 三条资源线各自对应一种「持续亏空」的代价，但**判定时点分两组**：
 *   - 粮草 ≤ 0 → 饥荒（民心 + 军事受损）      ┐ 回合产出**之后**判：本回合补上了就不算断
 *   - 兵员 ≤ 0 → 溃散（军事受损）            ┘
 *   - 银两 ≤ 0 → 破产（经济 + 民心受损）        回合产出**之前**判：月初空库=本月已加赋
 *
 * 破产这条是**实测逼出来的**：此前银两归零毫无后果，200 局模拟里银两有 5.1% 的回合停在 0，
 * 而 `economy_collapse` 结局从未被触发过——设计承诺的 7 种结局里有 2 种是死代码。
 * 轻档（经济 −3 / 民心 −2）配合养饷 K=4 实测把胜率从 95.5% 压到 86% 一档，
 * 并让 economy_collapse 真的出现。
 *
 * 纯函数、无副作用，供 useTurn.endTurn 调用。
 */

import type { Attributes, Resources } from '@/types/game'

/** 断粮饥荒：粮草见底，民心与军事同时受损 */
const FAMINE_PENALTY: Partial<Attributes> = { people: -3, military: -2 }

/** 兵员枯竭：无兵可用，军事受损 */
const DESERTION_PENALTY: Partial<Attributes> = { military: -3 }

/** 财政破产：无饷可发，经济运转与民心同时受损 */
const BANKRUPTCY_PENALTY: Partial<Attributes> = { economy: -3, people: -2 }

export interface ResourcePenalty {
  /** 需叠加到本回合结算的属性损失（空对象表示无惩罚） */
  effects: Partial<Attributes>
  /** 供历史时间线展示的中文说明，一条资源线一句 */
  reasons: string[]
}

/**
 * 按当前资源存量计算本回合的「断粮 / 兵溃」惩罚
 *
 * 只判 ≤0：资源为负本身已由 clamp 兜住，这里给的是「持续亏空」的代价，
 * 不是又一次扣数——所以粮草一旦回正，惩罚立刻停止。
 *
 * ⚠️ 调用时点：**回合产出之后**（读最新存量）。粮饷/兵员的产出语义是「本回合补上了」，
 *    补上就不算断，所以必须在产出之后判。
 *    银两的破产惩罚**不在这里**，见 `calcBankruptcyPenalty` —— 它的时点刻意相反。
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

/**
 * 财政破产惩罚：必须在**回合产出之前**判定（与上面的时点刻意相反）
 *
 * 为什么不能放在产出之后：赋税是「月底入库」的净正数（+50 − 养饷），
 * 只要净产出为正，银两在产出之后永远 >0 → 惩罚结构上不可能触发。
 * 实测（真实代码路径，200 局）：放在产出之后判定时，养饷 K=4 胜率仍是 95.5%（惩罚形同不存在），
 * 而 K 要能咬人就只能调到 6，可那时净产出转负、银两常年归零，胜率一步跳到 59.0%——
 * 是个阶跃而不是可调梯度。挪到产出之前判定后，K=4 落在 86% 附近，且随 K 平滑变化。
 *
 * 语义依据：月初府库已空，意味着这个月只能靠加赋、赊欠度日，民心与经济的损伤已经发生；
 * 月底补上来的赋税不能倒回去抹掉这一年的横征暴敛。
 */
export function calcBankruptcyPenalty(resources: Resources): ResourcePenalty {
  if (resources.silver > 0) return { effects: {}, reasons: [] }
  return {
    effects: {
      economy: BANKRUPTCY_PENALTY.economy!,
      people: BANKRUPTCY_PENALTY.people!
    },
    reasons: ['府库耗尽，加赋失民心']
  }
}
