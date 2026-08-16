/**
 * @file utils/goal-hint.ts 单元测试
 *
 * 覆盖 T1.6 验证要求：
 *   - 综合实力计算边界（0/50/89/90/100）
 *   - getCrisis：无 <30 / 单个 <30 / 多个 <30 取最低 / 恰好 30 不算危机
 *   - generateFocusHint：isVictory 分支 / crisis 分支 / 正常分支
 *   - 常量 CRISIS_THRESHOLD / VICTORY_THRESHOLD 正确
 */

import { describe, expect, it } from 'vitest'
import {
  CRISIS_THRESHOLD,
  VICTORY_THRESHOLD,
  generateFocusHint,
  getCrisis
} from '../../src/utils/goal-hint'
import type { Attributes } from '../../src/types/game'

function makeAttrs(overrides: Partial<Attributes> = {}): Attributes {
  return {
    military: 50,
    economy: 50,
    politics: 50,
    people: 50,
    diplomacy: 50,
    ...overrides
  }
}

describe('常量', () => {
  it('CRISIS_THRESHOLD = 30', () => {
    expect(CRISIS_THRESHOLD).toBe(30)
  })

  it('VICTORY_THRESHOLD = 90', () => {
    expect(VICTORY_THRESHOLD).toBe(90)
  })
})

describe('generateFocusHint - 综合实力计算边界', () => {
  it('全 0 时 overallPower = 0', () => {
    const hint = generateFocusHint(
      makeAttrs({ military: 0, economy: 0, politics: 0, people: 0, diplomacy: 0 })
    )
    expect(hint.overallPower).toBe(0)
  })

  it('全 50 时 overallPower = 50', () => {
    expect(generateFocusHint(makeAttrs()).overallPower).toBe(50)
  })

  it('全 89 时 overallPower = 89（未达胜利）', () => {
    const hint = generateFocusHint(
      makeAttrs({ military: 89, economy: 89, politics: 89, people: 89, diplomacy: 89 })
    )
    expect(hint.overallPower).toBe(89)
    expect(hint.isVictory).toBe(false)
  })

  it('全 90 时 overallPower = 90（达胜利阈值）', () => {
    const hint = generateFocusHint(
      makeAttrs({ military: 90, economy: 90, politics: 90, people: 90, diplomacy: 90 })
    )
    expect(hint.overallPower).toBe(90)
    expect(hint.isVictory).toBe(true)
  })

  it('全 100 时 overallPower = 100', () => {
    const hint = generateFocusHint(
      makeAttrs({ military: 100, economy: 100, politics: 100, people: 100, diplomacy: 100 })
    )
    expect(hint.overallPower).toBe(100)
    expect(hint.isVictory).toBe(true)
  })

  it('加权场景：(100,100,100,100,50) → overallPower ≈ 91.07（政治/民心权重更高）', () => {
    const hint = generateFocusHint(
      makeAttrs({ military: 100, economy: 100, politics: 100, people: 100, diplomacy: 50 })
    )
    // 加权 = (100*1 + 100*1 + 100*1.3 + 100*1.3 + 50*1) / 5.6 = 510/5.6 ≈ 91.07，取整后 = 91
    expect(hint.overallPower).toBe(91)
    expect(hint.isVictory).toBe(true)
  })
})

describe('getCrisis', () => {
  it('所有属性 ≥ 30 时返回 null', () => {
    expect(getCrisis(makeAttrs())).toBeNull()
    expect(
      getCrisis(
        makeAttrs({ military: 30, economy: 30, politics: 30, people: 30, diplomacy: 30 })
      )
    ).toBeNull()
  })

  it('单个属性 < 30 时返回该属性', () => {
    const crisis = getCrisis(makeAttrs({ military: 20 }))
    expect(crisis).not.toBeNull()
    expect(crisis?.attr).toBe('military')
    expect(crisis?.name).toBe('军事')
    expect(crisis?.value).toBe(20)
  })

  it('多个属性 < 30 时返回最低者', () => {
    const crisis = getCrisis(
      makeAttrs({ military: 25, economy: 10, politics: 28 })
    )
    expect(crisis).not.toBeNull()
    expect(crisis?.attr).toBe('economy')
    expect(crisis?.name).toBe('经济')
    expect(crisis?.value).toBe(10)
  })

  it('恰好 30 不算危机（< 30 严格）', () => {
    expect(
      getCrisis(
        makeAttrs({ military: 30, economy: 50, politics: 50, people: 50, diplomacy: 50 })
      )
    ).toBeNull()
  })

  it('属性为 0 或负值时也算危机', () => {
    const crisis1 = getCrisis(makeAttrs({ military: 0 }))
    expect(crisis1?.attr).toBe('military')
    expect(crisis1?.value).toBe(0)

    const crisis2 = getCrisis(makeAttrs({ people: -5 }))
    expect(crisis2?.attr).toBe('people')
    expect(crisis2?.value).toBe(-5)
  })

  it('遍历全部 5 维属性都能识别危机', () => {
    const keys: Array<keyof Attributes> = ['military', 'economy', 'politics', 'people', 'diplomacy']
    for (const k of keys) {
      const override = { [k]: 15 } as Partial<Attributes>
      const crisis = getCrisis(makeAttrs(override))
      expect(crisis?.attr).toBe(k)
    }
  })
})

describe('generateFocusHint - suggestion 生成规则', () => {
  it('isVictory 分支：综合 ≥ 90 时 suggestion 提示即将胜利', () => {
    const hint = generateFocusHint(
      makeAttrs({ military: 95, economy: 95, politics: 95, people: 95, diplomacy: 95 })
    )
    expect(hint.isVictory).toBe(true)
    expect(hint.suggestion).toContain('90')
    expect(hint.suggestion).toContain('霸业')
  })

  it('crisis 分支：有属性 < 30 时 suggestion 提示优先应对危机', () => {
    const hint = generateFocusHint(makeAttrs({ military: 15 }))
    expect(hint.crisis).not.toBeNull()
    expect(hint.crisis?.name).toBe('军事')
    expect(hint.suggestion).toContain('优先应对')
    expect(hint.suggestion).toContain('军事')
  })

  it('正常分支：无危机且未胜利时 suggestion 提示稳步发展', () => {
    const hint = generateFocusHint(makeAttrs())
    expect(hint.isVictory).toBe(false)
    expect(hint.crisis).toBeNull()
    expect(hint.suggestion).toContain('稳步发展')
  })

  it('胜利优先于危机（综合 ≥ 90 且某属性 < 30）', () => {
    // military=15 触发危机，但其他 4 项 100 → 综合 = (15+400)/5 = 83 < 90，不胜利
    // 要触发胜利优先于危机，需要综合 ≥ 90 且某属性 < 30
    // 例如：military=20, 其他 4 项都 100 → (20+400)/5 = 84 < 90，仍不胜利
    // 极端：military=29, 其他 4 项都 100 → (29+400)/5 = 85.8 < 90
    // 实际上若综合 ≥ 90，平均每项 ≥ 90，不可能有 < 30 的属性同时存在
    // 所以"胜利优先于危机"在数学上不可能同时触发，这里验证 isVictory 分支独立工作
    const hint = generateFocusHint(
      makeAttrs({ military: 90, economy: 90, politics: 90, people: 90, diplomacy: 90 })
    )
    expect(hint.isVictory).toBe(true)
    expect(hint.crisis).toBeNull()
    expect(hint.suggestion).toContain('90')
  })
})

describe('generateFocusHint - 返回结构完整性', () => {
  it('返回包含 overallPower/crisis/suggestion/isVictory 四字段', () => {
    const hint = generateFocusHint(makeAttrs())
    expect(hint).toHaveProperty('overallPower')
    expect(hint).toHaveProperty('crisis')
    expect(hint).toHaveProperty('suggestion')
    expect(hint).toHaveProperty('isVictory')
    expect(typeof hint.overallPower).toBe('number')
    expect(typeof hint.suggestion).toBe('string')
    expect(typeof hint.isVictory).toBe('boolean')
  })

  it('crisis 字段类型正确（null 或 Crisis 对象）', () => {
    const hint1 = generateFocusHint(makeAttrs())
    expect(hint1.crisis).toBeNull()

    const hint2 = generateFocusHint(makeAttrs({ diplomacy: 10 }))
    expect(hint2.crisis).not.toBeNull()
    expect(hint2.crisis).toHaveProperty('attr')
    expect(hint2.crisis).toHaveProperty('name')
    expect(hint2.crisis).toHaveProperty('value')
  })
})
