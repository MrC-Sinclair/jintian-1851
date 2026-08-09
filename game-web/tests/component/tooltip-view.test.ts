/**
 * @file TooltipView.vue 组件渲染测试
 *
 * 覆盖三端通用 tooltip 组件的核心交互：
 *   - 初始状态浮层不显示
 *   - H5 端 mouseenter 显示 / mouseleave 隐藏
 *   - 触摸端 longpress 显示 + 3 秒自动隐藏
 *   - content 为空时不显示
 *   - placement 控制浮层位置类名
 *   - 插槽内容渲染
 *   - 组件卸载时清理定时器
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import TooltipView from '../../src/components/TooltipView.vue'

const stubs = {
  view: 'div',
  text: 'span'
}

function mountTooltip(content = '同步存档', placement: 'top' | 'bottom' = 'top') {
  return mount(TooltipView, {
    props: { content, placement },
    slots: {
      default: '<button class="trigger-btn">按钮</button>'
    },
    global: { stubs }
  })
}

describe('TooltipView - 初始渲染', () => {
  it('渲染插槽内容（触发按钮）', () => {
    const wrapper = mountTooltip()
    expect(wrapper.find('.trigger-btn').exists()).toBe(true)
  })

  it('初始状态浮层不显示', () => {
    const wrapper = mountTooltip()
    expect(wrapper.find('.tooltip-view__bubble').exists()).toBe(false)
  })

  it('渲染 trigger 容器', () => {
    const wrapper = mountTooltip()
    expect(wrapper.find('.tooltip-view__trigger').exists()).toBe(true)
  })
})

describe('TooltipView - H5 端 hover 交互', () => {
  it('mouseenter 显示浮层', async () => {
    const wrapper = mountTooltip()
    await wrapper.find('.tooltip-view__trigger').trigger('mouseenter')
    expect(wrapper.find('.tooltip-view__bubble').exists()).toBe(true)
  })

  it('mouseleave 隐藏浮层', async () => {
    const wrapper = mountTooltip()
    const trigger = wrapper.find('.tooltip-view__trigger')
    await trigger.trigger('mouseenter')
    expect(wrapper.find('.tooltip-view__bubble').exists()).toBe(true)
    await trigger.trigger('mouseleave')
    expect(wrapper.find('.tooltip-view__bubble').exists()).toBe(false)
  })

  it('hover 时不启动自动隐藏（持续显示）', async () => {
    vi.useFakeTimers()
    const wrapper = mountTooltip()
    await wrapper.find('.tooltip-view__trigger').trigger('mouseenter')
    // 推进 5 秒，浮层仍显示（hover 模式不自动隐藏）
    vi.advanceTimersByTime(5000)
    expect(wrapper.find('.tooltip-view__bubble').exists()).toBe(true)
    vi.useRealTimers()
  })
})

describe('TooltipView - 触摸端 longpress 交互', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('longpress 显示浮层', async () => {
    const wrapper = mountTooltip()
    await wrapper.find('.tooltip-view__trigger').trigger('longpress')
    expect(wrapper.find('.tooltip-view__bubble').exists()).toBe(true)
  })

  it('longpress 后 3 秒自动隐藏', async () => {
    const wrapper = mountTooltip()
    await wrapper.find('.tooltip-view__trigger').trigger('longpress')
    expect(wrapper.find('.tooltip-view__bubble').exists()).toBe(true)
    // 推进 2.9 秒，仍显示
    vi.advanceTimersByTime(2900)
    await nextTick()
    expect(wrapper.find('.tooltip-view__bubble').exists()).toBe(true)
    // 推进到 3 秒，自动隐藏
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(wrapper.find('.tooltip-view__bubble').exists()).toBe(false)
  })

  it('longpress 触发后浮层显示（标志位间接验证）', async () => {
    const wrapper = mountTooltip()
    await wrapper.find('.tooltip-view__trigger').trigger('longpress')
    // 标志位为内部状态，通过行为间接验证：浮层已显示
    expect(wrapper.find('.tooltip-view__bubble').exists()).toBe(true)
  })
})

describe('TooltipView - 浮层内容与定位', () => {
  it('浮层渲染 content 文本', async () => {
    const wrapper = mountTooltip('军师对话')
    await wrapper.find('.tooltip-view__trigger').trigger('mouseenter')
    expect(wrapper.find('.tooltip-view__text').text()).toBe('军师对话')
  })

  it('placement=top 时浮层带 --top 类名', async () => {
    const wrapper = mountTooltip('提示', 'top')
    await wrapper.find('.tooltip-view__trigger').trigger('mouseenter')
    expect(wrapper.find('.tooltip-view__bubble').classes()).toContain('tooltip-view__bubble--top')
  })

  it('placement=bottom 时浮层带 --bottom 类名', async () => {
    const wrapper = mountTooltip('提示', 'bottom')
    await wrapper.find('.tooltip-view__trigger').trigger('mouseenter')
    expect(wrapper.find('.tooltip-view__bubble').classes()).toContain('tooltip-view__bubble--bottom')
  })

  it('不同 content 渲染不同文本', async () => {
    const wrapper = mountTooltip('返回')
    await wrapper.find('.tooltip-view__trigger').trigger('mouseenter')
    expect(wrapper.find('.tooltip-view__text').text()).toBe('返回')
  })
})

describe('TooltipView - 边界条件', () => {
  it('content 为空时 hover 不显示浮层', async () => {
    const wrapper = mountTooltip('')
    await wrapper.find('.tooltip-view__trigger').trigger('mouseenter')
    expect(wrapper.find('.tooltip-view__bubble').exists()).toBe(false)
  })

  it('content 为空时 longpress 不显示浮层', async () => {
    vi.useFakeTimers()
    const wrapper = mountTooltip('')
    await wrapper.find('.tooltip-view__trigger').trigger('longpress')
    expect(wrapper.find('.tooltip-view__bubble').exists()).toBe(false)
    vi.useRealTimers()
  })

  it('重复 longpress 重置自动隐藏定时器', async () => {
    vi.useFakeTimers()
    const wrapper = mountTooltip('提示')
    const trigger = wrapper.find('.tooltip-view__trigger')
    await trigger.trigger('longpress')
    // 推进 2 秒（接近 3 秒自动隐藏）
    vi.advanceTimersByTime(2000)
    await nextTick()
    // 再次 longpress，重置定时器
    await trigger.trigger('longpress')
    // 再推进 2.9 秒（从第二次 longpress 起算），仍应显示
    vi.advanceTimersByTime(2900)
    await nextTick()
    expect(wrapper.find('.tooltip-view__bubble').exists()).toBe(true)
    // 推进到 3 秒，自动隐藏
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(wrapper.find('.tooltip-view__bubble').exists()).toBe(false)
    vi.useRealTimers()
  })
})

describe('TooltipView - 组件卸载', () => {
  it('卸载时不抛错（清理定时器）', async () => {
    vi.useFakeTimers()
    const wrapper = mountTooltip('提示')
    await wrapper.find('.tooltip-view__trigger').trigger('longpress')
    // 卸载（内部 onUnmounted 应清理 autoHideTimer）
    expect(() => wrapper.unmount()).not.toThrow()
    vi.useRealTimers()
  })
})
