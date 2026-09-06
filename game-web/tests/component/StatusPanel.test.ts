/**
 * @file StatusPanel.vue 组件渲染测试
 *
 * 覆盖：
 *   - props 传递（attributes 五维、resources 四项）
 *   - 数值格式化（千分位 formatNumber）
 *   - 属性条颜色类（high/mid/low）
 *   - 属性值颜色类
 *   - 属性条宽度（clampPercent）
 *   - InfoHint 渲染（5 维属性 + 4 资源）
 *   - 危机预警图标（属性 < 30 时显示）
 *
 * 注意：P0-2 后综合实力模块已迁移至 FocusPanel，本组件不再渲染综合实力，
 * 对应断言（power-fill / power-value / 阈值刻度 / 胜利态）已随模块移除。
 *
 * 注意：组件 watch 内部用 setInterval/setTimeout 触发数字动画，
 * 初始挂载不触发 watch（非 immediate），因此本测试只验证初始渲染，
 * 避免引入定时器清理负担。每次测试后清理定时器防止泄漏。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusPanel from '../../src/components/StatusPanel.vue'
import type { Attributes, Resources } from '../../src/types/game'

const stubs = {
  view: 'div',
  text: 'span',
  // InfoHint stub：渲染占位 div，便于统计数量
  InfoHint: {
    name: 'InfoHint',
    template: '<div class="info-hint-stub" />'
  }
}

const defaultAttributes: Attributes = {
  military: 50,
  economy: 50,
  politics: 50,
  people: 50,
  diplomacy: 50
}

const defaultResources: Resources = {
  silver: 800,
  troops: 500,
  food: 600,
  reputation: 10
}

function mountPanel(
  attrs: Attributes = defaultAttributes,
  res: Resources = defaultResources
) {
  return mount(StatusPanel, {
    props: { attributes: attrs, resources: res },
    global: { stubs }
  })
}

// 清理可能残留的定时器（watch deep 比较时可能创建）
afterEach(() => {
  vi.clearAllTimers()
})

describe('StatusPanel - props 传递与初始渲染', () => {
  it('渲染五维属性标签', () => {
    const wrapper = mountPanel()
    const text = wrapper.text()
    expect(text).toContain('军事')
    expect(text).toContain('经济')
    expect(text).toContain('政治')
    expect(text).toContain('民心')
    expect(text).toContain('外交')
  })

  it('渲染资源标签', () => {
    const wrapper = mountPanel()
    const text = wrapper.text()
    expect(text).toContain('银两')
    expect(text).toContain('兵员')
    expect(text).toContain('粮草')
    expect(text).toContain('名望')
  })

  it('渲染初始属性值（初始动画 from===to 直接赋值）', () => {
    const wrapper = mountPanel({ ...defaultAttributes, military: 42 })
    // 同一值无动画，直接显示
    expect(wrapper.text()).toContain('42')
  })

  it('渲染初始资源值', () => {
    const wrapper = mountPanel(defaultAttributes, {
      ...defaultResources,
      reputation: 25
    })
    expect(wrapper.text()).toContain('25')
  })

  it('渲染分区标题「五维属性」与「资源」', () => {
    const wrapper = mountPanel()
    const titles = wrapper.findAll('.status-panel__section-title')
    // P0-2 后综合实力模块已迁移至 FocusPanel，此处仅 2 个分区
    expect(titles).toHaveLength(2)
    expect(titles[0].text()).toBe('五维属性')
    expect(titles[1].text()).toBe('资源')
  })
})

describe('StatusPanel - 数值格式化（formatNumber）', () => {
  it('资源值 ≥ 1000 显示千分位', () => {
    const wrapper = mountPanel(defaultAttributes, {
      silver: 12345,
      troops: 600,
      food: 700,
      reputation: 5
    })
    expect(wrapper.text()).toContain('12,345')
  })

  it('资源值 < 1000 直接显示原值', () => {
    const wrapper = mountPanel(defaultAttributes, {
      silver: 999,
      troops: 100,
      food: 200,
      reputation: 3
    })
    expect(wrapper.text()).toContain('999')
    expect(wrapper.text()).not.toContain('999,')
  })

  it('资源值正好 1000 显示千分位', () => {
    const wrapper = mountPanel(defaultAttributes, {
      silver: 1000,
      troops: 100,
      food: 200,
      reputation: 3
    })
    expect(wrapper.text()).toContain('1,000')
  })
})

describe('StatusPanel - 属性条颜色类（barColorClass）', () => {
  it('属性值 ≥ 70 → high 类', () => {
    const wrapper = mountPanel({ ...defaultAttributes, military: 75 })
    const fill = wrapper.find('.status-panel__bar-fill')
    expect(fill.classes()).toContain('status-panel__bar-fill--high')
  })

  it('属性值 < 30 → low 类', () => {
    const wrapper = mountPanel({ ...defaultAttributes, military: 20 })
    const fill = wrapper.find('.status-panel__bar-fill')
    expect(fill.classes()).toContain('status-panel__bar-fill--low')
  })

  it('30 ≤ 属性值 < 70 → mid 类', () => {
    const wrapper = mountPanel({ ...defaultAttributes, military: 50 })
    const fill = wrapper.find('.status-panel__bar-fill')
    expect(fill.classes()).toContain('status-panel__bar-fill--mid')
  })
})

describe('StatusPanel - 属性值颜色类（valueColorClass）', () => {
  it('属性值 ≥ 70 → value--high', () => {
    const wrapper = mountPanel({ ...defaultAttributes, economy: 80 })
    const value = wrapper.findAll('.status-panel__value')
    const economyValue = value.find((v) => v.text() === '80')
    expect(economyValue?.classes()).toContain('status-panel__value--high')
  })

  it('属性值 < 30 → value--low', () => {
    const wrapper = mountPanel({ ...defaultAttributes, economy: 25 })
    const value = wrapper.findAll('.status-panel__value')
    const economyValue = value.find((v) => v.text() === '25')
    expect(economyValue?.classes()).toContain('status-panel__value--low')
  })
})

describe('StatusPanel - 属性条宽度（clampPercent）', () => {
  it('属性值 50 → 50% 宽度', () => {
    const wrapper = mountPanel({ ...defaultAttributes, military: 50 })
    const fill = wrapper.find('.status-panel__bar-fill')
    expect(fill.attributes('style')).toContain('width: 50%')
  })

  it('属性值 > 100 → clamp 到 100%', () => {
    const wrapper = mountPanel({ ...defaultAttributes, military: 150 })
    const fill = wrapper.find('.status-panel__bar-fill')
    expect(fill.attributes('style')).toContain('width: 100%')
  })

  it('属性值 < 0 → clamp 到 0%', () => {
    const wrapper = mountPanel({ ...defaultAttributes, military: -10 })
    const fill = wrapper.find('.status-panel__bar-fill')
    expect(fill.attributes('style')).toContain('width: 0%')
  })
})

describe('StatusPanel - InfoHint 渲染', () => {
  it('5 维属性各渲染 1 个 InfoHint（共 5 个）', () => {
    const wrapper = mountPanel()
    // P0-2 后综合实力 InfoHint 已随模块迁至 FocusPanel，总数 = 属性 5 + 资源 4 = 9
    expect(wrapper.findAll('.info-hint-stub')).toHaveLength(9)
  })

  it('4 资源各渲染 1 个 InfoHint', () => {
    const wrapper = mountPanel()
    const resources = wrapper.findAll('.status-panel__resource')
    expect(resources).toHaveLength(4)
    // 每个资源项内有 1 个 InfoHint stub
    for (const res of resources) {
      expect(res.findAll('.info-hint-stub')).toHaveLength(1)
    }
  })
})

describe('StatusPanel - 危机预警图标', () => {
  it('属性 < 30 时渲染警告图标', () => {
    const wrapper = mountPanel({ ...defaultAttributes, military: 20 })
    expect(wrapper.find('.status-panel__warning-icon').exists()).toBe(true)
  })

  it('属性 ≥ 30 时不渲染警告图标', () => {
    const wrapper = mountPanel(defaultAttributes)
    expect(wrapper.find('.status-panel__warning-icon').exists()).toBe(false)
  })

  it('多个属性 < 30 时渲染多个警告图标', () => {
    const attrs: Attributes = { military: 20, economy: 25, politics: 50, people: 50, diplomacy: 50 }
    const wrapper = mountPanel(attrs)
    expect(wrapper.findAll('.status-panel__warning-icon')).toHaveLength(2)
  })

  it('属性正好 30 时不渲染警告图标（边界）', () => {
    const wrapper = mountPanel({ ...defaultAttributes, military: 30 })
    expect(wrapper.find('.status-panel__warning-icon').exists()).toBe(false)
  })

  it('属性正好 29 时渲染警告图标（边界）', () => {
    const wrapper = mountPanel({ ...defaultAttributes, military: 29 })
    expect(wrapper.find('.status-panel__warning-icon').exists()).toBe(true)
  })
})
