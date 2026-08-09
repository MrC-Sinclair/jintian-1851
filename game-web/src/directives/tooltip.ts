/**
 * @file v-tooltip 自定义指令
 *
 * 为纯图标按钮提供 tooltip 提示：
 * - 桌面端：mouseenter 显示、mouseleave 隐藏
 * - 触摸设备：touchstart 启动 500ms 定时器模拟 longpress，触发后显示 3 秒自动消失
 * - 长按触发后阻止下次 click 误触发（preventDefault + stopPropagation，捕获阶段拦截）
 *
 * 三端兼容说明：
 * - H5 端：完整支持（el 为真实 DOM，addEventListener 可用）
 * - 小程序/App 端：el 通常无 addEventListener，降级设置 title 属性作为最低保障
 *   （主要 tooltip 场景由 InfoHint 组件覆盖，纯图标按钮在小程序端可接受降级）
 *
 * 来源：openspec/changes/improve-ux-playability/tasks.md T1.3 + specs/help-system/spec.md
 */

import type { Directive, DirectiveBinding } from 'vue'
import { getElementRect, isTouchDevice } from '@/utils/platform'

/** 指令绑定值类型（对象形式） */
export interface TooltipBinding {
  /** 提示内容 */
  content: string
  /** 浮层位置：默认 top（上方），可选 bottom（下方） */
  placement?: 'top' | 'bottom'
}

/** 每个元素独立的 tooltip 状态 */
interface TooltipState {
  /** tooltip 内容 */
  content: string
  /** 浮层位置 */
  placement: 'top' | 'bottom'
  /** longpress 定时器句柄 */
  longpressTimer: ReturnType<typeof setTimeout> | null
  /** 自动隐藏定时器句柄 */
  autoHideTimer: ReturnType<typeof setTimeout> | null
  /** 浮层移除定时器句柄（淡出动画后移除 DOM） */
  removeTimer: ReturnType<typeof setTimeout> | null
  /** 长按是否已触发（用于阻止 click 误触发） */
  longpressTriggered: boolean
  /** 当前浮层 DOM 元素 */
  tooltipEl: HTMLElement | null
  /** 是否正在显示 */
  visible: boolean
  /** 事件处理器引用（解绑时用） */
  handlers: {
    onMouseEnter?: () => void
    onMouseLeave?: () => void
    onTouchStart?: () => void
    onTouchEnd?: () => void
    onTouchMove?: () => void
    onClickCapture?: (e: Event) => void
  }
}

/** 长按触发时长（ms） */
const LONGPRESS_DELAY = 500

/** 触摸端自动隐藏时长（ms） */
const AUTO_HIDE_DELAY = 3000

/** 浮层淡出动画时长（ms） */
const FADE_OUT_DURATION = 150

/** 浮层 z-index */
const TOOLTIP_Z_INDEX = 999

/** 浮层与目标元素的间距（px） */
const TOOLTIP_GAP_PX = 8

/** 浮层与视口边缘的最小间距（px） */
const VIEWPORT_MARGIN_PX = 8

/** 状态存储键（挂在 el 上，兼容小程序 el 非 HTMLElement） */
const STATE_KEY = '__tooltip_state__'

/** 唯一类名计数器（用于 getElementRect 选择器） */
let classCounter = 0

/**
 * rpx 转 px（H5 端动态计算，保证不同屏幕宽度下视觉一致）
 * 750rpx = 屏幕宽度
 */
function rpxToPx(rpx: number): number {
  if (typeof window === 'undefined') return rpx / 2 // SSR 兜底：按 375 屏宽估算
  return (window.innerWidth / 750) * rpx
}

/** 读取元素状态 */
function getState(el: any): TooltipState | undefined {
  return el?.[STATE_KEY]
}

/** 写入元素状态 */
function setState(el: any, state: TooltipState): void {
  el[STATE_KEY] = state
}

/** 移除元素状态 */
function removeState(el: any): void {
  delete el[STATE_KEY]
}

/** 解析绑定值（字符串或对象） */
function parseBinding(value: string | TooltipBinding): TooltipBinding {
  if (typeof value === 'string') {
    return { content: value, placement: 'top' }
  }
  return {
    content: value.content,
    placement: value.placement === 'bottom' ? 'bottom' : 'top'
  }
}

/**
 * 为元素生成唯一类名（用于 getElementRect 选择器）
 * 若元素已有 id 则优先用 #id
 */
function ensureSelector(el: any): string {
  if (el.id) return `#${el.id}`
  if (!el.__tooltip_class__) {
    // 生成唯一类名并附加到元素
    const cls = `v-tooltip-target-${++classCounter}`
    el.classList?.add(cls)
    el.__tooltip_class__ = cls
  }
  return `.${el.__tooltip_class__}`
}

/** 创建浮层 DOM 元素（H5 端 div 等价于 view） */
function createTooltipEl(content: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'v-tooltip'
  el.textContent = content
  // 内联样式（避免依赖全局 CSS，rpx 动态转 px 保证跨屏一致）
  Object.assign(el.style, {
    position: 'fixed',
    zIndex: String(TOOLTIP_Z_INDEX),
    maxWidth: '80%',
    padding: `${rpxToPx(16)}px ${rpxToPx(24)}px`,
    fontSize: `${rpxToPx(24)}px`,
    lineHeight: '1.4',
    color: '#fff',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: `${rpxToPx(8)}px`,
    pointerEvents: 'none',
    wordBreak: 'break-all',
    boxShadow: `0 ${rpxToPx(2)}px ${rpxToPx(8)}px rgba(0, 0, 0, 0.3)`,
    opacity: '0',
    transition: `opacity ${FADE_OUT_DURATION}ms ease`
  })
  return el
}

/** 显示 tooltip */
async function showTooltip(el: any, state: TooltipState): Promise<void> {
  if (state.visible) return
  if (!state.content) return
  // SSR/小程序守卫：无 document 时不创建浮层
  if (typeof document === 'undefined' || !document.body) return

  // 清除未完成的隐藏定时器
  if (state.removeTimer) {
    clearTimeout(state.removeTimer)
    state.removeTimer = null
  }

  // 创建浮层
  const tooltipEl = createTooltipEl(state.content)
  document.body.appendChild(tooltipEl)
  state.tooltipEl = tooltipEl
  state.visible = true

  // 计算定位（基于 getElementRect，遵循 spec 设计）
  const selector = ensureSelector(el)
  const rect = await getElementRect(selector)

  if (!rect) {
    // 无法获取位置，居中显示作为兜底
    Object.assign(tooltipEl.style, {
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)'
    })
  } else {
    // 先让浮层渲染以获取尺寸
    const tooltipRect = tooltipEl.getBoundingClientRect()
    const vw = typeof window !== 'undefined' ? window.innerWidth : 375
    const vh = typeof window !== 'undefined' ? window.innerHeight : 667

    // 水平居中于目标元素
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2
    let top: number

    if (state.placement === 'top') {
      top = rect.top - tooltipRect.height - TOOLTIP_GAP_PX
      // 上方空间不足时翻转到下方
      if (top < VIEWPORT_MARGIN_PX) {
        top = rect.top + rect.height + TOOLTIP_GAP_PX
      }
    } else {
      top = rect.top + rect.height + TOOLTIP_GAP_PX
      // 下方空间不足时翻转到上方
      if (top + tooltipRect.height > vh - VIEWPORT_MARGIN_PX) {
        top = rect.top - tooltipRect.height - TOOLTIP_GAP_PX
      }
    }

    // 水平边界处理
    left = Math.max(VIEWPORT_MARGIN_PX, Math.min(left, vw - tooltipRect.width - VIEWPORT_MARGIN_PX))
    // 垂直边界兜底
    top = Math.max(VIEWPORT_MARGIN_PX, Math.min(top, vh - tooltipRect.height - VIEWPORT_MARGIN_PX))

    Object.assign(tooltipEl.style, {
      left: `${left}px`,
      top: `${top}px`,
      transform: 'none'
    })
  }

  // 触发淡入（下一帧改 opacity 触发 transition）
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      if (state.tooltipEl === tooltipEl) tooltipEl.style.opacity = '1'
    })
  } else {
    tooltipEl.style.opacity = '1'
  }
}

/** 隐藏 tooltip（带淡出动画） */
function hideTooltip(state: TooltipState): void {
  if (!state.visible || !state.tooltipEl) return
  const el = state.tooltipEl
  el.style.opacity = '0'
  // 淡出动画后移除 DOM
  state.removeTimer = setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el)
    state.removeTimer = null
  }, FADE_OUT_DURATION)
  state.tooltipEl = null
  state.visible = false
  // 清除自动隐藏定时器
  if (state.autoHideTimer) {
    clearTimeout(state.autoHideTimer)
    state.autoHideTimer = null
  }
}

/** 绑定事件（根据设备类型走不同分支） */
function bindEvents(el: any, state: TooltipState): void {
  const touch = isTouchDevice()

  if (touch) {
    // 触摸设备：touchstart 启动 500ms 定时器，touchend/touchmove 清除
    state.handlers.onTouchStart = () => {
      state.longpressTriggered = false
      if (state.longpressTimer) clearTimeout(state.longpressTimer)
      state.longpressTimer = setTimeout(() => {
        state.longpressTriggered = true
        void showTooltip(el, state)
        // 3 秒后自动消失
        state.autoHideTimer = setTimeout(() => hideTooltip(state), AUTO_HIDE_DELAY)
      }, LONGPRESS_DELAY)
    }
    state.handlers.onTouchEnd = () => {
      if (state.longpressTimer) {
        clearTimeout(state.longpressTimer)
        state.longpressTimer = null
      }
    }
    state.handlers.onTouchMove = state.handlers.onTouchEnd
    // 长按触发后阻止下次 click 误触发（捕获阶段拦截，确保在目标 click 之前）
    state.handlers.onClickCapture = (e: Event) => {
      if (state.longpressTriggered) {
        e.preventDefault()
        e.stopPropagation()
        state.longpressTriggered = false
      }
    }
    el.addEventListener('touchstart', state.handlers.onTouchStart, { passive: true })
    el.addEventListener('touchend', state.handlers.onTouchEnd)
    el.addEventListener('touchmove', state.handlers.onTouchMove, { passive: true })
    el.addEventListener('click', state.handlers.onClickCapture, true)
  } else {
    // 桌面端：hover 显示/隐藏
    state.handlers.onMouseEnter = () => void showTooltip(el, state)
    state.handlers.onMouseLeave = () => hideTooltip(state)
    el.addEventListener('mouseenter', state.handlers.onMouseEnter)
    el.addEventListener('mouseleave', state.handlers.onMouseLeave)
  }
}

/** 解绑所有事件 */
function unbindEvents(el: any, state: TooltipState): void {
  const { handlers } = state
  if (handlers.onMouseEnter) el.removeEventListener('mouseenter', handlers.onMouseEnter)
  if (handlers.onMouseLeave) el.removeEventListener('mouseleave', handlers.onMouseLeave)
  if (handlers.onTouchStart) el.removeEventListener('touchstart', handlers.onTouchStart)
  if (handlers.onTouchEnd) el.removeEventListener('touchend', handlers.onTouchEnd)
  if (handlers.onTouchMove) el.removeEventListener('touchmove', handlers.onTouchMove)
  if (handlers.onClickCapture) el.removeEventListener('click', handlers.onClickCapture, true)
  if (state.longpressTimer) {
    clearTimeout(state.longpressTimer)
    state.longpressTimer = null
  }
  if (state.autoHideTimer) {
    clearTimeout(state.autoHideTimer)
    state.autoHideTimer = null
  }
}

/**
 * v-tooltip 指令对象
 *
 * 用法：
 * - `v-tooltip="'军师对话'"`（字符串形式）
 * - `v-tooltip="{ content: '同步存档', placement: 'top' }"`（对象形式）
 */
export const vTooltip: Directive = {
  mounted(el: any, binding: DirectiveBinding<string | TooltipBinding>) {
    // SSR 安全：服务端无 document，不绑定
    if (typeof document === 'undefined') return

    const config = parseBinding(binding.value)
    const state: TooltipState = {
      content: config.content,
      placement: config.placement ?? 'top',
      longpressTimer: null,
      autoHideTimer: null,
      removeTimer: null,
      longpressTriggered: false,
      tooltipEl: null,
      visible: false,
      handlers: {}
    }
    setState(el, state)

    // 小程序/App 端降级：el 无 addEventListener 时设置 title 属性作为最低保障
    if (typeof el.addEventListener !== 'function') {
      try {
        el.setAttribute('title', config.content)
      } catch {
        // 静默失败（部分运行时 setAttribute 不可用）
      }
      return
    }

    bindEvents(el, state)
  },

  updated(el: any, binding: DirectiveBinding<string | TooltipBinding>) {
    const state = getState(el)
    if (!state) return
    const config = parseBinding(binding.value)
    state.content = config.content
    state.placement = config.placement ?? 'top'
    // 降级模式同步更新 title
    if (typeof el.addEventListener !== 'function') {
      try {
        el.setAttribute('title', config.content)
      } catch {
        // 静默
      }
    }
    // 若浮层正在显示，更新内容
    if (state.tooltipEl) {
      state.tooltipEl.textContent = config.content
    }
  },

  unmounted(el: any) {
    const state = getState(el)
    if (!state) return
    unbindEvents(el, state)
    hideTooltip(state)
    // 清除移除定时器（若淡出未完成）
    if (state.removeTimer) {
      clearTimeout(state.removeTimer)
      if (state.tooltipEl?.parentNode) {
        state.tooltipEl.parentNode.removeChild(state.tooltipEl)
      }
      state.removeTimer = null
    }
    removeState(el)
  }
}

export default vTooltip
