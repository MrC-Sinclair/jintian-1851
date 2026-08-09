/**
 * @file Pinia UI Store — 全局对话框与 Toast 状态
 *
 * 设计：
 *   - confirm(options) 返回 Promise<boolean>，由 ConfirmDialog 组件消费 state 并 resolve
 *   - toast.success/error/info/warning(message) 向 toasts[] 推入消息，由 ToastContainer 组件消费
 *   - 单一 store 保证 SSR 与多端一致（不用 provide/inject 避免 uni-app 复杂环境）
 *
 * 全局组件挂载在 App.vue 根，所有页面共享同一实例。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 确认对话框选项 */
export interface ConfirmOptions {
  /** 标题（缺省「请确认」） */
  title?: string
  /** 正文 */
  message: string
  /** 确认按钮文案（缺省「确认」） */
  confirmText?: string
  /** 取消按钮文案（缺省「取消」） */
  cancelText?: string
}

/** 确认对话框运行时状态 */
interface ConfirmState extends Required<Omit<ConfirmOptions, 'title'>> {
  visible: boolean
  title: string
  /** 内部 resolve 句柄（点击按钮时调用） */
  resolver: ((value: boolean) => void) | null
}

/** Toast 类型 */
export type ToastType = 'success' | 'error' | 'info' | 'warning'

/** Toast 项 */
export interface ToastItem {
  /** 自增 ID */
  id: number
  type: ToastType
  message: string
  /** 自动消失时间戳（Date.now() + durationMs） */
  expireAt: number
}

/** 默认 Toast 持续时间 */
const DEFAULT_TOAST_DURATION_MS = 2500

let toastIdSeq = 0

export const useUIStore = defineStore('ui', () => {
  // ====================== 确认对话框 ======================
  const confirmState = ref<ConfirmState>({
    visible: false,
    title: '请确认',
    message: '',
    confirmText: '确认',
    cancelText: '取消',
    resolver: null
  })

  /**
   * 弹出确认对话框
   *
   * @returns 用户是否点击确认（true=确认，false=取消）
   *
   * 注意：若已有对话框显示，新调用会被忽略并立即 resolve(false)，避免覆盖
   */
  function confirm(options: ConfirmOptions): Promise<boolean> {
    if (confirmState.value.visible && confirmState.value.resolver) {
      // 已有对话框，拒绝嵌套调用
      confirmState.value.resolver(false)
    }

    return new Promise<boolean>((resolve) => {
      confirmState.value = {
        visible: true,
        title: options.title ?? '请确认',
        message: options.message,
        confirmText: options.confirmText ?? '确认',
        cancelText: options.cancelText ?? '取消',
        resolver: resolve
      }
    })
  }

  /** 内部方法：UI 组件点击确认/取消时调用 */
  function _resolveConfirm(value: boolean): void {
    const resolver = confirmState.value.resolver
    confirmState.value = {
      visible: false,
      title: '请确认',
      message: '',
      confirmText: '确认',
      cancelText: '取消',
      resolver: null
    }
    resolver?.(value)
  }

  // ====================== Toast ======================
  const toasts = ref<ToastItem[]>([])

  /**
   * 推入一条 Toast
   */
  function _pushToast(type: ToastType, message: string, durationMs?: number): void {
    const id = ++toastIdSeq
    const expireAt = Date.now() + (durationMs ?? DEFAULT_TOAST_DURATION_MS)
    toasts.value.push({ id, type, message, expireAt })
  }

  /** 移除指定 Toast（由 ToastContainer 在动画结束后调用） */
  function _removeToast(id: number): void {
    const idx = toasts.value.findIndex((t) => t.id === id)
    if (idx >= 0) toasts.value.splice(idx, 1)
  }

  function success(message: string, durationMs?: number): void {
    _pushToast('success', message, durationMs)
  }

  function error(message: string, durationMs?: number): void {
    _pushToast('error', message, durationMs)
  }

  function info(message: string, durationMs?: number): void {
    _pushToast('info', message, durationMs)
  }

  /** 推入一条 warning Toast（用于危机预警等警告场景） */
  function warning(message: string, durationMs?: number): void {
    _pushToast('warning', message, durationMs)
  }

  return {
    // 确认对话框
    confirmState,
    confirm,
    _resolveConfirm,
    // Toast
    toasts,
    success,
    error,
    info,
    warning,
    _removeToast
  }
})
