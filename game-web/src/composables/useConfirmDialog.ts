/**
 * @file useConfirmDialog — 全局确认对话框 composable
 *
 * 用法：
 *   const { confirm } = useConfirmDialog()
 *   const ok = await confirm({ message: '确认删除？' })
 *   if (ok) { ... }
 *
 * 禁止使用 confirm()/alert()/prompt()（AGENTS.md 触摸设备适配规范）。
 * 实际 UI 由 ConfirmDialog.vue 渲染（挂在 App.vue 根）。
 */

import { useUIStore } from '@/stores/ui'
import type { ConfirmOptions } from '@/stores/ui'

export function useConfirmDialog() {
  const ui = useUIStore()

  /**
   * 弹出确认对话框
   * @returns 用户是否点击确认
   */
  function confirm(options: ConfirmOptions): Promise<boolean> {
    return ui.confirm(options)
  }

  return { confirm }
}
