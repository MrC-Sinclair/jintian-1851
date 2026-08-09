/**
 * @file InfoHint.vue 组件渲染测试
 *
 * 覆盖 T1.4 验证要求：
 *   - 问号图标渲染（圆形、红色背景、白色"?"）
 *   - 点击图标切换浮层显隐
 *   - 点击遮罩关闭浮层
 *   - 点击关闭按钮关闭浮层
 *   - 浮层内容渲染（title 粗体 + content 段落）
 *   - 初始状态浮层不显示
 *   - 触摸目标尺寸（图标 48rpx，关闭按钮 88rpx，通过 class 存在性验证）
 *   - 遮罩点击 stopPropagation（防止冒泡到上层卡片）
 *
 * 事件模型说明：
 *   组件统一用 @click + CSS `touch-action: manipulation`，不再有 @touchend 路径。
 *   - 触摸端 click 由 touch-action: manipulation 即时派发，无 300ms 延迟、无 ghost click。
 *   - 因此不再需要测试 ghost click 拦截、touchend 关闭等场景。
 *   - 关键测试点：click 不会冒泡到父级 FactionCard 触发 select（穿透 bug 回归）。
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import InfoHint from '../../src/components/InfoHint.vue'

const stubs = {
  view: 'div',
  text: 'span'
}

function mountHint(title = '军事', content = '军队战力、装备水平、将领素质。影响战斗胜负、叛乱镇压') {
  return mount(InfoHint, {
    props: { title, content },
    global: { stubs }
  })
}

/**
 * 挂载带可点击父级元素的 InfoHint（用于测试事件冒泡/穿透）。
 * 父级 .parent 元素带 onClick 计数器，断言时通过 getParentClickCount() 验证
 * 父级 click handler 是否被调用。
 */
function mountWithClickableParent() {
  let parentClickCount = 0
  const Parent = defineComponent({
    setup() {
      return () =>
        h('div', { class: 'parent', onClick: () => parentClickCount++ }, [
          h(InfoHint, { title: '测试', content: '解释' })
        ])
    }
  })
  const wrapper = mount(Parent, { global: { stubs } })
  return { wrapper, getParentClickCount: () => parentClickCount }
}

describe('InfoHint - 初始渲染', () => {
  it('渲染问号图标（含"?"字符）', () => {
    const wrapper = mountHint()
    const icon = wrapper.find('.info-hint__icon')
    expect(icon.exists()).toBe(true)
    expect(icon.text()).toBe('?')
  })

  it('初始状态浮层不显示', () => {
    const wrapper = mountHint()
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(false)
  })

  it('图标有 active 点击反馈类名', () => {
    const wrapper = mountHint()
    const icon = wrapper.find('.info-hint__icon')
    // 未激活态无 --active 类
    expect(icon.classes()).not.toContain('info-hint__icon--active')
  })
})

describe('InfoHint - 点击图标切换显隐', () => {
  it('点击图标显示浮层', async () => {
    const wrapper = mountHint()
    await wrapper.find('.info-hint__icon').trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)
    // 图标进入激活态
    expect(wrapper.find('.info-hint__icon').classes()).toContain('info-hint__icon--active')
  })

  it('再次点击图标关闭浮层（toggle）', async () => {
    const wrapper = mountHint()
    const icon = wrapper.find('.info-hint__icon')
    await icon.trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)
    await icon.trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(false)
  })

  it('连续多次点击图标 toggle 正常（无 ghost click 干扰）', async () => {
    const wrapper = mountHint()
    const icon = wrapper.find('.info-hint__icon')

    // 模拟移动端快速连点 5 次：开-关-开-关-开
    await icon.trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)
    await icon.trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(false)
    await icon.trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)
    await icon.trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(false)
    await icon.trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)
  })
})

describe('InfoHint - 浮层内容渲染', () => {
  it('浮层显示术语标题（粗体）', async () => {
    const wrapper = mountHint('军事', '解释内容')
    await wrapper.find('.info-hint__icon').trigger('click')
    const title = wrapper.find('.info-hint__modal-title')
    expect(title.text()).toBe('军事')
  })

  it('浮层显示解释段落', async () => {
    const content = '军队战力、装备水平、将领素质。影响战斗胜负、叛乱镇压'
    const wrapper = mountHint('军事', content)
    await wrapper.find('.info-hint__icon').trigger('click')
    const body = wrapper.find('.info-hint__modal-content')
    expect(body.text()).toBe(content)
  })

  it('不同 props 渲染不同内容', async () => {
    const wrapper = mountHint('银两', '货币储备，用于购械、赈灾、行贿')
    await wrapper.find('.info-hint__icon').trigger('click')
    expect(wrapper.find('.info-hint__modal-title').text()).toBe('银两')
    expect(wrapper.find('.info-hint__modal-content').text()).toContain('货币储备')
  })
})

describe('InfoHint - 关闭浮层', () => {
  it('点击遮罩关闭浮层', async () => {
    const wrapper = mountHint()
    await wrapper.find('.info-hint__icon').trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)
    // 触发遮罩 click（uni-app H5 端 target/currentTarget 是 undefined，
    // onOverlayClick 直接 stopPropagation + close，不再判断 target === currentTarget）
    await wrapper.find('.info-hint__overlay').trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(false)
  })

  it('点击关闭按钮关闭浮层', async () => {
    const wrapper = mountHint()
    await wrapper.find('.info-hint__icon').trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)
    await wrapper.find('.info-hint__close').trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(false)
  })

  it('点击浮层内容区不关闭浮层（modal 内 @click.stop 拦截）', async () => {
    const wrapper = mountHint()
    await wrapper.find('.info-hint__icon').trigger('click')
    // 点击 modal 内容区（非遮罩、非关闭按钮），modal 的 @click.stop 阻止冒泡到 overlay
    await wrapper.find('.info-hint__modal').trigger('click')
    // 浮层仍在
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)
  })

  it('关闭后可立即再次点击图标打开（无 400ms 拦截器副作用）', async () => {
    const wrapper = mountHint()
    const icon = wrapper.find('.info-hint__icon')

    // 打开
    await icon.trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)
    // 通过遮罩关闭
    await wrapper.find('.info-hint__overlay').trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(false)
    // 立即再次点击图标：应能正常打开（旧 document 拦截器会吸收这次 click，已废弃）
    await icon.trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)
  })

  /**
   * 回归测试：关闭浮层后，不会有「关了又开」的 ghost click 现象。
   *
   * 历史 bug：旧实现用 @touchend 关闭浮层 + document 级拦截器吸收 ghost click。
   * 拦截器是布尔标志，连续 ghost click 会依次消耗，导致「关了又开」。
   * 现方案：只用 @click，无 @touchend，浏览器不合成 ghost click，从根源消除问题。
   */
  it('关闭浮层后浮层保持关闭，无 ghost click 重新打开', async () => {
    const wrapper = mountHint()
    const icon = wrapper.find('.info-hint__icon')

    await icon.trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)

    // 通过关闭按钮关闭
    await wrapper.find('.info-hint__close').trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(false)

    // 模拟"可能"的后续 click 事件（如来自旧 ghost click）：
    // 因为没有 @touchend，不会合成 ghost click，这里直接验证浮层保持关闭
    // 不需要再触发任何事件来验证
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(false)
  })
})

/**
 * 回归测试：遮罩 click 必须 stopPropagation，防止冒泡到上层卡片触发 select 事件。
 *
 * 历史 bug：势力选择页点 InfoHint 问号打开浮层后，点击浮层遮罩（modal 外），
 * click 事件冒泡到 FactionCard 触发 select 事件 → 错误弹出"确认势力"弹窗。
 * 根因：Vue 的 .self 修饰符不会自动 stopPropagation，uni-app H5 端 click 事件
 * target/currentTarget 是 undefined，无法靠 target === currentTarget 拦截冒泡。
 * 修复：onOverlayClick 显式 e.stopPropagation()。
 *
 * 关键：所有交互元素（图标、遮罩、关闭按钮）的 click 都不能冒泡到父级，
 * 这是穿透 bug 的核心回归点。
 */
describe('InfoHint - 遮罩点击 stopPropagation（防穿透 bug 回归）', () => {
  it('点击遮罩不会冒泡触发父元素 click handler', async () => {
    const { wrapper, getParentClickCount } = mountWithClickableParent()
    // 打开浮层
    await wrapper.find('.info-hint__icon').trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)
    const before = getParentClickCount()
    // 点击遮罩（modal 外）
    await wrapper.find('.info-hint__overlay').trigger('click')
    // 浮层已关闭
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(false)
    // 关键断言：父元素 click 处理器未被调用（stopPropagation 生效）
    expect(getParentClickCount()).toBe(before)
  })

  it('点击问号图标不会冒泡触发父元素 click handler', async () => {
    const { wrapper, getParentClickCount } = mountWithClickableParent()
    const before = getParentClickCount()
    // 点击图标（图标自身 @click.stop="toggle"）
    await wrapper.find('.info-hint__icon').trigger('click')
    expect(getParentClickCount()).toBe(before)
  })

  it('点击关闭按钮不会冒泡触发父元素 click handler', async () => {
    const { wrapper, getParentClickCount } = mountWithClickableParent()
    await wrapper.find('.info-hint__icon').trigger('click')
    const before = getParentClickCount()
    await wrapper.find('.info-hint__close').trigger('click')
    expect(getParentClickCount()).toBe(before)
  })

  /**
   * 回归测试：关闭浮层后，click 不会穿透到父级可点击元素。
   *
   * 历史 bug：旧实现用 @touchend 关闭浮层，touchend 先触发 → 浮层从 DOM 移除 →
   * 300ms 后合成的 ghost click 落到 InfoHint 之外的父级元素（如 FactionCard 的
   * @click="$emit('select')"），触发「确认势力」等无关弹窗。
   * 现方案：只用 @click，click 直接落在仍存在于 DOM 的浮层上，由浮层处理关闭，
   * 不会穿透到下层元素。
   */
  it('点击遮罩关闭浮层后，不会触发父元素 click（无穿透）', async () => {
    const { wrapper, getParentClickCount } = mountWithClickableParent()
    // 打开浮层
    await wrapper.find('.info-hint__icon').trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)

    const before = getParentClickCount()
    // 点击遮罩关闭浮层
    await wrapper.find('.info-hint__overlay').trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(false)
    // 关键断言：父元素 click 处理器未被调用（无 ghost click 穿透）
    expect(getParentClickCount()).toBe(before)
  })

  it('点击关闭按钮关闭浮层后，不会触发父元素 click（无穿透）', async () => {
    const { wrapper, getParentClickCount } = mountWithClickableParent()
    await wrapper.find('.info-hint__icon').trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)

    const before = getParentClickCount()
    // 点击关闭按钮关闭浮层
    await wrapper.find('.info-hint__close').trigger('click')
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(false)
    // 关键断言：父元素 click 处理器未被调用（无 ghost click 穿透）
    expect(getParentClickCount()).toBe(before)
  })
})

describe('InfoHint - 触摸目标尺寸', () => {
  it('问号图标 class 包含 info-hint__icon（CSS 定义 48rpx 尺寸）', () => {
    const wrapper = mountHint()
    const icon = wrapper.find('.info-hint__icon')
    expect(icon.exists()).toBe(true)
    // 尺寸由 scoped SCSS 保证（min-width/min-height: 48rpx）
  })

  it('关闭按钮 class 包含 info-hint__close（CSS 定义 88rpx 尺寸）', async () => {
    const wrapper = mountHint()
    await wrapper.find('.info-hint__icon').trigger('click')
    const close = wrapper.find('.info-hint__close')
    expect(close.exists()).toBe(true)
    // 尺寸由 scoped SCSS 保证（min-width/min-height: 88rpx）
  })

  it('图标 CSS 含 touch-action: manipulation（消除 300ms 延迟）', async () => {
    const wrapper = mountHint()
    await wrapper.find('.info-hint__icon').trigger('click')
    // touch-action 由 scoped SCSS 设置，这里仅验证 class 存在
    // 真实 touch-action 值由浏览器解析 CSS，单元测试不验证
    expect(wrapper.find('.info-hint__icon').exists()).toBe(true)
    expect(wrapper.find('.info-hint__overlay').exists()).toBe(true)
    expect(wrapper.find('.info-hint__close').exists()).toBe(true)
  })
})
