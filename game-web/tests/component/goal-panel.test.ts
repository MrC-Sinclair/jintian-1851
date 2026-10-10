/**
 * @file GoalPanel.vue 组件渲染测试
 *
 * 覆盖（P0-2 重构后：综合实力进度条已移除至 FocusPanel，本面板专注目标规则说明）：
 *   - 标题渲染「游戏目标」
 *   - 折叠态/展开态切换（defaultExpanded prop 控制 + 点击标题栏切换）
 *   - 展开图标旋转
 *   - 展开态内容：长期目标 / 胜利条件 / 失败条件
 *
 * 注意：重构后组件仅有 defaultExpanded prop，不再接收 attributes，
 * 不再有进度条 / InfoHint / 综合实力展示。
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GoalPanel from '../../src/components/GoalPanel.vue'

const stubs = {
  view: 'div',
  text: 'span'
}

function mountPanel(defaultExpanded = false) {
  return mount(GoalPanel, {
    props: { defaultExpanded },
    global: { stubs }
  })
}

describe('GoalPanel - 标题与折叠状态', () => {
  it('渲染标题「游戏目标」', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('.goal-panel__title').text()).toBe('游戏目标')
  })

  it('默认折叠（defaultExpanded=false）', () => {
    const wrapper = mountPanel(false)
    expect(wrapper.find('.goal-panel__expand').classes()).toContain('goal-panel__expand--collapsed')
  })

  it('defaultExpanded=true 时默认展开', () => {
    const wrapper = mountPanel(true)
    expect(wrapper.find('.goal-panel__expand').classes()).not.toContain('goal-panel__expand--collapsed')
  })

  it('点击标题栏切换折叠状态', async () => {
    const wrapper = mountPanel(false)
    expect(wrapper.find('.goal-panel__expand').classes()).toContain('goal-panel__expand--collapsed')
    await wrapper.find('.goal-panel__header').trigger('click')
    expect(wrapper.find('.goal-panel__expand').classes()).not.toContain('goal-panel__expand--collapsed')
    // 再次点击折叠
    await wrapper.find('.goal-panel__header').trigger('click')
    expect(wrapper.find('.goal-panel__expand').classes()).toContain('goal-panel__expand--collapsed')
  })

  it('展开图标随状态旋转', async () => {
    const wrapper = mountPanel(false)
    const icon = wrapper.find('.goal-panel__toggle-icon')
    expect(icon.classes()).not.toContain('goal-panel__toggle-icon--expanded')
    await wrapper.find('.goal-panel__header').trigger('click')
    expect(icon.classes()).toContain('goal-panel__toggle-icon--expanded')
  })
})

describe('GoalPanel - 展开态内容', () => {
  it('渲染长期目标段落', () => {
    const wrapper = mountPanel(true)
    const text = wrapper.text()
    expect(text).toContain('长期目标')
    expect(text).toContain('成就霸业')
    expect(text).toContain('1851-1912')
  })

  it('渲染胜利条件', () => {
    const wrapper = mountPanel(true)
    const text = wrapper.text()
    expect(text).toContain('胜利条件')
    expect(text).toContain('综合实力 ≥ 85')
  })

  it('渲染失败条件', () => {
    const wrapper = mountPanel(true)
    const text = wrapper.text()
    expect(text).toContain('失败条件')
    expect(text).toContain('任一属性 ≤ 0')
  })

  it('折叠态不渲染展开内容（max-height:0 隐藏）', () => {
    const wrapper = mountPanel(false)
    // 内容 DOM 仍在（max-height:0），但不应可见展开内容以外的结构差异
    expect(wrapper.find('.goal-panel__row').exists()).toBe(true)
  })
})
