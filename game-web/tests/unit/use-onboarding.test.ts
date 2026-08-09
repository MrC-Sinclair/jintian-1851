/**
 * @file useOnboarding composable 单元测试
 *
 * 覆盖 T1.9 验证要求：
 *   - checkAndStart：未完成启动 / 已完成跳过
 *   - markDone：写入 storage + 关闭引导
 *   - skip：等同 markDone
 *   - next/prev：步骤导航（含 prev 边界 0）
 *   - 模块级单例状态：多次调用 useOnboarding 返回同一份状态
 *
 * mock 策略：mock @/utils/platform 的 storageGet/storageSet，
 * 隔离 useOnboarding 逻辑，不依赖 setup.ts 的 uni/localStorage mock。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// mock platform 模块（vi.mock 提升到文件顶部，工厂内独立创建 vi.fn）
vi.mock('@/utils/platform', () => ({
  storageGet: vi.fn(),
  storageSet: vi.fn()
}))

import { useOnboarding } from '../../src/composables/useOnboarding'
import { storageGet, storageSet } from '@/utils/platform'

const mockStorageGet = vi.mocked(storageGet)
const mockStorageSet = vi.mocked(storageSet)

beforeEach(() => {
  // 重置 mock
  mockStorageGet.mockReset()
  mockStorageSet.mockReset()

  // 重置模块级单例状态（测试间隔离）
  const { isOnboarding, currentStep } = useOnboarding()
  isOnboarding.value = false
  currentStep.value = 0
})

describe('useOnboarding - checkAndStart', () => {
  it('storage 无记录（null）时启动引导', () => {
    mockStorageGet.mockReturnValue(null)
    const { isOnboarding, currentStep, checkAndStart } = useOnboarding()
    checkAndStart()
    expect(isOnboarding.value).toBe(true)
    expect(currentStep.value).toBe(0)
  })

  it('storage 返回 false 时启动引导', () => {
    mockStorageGet.mockReturnValue(false)
    const { isOnboarding, checkAndStart } = useOnboarding()
    checkAndStart()
    expect(isOnboarding.value).toBe(true)
  })

  it('storage 返回 true 时不启动引导', () => {
    mockStorageGet.mockReturnValue(true)
    const { isOnboarding, checkAndStart } = useOnboarding()
    checkAndStart()
    expect(isOnboarding.value).toBe(false)
  })

  it('启动时 currentStep 重置为 0', () => {
    mockStorageGet.mockReturnValue(null)
    const { currentStep, next, checkAndStart } = useOnboarding()
    // 先前进几步
    next()
    next()
    expect(currentStep.value).toBe(2)
    // 重新检查启动，重置为 0
    checkAndStart()
    expect(currentStep.value).toBe(0)
  })

  it('读取 storage 使用 onboarding_done key', () => {
    mockStorageGet.mockReturnValue(null)
    const { checkAndStart } = useOnboarding()
    checkAndStart()
    expect(mockStorageGet).toHaveBeenCalledWith('onboarding_done')
  })
})

describe('useOnboarding - markDone', () => {
  it('写入 storage（key=onboarding_done, value=true）', () => {
    const { markDone } = useOnboarding()
    markDone()
    expect(mockStorageSet).toHaveBeenCalledWith('onboarding_done', true)
  })

  it('关闭引导（isOnboarding=false）', () => {
    mockStorageGet.mockReturnValue(null)
    const { isOnboarding, checkAndStart, markDone } = useOnboarding()
    checkAndStart()
    expect(isOnboarding.value).toBe(true)
    markDone()
    expect(isOnboarding.value).toBe(false)
  })
})

describe('useOnboarding - skip', () => {
  it('等同 markDone：写入 storage + 关闭引导', () => {
    mockStorageGet.mockReturnValue(null)
    const { isOnboarding, checkAndStart, skip } = useOnboarding()
    checkAndStart()
    expect(isOnboarding.value).toBe(true)
    skip()
    expect(isOnboarding.value).toBe(false)
    expect(mockStorageSet).toHaveBeenCalledWith('onboarding_done', true)
  })
})

describe('useOnboarding - next/prev 步骤导航', () => {
  it('next 前进一步', () => {
    const { currentStep, next } = useOnboarding()
    expect(currentStep.value).toBe(0)
    next()
    expect(currentStep.value).toBe(1)
    next()
    expect(currentStep.value).toBe(2)
  })

  it('prev 后退一步', () => {
    const { currentStep, next, prev } = useOnboarding()
    next()
    next()
    expect(currentStep.value).toBe(2)
    prev()
    expect(currentStep.value).toBe(1)
  })

  it('prev 在 step=0 时不再后退（边界）', () => {
    const { currentStep, prev } = useOnboarding()
    expect(currentStep.value).toBe(0)
    prev()
    expect(currentStep.value).toBe(0)
  })

  it('prev 在 step=1 时后退到 0', () => {
    const { currentStep, next, prev } = useOnboarding()
    next()
    expect(currentStep.value).toBe(1)
    prev()
    expect(currentStep.value).toBe(0)
  })
})

describe('useOnboarding - 模块级单例状态', () => {
  it('多次调用 useOnboarding 返回同一份状态', () => {
    const a = useOnboarding()
    const b = useOnboarding()
    expect(a.isOnboarding).toBe(b.isOnboarding)
    expect(a.currentStep).toBe(b.currentStep)

    // 修改 a 的状态，b 也能看到
    a.next()
    expect(b.currentStep.value).toBe(1)
  })

  it('多处调用的方法操作同一份状态', () => {
    mockStorageGet.mockReturnValue(null)
    const a = useOnboarding()
    const b = useOnboarding()

    a.checkAndStart()
    expect(b.isOnboarding.value).toBe(true)

    b.markDone()
    expect(a.isOnboarding.value).toBe(false)
  })
})
