/**
 * @file 平台能力封装
 *
 * 统一封装 H5/微信小程序/App 三端差异 API，避免组件内判断平台。
 * 来源：openspec/changes/improve-ux-playability/tasks.md T1.2 + design.md 多端兼容方案
 *
 * 封装内容：
 * - getElementRect(selector)：获取元素位置（H5 getBoundingClientRect / 小程序 createSelectorQuery）
 * - isTouchDevice()：是否触摸设备（决定 v-tooltip 触发方式）
 * - storageGet/storageSet：通用本地存储（非存档专用，如 onboarding_done 标记）
 */

/** 元素相对视口的位置与尺寸 */
export interface ElementRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 判断当前是否触摸设备
 *
 * - H5：matchMedia('(hover: none)') 或 navigator.maxTouchPoints > 0
 * - 小程序/App：直接返回 true（均为触摸交互）
 *
 * SSR 安全：服务端无 window/navigator，返回 false
 */
export function isTouchDevice(): boolean {
  // 服务端渲染守卫（AGENTS.md SSR 水合规则）
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false
  }
  // H5 端判断
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(hover: none)').matches || navigator.maxTouchPoints > 0
  }
  // 兜底：有 uni 且非 H5 视为触摸
  return typeof uni !== 'undefined'
}

/**
 * 获取元素相对视口的位置与尺寸（用于 OnboardingOverlay 高亮定位）
 *
 * 三端实现差异：
 * - H5：document.querySelector + getBoundingClientRect（同步）
 * - 小程序/App：uni.createSelectorQuery（异步）
 *
 * @param selector 选择器（如 '.status-panel' 或 '#event-card'）
 * @returns Promise<ElementRect | null>，元素不存在时 resolve null
 */
export function getElementRect(selector: string): Promise<ElementRect | null> {
  return new Promise((resolve) => {
    // H5 端：用 DOM API 同步获取
    // 注意：typeof document 判断在 uni-app H5 编译后为 true
    if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      const el = document.querySelector(selector)
      if (!el) {
        resolve(null)
        return
      }
      const rect = (el as HTMLElement).getBoundingClientRect()
      resolve({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      })
      return
    }

    // 小程序/App 端：用 uni.createSelectorQuery 异步获取
    if (typeof uni !== 'undefined' && typeof uni.createSelectorQuery === 'function') {
      const query = uni.createSelectorQuery()
      query
        .select(selector)
        .boundingClientRect((rect) => {
          if (rect && typeof rect === 'object' && 'left' in rect) {
            resolve({
              left: rect.left as number,
              top: rect.top as number,
              width: rect.width as number,
              height: rect.height as number
            })
          } else {
            resolve(null)
          }
        })
        .exec()
      return
    }

    // 兜底：无法获取
    resolve(null)
  })
}

/**
 * 查找元素最近的可滚动祖先容器
 * @param el 目标元素
 * @returns 可滚动容器（HTMLElement 或 window），找不到返回 window
 */
function findScrollableAncestor(el: HTMLElement): HTMLElement | Window {
  let node: HTMLElement | null = el.parentElement
  const body = typeof document !== 'undefined' ? document.body : null
  const docEl = typeof document !== 'undefined' ? document.documentElement : null
  while (node) {
    if (node === body || node === docEl) break
    try {
      const style = window.getComputedStyle(node)
      const overflowY = style.overflowY
      if (
        (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
        node.scrollHeight > node.clientHeight + 1
      ) {
        return node
      }
    } catch {
      // jsdom 测试环境或其他异常环境下 getComputedStyle 可能失败，静默跳过
    }
    node = node.parentElement
  }
  return window
}

/**
 * 将元素滚动到视口中央（用于 OnboardingOverlay 高亮定位前确保目标元素可见）
 *
 * 三端实现差异：
 * - H5：手动查找最近滚动祖先，计算 scrollTop 平滑滚动到中央（兼容 uni-app scroll-view）
 * - 小程序/App：无 DOM API，空操作（依赖 scroll-view 的 scroll-into-view 属性，由调用方处理）
 *
 * @param selector 选择器
 * @returns Promise<void>，H5 端等待滚动完成（400ms），其他端立即 resolve
 */
export function scrollElementIntoView(selector: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') {
      resolve()
      return
    }
    if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
      resolve()
      return
    }
    const el = document.querySelector(selector) as HTMLElement | null
    if (!el) {
      resolve()
      return
    }

    let rect: DOMRect
    try {
      rect = el.getBoundingClientRect()
    } catch {
      resolve()
      return
    }
    const windowHeight = window.innerHeight || 0
    if (windowHeight === 0) {
      resolve()
      return
    }

    // 元素已在视口内（top >= 0 且 bottom 不超出视口），无需滚动
    if (rect.top >= 0 && rect.bottom <= windowHeight) {
      resolve()
      return
    }

    const scrollContainer = findScrollableAncestor(el)

    try {
      if (scrollContainer === window) {
        const targetTop = (window.scrollY || 0) + rect.top - windowHeight / 2 + rect.height / 2
        window.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
      } else {
        const container = scrollContainer as HTMLElement
        const containerRect = container.getBoundingClientRect()
        const elTopInContainer = rect.top - containerRect.top + container.scrollTop
        const targetScrollTop = elTopInContainer - container.clientHeight / 2 + rect.height / 2
        container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' })
      }
    } catch {
      // 测试环境 scrollTo 可能不存在，静默降级
    }

    setTimeout(() => resolve(), 400)
  })
}

/**
 * 通用本地存储读取（非存档专用）
 *
 * 用于 onboarding_done 等标记位，与 storage.ts 的存档读写分离。
 * - H5：localStorage
 * - 小程序/App：uni.getStorageSync
 *
 * SSR 安全：服务端无 localStorage/uni，返回 null
 */
export function storageGet<T = unknown>(key: string): T | null {
  // H5 端
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return raw as unknown as T
    }
  }
  // 小程序/App 端
  if (typeof uni !== 'undefined' && typeof uni.getStorageSync === 'function') {
    const data = uni.getStorageSync(key)
    if (data === '' || data === null || data === undefined) return null
    // uni.getStorageSync 直接返回对象（无需 JSON.parse）
    return data as T
  }
  // 服务端兜底
  return null
}

/**
 * 通用本地存储写入（非存档专用）
 *
 * - H5：localStorage（JSON.stringify）
 * - 小程序/App：uni.setStorageSync（直接写对象）
 */
export function storageSet<T = unknown>(key: string, value: T): void {
  // H5 端
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // 存储满或被禁用时静默失败（非关键数据）
    }
    return
  }
  // 小程序/App 端
  if (typeof uni !== 'undefined' && typeof uni.setStorageSync === 'function') {
    try {
      uni.setStorageSync(key, value)
    } catch {
      // 静默失败
    }
  }
}

/**
 * 通用本地存储删除
 */
export function storageRemove(key: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(key)
    return
  }
  if (typeof uni !== 'undefined' && typeof uni.removeStorageSync === 'function') {
    uni.removeStorageSync(key)
  }
}
