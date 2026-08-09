/**
 * @file DecisionButton.vue 组件渲染测试
 *
 * 覆盖：
 *   - props 传递（label、effects、disabled、loading、selected）
 *   - 事件触发（click、select）
 *   - disabled/loading 状态下不触发 click/select
 *   - loading 显示 spinner
 *   - effects 渲染（正负号 + 颜色类）
 *   - effects 全为 0 / 缺省 → 不渲染 effects 区
 *   - T3.1：选中态样式 + 勾选标记 + select 事件
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DecisionButton from '../../src/components/DecisionButton.vue'

const stubs = {
  view: 'div',
  text: 'span'
}

function mountButton(props: Record<string, unknown>) {
  return mount(DecisionButton, {
    props,
    global: { stubs }
  })
}

describe('DecisionButton - props 传递', () => {
  it('渲染 label', () => {
    const wrapper = mountButton({ label: '出兵征讨' })
    expect(wrapper.find('.decision-button__label').text()).toBe('出兵征讨')
  })
})

describe('DecisionButton - 事件触发', () => {
  it('点击触发 click 事件', async () => {
    const wrapper = mountButton({ label: '选项' })
    await wrapper.find('.decision-button').trigger('click')
    expect(wrapper.emitted('click')).toBeTruthy()
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('T3.1：点击同时触发 select 事件', async () => {
    const wrapper = mountButton({ label: '选项' })
    await wrapper.find('.decision-button').trigger('click')
    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')).toHaveLength(1)
  })

  it('disabled=true 时不触发 click + 加 --disabled 类', async () => {
    const wrapper = mountButton({ label: '选项', disabled: true })
    const root = wrapper.find('.decision-button')
    expect(root.classes()).toContain('decision-button--disabled')
    await root.trigger('click')
    expect(wrapper.emitted('click')).toBeFalsy()
    expect(wrapper.emitted('select')).toBeFalsy()
  })

  it('loading=true 时不触发 click + 加 --loading 类', async () => {
    const wrapper = mountButton({ label: '选项', loading: true })
    const root = wrapper.find('.decision-button')
    expect(root.classes()).toContain('decision-button--loading')
    await root.trigger('click')
    expect(wrapper.emitted('click')).toBeFalsy()
    expect(wrapper.emitted('select')).toBeFalsy()
  })

  it('disabled + loading 同时为 true 时不触发 click', async () => {
    const wrapper = mountButton({ label: '选项', disabled: true, loading: true })
    await wrapper.find('.decision-button').trigger('click')
    expect(wrapper.emitted('click')).toBeFalsy()
    expect(wrapper.emitted('select')).toBeFalsy()
  })
})

describe('DecisionButton - loading spinner', () => {
  it('loading=true 时显示 spinner', () => {
    const wrapper = mountButton({ label: '选项', loading: true })
    expect(wrapper.find('.decision-button__spinner').exists()).toBe(true)
    expect(wrapper.find('.decision-button__spinner-dot').exists()).toBe(true)
  })

  it('loading=false 时不显示 spinner', () => {
    const wrapper = mountButton({ label: '选项', loading: false })
    expect(wrapper.find('.decision-button__spinner').exists()).toBe(false)
  })
})

describe('DecisionButton - effects 渲染', () => {
  it('正值 effects 显示 +号 与 positive 类（T2.4 完整词）', () => {
    const wrapper = mountButton({
      label: '选项',
      effects: { military: 10, silver: 200 }
    })
    const effects = wrapper.findAll('.decision-button__effect')
    expect(effects).toHaveLength(2)
    // T2.4：完整词"军事+10"而非单字"军+10"
    expect(wrapper.text()).toContain('军事+10')
    expect(wrapper.text()).toContain('银两+200')
    expect(wrapper.text()).not.toContain('军+10')
    expect(wrapper.text()).not.toContain('银+200')
    effects.forEach((e) => {
      expect(e.classes()).toContain('decision-button__effect--positive')
    })
  })

  it('负值 effects 显示 原值 与 negative 类（T2.4 完整词）', () => {
    const wrapper = mountButton({
      label: '选项',
      effects: { military: -5, troops: -100 }
    })
    const effects = wrapper.findAll('.decision-button__effect')
    expect(effects).toHaveLength(2)
    // T2.4：完整词"军事-5"而非单字"军-5"
    expect(wrapper.text()).toContain('军事-5')
    expect(wrapper.text()).toContain('兵员-100')
    expect(wrapper.text()).not.toContain('军-5')
    expect(wrapper.text()).not.toContain('兵-100')
    effects.forEach((e) => {
      expect(e.classes()).toContain('decision-button__effect--negative')
    })
  })

  it('正负值混合 effects 都渲染', () => {
    const wrapper = mountButton({
      label: '选项',
      effects: { military: 5, economy: -3 }
    })
    const effects = wrapper.findAll('.decision-button__effect')
    expect(effects).toHaveLength(2)
    const pos = effects.find((e) => e.text().includes('+'))
    const neg = effects.find((e) => e.text().includes('-'))
    expect(pos?.classes()).toContain('decision-button__effect--positive')
    expect(neg?.classes()).toContain('decision-button__effect--negative')
  })

  it('effects 全部为 0 → 不渲染 effects 区', () => {
    const wrapper = mountButton({
      label: '选项',
      effects: { military: 0, silver: 0 }
    })
    expect(wrapper.find('.decision-button__effects').exists()).toBe(false)
  })

  it('未传 effects → 不渲染 effects 区', () => {
    const wrapper = mountButton({ label: '选项' })
    expect(wrapper.find('.decision-button__effects').exists()).toBe(false)
  })

  it('effects 含非数字值 → 跳过非数字项', () => {
    const wrapper = mountButton({
      label: '选项',
      effects: { military: 5, silver: 'NaN' as unknown as number }
    })
    const effects = wrapper.findAll('.decision-button__effect')
    expect(effects).toHaveLength(1)
    expect(wrapper.text()).toContain('军事+5')
  })
})

// ====================== T3.1：选中态 ======================
describe('DecisionButton - T3.1 选中态', () => {
  it('selected=true 时加 --selected 类', () => {
    const wrapper = mountButton({ label: '选项', selected: true })
    expect(wrapper.find('.decision-button').classes()).toContain('decision-button--selected')
  })

  it('selected=false（默认）时不加 --selected 类', () => {
    const wrapper = mountButton({ label: '选项' })
    expect(wrapper.find('.decision-button').classes()).not.toContain('decision-button--selected')
  })

  it('selected=true 时显示右上角勾选标记', () => {
    const wrapper = mountButton({ label: '选项', selected: true })
    expect(wrapper.find('.decision-button__check').exists()).toBe(true)
  })

  it('selected=false 时不显示勾选标记', () => {
    const wrapper = mountButton({ label: '选项', selected: false })
    expect(wrapper.find('.decision-button__check').exists()).toBe(false)
  })

  it('选中态 + disabled 仍可显示选中样式（视觉反馈）', () => {
    const wrapper = mountButton({ label: '选项', selected: true, disabled: true })
    const root = wrapper.find('.decision-button')
    expect(root.classes()).toContain('decision-button--selected')
    expect(root.classes()).toContain('decision-button--disabled')
  })
})
