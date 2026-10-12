/**
 * @file fallback-events 单元测试
 *
 * 验证总数 = 90 与 5 类型各 18 条；兜底事件不携带 chainId；标题全局唯一；
 * 扩容新增的 30 条无严格占优选项、且至少 1/3 带粮草/兵员收支；
 * 以及 getRandomFallbackEvent 的 avoidTitles 避重与「剔空回退全池」行为
 */

import { describe, expect, it } from 'vitest'
import { FALLBACK_EVENTS, getRandomFallbackEvent } from '../../server/runtime/fallback-events'

describe('fallback-events', () => {
  it('总数 = 90', () => {
    expect(FALLBACK_EVENTS.length).toBe(90)
  })

  it('5 类型各 18 条', () => {
    const counts: Record<string, number> = {}
    for (const e of FALLBACK_EVENTS) {
      counts[e.type] = (counts[e.type] ?? 0) + 1
    }
    expect(counts['民生']).toBe(18)
    expect(counts['军事']).toBe(18)
    expect(counts['外交']).toBe(18)
    expect(counts['随机']).toBe(18)
    expect(counts['历史剧情']).toBe(18)
  })

  it('兜底事件不携带 chainId 字段', () => {
    for (const e of FALLBACK_EVENTS) {
      expect(e).not.toHaveProperty('chainId')
      expect(e).not.toHaveProperty('chainNodeId')
      expect(e).not.toHaveProperty('chainProgress')
    }
  })

  it('标题全局唯一（同类内不重复主题的前提）', () => {
    const titles = FALLBACK_EVENTS.map((e) => e.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  // 扩容 30 条的清单（新增事件时必须同步登记，否则下面两条护栏覆盖不到它）
  const EXPANDED_TITLES = [
    // 民生
    '蚕桑歉收', '银荒钱贱', '裁撤驿递', '乡族械斗', '田赋加派', '书院义学',
    // 军事
    '屯田实边', '军粮转运', '团练劝捐', '溃兵为匪', '江防炮台', '军马采购',
    // 外交
    '洋商欠债', '出使经费', '华工出洋', '矿权让与', '商约修订', '公使觐礼',
    // 随机
    '戏班义演', '巧匠献器', '洋油失慎', '奇兽困人', '电报误传', '落第士子',
    // 历史剧情
    '丁戊奇荒', '捻军荡平', '滇案照会', '伊犁交涉', '海防塞防之争', '义和拳起'
  ]

  /**
   * 严格占优判定：effects 里所有字段都是「越大越好」（负数即代价），
   * 若 A 在全部字段 ≥ B 且至少一项 >，则 A 严格优于 B —— 玩家不必思考就能选对，是坏设计。
   */
  function strictlyDominates(a: Record<string, number>, b: Record<string, number>): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    let strict = false
    for (const k of keys) {
      const av = a[k] ?? 0
      const bv = b[k] ?? 0
      if (av < bv) return false
      if (av > bv) strict = true
    }
    return strict
  }

  it('扩容新增的 30 条：不存在严格占优选项（每条都要有权衡）', () => {
    const offenders: string[] = []
    for (const e of FALLBACK_EVENTS.filter((x) => EXPANDED_TITLES.includes(x.title))) {
      for (const a of e.options) {
        for (const b of e.options) {
          if (a !== b && strictlyDominates(a.effects as Record<string, number>, b.effects as Record<string, number>)) {
            offenders.push(`${e.title}：「${a.label}」严格优于「${b.label}」`)
          }
        }
      }
    }
    // 旧池 60 条里有 26 条存在严格占优选项（早于本规则，未一并整改，见提案「遗留」）。
    // 因此本护栏只覆盖登记的扩容清单——新增事件不写进 EXPANDED_TITLES 就等于没测。
    expect(offenders).toEqual([])
    expect(EXPANDED_TITLES.length).toBe(30)
    expect(FALLBACK_EVENTS.filter((x) => EXPANDED_TITLES.includes(x.title))).toHaveLength(30)
  })

  it('扩容新增的 30 条里至少 1/3 以粮草或兵员为代价/收益（激活枯竭惩罚）', () => {
    const withResource = FALLBACK_EVENTS.filter(
      (x) =>
        EXPANDED_TITLES.includes(x.title) &&
        x.options.some((o) => o.effects.food !== undefined || o.effects.troops !== undefined)
    )
    expect(withResource.length).toBeGreaterThanOrEqual(10)
  })

  it('每条事件含 title/description/options(2-4)/eventType', () => {
    for (const e of FALLBACK_EVENTS) {
      expect(typeof e.title).toBe('string')
      expect(e.title.length).toBeGreaterThan(0)
      expect(typeof e.description).toBe('string')
      expect(e.description.length).toBeGreaterThanOrEqual(20)
      expect(Array.isArray(e.options)).toBe(true)
      expect(e.options.length).toBeGreaterThanOrEqual(2)
      expect(e.options.length).toBeLessThanOrEqual(4)
      expect(['民生', '军事', '外交', '随机', '历史剧情']).toContain(e.eventType)
    }
  })

  it('每个 option 含 id/label/effects，effects 数值合理', () => {
    // 属性（military/economy/politics/people/diplomacy/reputation）变化幅度 ±1~15
    // 资源（silver/troops/food）变化幅度 ±50~500（绝对值更大）
    const attrKeys = ['military', 'economy', 'politics', 'people', 'diplomacy', 'reputation']
    for (const e of FALLBACK_EVENTS) {
      for (const opt of e.options) {
        expect(typeof opt.id).toBe('string')
        expect(opt.id.length).toBeGreaterThan(0)
        expect(typeof opt.label).toBe('string')
        expect(opt.label.length).toBeGreaterThan(0)
        expect(typeof opt.effects).toBe('object')
        // effects 不能全为 0
        const allValues = Object.values(opt.effects)
        expect(allValues.some((v) => v !== 0)).toBe(true)
        for (const [k, v] of Object.entries(opt.effects)) {
          if (attrKeys.includes(k)) {
            expect(Math.abs(v as number)).toBeLessThanOrEqual(15)
          } else {
            // silver/troops/food 资源类
            expect(Math.abs(v as number)).toBeLessThanOrEqual(500)
          }
        }
      }
    }
  })

  it('getRandomFallbackEvent 返回合法事件', () => {
    for (let i = 0; i < 20; i++) {
      const e = getRandomFallbackEvent()
      expect(e).toBeDefined()
      expect(e.options.length).toBeGreaterThanOrEqual(2)
      // 返回的 GameEvent 不应含 type 字段
      expect(e).not.toHaveProperty('type')
    }
  })

  it('getRandomFallbackEvent 按类型筛选', () => {
    for (let i = 0; i < 10; i++) {
      const e = getRandomFallbackEvent('军事')
      expect(e.eventType).toBe('军事')
    }
  })

  it('getRandomFallbackEvent 不存在的类型返回全池随机', () => {
    // @ts-expect-error 故意传不存在的类型测试兜底
    const e = getRandomFallbackEvent('不存在的类型')
    expect(e).toBeDefined()
    expect(e.options.length).toBeGreaterThanOrEqual(2)
  })

  it('avoidTitles 命中的标题不会被再次返回（兜底路径避重）', () => {
    // 避开除一条外的全部标题，多次采样只能得到剩下那条
    const avoid = FALLBACK_EVENTS.slice(0, -1).map((e) => e.title)
    const expected = FALLBACK_EVENTS[FALLBACK_EVENTS.length - 1].title
    for (let i = 0; i < 10; i++) {
      expect(getRandomFallbackEvent(undefined, avoid).title).toBe(expected)
    }
  })

  it('整池都被 avoid 时回退全池，绝不返回不了事件', () => {
    const all = FALLBACK_EVENTS.map((e) => e.title)
    const e = getRandomFallbackEvent(undefined, all)
    expect(e).toBeDefined()
    expect(e.title.length).toBeGreaterThan(0)
    expect(e.options.length).toBeGreaterThanOrEqual(2)
  })

  it('avoidTitles 与类型筛选叠加：只在同类型子池内避重', () => {
    const military = FALLBACK_EVENTS.filter((e) => e.type === '军事')
    const avoid = military.slice(0, -1).map((e) => e.title)
    const left = military[military.length - 1].title
    for (let i = 0; i < 8; i++) {
      const e = getRandomFallbackEvent('军事', avoid)
      expect(e.eventType).toBe('军事')
      expect(e.title).toBe(left)
    }
  })

  it('不传 avoidTitles 时行为与改造前一致（全池随机，仍能出事件）', () => {
    const e = getRandomFallbackEvent()
    expect(e).toBeDefined()
    expect(e.options.length).toBeGreaterThanOrEqual(2)
  })
})
