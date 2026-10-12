/**
 * @file 资源枯竭惩罚单测（断粮→饥荒、兵员枯竭→溃散、财政破产）
 *
 * 背景：兵员/粮草/银两归零此前毫无后果（通关模拟实测资源跌到 -550 游戏照常推进），
 * 本模块补上代价。注意两组判定时点不同：断粮/兵溃在产出之后，破产在产出之前。
 */
import { describe, expect, it } from 'vitest'
import { calcBankruptcyPenalty, calcResourcePenalty } from '@/utils/resource-penalty'
import type { Resources } from '@/types/game'

function makeResources(overrides: Partial<Resources> = {}): Resources {
  return { silver: 1000, troops: 500, food: 200, reputation: 30, ...overrides }
}

describe('calcResourcePenalty', () => {
  it('资源充足时无任何惩罚', () => {
    const r = calcResourcePenalty(makeResources())
    expect(r.effects).toEqual({})
    expect(r.reasons).toEqual([])
  })

  it('边界：粮草剩 1 不罚，归零才罚', () => {
    expect(calcResourcePenalty(makeResources({ food: 1 })).effects).toEqual({})
    const r = calcResourcePenalty(makeResources({ food: 0 }))
    expect(r.effects).toEqual({ people: -3, military: -2 })
    expect(r.reasons).toEqual(['粮草断绝，军中饥荒'])
  })

  it('兵员枯竭只扣军事', () => {
    const r = calcResourcePenalty(makeResources({ troops: 0 }))
    expect(r.effects).toEqual({ military: -3 })
    expect(r.reasons).toEqual(['兵员耗尽，队伍溃散'])
  })

  it('双线同时枯竭：军事损失叠加，两条说明并列', () => {
    const r = calcResourcePenalty(makeResources({ food: -50, troops: -550 }))
    expect(r.effects).toEqual({ people: -3, military: -5 })
    expect(r.reasons).toHaveLength(2)
  })

  it('银两不归本函数管：破产惩罚刻意在产出之前判，见 calcBankruptcyPenalty', () => {
    const r = calcResourcePenalty(makeResources({ silver: -9999 }))
    expect(r.effects).toEqual({})
  })
})

describe('calcBankruptcyPenalty（财政破产，产出之前判）', () => {
  it('银两 > 0 时无惩罚', () => {
    expect(calcBankruptcyPenalty(makeResources({ silver: 1 }))).toEqual({ effects: {}, reasons: [] })
  })

  it('银两归零：经济 −3、民心 −2，并给一句中文说明', () => {
    const r = calcBankruptcyPenalty(makeResources({ silver: 0 }))
    expect(r.effects).toEqual({ economy: -3, people: -2 })
    expect(r.reasons).toEqual(['府库耗尽，加赋失民心'])
  })

  it('银两为负同样只扣一档（是持续代价，不是按缺口比例的二次惩罚）', () => {
    const r = calcBankruptcyPenalty(makeResources({ silver: -850 }))
    expect(r.effects).toEqual({ economy: -3, people: -2 })
  })

  it('与断粮/兵溃互不干扰：三条线各自独立判定', () => {
    const res = makeResources({ silver: 0, food: 0, troops: 0 })
    const famine = calcResourcePenalty(res)
    const bank = calcBankruptcyPenalty(res)
    // 断粮 people-3/military-2 + 兵溃 military-3
    expect(famine.effects).toEqual({ people: -3, military: -5 })
    expect(bank.effects).toEqual({ economy: -3, people: -2 })
    expect(famine.reasons).toHaveLength(2)
    expect(bank.reasons).toHaveLength(1)
  })
})
