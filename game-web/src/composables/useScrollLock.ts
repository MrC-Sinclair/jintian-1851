/**
 * @file 滚动锁 composable
 *
 * 用途：弹窗/覆盖层显示时锁定底层页面滚动，避免「弹框时下方列表可滚动」的 UX 问题。
 *
 * 实现策略（三端兼容）：
 * - H5 端：
 *   1. body/html overflow:hidden + 滚动条宽度补偿
 *   2. body 添加 `scroll-locked` class（配合全局 CSS 锁定内部滚动容器）
 *   3. **捕获阶段** touchmove/wheel 监听：目标不在弹框内时 preventDefault + stopPropagation
 * - 小程序/App 端：无 body 概念，靠弹窗自身遮罩 @touchmove.stop.prevent 拦截
 *
 * 使用方式：
 *   const { lock, unlock } = useScrollLock()
 *   watch(visible, (v) => (v ? lock() : unlock()))
 *   onUnmounted(unlock)
 *
 * SSR 安全：服务端无 document，lock/unlock 空操作。
 * 引用计数：多个弹窗同时显示时，只有全部 unlock 后才真正解锁。
 */

const SCROLL_LOCK_CLASS = 'scroll-locked'
const lockCount = { current: 0 }
let originalHtmlOverflow = ''
let originalBodyOverflow = ''
let originalBodyPaddingRight = ''
let touchmoveHandler: ((e: TouchEvent) => void) | null = null
let wheelHandler: ((e: WheelEvent) => void) | null = null

/**
 * 判断目标元素是否在弹框（fixed z-index >= 100 的容器）内部
 */
function isInsideFixedModal(el: EventTarget | null): boolean {
  if (!(el instanceof Node)) return false
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return false
  let node: Node | null = el
  const body = typeof document !== 'undefined' ? document.body : null
  const docEl = typeof document !== 'undefined' ? document.documentElement : null
  while (node) {
    if (node === body || node === docEl) {
      return false
    }
    if (node instanceof HTMLElement) {
      try {
        const style = window.getComputedStyle(node)
        const zIndex = parseInt(style.zIndex || '0', 10)
        if (style.position === 'fixed' && zIndex >= 100) {
          return true
        }
      } catch {
        // jsdom 测试环境静默跳过
      }
    }
    node = node.parentNode
  }
  return false
}

/**
 * 锁定底层页面滚动
 */
function lock(): void {
  if (typeof document === 'undefined') return

  lockCount.current += 1
  if (lockCount.current !== 1) return

  const body = document.body
  const html = document.documentElement
  if (!body) return

  try {
    originalHtmlOverflow = html.style.overflow
    originalBodyOverflow = body.style.overflow
    originalBodyPaddingRight = body.style.paddingRight

    const scrollbarWidth = window.innerWidth - html.clientWidth
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`
    }
    body.classList.add(SCROLL_LOCK_CLASS)
  } catch {
    // jsdom 测试环境静默降级
  }

  try {
    touchmoveHandler = (e: TouchEvent): void => {
      if (isInsideFixedModal(e.target)) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener('touchmove', touchmoveHandler, { passive: false, capture: true })

    wheelHandler = (e: WheelEvent): void => {
      if (isInsideFixedModal(e.target)) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener('wheel', wheelHandler, { passive: false, capture: true })
  } catch {
    // jsdom 测试环境可能不支持 addEventListener options，静默降级
  }
}

/**
 * 解锁底层页面滚动
 */
function unlock(): void {
  if (typeof document === 'undefined') return

  if (lockCount.current === 0) return
  lockCount.current -= 1
  if (lockCount.current !== 0) return

  const body = document.body
  const html = document.documentElement
  if (!body) return

  try {
    html.style.overflow = originalHtmlOverflow
    body.style.overflow = originalBodyOverflow
    body.style.paddingRight = originalBodyPaddingRight
    body.classList.remove(SCROLL_LOCK_CLASS)
  } catch {
    // jsdom 测试环境静默降级
  }

  try {
    if (touchmoveHandler) {
      document.removeEventListener('touchmove', touchmoveHandler, { capture: true } as any)
      touchmoveHandler = null
    }
    if (wheelHandler) {
      document.removeEventListener('wheel', wheelHandler, { capture: true } as any)
      wheelHandler = null
    }
  } catch {
    // jsdom 测试环境静默降级
  }
}

export function useScrollLock() {
  return { lock, unlock }
}
