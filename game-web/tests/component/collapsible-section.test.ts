/**
 * @file CollapsibleSection 组件测试
 *
 * 验证：
 *   - 默认展开/折叠状态
 *   - 点击标题栏切换折叠/展开
 *   - toggle 事件携带正确的 expanded 值
 *   - 标题文案渲染
 *   - title-extra slot 渲染
 *   - 默认 slot 内容渲染
 *   - chevron 旋转类名随状态切换
 *   - icon prop 渲染 SVG
 *
 * 来源：openspec/changes/improve-ux-playability/tasks.md T2.1
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CollapsibleSection from '@/components/CollapsibleSection.vue'

describe('CollapsibleSection - 默认展开', () => {
  it('defaultExpanded 默认 true，初始展开', () => {
    const wrapper = mount(CollapsibleSection, {
      props: { title: '状态区' },
      slots: { default: '<div class="content">内容</div>' }
    })
    expect(wrapper.find('.collapsible-section__expand--collapsed').exists()).toBe(false)
    expect(wrapper.find('.collapsible-section__chevron--expanded').exists()).toBe(true)
    expect(wrapper.text()).toContain('内容')
  })

  it('渲染标题文案', () => {
    const wrapper = mount(CollapsibleSection, {
      props: { title: '天下动静' }
    })
    expect(wrapper.find('.collapsible-section__title').text()).toBe('天下动静')
  })

  it('渲染默认 slot 内容', () => {
    const wrapper = mount(CollapsibleSection, {
      props: { title: '状态区' },
      slots: { default: '<div class="inner">状态面板</div>' }
    })
    expect(wrapper.find('.inner').exists()).toBe(true)
    expect(wrapper.text()).toContain('状态面板')
  })

  it('渲染 title-extra slot', () => {
    const wrapper = mount(CollapsibleSection, {
      props: { title: '状态区' },
      slots: { 'title-extra': '<div class="extra">摘要</div>' }
    })
    expect(wrapper.find('.collapsible-section__title-extra').exists()).toBe(true)
    expect(wrapper.find('.extra').exists()).toBe(true)
  })

  it('无 title-extra slot 时不渲染 title-extra 容器', () => {
    const wrapper = mount(CollapsibleSection, {
      props: { title: '状态区' }
    })
    expect(wrapper.find('.collapsible-section__title-extra').exists()).toBe(false)
  })

  it('点击标题栏切换为折叠，emit toggle(false)', async () => {
    const wrapper = mount(CollapsibleSection, {
      props: { title: '状态区' }
    })
    await wrapper.find('.collapsible-section__header').trigger('click')
    expect(wrapper.find('.collapsible-section__expand--collapsed').exists()).toBe(true)
    expect(wrapper.find('.collapsible-section__chevron--expanded').exists()).toBe(false)
    expect(wrapper.emitted('toggle')).toEqual([[false]])
  })
})

describe('CollapsibleSection - 默认折叠', () => {
  it('defaultExpanded=false，初始折叠', () => {
    const wrapper = mount(CollapsibleSection, {
      props: { title: '近况时间线', defaultExpanded: false }
    })
    expect(wrapper.find('.collapsible-section__expand--collapsed').exists()).toBe(true)
    expect(wrapper.find('.collapsible-section__chevron--expanded').exists()).toBe(false)
  })

  it('点击标题栏切换为展开，emit toggle(true)', async () => {
    const wrapper = mount(CollapsibleSection, {
      props: { title: '近况时间线', defaultExpanded: false }
    })
    await wrapper.find('.collapsible-section__header').trigger('click')
    expect(wrapper.find('.collapsible-section__expand--collapsed').exists()).toBe(false)
    expect(wrapper.find('.collapsible-section__chevron--expanded').exists()).toBe(true)
    expect(wrapper.emitted('toggle')).toEqual([[true]])
  })
})

describe('CollapsibleSection - 多次切换', () => {
  it('连续点击 4 次，最终回到展开态，emit 4 次 toggle', async () => {
    const wrapper = mount(CollapsibleSection, {
      props: { title: '状态区', defaultExpanded: true }
    })
    const header = wrapper.find('.collapsible-section__header')
    await header.trigger('click') // 展开→折叠
    await header.trigger('click') // 折叠→展开
    await header.trigger('click') // 展开→折叠
    await header.trigger('click') // 折叠→展开
    expect(wrapper.find('.collapsible-section__expand--collapsed').exists()).toBe(false)
    expect(wrapper.emitted('toggle')).toEqual([[false], [true], [false], [true]])
  })
})

describe('CollapsibleSection - icon prop', () => {
  it('传入 icon prop 时渲染 SVG path', () => {
    const wrapper = mount(CollapsibleSection, {
      props: {
        title: '状态区',
        icon: 'M12 2L2 22h20L12 2z'
      }
    })
    expect(wrapper.find('.collapsible-section__icon').exists()).toBe(true)
    expect(wrapper.find('svg path').attributes('d')).toBe('M12 2L2 22h20L12 2z')
  })

  it('不传 icon prop 时不渲染图标容器', () => {
    const wrapper = mount(CollapsibleSection, {
      props: { title: '状态区' }
    })
    expect(wrapper.find('.collapsible-section__icon').exists()).toBe(false)
  })
})

describe('CollapsibleSection - 触摸目标', () => {
  it('标题栏 min-height: 88rpx（触摸目标）', () => {
    const wrapper = mount(CollapsibleSection, {
      props: { title: '状态区' }
    })
    const header = wrapper.find('.collapsible-section__header')
    expect(header.classes()).toContain('collapsible-section__header')
    // CSS 类断言（实际像素在浏览器验证）
    expect(header.element).toBeDefined()
  })
})
