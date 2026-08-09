/**
 * @file OnboardingOverlay.vue 组件渲染测试
 *
 * 覆盖 T1.8 验证要求：
 *   - SSR 安全：mounted 初始 false → onMounted 后 true（需 await flushPromises 等待 DOM 更新）
 *   - 渲染步骤数据（标题、内容、步骤指示）
 *   - 步骤前进：点击"下一步" → 步骤索引 +1
 *   - 最后一步点击"下一步" → emit('complete')
 *   - 点击"跳过" → emit('skip')
 *   - 按钮文案：最后一步显示"开始游戏"，否则"下一步"
 *   - 无 targetKey 时不渲染高亮层
 *   - 有 targetKey 且 getElementRect 返回位置时渲染高亮层
 *   - 触摸目标：按钮 min-w/min-h: 88rpx
 *
 * 注意：组件根元素用 v-if="mounted" 保证 SSR 安全，onMounted 内修改 ref 后
 * DOM 更新是异步的（Vue 响应式 microtask 调度），测试需 await flushPromises
 * 等待 onMounted 回调 + DOM 更新完成后才能访问 DOM。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// mock platform 模块的 getElementRect 和 scrollElementIntoView（避免 jsdom 环境查询不存在的高亮元素）
// 注意：vi.mock 工厂被提升到文件顶部执行，工厂内不能引用外部变量
// 改用 vi.fn() 在工厂内独立创建，再通过 vi.mocked() 获取类型化 mock
vi.mock('@/utils/platform', () => ({
  getElementRect: vi.fn(),
  scrollElementIntoView: vi.fn().mockResolvedValue(undefined)
}))

import OnboardingOverlay from '../../src/components/OnboardingOverlay.vue'
import type { OnboardingStep } from '../../src/components/OnboardingOverlay.vue'
import { getElementRect, scrollElementIntoView } from '@/utils/platform'

const mockGetElementRect = vi.mocked(getElementRect)
const mockScrollElementIntoView = vi.mocked(scrollElementIntoView)

const stubs = {
  view: 'div',
  text: 'span'
}

const steps: OnboardingStep[] = [
  { title: '欢迎', content: '欢迎来到金田：1851', targetKey: null },
  { title: '状态面板', content: '查看 5 维属性与 4 项资源', targetKey: 'statusPanel' },
  { title: '事件卡片', content: '每回合 AI 生成事件', targetKey: 'eventCard' },
  { title: '完成', content: '开始游戏吧', targetKey: null }
]

const targetSelectors = {
  statusPanel: '.status-panel',
  eventCard: '.event-card'
}

/** 挂载组件并等待 onMounted + DOM 更新完成 */
async function mountOverlay(customSteps: OnboardingStep[] = steps) {
  const wrapper = mount(OnboardingOverlay, {
    props: {
      steps: customSteps,
      targetSelectors
    },
    global: { stubs }
  })
  // 等待 onMounted 回调执行 + v-if="mounted" 触发的 DOM 更新
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  mockGetElementRect.mockReset()
  mockScrollElementIntoView.mockReset()
  mockScrollElementIntoView.mockResolvedValue(undefined)
  // 默认返回 null（元素不存在场景）
  mockGetElementRect.mockResolvedValue(null)
})

describe('OnboardingOverlay - SSR 安全与挂载', () => {
  it('挂载后渲染根容器', async () => {
    const wrapper = await mountOverlay()
    expect(wrapper.find('.onboarding-overlay').exists()).toBe(true)
  })
})

describe('OnboardingOverlay - 步骤数据渲染', () => {
  it('渲染当前步骤的标题', async () => {
    const wrapper = await mountOverlay()
    expect(wrapper.find('.onboarding-overlay__title').text()).toBe('欢迎')
  })

  it('渲染当前步骤的内容', async () => {
    const wrapper = await mountOverlay()
    expect(wrapper.find('.onboarding-overlay__content').text()).toBe('欢迎来到金田：1851')
  })

  it('渲染步骤指示（1/4）', async () => {
    const wrapper = await mountOverlay()
    expect(wrapper.find('.onboarding-overlay__indicator-text').text()).toBe('1/4')
  })

  it('空 steps 时不崩溃', async () => {
    const wrapper = await mountOverlay([])
    // currentStep 兜底为空字符串，不崩溃即通过
    expect(wrapper.find('.onboarding-overlay').exists()).toBe(true)
  })
})

describe('OnboardingOverlay - 步骤前进', () => {
  it('点击"下一步"前进到下一题', async () => {
    const wrapper = await mountOverlay()
    await wrapper.find('.onboarding-overlay__btn--next').trigger('click')
    expect(wrapper.find('.onboarding-overlay__title').text()).toBe('状态面板')
    expect(wrapper.find('.onboarding-overlay__indicator-text').text()).toBe('2/4')
  })

  it('非最后一步按钮文案为"下一步"', async () => {
    const wrapper = await mountOverlay()
    const nextBtnText = wrapper.find('.onboarding-overlay__btn--next .onboarding-overlay__btn-text').text()
    expect(nextBtnText).toBe('下一步')
  })

  it('最后一步按钮文案为"开始游戏"', async () => {
    const wrapper = await mountOverlay()
    // 跳到最后一步
    for (let i = 0; i < steps.length - 1; i++) {
      await wrapper.find('.onboarding-overlay__btn--next').trigger('click')
    }
    const nextBtnText = wrapper.find('.onboarding-overlay__btn--next .onboarding-overlay__btn-text').text()
    expect(nextBtnText).toBe('开始游戏')
  })

  it('最后一步点击"下一步"触发 complete 事件', async () => {
    const wrapper = await mountOverlay()
    // 跳到最后一步
    for (let i = 0; i < steps.length - 1; i++) {
      await wrapper.find('.onboarding-overlay__btn--next').trigger('click')
    }
    await wrapper.find('.onboarding-overlay__btn--next').trigger('click')
    const completeEvents = wrapper.emitted('complete')
    expect(completeEvents).toHaveLength(1)
  })

  it('中间步骤点击"下一步"不触发 complete', async () => {
    const wrapper = await mountOverlay()
    await wrapper.find('.onboarding-overlay__btn--next').trigger('click')
    expect(wrapper.emitted('complete')).toBeUndefined()
  })
})

describe('OnboardingOverlay - 跳过引导', () => {
  it('点击"跳过"触发 skip 事件', async () => {
    const wrapper = await mountOverlay()
    await wrapper.find('.onboarding-overlay__btn--skip').trigger('click')
    const skipEvents = wrapper.emitted('skip')
    expect(skipEvents).toHaveLength(1)
  })

  it('跳过后步骤不前进（保持当前步骤）', async () => {
    const wrapper = await mountOverlay()
    expect(wrapper.find('.onboarding-overlay__title').text()).toBe('欢迎')
    await wrapper.find('.onboarding-overlay__btn--skip').trigger('click')
    // 标题仍是第 1 步（父组件负责卸载组件）
    expect(wrapper.find('.onboarding-overlay__title').text()).toBe('欢迎')
  })
})

describe('OnboardingOverlay - 高亮层渲染', () => {
  it('无 targetKey 的步骤不渲染高亮层', async () => {
    const wrapper = await mountOverlay()
    expect(wrapper.find('.onboarding-overlay__highlight').exists()).toBe(false)
  })

  it('有 targetKey 但 getElementRect 返回 null 时不渲染高亮层', async () => {
    mockGetElementRect.mockResolvedValue(null)
    const wrapper = await mountOverlay()
    // 前进到第 2 步（有 targetKey='statusPanel'）
    await wrapper.find('.onboarding-overlay__btn--next').trigger('click')
    await flushPromises()
    expect(wrapper.find('.onboarding-overlay__highlight').exists()).toBe(false)
  })

  it('有 targetKey 且 getElementRect 返回位置时渲染高亮层', async () => {
    const rect = { left: 10, top: 20, width: 100, height: 50 }
    mockGetElementRect.mockResolvedValue(rect)
    const wrapper = await mountOverlay()
    // 前进到第 2 步（targetKey='statusPanel' → selector='.status-panel'）
    await wrapper.find('.onboarding-overlay__btn--next').trigger('click')
    await flushPromises()
    const highlight = wrapper.find('.onboarding-overlay__highlight')
    expect(highlight.exists()).toBe(true)
    const style = highlight.attributes('style') || ''
    expect(style).toContain('left: 10px')
    expect(style).toContain('top: 20px')
    expect(style).toContain('width: 100px')
    expect(style).toContain('height: 50px')
  })

  it('getElementRect 收到正确的 selector（targetKey 映射）', async () => {
    mockGetElementRect.mockResolvedValue(null)
    const wrapper = await mountOverlay()
    // 前进到第 2 步（statusPanel → '.status-panel'）
    await wrapper.find('.onboarding-overlay__btn--next').trigger('click')
    await flushPromises()
    expect(mockGetElementRect).toHaveBeenCalledWith('.status-panel')
  })

  it('targetKey 存在但 targetSelectors 中无对应键时不调用 getElementRect', async () => {
    mount(OnboardingOverlay, {
      props: {
        steps: [{ title: 'test', content: 'c', targetKey: 'unknownKey' }],
        targetSelectors: { statusPanel: '.status-panel' } // 不含 unknownKey
      },
      global: { stubs }
    })
    await flushPromises()
    expect(mockGetElementRect).not.toHaveBeenCalled()
  })
})

describe('OnboardingOverlay - 触摸目标', () => {
  it('下一步按钮 min-w/min-h: 88rpx（CSS 类存在）', async () => {
    const wrapper = await mountOverlay()
    const nextBtn = wrapper.find('.onboarding-overlay__btn--next')
    expect(nextBtn.exists()).toBe(true)
    expect(nextBtn.classes()).toContain('onboarding-overlay__btn')
  })

  it('跳过按钮 min-w/min-h: 88rpx（CSS 类存在）', async () => {
    const wrapper = await mountOverlay()
    const skipBtn = wrapper.find('.onboarding-overlay__btn--skip')
    expect(skipBtn.exists()).toBe(true)
    expect(skipBtn.classes()).toContain('onboarding-overlay__btn')
  })
})
