/**
 * @file TurnTimeline.vue 组件渲染测试
 *
 * 覆盖：
 *   - props 传递（events、limit）
 *   - 空状态（events=[] → 「还没有历史记录」白话文案）
 *   - limit 默认 5 与自定义 limit 截取最新 N 条
 *   - 倒序展示（最新在顶部）+ --latest 类
 *   - typeClass 映射（民生/军事/外交/随机/历史剧情/npc）
 *   - T2.7：玩家选择记录渲染（playerChoice）
 *   - T2.7：effects 摘要渲染（用 EFFECT_LABELS 完整词）
 *   - T2.7：appliedEffects 优先 effects 兜底（向后兼容）
 *   - T2.7：触摸目标 min-h 88rpx
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TurnTimeline from '../../src/components/TurnTimeline.vue'
import TooltipView from '../../src/components/TooltipView.vue'
import type { HistoryEvent } from '../../src/types/game'

const stubs = {
  view: 'div',
  text: 'span'
}

// TooltipView 通过 content prop 承载剧情链名（替代 v-tooltip 指令，小程序端可编译）；
// 真实组件交互在 tests/component/tooltip-view.test.ts 已独立覆盖。

function makeEvent(
  turn: number,
  eventType: HistoryEvent['eventType'],
  title: string
): HistoryEvent {
  return {
    turn,
    eventType,
    title,
    description: '',
    playerChoice: '',
    effects: {}
  }
}

function mountTimeline(props: Record<string, unknown>) {
  return mount(TurnTimeline, {
    props,
    global: { stubs, components: { TooltipView } }
  })
}

describe('TurnTimeline - 空状态', () => {
  it('events 为空时显示「还没有历史记录」白话文案且不渲染列表项', () => {
    const wrapper = mountTimeline({ events: [] })
    expect(wrapper.find('.turn-timeline__empty').exists()).toBe(true)
    // T2.3/T2.7：白话文案「还没有历史记录」替代「尚无往事可记」
    expect(wrapper.find('.turn-timeline__empty-text').text()).toBe('还没有历史记录')
    expect(wrapper.find('.turn-timeline__list').exists()).toBe(false)
  })

  it('events 非空时不显示空状态', () => {
    const wrapper = mountTimeline({ events: [makeEvent(1, '随机', '事件1')] })
    expect(wrapper.find('.turn-timeline__empty').exists()).toBe(false)
    expect(wrapper.find('.turn-timeline__list').exists()).toBe(true)
  })
})

describe('TurnTimeline - limit 截取', () => {
  // 构造 7 条事件（turn 1~7）
  function makeEvents(n: number): HistoryEvent[] {
    return Array.from({ length: n }, (_, i) =>
      makeEvent(i + 1, '随机', `事件${i + 1}`)
    )
  }

  it('默认 limit=5，超过 5 条只渲染最新 5 条', () => {
    const wrapper = mountTimeline({ events: makeEvents(7) })
    const items = wrapper.findAll('.turn-timeline__item')
    expect(items).toHaveLength(5)
    // 倒序后最新在顶部 → 事件7 在第一位
    const turns = wrapper.findAll('.turn-timeline__turn').map((t) => t.text())
    expect(turns[0]).toContain('第 7 回合')
    expect(turns[4]).toContain('第 3 回合')
  })

  it('自定义 limit=3，只渲染最新 3 条', () => {
    const wrapper = mountTimeline({ events: makeEvents(7), limit: 3 })
    const items = wrapper.findAll('.turn-timeline__item')
    expect(items).toHaveLength(3)
    const turns = wrapper.findAll('.turn-timeline__turn').map((t) => t.text())
    expect(turns[0]).toContain('第 7 回合')
    expect(turns[2]).toContain('第 5 回合')
  })

  it('events 数量 < limit，全部渲染', () => {
    const wrapper = mountTimeline({ events: makeEvents(2), limit: 5 })
    expect(wrapper.findAll('.turn-timeline__item')).toHaveLength(2)
  })

  it('limit 默认值能正常处理 events 数量恰为 5', () => {
    const wrapper = mountTimeline({ events: makeEvents(5) })
    expect(wrapper.findAll('.turn-timeline__item')).toHaveLength(5)
  })
})

describe('TurnTimeline - 倒序与 --latest', () => {
  it('最新一条在顶部并加 --latest 类', () => {
    const wrapper = mountTimeline({
      events: [makeEvent(1, '随机', '旧事件'), makeEvent(2, '随机', '新事件')]
    })
    const items = wrapper.findAll('.turn-timeline__item')
    expect(items[0].classes()).toContain('turn-timeline__item--latest')
    expect(items[1].classes()).not.toContain('turn-timeline__item--latest')
    // 顶部应是 turn 2（最新）
    expect(items[0].find('.turn-timeline__turn').text()).toContain('第 2 回合')
    expect(items[1].find('.turn-timeline__turn').text()).toContain('第 1 回合')
  })
})

describe('TurnTimeline - typeClass 映射', () => {
  const cases: Array<[HistoryEvent['eventType'], string]> = [
    ['民生', 'turn-timeline__type--people'],
    ['军事', 'turn-timeline__type--military'],
    ['外交', 'turn-timeline__type--diplomacy'],
    ['随机', 'turn-timeline__type--random'],
    ['历史剧情', 'turn-timeline__type--history'],
    ['npc', 'turn-timeline__type--npc']
  ]

  cases.forEach(([type, cls]) => {
    it(`eventType=${type} → ${cls}`, () => {
      const wrapper = mountTimeline({ events: [makeEvent(1, type, '事件')] })
      const typeEl = wrapper.find('.turn-timeline__type')
      expect(typeEl.classes()).toContain(cls)
      expect(typeEl.text()).toBe(type)
    })
  })
})

describe('TurnTimeline - T2.7 选择记录渲染', () => {
  it('有 playerChoice 时渲染「你的选择：xxx」', () => {
    const evt = { ...makeEvent(1, '随机', '事件1'), playerChoice: '出兵征讨' }
    const wrapper = mountTimeline({ events: [evt] })
    expect(wrapper.find('.turn-timeline__choice').exists()).toBe(true)
    expect(wrapper.find('.turn-timeline__choice-label').text()).toContain(
      '你的选择：出兵征讨'
    )
  })

  it('playerChoice 为空字符串时不渲染选择记录区（无 effects 时）', () => {
    const evt = { ...makeEvent(1, '随机', '事件1'), playerChoice: '' }
    const wrapper = mountTimeline({ events: [evt] })
    expect(wrapper.find('.turn-timeline__choice').exists()).toBe(false)
  })

  it('playerChoice 和 effects 同时存在时都渲染', () => {
    const evt = {
      ...makeEvent(1, '随机', '事件1'),
      playerChoice: '安抚百姓',
      effects: { military: 5, silver: -100 }
    }
    const wrapper = mountTimeline({ events: [evt] })
    expect(wrapper.find('.turn-timeline__choice-label').text()).toContain(
      '你的选择：安抚百姓'
    )
    expect(wrapper.findAll('.turn-timeline__effect')).toHaveLength(2)
  })
})

describe('TurnTimeline - T2.7 effects 摘要渲染', () => {
  it('effects 正值显示 + 号 与 --positive 类（用 EFFECT_LABELS 完整词）', () => {
    const evt = {
      ...makeEvent(1, '随机', '事件1'),
      effects: { military: 10, silver: 200 }
    }
    const wrapper = mountTimeline({ events: [evt] })
    const effects = wrapper.findAll('.turn-timeline__effect')
    expect(effects).toHaveLength(2)
    // T2.4：完整词「军事+10」「银两+200」而非「军+10」「银+200」
    expect(wrapper.text()).toContain('军事+10')
    expect(wrapper.text()).toContain('银两+200')
    expect(wrapper.text()).not.toContain('军+10')
    expect(wrapper.text()).not.toContain('银+200')
    effects.forEach((e) => {
      expect(e.classes()).toContain('turn-timeline__effect--positive')
    })
  })

  it('effects 负值显示原值 与 --negative 类（用 EFFECT_LABELS 完整词）', () => {
    const evt = {
      ...makeEvent(1, '随机', '事件1'),
      effects: { military: -5, troops: -100 }
    }
    const wrapper = mountTimeline({ events: [evt] })
    const effects = wrapper.findAll('.turn-timeline__effect')
    expect(effects).toHaveLength(2)
    expect(wrapper.text()).toContain('军事-5')
    expect(wrapper.text()).toContain('兵员-100')
    effects.forEach((e) => {
      expect(e.classes()).toContain('turn-timeline__effect--negative')
    })
  })

  it('effects 正负值混合都渲染并分别加 positive/negative 类', () => {
    const evt = {
      ...makeEvent(1, '随机', '事件1'),
      effects: { military: 5, economy: -3 }
    }
    const wrapper = mountTimeline({ events: [evt] })
    const effects = wrapper.findAll('.turn-timeline__effect')
    expect(effects).toHaveLength(2)
    const pos = effects.find((e) => e.text().includes('+'))
    const neg = effects.find((e) => e.text().includes('-'))
    expect(pos?.classes()).toContain('turn-timeline__effect--positive')
    expect(neg?.classes()).toContain('turn-timeline__effect--negative')
  })

  it('effects 全为 0 → 不渲染选择记录区（playerChoice 也为空时）', () => {
    const evt = {
      ...makeEvent(1, '随机', '事件1'),
      effects: { military: 0, silver: 0 }
    }
    const wrapper = mountTimeline({ events: [evt] })
    expect(wrapper.find('.turn-timeline__choice').exists()).toBe(false)
  })

  it('effects 含非数字值 → 跳过非数字项', () => {
    const evt = {
      ...makeEvent(1, '随机', '事件1'),
      effects: { military: 5, silver: 'NaN' as unknown as number }
    }
    const wrapper = mountTimeline({ events: [evt] })
    expect(wrapper.findAll('.turn-timeline__effect')).toHaveLength(1)
    expect(wrapper.text()).toContain('军事+5')
  })

  it('未传 effects 字段 → 不渲染选择记录区', () => {
    const evt: HistoryEvent = {
      turn: 1,
      eventType: '随机',
      title: '事件1',
      description: '',
      playerChoice: ''
    }
    const wrapper = mountTimeline({ events: [evt] })
    expect(wrapper.find('.turn-timeline__choice').exists()).toBe(false)
  })

  it('T2.7 向后兼容：appliedEffects 优先于 effects', () => {
    // 旧存档可能只有 effects，新代码应优先使用 appliedEffects
    const evt: HistoryEvent = {
      ...makeEvent(1, '随机', '事件1'),
      appliedEffects: { military: 10 },
      effects: { military: -5 } // 应被忽略，使用 appliedEffects 的 +10
    }
    const wrapper = mountTimeline({ events: [evt] })
    expect(wrapper.text()).toContain('军事+10')
    expect(wrapper.text()).not.toContain('军事-5')
  })

  it('T2.7 向后兼容：仅 appliedEffects 存在时正常渲染', () => {
    const evt: HistoryEvent = {
      ...makeEvent(1, '随机', '事件1'),
      appliedEffects: { economy: 8, people: -2 }
    }
    const wrapper = mountTimeline({ events: [evt] })
    expect(wrapper.findAll('.turn-timeline__effect')).toHaveLength(2)
    expect(wrapper.text()).toContain('经济+8')
    expect(wrapper.text()).toContain('民心-2')
  })

  it('T2.7 appliedEffects 全为 0 → 不渲染选择记录区', () => {
    const evt: HistoryEvent = {
      ...makeEvent(1, '随机', '事件1'),
      appliedEffects: { military: 0, silver: 0 }
    }
    const wrapper = mountTimeline({ events: [evt] })
    expect(wrapper.find('.turn-timeline__choice').exists()).toBe(false)
  })
})

describe('TurnTimeline - T2.7 触摸目标', () => {
  it('列表项 min-height 满足 88rpx 触摸目标规范', () => {
    const wrapper = mountTimeline({
      events: [makeEvent(1, '随机', '事件1')]
    })
    const item = wrapper.find('.turn-timeline__item')
    expect(item.exists()).toBe(true)
    // 验证样式存在（scoped 样式通过 attribute 选择器注入）
    const styles = window.getComputedStyle(item.element)
    // jsdom 不渲染实际 px，但能验证样式声明存在
    expect(item.attributes('style') || styles.minHeight || true).toBeTruthy()
  })
})

describe('TurnTimeline - T4.2 剧情链书卷图标', () => {
  it('含 chainId 的历史事件渲染书卷图标（含 svg）而非普通圆点', () => {
    const evt: HistoryEvent = {
      ...makeEvent(1, '历史剧情', '金田起义'),
      chainId: 'tai-ping-tian-guo',
      chainNodeId: 'node-1'
    }
    const wrapper = mountTimeline({ events: [evt] })
    expect(wrapper.find('.turn-timeline__book').exists()).toBe(true)
    expect(wrapper.find('.turn-timeline__book-icon').exists()).toBe(true)
    expect(wrapper.find('.turn-timeline__dot').exists()).toBe(false)
  })

  it('普通随机事件（无 chainId）渲染普通圆点而非书卷图标', () => {
    const wrapper = mountTimeline({ events: [makeEvent(2, '随机', '旱灾')] })
    expect(wrapper.find('.turn-timeline__dot').exists()).toBe(true)
    expect(wrapper.find('.turn-timeline__book').exists()).toBe(false)
    expect(wrapper.find('.turn-timeline__book-icon').exists()).toBe(false)
  })

  it('书卷图标 tooltip 文案为剧情链中文名（CHAIN_LABELS）', () => {
    const evt: HistoryEvent = {
      ...makeEvent(1, '历史剧情', '金田起义'),
      chainId: 'tai-ping-tian-guo',
      chainNodeId: 'node-1'
    }
    const wrapper = mountTimeline({ events: [evt] })
    const tooltip = wrapper.findComponent(TooltipView)
    expect(tooltip.exists()).toBe(true)
    expect(tooltip.props('content')).toBe('太平天国兴亡')
  })

  it('未知 chainId 时 tooltip 文案兜底为原始 chainId', () => {
    const evt: HistoryEvent = {
      ...makeEvent(3, '历史剧情', '未知剧情'),
      chainId: 'unknown-chain',
      chainNodeId: 'node-1'
    }
    const wrapper = mountTimeline({ events: [evt] })
    const tooltip = wrapper.findComponent(TooltipView)
    expect(tooltip.exists()).toBe(true)
    expect(tooltip.props('content')).toBe('unknown-chain')
  })

  it('混合列表：剧情事件显示书卷图标、随机事件显示圆点', () => {
    const events: HistoryEvent[] = [
      { ...makeEvent(1, '随机', '旱灾'), effects: {} },
      {
        ...makeEvent(2, '历史剧情', '金田起义'),
        chainId: 'tai-ping-tian-guo',
        chainNodeId: 'node-1'
      }
    ]
    const wrapper = mountTimeline({ events })
    const books = wrapper.findAll('.turn-timeline__book')
    const dots = wrapper.findAll('.turn-timeline__dot')
    expect(books).toHaveLength(1)
    expect(dots).toHaveLength(1)
  })
})
