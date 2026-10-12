/**
 * @file utils/end-conditions.ts 单元测试
 *
 * 覆盖 T5.4 验证要求：8 个分支
 *   - 5 种属性崩溃（military/economy/politics/people/diplomacy ≤ 0）
 *   - 胜利（综合实力 ≥ VICTORY_THRESHOLD，当前 85；用例数值沿用历史上取 90 的那批）
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
  getChainCompletion,
  getChainTier,
  getEndReasonDescription,
  getEndReasonLabel,
  getHistoryRating,
  isFailureEnd
} from '../../src/utils/end-conditions'
import { CHAIN_META } from '../../src/data/story-chains'
import { HISTORY_RATINGS } from '../../src/utils/constants'
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
    // numeric：internalHeavy=(100*1.3*2)/5.6≈46.4，取整后 = 46；militaryHeavy=(100*2)/5.6≈35.7，取整后 = 36
    // calcOverallPower 取整返回 0-100 整数（与 5 维属性及 90 胜利阈值对齐）
    expect(calcOverallPower(internalHeavy)).toBe(46)
    expect(calcOverallPower(militaryHeavy)).toBe(36)
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

describe('checkEndConditions - 胜利（1912 结算制）', () => {
  it('结算时综合实力达标 → victory', () => {
    const s = makeState({
      date: { year: 1913, month: 1 },
      attributes: { military: 90, economy: 90, politics: 90, people: 90, diplomacy: 90 }
    })
    expect(checkEndConditions(s)).toBe('victory')
  })

  it('中途达标不再即时通关：快照里没有锁定信息，1912 前一律 continue', () => {
    // 只传 StateSnapshot（无 zenithYear）时，实力满分也不该提前判胜
    const s = makeState({
      date: { year: 1873, month: 1 },
      attributes: { military: 100, economy: 100, politics: 100, people: 100, diplomacy: 100 }
    })
    expect(checkEndConditions(s)).toBe('continue')
  })

  it('存档曾锁定「中兴已定」→ 结算时即便实力下滑仍判 victory', () => {
    const save = makeSave(
      makeState({
        date: { year: 1913, month: 1 },
        attributes: { military: 55, economy: 55, politics: 55, people: 55, diplomacy: 55 }
      })
    )
    expect(checkEndConditions(save)).toBe('time_up')
    expect(checkEndConditions({ ...save, zenithYear: 1888 })).toBe('victory')
  })

  it('从未锁定且结算时实力未达标 → time_up（走完全程但未成中兴）', () => {
    const s = makeState({
      date: { year: 1913, month: 1 },
      attributes: { military: 50, economy: 50, politics: 50, people: 50, diplomacy: 50 }
    })
    expect(checkEndConditions(s)).toBe('time_up')
  })

  it('综合实力 < 85 不触发胜利（即便已到结算年）', () => {
    // 阈值下调到 85 后，用全 84 验证「未达线不判胜」（原用例取 89.46 已落在新阈值之上）
    const s = makeState({
      date: { year: 1913, month: 1 },
      attributes: { military: 84, economy: 84, politics: 84, people: 84, diplomacy: 84 }
    })
    expect(checkEndConditions(s)).toBe('time_up')
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

describe('getHistoryRating（名望 → 史评档位）', () => {
  it('按各档下限入档（边界值直接取自 HISTORY_RATINGS，重标阈值时不必改这里）', () => {
    for (let i = 0; i < HISTORY_RATINGS.length - 1; i++) {
      const band = HISTORY_RATINGS[i]
      expect(getHistoryRating(band.min).label).toBe(band.label)
      expect(getHistoryRating(band.min - 1).label).toBe(HISTORY_RATINGS[i + 1].label)
    }
    // 划线本身也钉一下，防止被无声改动（年钟重标为 78/60/42/22，见 constants 注释）
    expect(HISTORY_RATINGS.map((b) => b.min)).toEqual([78, 60, 42, 22, -Infinity])
  })

  it('最低档兜底：0 与负数都归「身败名裂」，不抛错', () => {
    expect(getHistoryRating(0).label).toBe('身败名裂')
    expect(getHistoryRating(-30).label).toBe('身败名裂')
  })

  it('每档都有 label 与 remark（结局页直接渲染，缺字段会显示空白）', () => {
    for (const rep of [100, 80, 50, 25, 0]) {
      const r = getHistoryRating(rep)
      expect(r.label).toBeTruthy()
      expect(r.remark).toBeTruthy()
      expect(r.npcStance).toBeTruthy()
    }
  })

  it('关键不变量：名望高低完全不改变结局判定', () => {
    // C 方案的立身之本——实测把名望计入 calcOverallPower 会把 200 局胜率从 95.5% 抬到 100%，
    // 所以名望只做展示档位。这条用例锁住「不许顺手把 reputation 塞进胜利判定」。
    const attrs = { military: 90, economy: 88, politics: 92, people: 86, diplomacy: 84 }
    const low = makeState({ attributes: attrs, resources: { silver: 100, troops: 100, food: 100, reputation: 0 } })
    const high = makeState({ attributes: attrs, resources: { silver: 100, troops: 100, food: 100, reputation: 100 } })

    expect(checkEndConditions(low)).toBe(checkEndConditions(high))
    expect(calcOverallPower(attrs)).toBe(calcOverallPower(attrs))
  })
})

describe('getChainCompletion / getChainTier - 剧情链完成度进结局（派生，不参与判定）', () => {
  /** 取指定年份之前（含当年）在镜像表里存在的链，按 chainId 返回 */
  function chainsBy(year: number): string[] {
    return Object.values(CHAIN_META)
      .filter((c) => c.startYear <= year)
      .map((c) => c.chainId)
  }

  function makeChainSave(
    year: number,
    completed: string[],
    active: string[] = [],
    attributes = { military: 40, economy: 40, politics: 40, people: 40, diplomacy: 40 }
  ): GameSave {
    return {
      ...makeSave(makeState({ date: { year, month: 1 }, attributes })),
      completedChainIds: completed,
      activeChainIds: active
    }
  }

  it('分母取「终局年份前可达链数」，不是全集', () => {
    const early = getChainCompletion(makeChainSave(1865, []))
    const late = getChainCompletion(makeChainSave(1912, []))
    expect(early.reachable).toBe(chainsBy(1865).length)
    expect(late.reachable).toBe(chainsBy(1912).length)
    // 23 条链铺到 1851-1911，早期年份的可达集必然小于全集，否则这个口径没有意义
    expect(early.reachable).toBeLessThan(late.reachable)
    expect(late.reachable).toBe(Object.keys(CHAIN_META).length)
  })

  it('尚未到年代的链即使被标记完成也不计入（防"未来完成"）', () => {
    const save = makeChainSave(1852, ['tai-ping-tian-guo', 'xin-hai-ge-ming'])
    const r = getChainCompletion(save)
    expect(r.completed).toBe(1)
    expect(r.completedTitles).toEqual(['太平天国兴亡'])
  })

  it('completedTitles 按 startYear 升序（镜像表本身不是年代序）', () => {
    const save = makeChainSave(1900, ['yang-wu-yun-dong', 'tai-ping-tian-guo', 'nian-jun-zhi-luan'])
    const r = getChainCompletion(save)
    expect(r.completedTitles).toEqual(['太平天国兴亡', '捻军之乱', '洋务运动'])
  })

  it('进行中链数单独统计，不混进完成数', () => {
    const save = makeChainSave(1860, ['tai-ping-tian-guo'], ['er-ci-ya-pian'])
    const r = getChainCompletion(save)
    expect(r.completed).toBe(1)
    expect(r.inProgress).toBe(1)
  })

  it('三档比例分界：≥0.8 亲历全局 / ≥0.5 半壁经行 / <0.5 未竟之局', () => {
    const pool = chainsBy(1912)
    const total = pool.length
    const take = (n: number) => makeChainSave(1912, pool.slice(0, n))
    expect(getChainTier(getChainCompletion(take(total)))?.label).toBe('亲历全局')
    // 恰好过半（含奇数向下取整）应落在第二档
    expect(getChainTier(getChainCompletion(take(Math.ceil(total / 2))))?.label).toBe('半壁经行')
    expect(getChainTier(getChainCompletion(take(1)))?.label).toBe('未竟之局')
  })

  it('可达链数不足 3 条时不分级：1/1=100% 不该被吹成完人', () => {
    const save = makeChainSave(1852, ['tai-ping-tian-guo'])
    const r = getChainCompletion(save)
    expect(r.reachable).toBeLessThan(3)
    expect(r.ratio).toBe(1)
    expect(getChainTier(r)).toBeNull()
  })

  it('一条也没完成时不分级（结局页只给原始数字）', () => {
    const r = getChainCompletion(makeChainSave(1912, []))
    expect(r.completed).toBe(0)
    expect(getChainTier(r)).toBeNull()
  })

  it('存档为 null 时返回全零而不抛（结局页 save 是 onMounted 才载入的）', () => {
    const r = getChainCompletion(null)
    expect(r).toEqual({
      completed: 0,
      reachable: 0,
      inProgress: 0,
      ratio: 0,
      completedTitles: [],
      endYear: 0
    })
    expect(getChainTier(r)).toBeNull()
  })

  it('关键不变量：完成度高低完全不改变结局判定', () => {
    // 与 #2 名望同一口径。实测理由：若用完成度当胜利门槛，
    // 「关链」模拟的 chainsCompleted 恒为 0，胜率会直接归零，整条 86.0% 基线作废。
    const pool = chainsBy(1912)
    const empty = makeChainSave(1912, [], [])
    const full = makeChainSave(1912, pool, [])
    expect(checkEndConditions(empty)).toBe(checkEndConditions(full))
    // 达标属性 + 满完成度 与 达标属性 + 零完成度 同样判胜
    const winAttrs = { military: 90, economy: 90, politics: 90, people: 90, diplomacy: 90 }
    expect(
      checkEndConditions(makeChainSave(1912, [], [], winAttrs))
    ).toBe(
      checkEndConditions(makeChainSave(1912, pool, [], winAttrs))
    )
  })
})
