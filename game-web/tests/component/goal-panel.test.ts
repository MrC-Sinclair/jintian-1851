/**
 * @file GoalPanel.vue 组件渲染测试
 *
 * 覆盖 T1.5 验证要求：
 *   - 综合实力计算（复用 goal-hint.ts）
 *   - 进度条渲染（宽度 = overallPower%）
 *   - 90 阈值刻度存在
 *   - 折叠态/展开态切换
 *   - defaultExpanded prop 控制
 *   - 胜利状态（overallPower ≥ 90）颜色变化
 *   - InfoHint 渲染（展开态）
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GoalPanel from '../../src/components/GoalPanel.vue'
import type { Attributes } from '../../src/types/game'

const stubs = {
  view: 'div',
  text: 'span',
  // stub InfoHint 避免浮层逻辑干扰 GoalPanel 测试
  InfoHint: {
    name: 'InfoHint',
    template: '<div class="info-hint-stub" />'
  }
}

const defaultAttrs: Attributes = {
  military: 50,
  economy: 50,
  politics: 50,
  people: 50,
  diplomacy: 50
}

function mountPanel(attrs: Attributes = defaultAttrs, defaultExpanded = false) {
  return mount(GoalPanel, {
    props: { attributes: attrs, defaultExpanded },
    global: { stubs }
  })
}

describe('GoalPanel - 标题与折叠状态', () => {
  it('渲染标题"游戏目标"', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('.goal-panel__title').text()).toBe('游戏目标')
  })

  it('默认折叠（defaultExpanded=false）', () => {
    const wrapper = mountPanel(defaultAttrs, false)
    expect(wrapper.find('.goal-panel__expand').classes()).toContain('goal-panel__expand--collapsed')
    // 折叠态显示缩略进度条
    expect(wrapper.find('.goal-panel__brief').exists()).toBe(true)
  })

  it('defaultExpanded=true 时默认展开', () => {
    const wrapper = mountPanel(defaultAttrs, true)
    expect(wrapper.find('.goal-panel__expand').classes()).not.toContain('goal-panel__expand--collapsed')
    // 展开态不显示缩略进度条
    expect(wrapper.find('.goal-panel__brief').exists()).toBe(false)
  })

  it('点击标题栏切换折叠状态', async () => {
    const wrapper = mountPanel(defaultAttrs, false)
    expect(wrapper.find('.goal-panel__expand').classes()).toContain('goal-panel__expand--collapsed')
    await wrapper.find('.goal-panel__header').trigger('click')
    expect(wrapper.find('.goal-panel__expand').classes()).not.toContain('goal-panel__expand--collapsed')
    // 再次点击折叠
    await wrapper.find('.goal-panel__header').trigger('click')
    expect(wrapper.find('.goal-panel__expand').classes()).toContain('goal-panel__expand--collapsed')
  })

  it('展开图标随状态旋转', async () => {
    const wrapper = mountPanel(defaultAttrs, false)
    const icon = wrapper.find('.goal-panel__toggle-icon')
    expect(icon.classes()).not.toContain('goal-panel__toggle-icon--expanded')
    await wrapper.find('.goal-panel__header').trigger('click')
    expect(icon.classes()).toContain('goal-panel__toggle-icon--expanded')
  })
})

describe('GoalPanel - 综合实力计算', () => {
  it('全 50 时综合实力=50，进度条 50%', () => {
    const wrapper = mountPanel(defaultAttrs, true)
    const fill = wrapper.find('.goal-panel__bar-fill')
    expect(fill.attributes('style')).toContain('width: 50%')
  })

  it('全 90 时综合实力=90，进度条 90%，胜利态', () => {
    const attrs: Attributes = { military: 90, economy: 90, politics: 90, people: 90, diplomacy: 90 }
    const wrapper = mountPanel(attrs, true)
    const fill = wrapper.find('.goal-panel__bar-fill')
    expect(fill.attributes('style')).toContain('width: 90%')
    expect(fill.classes()).toContain('goal-panel__bar-fill--victory')
  })

  it('全 100 时综合实力=100，进度条 100%', () => {
    const attrs: Attributes = { military: 100, economy: 100, politics: 100, people: 100, diplomacy: 100 }
    const wrapper = mountPanel(attrs, true)
    const fill = wrapper.find('.goal-panel__bar-fill')
    expect(fill.attributes('style')).toContain('width: 100%')
  })

  it('非等权 (100,100,100,100,50) → 综合=90，胜利态', () => {
    const attrs: Attributes = { military: 100, economy: 100, politics: 100, people: 100, diplomacy: 50 }
    const wrapper = mountPanel(attrs, true)
    expect(wrapper.find('.goal-panel__bar-fill').classes()).toContain('goal-panel__bar-fill--victory')
  })

  it('综合实力<90 时不显示胜利态', () => {
    const attrs: Attributes = { military: 89, economy: 89, politics: 89, people: 89, diplomacy: 89 }
    const wrapper = mountPanel(attrs, true)
    expect(wrapper.find('.goal-panel__bar-fill').classes()).not.toContain('goal-panel__bar-fill--victory')
  })

  it('属性超过 100 时进度条 clamp 到 100%', () => {
    const attrs: Attributes = { military: 150, economy: 150, politics: 150, people: 150, diplomacy: 150 }
    const wrapper = mountPanel(attrs, true)
    expect(wrapper.find('.goal-panel__bar-fill').attributes('style')).toContain('width: 100%')
  })
})

describe('GoalPanel - 进度条阈值刻度', () => {
  it('展开态渲染 90 阈值刻度竖线', () => {
    const wrapper = mountPanel(defaultAttrs, true)
    expect(wrapper.find('.goal-panel__bar-threshold').exists()).toBe(true)
  })

  it('展开态渲染 90 阈值标签', () => {
    const wrapper = mountPanel(defaultAttrs, true)
    expect(wrapper.find('.goal-panel__bar-threshold-label').text()).toBe('90')
  })

  it('折叠态不渲染阈值刻度（缩略条无刻度）', () => {
    const wrapper = mountPanel(defaultAttrs, false)
    // 折叠态内容区 collapsed，但 DOM 仍存在（max-height:0）
    // 缩略进度条 .goal-panel__bar--brief 内无 threshold
    const briefBar = wrapper.find('.goal-panel__bar--brief')
    expect(briefBar.find('.goal-panel__bar-threshold').exists()).toBe(false)
  })
})

describe('GoalPanel - 展开态内容', () => {
  it('渲染长期目标段落', () => {
    const wrapper = mountPanel(defaultAttrs, true)
    const text = wrapper.text()
    expect(text).toContain('长期目标')
    expect(text).toContain('成就霸业')
    expect(text).toContain('1851-1912')
  })

  it('渲染胜利条件', () => {
    const wrapper = mountPanel(defaultAttrs, true)
    const text = wrapper.text()
    expect(text).toContain('胜利条件')
    expect(text).toContain('综合实力 ≥ 90')
  })

  it('渲染失败条件', () => {
    const wrapper = mountPanel(defaultAttrs, true)
    const text = wrapper.text()
    expect(text).toContain('失败条件')
    expect(text).toContain('任一属性 ≤ 0')
  })

  it('渲染 InfoHint 组件（综合实力解释）', () => {
    const wrapper = mountPanel(defaultAttrs, true)
    expect(wrapper.find('.info-hint-stub').exists()).toBe(true)
  })

  it('渲染综合实力当前值', () => {
    const wrapper = mountPanel(defaultAttrs, true)
    // 全 50 → 综合 50
    expect(wrapper.find('.goal-panel__power-value').text()).toBe('50')
  })

  it('综合实力≥90 时数值显示胜利色', () => {
    const attrs: Attributes = { military: 90, economy: 90, politics: 90, people: 90, diplomacy: 90 }
    const wrapper = mountPanel(attrs, true)
    expect(wrapper.find('.goal-panel__power-value').classes()).toContain('goal-panel__power-value--victory')
  })
})

describe('GoalPanel - 折叠态缩略', () => {
  it('折叠态显示缩略进度条与数值', () => {
    const wrapper = mountPanel(defaultAttrs, false)
    expect(wrapper.find('.goal-panel__brief').exists()).toBe(true)
    expect(wrapper.find('.goal-panel__brief-value').text()).toBe('50/100')
  })

  it('折叠态综合实力≥90 时数值显示胜利色', () => {
    const attrs: Attributes = { military: 90, economy: 90, politics: 90, people: 90, diplomacy: 90 }
    const wrapper = mountPanel(attrs, false)
    expect(wrapper.find('.goal-panel__brief-value').classes()).toContain('goal-panel__brief-value--victory')
  })
})
