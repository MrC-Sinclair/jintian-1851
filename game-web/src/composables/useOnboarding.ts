/**
 * @file useOnboarding 引导状态管理 composable
 *
 * 管理新手引导的显隐与步骤导航：
 *   - isOnboarding：是否正在引导（控制 OnboardingOverlay 挂载）
 *   - currentStep：当前步骤索引
 *   - checkAndStart：读 storage 判断是否首次进入，启动引导
 *   - markDone/skip：标记完成（写入 storage，下次不再启动）
 *   - next/prev：步骤导航
 *
 * 设计依据：openspec/changes/improve-ux-playability/tasks.md T1.9 + specs/onboarding-tutorial/spec.md
 *   - localStorage key: onboarding_done（布尔）
 *   - 模块级单例状态（跨组件共享，game-main 挂载时调 checkAndStart）
 *   - 跳过等同完成（不再显示引导）
 */

import { ref } from 'vue'
import { storageGet, storageSet } from '@/utils/platform'

/** storage key：标记新手引导是否已完成 */
const ONBOARDING_KEY = 'onboarding_done'

// 模块级单例状态（跨组件共享，useOnboarding 多次调用返回同一份状态）
const isOnboarding = ref(false)
const currentStep = ref(0)

/**
 * 新手引导状态管理 composable
 *
 * 用法：
 * ```ts
 * const { isOnboarding, currentStep, checkAndStart, markDone, skip, next, prev } = useOnboarding()
 *
 * onMounted(() => {
 *   checkAndStart() // 首次进入启动引导
 * })
 *
 * // OnboardingOverlay 的 complete/skip 事件回调
 * function onComplete() { markDone() }
 * function onSkip() { skip() }
 * ```
 */
export function useOnboarding() {
  /**
   * 检查是否需要启动引导
   *
   * 读 storage 中的 onboarding_done：
   * - 未完成（null/false）→ isOnboarding = true，currentStep 重置为 0
   * - 已完成（true）→ isOnboarding = false
   */
  function checkAndStart(): void {
    const done = storageGet<boolean>(ONBOARDING_KEY)
    if (!done) {
      isOnboarding.value = true
      currentStep.value = 0
    } else {
      isOnboarding.value = false
    }
  }

  /**
   * 标记引导完成
   *
   * 写入 storage（下次不再启动）+ 关闭引导
   */
  function markDone(): void {
    storageSet(ONBOARDING_KEY, true)
    isOnboarding.value = false
  }

  /**
   * 跳过引导（等同 markDone，跳过也算完成，不再显示）
   */
  function skip(): void {
    markDone()
  }

  /**
   * 前进到下一步
   */
  function next(): void {
    currentStep.value += 1
  }

  /**
   * 返回上一步（不能小于 0）
   */
  function prev(): void {
    if (currentStep.value > 0) {
      currentStep.value -= 1
    }
  }

  return {
    isOnboarding,
    currentStep,
    checkAndStart,
    markDone,
    skip,
    next,
    prev
  }
}
