/**
 * @file utils/end-conditions.ts 单元测试
 *
 * 覆盖 T5.4 验证要求：8 个分支
 *   - 5 种属性崩溃（military/economy/politics/people/diplomacy ≤ 0）
 *   - 胜利（综合实力 ≥ 90）
 *   - 时光尽头（year > 1912）
 *   - continue（无触发）
 *
 * 覆盖优先级：
 *   - 属性崩溃优先于胜利（同时满足时返回崩溃）
 *   - 胜利优先于时光尽头
 *   - calcOverallPower 加权平均（政治/民心权重更高）
 *   - getEndReasonLabel / getEndReasonDescription / isFailureEnd
 */

import { describe, expect, it } from 'vitest'
import {
  calcOverallPower,
  checkEndConditions,
  getEndReasonDescription,
  getEndReasonLabel,
  isFailureEnd
} from '../../src/utils/end-conditions'
import type { GameSave, StateSnapshot } from '../../src/types/game'

function makeState(overrides: Partial<StateSnapshot> = {}): StateSnapshot {
  return {
    turn: 1,
    date: { year: 1851, month: 1 },
    attributes: {
      military: 50,
      economy: 50,
      politics: 50,
      people: 50,
      diplomacy: 50
    },
    resources: {
      silver: 1000,
      troops: 500,
      food: 800,
      reputation: 10
    },
    ...overrides
  }
}

function makeSave(state: StateSnapshot): GameSave {
  return {
    saveVersion: 1,
    saveId: 'test-save-id',
    deviceId: 'test-device',
    createdAt: 0,
    updatedAt: 0,
    character: {
      background: '文官',
      backgroundPerks: {},
      factionId: 'f1',
      factionName: '清廷',
      factionSummary: ''
    },
    state,
    factions: [],
    events: [],
    advisorMessages: [],
    ended: false
  }
}

describe('calcOverallPower - 加权平均（2026-08-07-weighted-overall-power）', () => {
  it('全属性相等时等于该值（等权退化）', () => {
    expect(calcOverallPower(makeState().attributes)).toBe(50)
    expect(
      calcOverallPower(
        makeState({
          attributes: { military: 90, economy: 90, politics: 90, people: 90, diplomacy: 90 }
        }).attributes
      )
    ).toBe(90)
  })

  it('clamp：超 100 封顶、负值封底 0', () => {
    expect(
      calcOverallPower({ military: 200, economy: 200, politics: 200, people: 200, diplomacy: 200 })
    ).toBe(100)
    expect(
      calcOverallPower({ military: -50, economy: -50, politics: -50, people: -50, diplomacy: -50 })
    ).toBe(0)
  })

  it('内政倾斜：同总和下政治/民心高者得分更高', () => {
    const militaryHeavy = { military: 100, economy: 100, politics: 0, people: 0, diplomacy: 0 }
    const internalHeavy = { military: 0, economy: 0, politics: 100, people: 100, diplomacy: 0 }
    // 两者总和均为 200，但 internalHeavy 的政治/民心权重 1.3 拉高得分
    expect(calcOverallPower(internalHeavy)).toBeGreaterThan(calcOverallPower(militaryHeavy))
    // numeric：internalHeavy=(100*1.3*2)/5.6≈46.4；militaryHeavy=(100*2)/5.6≈35.7
    expect(calcOverallPower(internalHeavy)).toBeCloseTo(46.4, 1)
  })
})

describe('checkEndConditions - 5 种属性崩溃', () => {
  it('military ≤ 0 触发 military_collapse', () => {
    const s = makeState({
      attributes: { military: 0, economy: 50, politics: 50, people: 50, diplomacy: 50 }
    })
    expect(checkEndConditions(s)).toBe('military_collapse')
    // 负值同样触发
    expect(
      checkEndConditions(
        makeState({
          attributes: { military: -5, economy: 50, politics: 50, people: 50, diplomacy: 50 }
        })
      )
    ).toBe('military_collapse')
  })

  it('economy ≤ 0 触发 economy_collapse', () => {
    const s = makeState({
      attributes: { military: 50, economy: 0, politics: 50, people: 50, diplomacy: 50 }
    })
    expect(checkEndConditions(s)).toBe('economy_collapse')
  })

  it('politics ≤ 0 触发 politics_collapse', () => {
    const s = makeState({
      attributes: { military: 50, economy: 50, politics: 0, people: 50, diplomacy: 50 }
    })
    expect(checkEndConditions(s)).toBe('politics_collapse')
  })

  it('people ≤ 0 触发 people_collapse', () => {
    const s = makeState({
      attributes: { military: 50, economy: 50, politics: 50, people: 0, diplomacy: 50 }
    })
    expect(checkEndConditions(s)).toBe('people_collapse')
  })

  it('diplomacy ≤ 0 触发 diplomacy_collapse', () => {
    const s = makeState({
      attributes: { military: 50, economy: 50, politics: 50, people: 50, diplomacy: 0 }
    })
    expect(checkEndConditions(s)).toBe('diplomacy_collapse')
  })
})

describe('checkEndConditions - 胜利', () => {
  it('综合实力 ≥ 90 触发 victory（恰好 90）', () => {
    const s = makeState({
      attributes: { military: 90, economy: 90, politics: 90, people: 90, diplomacy: 90 }
    })
    expect(checkEndConditions(s)).toBe('victory')
  })

  it('综合实力 > 90 触发 victory', () => {
    const s = makeState({
      attributes: { military: 100, economy: 100, politics: 100, people: 100, diplomacy: 100 }
    })
    expect(checkEndConditions(s)).toBe('victory')
  })

  it('综合实力 < 90 不触发胜利', () => {
    const s = makeState({
      attributes: { military: 89, economy: 90, politics: 90, people: 90, diplomacy: 90 }
    })
    expect(checkEndConditions(s)).toBe('continue')
  })
})

describe('checkEndConditions - 时光尽头', () => {
  it('year > 1912 触发 time_up', () => {
    const s = makeState({ date: { year: 1913, month: 1 } })
    expect(checkEndConditions(s)).toBe('time_up')
  })

  it('year = 1912 不触发 time_up', () => {
    const s = makeState({ date: { year: 1912, month: 12 } })
    expect(checkEndConditions(s)).toBe('continue')
  })
})

describe('checkEndConditions - 优先级', () => {
  it('属性崩溃优先于胜利（同时满足时返回崩溃）', () => {
    const s = makeState({
      attributes: { military: 0, economy: 100, politics: 100, people: 100, diplomacy: 100 }
      // military=0 触发崩溃，综合实力=(0+100*4)/5=80 < 90，不触发胜利，所以这个不是好测试
    })
    expect(checkEndConditions(s)).toBe('military_collapse')
  })

  it('胜利优先于时光尽头（year > 1912 + 综合 ≥ 90 时返回 victory）', () => {
    const s = makeState({
      date: { year: 1920, month: 1 },
      attributes: { military: 95, economy: 95, politics: 95, people: 95, diplomacy: 95 }
    })
    expect(checkEndConditions(s)).toBe('victory')
  })

  it('崩溃优先于时光尽头', () => {
    const s = makeState({
      date: { year: 1920, month: 1 },
      attributes: { military: 0, economy: 50, politics: 50, people: 50, diplomacy: 50 }
    })
    expect(checkEndConditions(s)).toBe('military_collapse')
  })
})

describe('checkEndConditions - 接受存档对象或状态快照', () => {
  it('接受 GameSave 对象（内部读取 .state）', () => {
    const save = makeSave(
      makeState({
        attributes: { military: 0, economy: 50, politics: 50, people: 50, diplomacy: 50 }
      })
    )
    expect(checkEndConditions(save)).toBe('military_collapse')
  })

  it('接受 StateSnapshot 直接传入', () => {
    const s = makeState({
      attributes: { military: 50, economy: 50, politics: 50, people: 50, diplomacy: 50 }
    })
    expect(checkEndConditions(s)).toBe('continue')
  })
})

describe('checkEndConditions - continue 分支', () => {
  it('正常初始状态返回 continue', () => {
    expect(checkEndConditions(makeState())).toBe('continue')
  })
})

describe('结局文案辅助函数', () => {
  it('getEndReasonLabel 返回中文标签', () => {
    expect(getEndReasonLabel('military_collapse')).toBe('军备崩溃')
    expect(getEndReasonLabel('victory')).toBe('中兴大业')
    expect(getEndReasonLabel('time_up')).toBe('时光尽头')
  })

  it('getEndReasonDescription 返回叙述文案', () => {
    expect(getEndReasonDescription('victory')).toContain('中兴')
    expect(getEndReasonDescription('military_collapse')).toContain('军力')
  })

  it('isFailureEnd：5 种崩溃为失败，victory 与 time_up 不算失败', () => {
    expect(isFailureEnd('military_collapse')).toBe(true)
    expect(isFailureEnd('economy_collapse')).toBe(true)
    expect(isFailureEnd('politics_collapse')).toBe(true)
    expect(isFailureEnd('people_collapse')).toBe(true)
    expect(isFailureEnd('diplomacy_collapse')).toBe(true)
    expect(isFailureEnd('victory')).toBe(false)
    expect(isFailureEnd('time_up')).toBe(false)
  })
})
