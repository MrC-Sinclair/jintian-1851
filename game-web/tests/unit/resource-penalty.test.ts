/**
 * @file 资源枯竭惩罚单测（断粮→饥荒、兵员枯竭→溃散）
 *
 * 背景：兵员/粮草在所有事件与选项中只减不增，此前归零毫无后果
 * （通关模拟实测资源跌到 -550 游戏照常推进），本模块补上代价。
 */
import { describe, expect, it } from 'vitest'
import { calcResourcePenalty } from '@/utils/resource-penalty'
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

  it('银两名不副实不影响判定（只有粮草与兵员触发惩罚）', () => {
    const r = calcResourcePenalty(makeResources({ silver: -9999 }))
    expect(r.effects).toEqual({})
  })
})
