/**
 * @file directives/tooltip.ts 单元测试
 *
 * 覆盖 T1.3 验证要求：mock 指令钩子验证绑定/解绑/触发
 *   - 绑定值解析（字符串/对象、placement 默认值）
 *   - 桌面端事件绑定（mouseenter/mouseleave）+ hover 触发显示/隐藏
 *   - 触摸端事件绑定（touchstart/touchend/touchmove/click 捕获）+ longpress 触发
 *   - 小程序降级（el 无 addEventListener 时设置 title）
 *   - SSR 安全（无 document 时不绑定）
 *   - unmounted 清理（解绑事件 + 移除 state）
 *   - 长按与 click 冲突处理（preventDefault + stopPropagation）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { vTooltip } from '../../src/directives/tooltip'
import type { TooltipBinding } from '../../src/directives/tooltip'

// mock platform 模块（避免依赖真实 window/navigator 判断）
vi.mock('@/utils/platform', () => ({
  isTouchDevice: vi.fn(),
  getElementRect: vi.fn()
}))

import { isTouchDevice, getElementRect } from '@/utils/platform'

const mockIsTouchDevice = vi.mocked(isTouchDevice)
const mockGetElementRect = vi.mocked(getElementRect)

beforeEach(() => {
  // 默认桌面端 + 元素位置已知
  mockIsTouchDevice.mockReturnValue(false)
  mockGetElementRect.mockResolvedValue({ left: 100, top: 100, width: 80, height: 40 })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  // 清理 body 下残留浮层
  document.body.innerHTML = ''
})

/** 读取元素的 tooltip 状态 */
function getState(el: HTMLElement): any {
  return (el as any).__tooltip_state__
}

describe('mounted - 绑定值解析', () => {
  it('字符串形式：content 正确，placement 默认 top', () => {
    const el = document.createElement('div')
    vTooltip.mounted!(el as any, { value: '军师对话' } as any)
    const state = getState(el)
    expect(state.content).toBe('军师对话')
    expect(state.placement).toBe('top')
  })

  it('对象形式：content 与 placement 正确', () => {
    const el = document.createElement('div')
    const binding: TooltipBinding = { content: '同步存档', placement: 'bottom' }
    vTooltip.mounted!(el as any, { value: binding } as any)
    const state = getState(el)
    expect(state.content).toBe('同步存档')
    expect(state.placement).toBe('bottom')
  })

  it('对象形式：placement 缺省时默认 top', () => {
    const el = document.createElement('div')
    const binding: TooltipBinding = { content: '提示' }
    vTooltip.mounted!(el as any, { value: binding } as any)
    const state = getState(el)
    expect(state.placement).toBe('top')
  })

  it('对象形式：placement 无效值时回退 top', () => {
    const el = document.createElement('div')
    const binding = { content: '提示', placement: 'left' as any }
    vTooltip.mounted!(el as any, { value: binding } as any)
    const state = getState(el)
    expect(state.placement).toBe('top')
  })
})

describe('mounted - 桌面端事件绑定', () => {
  it('桌面端绑定 mouseenter 与 mouseleave', () => {
    mockIsTouchDevice.mockReturnValue(false)
    const el = document.createElement('div')
    const spy = vi.spyOn(el, 'addEventListener')
    vTooltip.mounted!(el as any, { value: '提示' } as any)
    expect(spy).toHaveBeenCalledWith('mouseenter', expect.any(Function))
    expect(spy).toHaveBeenCalledWith('mouseleave', expect.any(Function))
    expect(spy).not.toHaveBeenCalledWith('touchstart', expect.any(Function), expect.anything())
  })
})

describe('mounted - 触摸端事件绑定', () => {
  it('触摸端绑定 touchstart/touchend/touchmove/click（捕获）', () => {
    mockIsTouchDevice.mockReturnValue(true)
    const el = document.createElement('div')
    const spy = vi.spyOn(el, 'addEventListener')
    vTooltip.mounted!(el as any, { value: '提示' } as any)
    expect(spy).toHaveBeenCalledWith('touchstart', expect.any(Function), { passive: true })
    expect(spy).toHaveBeenCalledWith('touchend', expect.any(Function))
    expect(spy).toHaveBeenCalledWith('touchmove', expect.any(Function), { passive: true })
    expect(spy).toHaveBeenCalledWith('click', expect.any(Function), true)
  })

  it('触摸端不绑定 mouseenter/mouseleave', () => {
    mockIsTouchDevice.mockReturnValue(true)
    const el = document.createElement('div')
    const spy = vi.spyOn(el, 'addEventListener')
    vTooltip.mounted!(el as any, { value: '提示' } as any)
    expect(spy).not.toHaveBeenCalledWith('mouseenter', expect.any(Function))
    expect(spy).not.toHaveBeenCalledWith('mouseleave', expect.any(Function))
  })
})

describe('mounted - 小程序降级', () => {
  it('el 无 addEventListener 时设置 title 属性', () => {
    const el = document.createElement('div')
    ;(el as any).addEventListener = undefined
    const setAttrSpy = vi.spyOn(el, 'setAttribute')
    vTooltip.mounted!(el as any, { value: '降级提示' } as any)
    expect(setAttrSpy).toHaveBeenCalledWith('title', '降级提示')
    // 仍写入 state（updated 时可同步 title）
    expect(getState(el).content).toBe('降级提示')
  })
})

describe('updated - 更新内容', () => {
  it('更新 content 后 state 同步', () => {
    const el = document.createElement('div')
    vTooltip.mounted!(el as any, { value: '旧提示' } as any)
    vTooltip.updated!(el as any, { value: '新提示' } as any)
    expect(getState(el).content).toBe('新提示')
  })

  it('更新 placement 后 state 同步', () => {
    const el = document.createElement('div')
    vTooltip.mounted!(el as any, { value: { content: 'a' } } as any)
    vTooltip.updated!(el as any, { value: { content: 'a', placement: 'bottom' } } as any)
    expect(getState(el).placement).toBe('bottom')
  })

  it('降级模式下 updated 同步更新 title', () => {
    const el = document.createElement('div')
    ;(el as any).addEventListener = undefined
    vTooltip.mounted!(el as any, { value: '旧' } as any)
    const setAttrSpy = vi.spyOn(el, 'setAttribute')
    vTooltip.updated!(el as any, { value: '新' } as any)
    expect(setAttrSpy).toHaveBeenCalledWith('title', '新')
  })
})

describe('unmounted - 清理', () => {
  it('unmounted 后移除 state 并解绑事件', () => {
    mockIsTouchDevice.mockReturnValue(false)
    const el = document.createElement('div')
    vTooltip.mounted!(el as any, { value: '提示' } as any)
    const spy = vi.spyOn(el, 'removeEventListener')
    vTooltip.unmounted!(el as any)
    expect(spy).toHaveBeenCalledWith('mouseenter', expect.any(Function))
    expect(spy).toHaveBeenCalledWith('mouseleave', expect.any(Function))
    expect(getState(el)).toBeUndefined()
  })

  it('unmounted 时移除已显示的浮层 DOM', async () => {
    mockIsTouchDevice.mockReturnValue(false)
    mockGetElementRect.mockResolvedValue({ left: 50, top: 50, width: 60, height: 30 })
    const el = document.createElement('div')
    document.body.appendChild(el)
    vTooltip.mounted!(el as any, { value: '提示' } as any)
    // 触发显示
    el.dispatchEvent(new Event('mouseenter'))
    await vi.waitFor(() => expect(document.querySelector('.v-tooltip')).not.toBeNull())
    // 卸载
    vTooltip.unmounted!(el as any)
    // 浮层 opacity 应为 0（淡出中）
    const tooltip = document.querySelector('.v-tooltip') as HTMLElement | null
    if (tooltip) {
      expect(tooltip.style.opacity).toBe('0')
    }
  })
})

describe('桌面端 hover 触发显示/隐藏', () => {
  it('mouseenter 后显示浮层，内容正确', async () => {
    mockIsTouchDevice.mockReturnValue(false)
    mockGetElementRect.mockResolvedValue({ left: 100, top: 100, width: 80, height: 40 })
    const el = document.createElement('div')
    document.body.appendChild(el)
    vTooltip.mounted!(el as any, { value: 'hover 提示' } as any)
    el.dispatchEvent(new Event('mouseenter'))
    await vi.waitFor(() => {
      const tooltip = document.querySelector('.v-tooltip')
      expect(tooltip).not.toBeNull()
      expect(tooltip?.textContent).toBe('hover 提示')
    })
  })

  it('mouseleave 后浮层淡出（opacity 设为 0）', async () => {
    mockIsTouchDevice.mockReturnValue(false)
    mockGetElementRect.mockResolvedValue({ left: 100, top: 100, width: 80, height: 40 })
    const el = document.createElement('div')
    document.body.appendChild(el)
    vTooltip.mounted!(el as any, { value: '提示' } as any)
    el.dispatchEvent(new Event('mouseenter'))
    await vi.waitFor(() => expect(document.querySelector('.v-tooltip')).not.toBeNull())
    el.dispatchEvent(new Event('mouseleave'))
    const tooltip = document.querySelector('.v-tooltip') as HTMLElement
    expect(tooltip.style.opacity).toBe('0')
  })

  it('浮层为空字符串时不显示', () => {
    mockIsTouchDevice.mockReturnValue(false)
    const el = document.createElement('div')
    document.body.appendChild(el)
    vTooltip.mounted!(el as any, { value: '' } as any)
    el.dispatchEvent(new Event('mouseenter'))
    expect(document.querySelector('.v-tooltip')).toBeNull()
  })

  it('getElementRect 返回 null 时居中显示兜底', async () => {
    mockIsTouchDevice.mockReturnValue(false)
    mockGetElementRect.mockResolvedValue(null)
    const el = document.createElement('div')
    document.body.appendChild(el)
    vTooltip.mounted!(el as any, { value: '居中' } as any)
    el.dispatchEvent(new Event('mouseenter'))
    await vi.waitFor(() => expect(document.querySelector('.v-tooltip')).not.toBeNull())
    const tooltip = document.querySelector('.v-tooltip') as HTMLElement
    expect(tooltip.style.left).toBe('50%')
    expect(tooltip.style.top).toBe('50%')
  })
})

describe('触摸端 longpress 触发', () => {
  it('touchstart 后 500ms 触发显示浮层', async () => {
    vi.useFakeTimers()
    mockIsTouchDevice.mockReturnValue(true)
    mockGetElementRect.mockResolvedValue({ left: 50, top: 50, width: 60, height: 30 })
    const el = document.createElement('div')
    document.body.appendChild(el)
    vTooltip.mounted!(el as any, { value: '长按提示' } as any)
    el.dispatchEvent(new Event('touchstart'))
    // 499ms 时未显示
    await vi.advanceTimersByTimeAsync(499)
    expect(document.querySelector('.v-tooltip')).toBeNull()
    // 500ms 时显示
    await vi.advanceTimersByTimeAsync(1)
    expect(document.querySelector('.v-tooltip')).not.toBeNull()
    expect(document.querySelector('.v-tooltip')?.textContent).toBe('长按提示')
  })

  it('touchend 在 500ms 内清除定时器，不触发显示', async () => {
    vi.useFakeTimers()
    mockIsTouchDevice.mockReturnValue(true)
    const el = document.createElement('div')
    document.body.appendChild(el)
    vTooltip.mounted!(el as any, { value: '提示' } as any)
    el.dispatchEvent(new Event('touchstart'))
    await vi.advanceTimersByTimeAsync(300)
    el.dispatchEvent(new Event('touchend'))
    await vi.advanceTimersByTimeAsync(500)
    expect(document.querySelector('.v-tooltip')).toBeNull()
  })

  it('touchmove 清除定时器（手指滑动不触发 longpress）', async () => {
    vi.useFakeTimers()
    mockIsTouchDevice.mockReturnValue(true)
    const el = document.createElement('div')
    document.body.appendChild(el)
    vTooltip.mounted!(el as any, { value: '提示' } as any)
    el.dispatchEvent(new Event('touchstart'))
    await vi.advanceTimersByTimeAsync(200)
    el.dispatchEvent(new Event('touchmove'))
    await vi.advanceTimersByTimeAsync(500)
    expect(document.querySelector('.v-tooltip')).toBeNull()
  })

  it('3 秒后自动隐藏浮层', async () => {
    vi.useFakeTimers()
    mockIsTouchDevice.mockReturnValue(true)
    mockGetElementRect.mockResolvedValue({ left: 50, top: 50, width: 60, height: 30 })
    const el = document.createElement('div')
    document.body.appendChild(el)
    vTooltip.mounted!(el as any, { value: '提示' } as any)
    el.dispatchEvent(new Event('touchstart'))
    await vi.advanceTimersByTimeAsync(500)
    expect(document.querySelector('.v-tooltip')).not.toBeNull()
    // 3 秒后自动消失
    await vi.advanceTimersByTimeAsync(3000)
    const tooltip = document.querySelector('.v-tooltip') as HTMLElement | null
    expect(tooltip?.style.opacity ?? '').toBe('0')
  })

  it('长按触发后下一次 click 被 preventDefault + stopPropagation', async () => {
    vi.useFakeTimers()
    mockIsTouchDevice.mockReturnValue(true)
    mockGetElementRect.mockResolvedValue({ left: 50, top: 50, width: 60, height: 30 })
    const el = document.createElement('div')
    document.body.appendChild(el)
    vTooltip.mounted!(el as any, { value: '提示' } as any)
    // 触发 longpress
    el.dispatchEvent(new Event('touchstart'))
    await vi.advanceTimersByTimeAsync(500)
    expect(getState(el).longpressTriggered).toBe(true)
    // 触发 click（应被拦截）
    const clickEvent = new Event('click', { cancelable: true, bubbles: true })
    const preventSpy = vi.spyOn(clickEvent, 'preventDefault')
    const stopSpy = vi.spyOn(clickEvent, 'stopPropagation')
    el.dispatchEvent(clickEvent)
    expect(preventSpy).toHaveBeenCalled()
    expect(stopSpy).toHaveBeenCalled()
    // 标志位已重置
    expect(getState(el).longpressTriggered).toBe(false)
  })

  it('未长按触发的 click 不被拦截', () => {
    mockIsTouchDevice.mockReturnValue(true)
    const el = document.createElement('div')
    document.body.appendChild(el)
    vTooltip.mounted!(el as any, { value: '提示' } as any)
    // 直接 click（未触发 longpress）
    const clickEvent = new Event('click', { cancelable: true, bubbles: true })
    const preventSpy = vi.spyOn(clickEvent, 'preventDefault')
    el.dispatchEvent(clickEvent)
    expect(preventSpy).not.toHaveBeenCalled()
  })
})

describe('SSR 安全', () => {
  it('无 document 时 mounted 不绑定事件、不写 state', () => {
    const el = document.createElement('div')
    const originalDoc = (globalThis as any).document
    Object.defineProperty(globalThis, 'document', { value: undefined, configurable: true })
    try {
      const addSpy = vi.spyOn(el, 'addEventListener')
      vTooltip.mounted!(el as any, { value: '提示' } as any)
      expect(addSpy).not.toHaveBeenCalled()
      expect(getState(el)).toBeUndefined()
    } finally {
      Object.defineProperty(globalThis, 'document', { value: originalDoc, configurable: true })
    }
  })
})

describe('placement 翻转', () => {
  it('placement=top 且上方空间不足时翻转到下方', async () => {
    mockIsTouchDevice.mockReturnValue(false)
    // 元素在视口顶部，上方空间不足
    mockGetElementRect.mockResolvedValue({ left: 100, top: 10, width: 80, height: 40 })
    const el = document.createElement('div')
    document.body.appendChild(el)
    vTooltip.mounted!(el as any, { value: '翻转', placement: 'top' } as any)
    // 直接调 mount 用对象形式
    vTooltip.unmounted!(el as any)
    vTooltip.mounted!(el as any, { value: { content: '翻转', placement: 'top' } } as any)
    el.dispatchEvent(new Event('mouseenter'))
    await vi.waitFor(() => expect(document.querySelector('.v-tooltip')).not.toBeNull())
    const tooltip = document.querySelector('.v-tooltip') as HTMLElement
    // 翻转后 top 应大于元素 top（10）+ height（40）= 50
    const tooltipTop = parseFloat(tooltip.style.top)
    expect(tooltipTop).toBeGreaterThan(50)
  })

  it('placement=bottom 且下方空间不足时翻转到上方', async () => {
    mockIsTouchDevice.mockReturnValue(false)
    // 元素在视口底部，下方空间不足（jsdom 默认 innerHeight=768）
    mockGetElementRect.mockResolvedValue({ left: 100, top: 760, width: 80, height: 40 })
    const el = document.createElement('div')
    document.body.appendChild(el)
    vTooltip.mounted!(el as any, { value: { content: '翻转', placement: 'bottom' } } as any)
    el.dispatchEvent(new Event('mouseenter'))
    await vi.waitFor(() => expect(document.querySelector('.v-tooltip')).not.toBeNull())
    const tooltip = document.querySelector('.v-tooltip') as HTMLElement
    // 翻转后 top 应小于元素 top（760）- tooltip 高度
    const tooltipTop = parseFloat(tooltip.style.top)
    expect(tooltipTop).toBeLessThan(760)
  })
})
