/**
 * @file useToast — 全局 Toast 提示 composable
 *
 * 用法：
 *   const toast = useToast()
 *   toast.success('保存成功')
 *   toast.error('网络异常')
 *   toast.info('提示')
 *   toast.warning('军事濒临崩溃')
 *
 * 实际 UI 由 ToastContainer.vue 渲染（挂在 App.vue 根）。
 */

import { useUIStore } from '@/stores/ui'

export function useToast() {
  const ui = useUIStore()

  return {
    success: (message: string, durationMs?: number) => ui.success(message, durationMs),
    error: (message: string, durationMs?: number) => ui.error(message, durationMs),
    info: (message: string, durationMs?: number) => ui.info(message, durationMs),
    warning: (message: string, durationMs?: number) => ui.warning(message, durationMs)
  }
}
