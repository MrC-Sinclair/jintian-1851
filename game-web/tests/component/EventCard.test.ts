/**
 * @file EventCard.vue 组件渲染测试
 *
 * 覆盖：
 *   - props 传递（event.eventType/title/description/options）
 *   - 子组件 DecisionButton 渲染（mount 真实子组件，验证集成）
 *   - 事件冒泡（DecisionButton click → EventCard select with optionId）
 *   - 无 options 时仍正常渲染
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import EventCard from '../../src/components/EventCard.vue'
import type { GameEvent } from '../../src/types/game'

const stubs = {
  view: 'div',
  text: 'span'
}

function makeEvent(overrides: Partial<GameEvent> = {}): GameEvent {
  return {
    title: '天灾降临',
    description: '北方大旱，粮食歉收。',
    eventType: '民生',
    options: [
      { id: 'o1', label: '开仓赈灾', effects: { silver: -200, people: 10 } },
      { id: 'o2', label: '加征赋税', effects: { silver: 100, people: -15 } }
    ],
    ...overrides
  }
}

function mountCard(props: Record<string, unknown>) {
  return mount(EventCard, {
    props,
    global: { stubs }
  })
}

describe('EventCard - props 传递', () => {
  it('渲染 eventType / title / description', () => {
    const wrapper = mountCard({
      event: makeEvent({
        eventType: '军事',
        title: '边关告急',
        description: '俄军南下侵扰新疆。'
      })
    })
    expect(wrapper.find('.event-card__type').text()).toBe('军事')
    expect(wrapper.find('.event-card__title').text()).toBe('边关告急')
    expect(wrapper.find('.event-card__description').text()).toBe('俄军南下侵扰新疆。')
  })

  it('渲染「应对方案」标题（T2.3 白话化）', () => {
    const wrapper = mountCard({ event: makeEvent() })
    expect(wrapper.find('.event-card__options-title').text()).toBe('应对方案')
  })

  it('剧情链事件（含 chainId）渲染剧情推进提示', () => {
    const wrapper = mountCard({
      event: makeEvent({
        eventType: '历史剧情',
        chainId: 'tai-ping-tian-guo',
        chainNodeId: 'node-1',
        chainProgress: { current: 1, total: 5 }
      })
    })
    const hint = wrapper.find('.event-card__chain-hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe('历史剧情：选择应对方案或自由行动回应后，剧情将推进')
  })

  it('非剧情链事件（无 chainId）不渲染剧情推进提示', () => {
    const wrapper = mountCard({ event: makeEvent() })
    expect(wrapper.find('.event-card__chain-hint').exists()).toBe(false)
  })
})

describe('EventCard - 子组件 DecisionButton 渲染', () => {
  it('为每个 option 渲染一个 DecisionButton', () => {
    const wrapper = mountCard({ event: makeEvent() })
    const buttons = wrapper.findAll('.decision-button')
    expect(buttons).toHaveLength(2)
  })

  it('option.label 透传到 DecisionButton', () => {
    const wrapper = mountCard({ event: makeEvent() })
    const labels = wrapper.findAll('.decision-button__label').map((l) => l.text())
    expect(labels).toEqual(['开仓赈灾', '加征赋税'])
  })

  it('option.effects 透传并渲染为 effect 标签（T2.4 完整词）', () => {
    const wrapper = mountCard({ event: makeEvent() })
    // 第一个按钮 effects = { silver: -200, people: 10 }
    const firstButton = wrapper.findAll('.decision-button')[0]
    const effects = firstButton.findAll('.decision-button__effect')
    expect(effects).toHaveLength(2)
    const text = firstButton.text()
    // T2.4：完整词"银两-200"而非单字"银-200"
    expect(text).toContain('银两-200')
    expect(text).toContain('民心+10')
    expect(text).not.toContain('银-200')
    expect(text).not.toContain('民+10')
  })
})

describe('EventCard - 事件冒泡', () => {
  it('点击 DecisionButton 触发 select 事件，载荷为 option.id', async () => {
    const wrapper = mountCard({ event: makeEvent() })
    const buttons = wrapper.findAll('.decision-button')
    await buttons[0].trigger('click')
    const emitted = wrapper.emitted('select')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual(['o1'])
  })

  it('点击第二个 option 触发对应 optionId', async () => {
    const wrapper = mountCard({ event: makeEvent() })
    await wrapper.findAll('.decision-button')[1].trigger('click')
    expect(wrapper.emitted('select')![0]).toEqual(['o2'])
  })

  it('多次点击多次触发 select', async () => {
    const wrapper = mountCard({ event: makeEvent() })
    await wrapper.findAll('.decision-button')[0].trigger('click')
    await wrapper.findAll('.decision-button')[1].trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(2)
  })
})

describe('EventCard - 边界场景', () => {
  it('options 为空时仍渲染头部与描述，不渲染 DecisionButton', () => {
    const wrapper = mountCard({
      event: makeEvent({ options: [] })
    })
    expect(wrapper.find('.event-card__title').exists()).toBe(true)
    expect(wrapper.find('.event-card__description').exists()).toBe(true)
    expect(wrapper.findAll('.decision-button')).toHaveLength(0)
  })

  it('单 option 正常渲染', () => {
    const wrapper = mountCard({
      event: makeEvent({
        options: [{ id: 'only', label: '唯一选项', effects: {} }]
      })
    })
    expect(wrapper.findAll('.decision-button')).toHaveLength(1)
    expect(wrapper.find('.decision-button__label').text()).toBe('唯一选项')
  })
})

// ====================== T3.1：选中态传递 ======================
describe('EventCard - T3.1 选中态传递', () => {
  it('selectedOptionId 匹配时对应 DecisionButton 显示选中态', () => {
    const wrapper = mountCard({
      event: makeEvent(),
      selectedOptionId: 'o1'
    })
    const buttons = wrapper.findAll('.decision-button')
    expect(buttons[0].classes()).toContain('decision-button--selected')
    expect(buttons[1].classes()).not.toContain('decision-button--selected')
  })

  it('selectedOptionId 为 null 时无选中态', () => {
    const wrapper = mountCard({
      event: makeEvent(),
      selectedOptionId: null
    })
    const buttons = wrapper.findAll('.decision-button')
    buttons.forEach((b) => {
      expect(b.classes()).not.toContain('decision-button--selected')
    })
  })

  it('切换 selectedOptionId 选中态跟随切换', async () => {
    const wrapper = mountCard({
      event: makeEvent(),
      selectedOptionId: 'o1'
    })
    expect(wrapper.findAll('.decision-button')[0].classes()).toContain('decision-button--selected')
    await wrapper.setProps({ selectedOptionId: 'o2' })
    const buttons = wrapper.findAll('.decision-button')
    expect(buttons[0].classes()).not.toContain('decision-button--selected')
    expect(buttons[1].classes()).toContain('decision-button--selected')
  })

  it('disabled=true 时所有 DecisionButton 加 --disabled 类', () => {
    const wrapper = mountCard({
      event: makeEvent(),
      disabled: true
    })
    const buttons = wrapper.findAll('.decision-button')
    buttons.forEach((b) => {
      expect(b.classes()).toContain('decision-button--disabled')
    })
  })

  it('未传 selectedOptionId 默认不选中（向后兼容）', () => {
    const wrapper = mountCard({ event: makeEvent() })
    const buttons = wrapper.findAll('.decision-button')
    buttons.forEach((b) => {
      expect(b.classes()).not.toContain('decision-button--selected')
    })
  })
})

// ====================== T4.1：剧情进度角标 + 剧情链名 ======================
describe('EventCard - T4.1 剧情角标与链名', () => {
  it('普通事件（无 chainProgress）不显示角标与链名', () => {
    const wrapper = mountCard({ event: makeEvent({ eventType: '民生' }) })
    expect(wrapper.find('.event-card__chain-badge').exists()).toBe(false)
    expect(wrapper.find('.event-card__chain-title').exists()).toBe(false)
  })

  it('剧情链事件携带 chainProgress 时右上角显示「剧情 X/Y」角标', () => {
    const wrapper = mountCard({
      event: makeEvent({
        chainId: 'tai-ping-tian-guo',
        chainNodeId: 'node-1',
        chainProgress: { current: 1, total: 5 }
      })
    })
    const badge = wrapper.find('.event-card__chain-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('剧情 1/5')
  })

  it('剧情链事件显示剧情链名（CHAIN_LABELS 映射）', () => {
    const wrapper = mountCard({
      event: makeEvent({
        chainId: 'tai-ping-tian-guo',
        chainProgress: { current: 2, total: 5 }
      })
    })
    const title = wrapper.find('.event-card__chain-title')
    expect(title.exists()).toBe(true)
    expect(title.text()).toBe('太平天国兴亡')
  })

  it('未知 chainId 时链名回退为 chainId 本身', () => {
    const wrapper = mountCard({
      event: makeEvent({
        chainId: 'unknown-chain',
        chainProgress: { current: 1, total: 2 }
      })
    })
    expect(wrapper.find('.event-card__chain-title').text()).toBe('unknown-chain')
  })

  it('角标与链名可同时存在（完整剧情事件）', () => {
    const wrapper = mountCard({
      event: makeEvent({
        chainId: 'jia-wu-zhan-zheng',
        chainNodeId: 'node-3',
        chainProgress: { current: 3, total: 3 }
      })
    })
    expect(wrapper.find('.event-card__chain-title').text()).toBe('甲午战争')
    expect(wrapper.find('.event-card__chain-badge').text()).toBe('剧情 3/3')
  })
})
