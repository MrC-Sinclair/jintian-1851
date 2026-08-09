/**
 * @file FactionCard.vue 组件渲染测试
 *
 * 覆盖：
 *   - props 传递（faction.name/summary/power/relationship、selected）
 *   - 关系文案与颜色类映射（盟友/友好/中立/紧张/敌对）
 *   - 属性条宽度 clampPercent
 *   - 事件触发（点击 → select）
 *   - InfoHint 渲染（势力名称旁 1 个，解释"势力关系"概念）
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FactionCard from '../../src/components/FactionCard.vue'
import type { Faction } from '../../src/types/game'

// uni-app 平台组件 stub：view→div、text→span；InfoHint stub 渲染占位 div
const stubs = {
  view: 'div',
  text: 'span',
  InfoHint: {
    name: 'InfoHint',
    template: '<div class="info-hint-stub" />'
  }
}

function makeFaction(overrides: Partial<Faction> = {}): Pick<
  Faction,
  'name' | 'summary' | 'power' | 'relationship'
> {
  return {
    name: '清廷',
    summary: '晚清朝廷',
    power: 70,
    relationship: 0,
    ...overrides
  }
}

function mountCard(props: Record<string, unknown>) {
  return mount(FactionCard, {
    props,
    global: { stubs }
  })
}

describe('FactionCard - props 传递', () => {
  it('渲染势力名称与摘要', () => {
    const wrapper = mountCard({
      faction: makeFaction({ name: '太平天国', summary: '南方起义军' })
    })
    expect(wrapper.text()).toContain('太平天国')
    expect(wrapper.text()).toContain('南方起义军')
  })

  it('渲染 power 数值', () => {
    const wrapper = mountCard({ faction: makeFaction({ power: 42 }) })
    expect(wrapper.text()).toContain('42')
  })
})

describe('FactionCard - selected 状态', () => {
  it('selected=true 时显示「已选」徽章与 --selected 类', () => {
    const wrapper = mountCard({ faction: makeFaction(), selected: true })
    const root = wrapper.find('.faction-card')
    expect(root.classes()).toContain('faction-card--selected')
    expect(wrapper.find('.faction-card__badge').exists()).toBe(true)
    expect(wrapper.text()).toContain('已选')
  })

  it('selected=false 时不显示徽章', () => {
    const wrapper = mountCard({ faction: makeFaction(), selected: false })
    expect(wrapper.find('.faction-card__badge').exists()).toBe(false)
    expect(wrapper.find('.faction-card').classes()).not.toContain(
      'faction-card--selected'
    )
  })

  it('selected 缺省时按 false 处理', () => {
    const wrapper = mountCard({ faction: makeFaction() })
    expect(wrapper.find('.faction-card__badge').exists()).toBe(false)
  })
})

describe('FactionCard - 关系文案与颜色类', () => {
  it('relationship > 50 → 盟友 + positive 类', () => {
    const wrapper = mountCard({ faction: makeFaction({ relationship: 80 }) })
    expect(wrapper.text()).toContain('盟友 +80')
    // 注意：模板中「实力」与「关系」都用 .faction-card__bar-value，
    // 直接断言 positive 类元素存在即可
    expect(wrapper.find('.faction-card__bar-value--positive').exists()).toBe(true)
    expect(wrapper.find('.faction-card__bar-fill--positive').exists()).toBe(true)
  })

  it('0 < relationship <= 50 → 友好 + positive 类', () => {
    const wrapper = mountCard({ faction: makeFaction({ relationship: 30 }) })
    expect(wrapper.text()).toContain('友好 +30')
    expect(wrapper.find('.faction-card__bar-value--positive').exists()).toBe(true)
  })

  it('relationship = 0 → 中立 + neutral 填充类', () => {
    const wrapper = mountCard({ faction: makeFaction({ relationship: 0 }) })
    expect(wrapper.text()).toContain('中立')
    // 中立时 value 不加颜色类
    const value = wrapper.find('.faction-card__bar-value')
    expect(value.classes()).not.toContain('faction-card__bar-value--positive')
    expect(value.classes()).not.toContain('faction-card__bar-value--negative')
    expect(wrapper.find('.faction-card__bar-fill--neutral').exists()).toBe(true)
  })

  it('-50 < relationship < 0 → 紧张 + negative 类', () => {
    const wrapper = mountCard({ faction: makeFaction({ relationship: -30 }) })
    expect(wrapper.text()).toContain('紧张 -30')
    expect(wrapper.find('.faction-card__bar-value--negative').exists()).toBe(true)
    expect(wrapper.find('.faction-card__bar-fill--negative').exists()).toBe(true)
  })

  it('relationship <= -50 → 敌对 + negative 类', () => {
    const wrapper = mountCard({ faction: makeFaction({ relationship: -80 }) })
    expect(wrapper.text()).toContain('敌对 -80')
    expect(wrapper.find('.faction-card__bar-value--negative').exists()).toBe(true)
  })
})

describe('FactionCard - 属性条宽度 clamp', () => {
  it('power 超过 100 时宽度 clamp 到 100%', () => {
    const wrapper = mountCard({ faction: makeFaction({ power: 150 }) })
    const fill = wrapper.find('.faction-card__bar-fill--power')
    expect(fill.attributes('style')).toContain('width: 100%')
  })

  it('power 为负时宽度 clamp 到 0%', () => {
    const wrapper = mountCard({ faction: makeFaction({ power: -20 }) })
    const fill = wrapper.find('.faction-card__bar-fill--power')
    expect(fill.attributes('style')).toContain('width: 0%')
  })

  it('relationship=-100 → relationshipPercent 0%', () => {
    const wrapper = mountCard({ faction: makeFaction({ relationship: -100 }) })
    const track = wrapper.find('.faction-card__bar-track--relationship')
    const fill = track.find('.faction-card__bar-fill')
    expect(fill.attributes('style')).toContain('width: 0%')
  })

  it('relationship=100 → relationshipPercent 100%', () => {
    const wrapper = mountCard({ faction: makeFaction({ relationship: 100 }) })
    const track = wrapper.find('.faction-card__bar-track--relationship')
    const fill = track.find('.faction-card__bar-fill')
    expect(fill.attributes('style')).toContain('width: 100%')
  })
})

describe('FactionCard - 事件触发', () => {
  it('点击卡片触发 select 事件', async () => {
    const wrapper = mountCard({ faction: makeFaction() })
    await wrapper.find('.faction-card').trigger('click')
    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')).toHaveLength(1)
  })
})

describe('FactionCard - InfoHint 渲染', () => {
  it('势力名称旁渲染 1 个 InfoHint', () => {
    const wrapper = mountCard({ faction: makeFaction() })
    const nameWrap = wrapper.find('.faction-card__name-wrap')
    expect(nameWrap.exists()).toBe(true)
    expect(nameWrap.findAll('.info-hint-stub')).toHaveLength(1)
  })

  it('InfoHint 总数为 1（每张卡片仅名称旁 1 个）', () => {
    const wrapper = mountCard({ faction: makeFaction() })
    expect(wrapper.findAll('.info-hint-stub')).toHaveLength(1)
  })

  it('selected 状态下 InfoHint 仍然渲染', () => {
    const wrapper = mountCard({ faction: makeFaction(), selected: true })
    expect(wrapper.findAll('.info-hint-stub')).toHaveLength(1)
  })
})

/**
 * 回归测试：FactionCard + 真实 InfoHint 端到端集成
 *
 * 覆盖用户实际场景：势力选择页点 InfoHint 问号打开浮层后，
 * 点击浮层遮罩（modal 外）必须只关闭浮层，**不能**冒泡触发 FactionCard 的 select 事件。
 *
 * 历史 bug：势力选择页点击问号显示悬浮框后，点击下方势力卡仍能触发确认势力框。
 * 根因：InfoHint overlay 的 @click.self 不会 stopPropagation，且 uni-app H5 端
 * click 事件 target/currentTarget 是 undefined，.self 修饰符失效。
 * 修复：onOverlayClick 显式 e.stopPropagation() + close()。
 */
describe('FactionCard + InfoHint 集成 - 遮罩点击不触发 select（防穿透 bug 回归）', () => {
  function mountReal() {
    return mount(FactionCard, {
      props: { faction: makeFaction(), selected: false },
      // 真实挂载 InfoHint（不 stub），view/text 仍 stub 以适配 @vue/test-utils
      global: { stubs: { view: 'div', text: 'span' } }
    })
  }

  it('点击问号打开浮层，select 事件未触发', async () => {
    const wrapper = mountReal()
    await wrapper.find('.info-hint__icon').trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)
    expect(wrapper.emitted('select')).toBeFalsy()
  })

  it('点击浮层遮罩关闭浮层，select 事件未触发（关键回归）', async () => {
    const wrapper = mountReal()
    // 1. 打开浮层
    await wrapper.find('.info-hint__icon').trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)
    // 2. 点击遮罩（modal 外）
    await wrapper.find('.info-hint__overlay').trigger('click')
    // 3. 浮层已关闭
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(false)
    // 4. 关键断言：FactionCard 的 select 事件未触发
    expect(wrapper.emitted('select')).toBeFalsy()
  })

  it('点击浮层 modal 内部不关闭浮层，select 事件未触发', async () => {
    const wrapper = mountReal()
    await wrapper.find('.info-hint__icon').trigger('click')
    await wrapper.find('.info-hint__modal').trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)
    expect(wrapper.emitted('select')).toBeFalsy()
  })

  it('点击关闭按钮关闭浮层，select 事件未触发', async () => {
    const wrapper = mountReal()
    await wrapper.find('.info-hint__icon').trigger('click')
    await wrapper.find('.info-hint__close').trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(false)
    expect(wrapper.emitted('select')).toBeFalsy()
  })

  it('点击卡片非 InfoHint 区域正常触发 select', async () => {
    const wrapper = mountReal()
    // 直接点击 faction-card 根元素
    await wrapper.find('.faction-card').trigger('click')
    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')).toHaveLength(1)
  })
})
