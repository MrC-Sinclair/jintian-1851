/**
 * @file utils/platform.ts 单元测试
 *
 * 覆盖 T1.2 验证要求：mock 三端环境验证分支
 *   - isTouchDevice：SSR / H5 触摸 / H5 非触摸 / 小程序兜底
 *   - getElementRect：H5 DOM / 小程序 createSelectorQuery / 元素不存在 / 兜底
 *   - storageGet/storageSet/storageRemove：H5 localStorage / 小程序 uni storage / JSON 异常
 *
 * 测试环境说明（来自 tests/setup.ts）：
 *   - jsdom 默认有 window/navigator/document
 *   - globalThis.uni 已 mock（含 storage 同步 API，无 createSelectorQuery）
 *   - globalThis.localStorage 已 mock（与 uni storage 独立 Map）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getElementRect,
  isTouchDevice,
  storageGet,
  storageSet,
  storageRemove
} from '../../src/utils/platform'

const TEST_KEY = 'test_platform_key'

beforeEach(() => {
  // 清理 localStorage 与 uni storage 中的测试键
  if (typeof localStorage !== 'undefined') localStorage.removeItem(TEST_KEY)
  if (typeof uni !== 'undefined' && uni.removeStorageSync) uni.removeStorageSync(TEST_KEY)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isTouchDevice', () => {
  it('SSR 无 window 时返回 false', () => {
    // 临时屏蔽 window 与 navigator 模拟服务端
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('navigator', undefined)
    expect(isTouchDevice()).toBe(false)
  })

  it('H5 触摸设备：matchMedia (hover: none) matches → true', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    vi.stubGlobal('navigator', { maxTouchPoints: 0 })
    expect(isTouchDevice()).toBe(true)
  })

  it('H5 触摸设备：maxTouchPoints > 0 → true', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    vi.stubGlobal('navigator', { maxTouchPoints: 1 })
    expect(isTouchDevice()).toBe(true)
  })

  it('H5 非触摸设备：matchMedia 不匹配且 maxTouchPoints=0 → false', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    vi.stubGlobal('navigator', { maxTouchPoints: 0 })
    expect(isTouchDevice()).toBe(false)
  })

  it('无 matchMedia 但有 uni → true（小程序兜底）', () => {
    // window 存在但 matchMedia 未定义，走兜底 typeof uni !== 'undefined'
    vi.stubGlobal('matchMedia', undefined)
    // window 仍存在但无 matchMedia 函数
    vi.stubGlobal('window', { matchMedia: undefined })
    expect(isTouchDevice()).toBe(true)
  })
})

describe('getElementRect - H5 DOM 分支', () => {
  it('元素存在时返回 getBoundingClientRect 结果', async () => {
    // jsdom 默认 document.querySelector 可用
    // 临时插入一个测试元素
    const div = document.createElement('div')
    div.className = 'test-target'
    div.style.position = 'absolute'
    div.style.left = '10px'
    div.style.top = '20px'
    div.style.width = '100px'
    div.style.height = '50px'
    document.body.appendChild(div)

    // mock getBoundingClientRect（jsdom 默认返回全 0，这里覆盖）
    const fakeRect = { left: 10, top: 20, width: 100, height: 50, right: 110, bottom: 70, x: 10, y: 20 }
    div.getBoundingClientRect = () => fakeRect as DOMRect

    const rect = await getElementRect('.test-target')
    expect(rect).not.toBeNull()
    expect(rect?.left).toBe(10)
    expect(rect?.top).toBe(20)
    expect(rect?.width).toBe(100)
    expect(rect?.height).toBe(50)

    document.body.removeChild(div)
  })

  it('元素不存在时返回 null', async () => {
    const rect = await getElementRect('.not-exist-selector')
    expect(rect).toBeNull()
  })
})

describe('getElementRect - 小程序 createSelectorQuery 分支', () => {
  it('uni.createSelectorQuery 返回 rect 时正确解析', async () => {
    // 临时屏蔽 document.querySelector 强制走 uni 分支
    const originalQuerySelector = document.querySelector
    vi.spyOn(document, 'querySelector').mockReturnValue(null)
    // 由于 typeof document 仍为 'object'，会走 H5 分支返回 null
    // 要走 uni 分支需 document 不存在 — 这里改用直接 mock uni API 验证回调契约

    // 恢复 querySelector
    vi.mocked(document.querySelector).mockRestore()
    if (typeof originalQuerySelector === 'function') {
      // @ts-expect-error 恢复原始方法
      document.querySelector = originalQuerySelector
    }

    // 直接验证 uni 分支：mock uni.createSelectorQuery
    const fakeRect = { left: 5, top: 15, width: 200, height: 80 }
    const mockExec = vi.fn()
    const mockBoundingClient = vi.fn((cb) => cb(fakeRect))
    const mockSelect = vi.fn(() => ({ boundingClientRect: mockBoundingClient }))
    const mockQuery = { select: mockSelect, exec: mockExec }

    const originalCreateSelectorQuery = (uni as any).createSelectorQuery
    ;(uni as any).createSelectorQuery = () => mockQuery

    // 临时移除 document 强制走 uni 分支
    const originalDocument = (globalThis as any).document
    Object.defineProperty(globalThis, 'document', { value: undefined, configurable: true })

    try {
      const rect = await getElementRect('.target')
      // exec 需要在调用链末尾触发 boundingClientRect 回调
      // 上面 mock 中 exec 是空函数，boundingClientRect 已在 select 时同步执行回调
      expect(rect).not.toBeNull()
      expect(rect?.left).toBe(5)
      expect(rect?.top).toBe(15)
      expect(rect?.width).toBe(200)
      expect(rect?.height).toBe(80)
    } finally {
      // 恢复 document
      Object.defineProperty(globalThis, 'document', { value: originalDocument, configurable: true })
      ;(uni as any).createSelectorQuery = originalCreateSelectorQuery
    }
  })

  it('uni.createSelectorQuery 返回空对象时返回 null', async () => {
    const mockBoundingClient = vi.fn((cb) => cb(null))
    const mockSelect = vi.fn(() => ({ boundingClientRect: mockBoundingClient }))
    const mockQuery = { select: mockSelect, exec: vi.fn() }

    const originalCreateSelectorQuery = (uni as any).createSelectorQuery
    ;(uni as any).createSelectorQuery = () => mockQuery

    const originalDocument = (globalThis as any).document
    Object.defineProperty(globalThis, 'document', { value: undefined, configurable: true })

    try {
      const rect = await getElementRect('.missing')
      expect(rect).toBeNull()
    } finally {
      Object.defineProperty(globalThis, 'document', { value: originalDocument, configurable: true })
      ;(uni as any).createSelectorQuery = originalCreateSelectorQuery
    }
  })
})

describe('storageGet / storageSet / storageRemove - H5 localStorage 分支', () => {
  beforeEach(() => {
    // 确保走 localStorage 分支：document 存在 → localStorage 存在
    // setup.ts 已 mock localStorage
  })

  it('storageSet 写入后 storageGet 能读取对象', () => {
    storageSet(TEST_KEY, { foo: 'bar', n: 42 })
    const data = storageGet<{ foo: string; n: number }>(TEST_KEY)
    expect(data).not.toBeNull()
    expect(data?.foo).toBe('bar')
    expect(data?.n).toBe(42)
  })

  it('storageSet 写入字符串后 storageGet 能读取', () => {
    storageSet(TEST_KEY, 'plain string')
    const data = storageGet<string>(TEST_KEY)
    expect(data).toBe('plain string')
  })

  it('storageGet 未设置的键返回 null', () => {
    expect(storageGet('not_exist_key_xyz')).toBeNull()
  })

  it('storageRemove 删除后 storageGet 返回 null', () => {
    storageSet(TEST_KEY, { a: 1 })
    expect(storageGet(TEST_KEY)).not.toBeNull()
    storageRemove(TEST_KEY)
    expect(storageGet(TEST_KEY)).toBeNull()
  })

  it('localStorage 已有非 JSON 数据时 storageGet 回退返回原始字符串', () => {
    // 直接写入非 JSON 字符串，触发 JSON.parse catch 分支
    localStorage.setItem(TEST_KEY, 'not-a-json')
    const data = storageGet<string>(TEST_KEY)
    expect(data).toBe('not-a-json')
  })
})

describe('storageGet / storageSet / storageRemove - 小程序 uni storage 分支', () => {
  beforeEach(() => {
    // 屏蔽 localStorage 强制走 uni storage 分支
    vi.stubGlobal('localStorage', undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('storageSet 写入后 storageGet 能读取对象', () => {
    storageSet(TEST_KEY, { foo: 'uni' })
    const data = storageGet<{ foo: string }>(TEST_KEY)
    expect(data).not.toBeNull()
    expect(data?.foo).toBe('uni')
  })

  it('storageGet 未设置的键返回 null（uni 返回空字符串）', () => {
    // uni.getStorageSync 未设置时返回 ''（setup.ts mock 用 Map.get 返回 undefined）
    expect(storageGet('not_exist_uni_key')).toBeNull()
  })

  it('storageRemove 删除后 storageGet 返回 null', () => {
    storageSet(TEST_KEY, { x: 1 })
    expect(storageGet(TEST_KEY)).not.toBeNull()
    storageRemove(TEST_KEY)
    expect(storageGet(TEST_KEY)).toBeNull()
  })
})

describe('storage - SSR 无 localStorage 无 uni 时兜底', () => {
  it('storageGet 返回 null', () => {
    vi.stubGlobal('localStorage', undefined)
    // uni 仍存在，需要屏蔽 uni.getStorageSync
    const original = (uni as any).getStorageSync
    ;(uni as any).getStorageSync = undefined
    try {
      expect(storageGet('any_key')).toBeNull()
    } finally {
      ;(uni as any).getStorageSync = original
    }
  })

  it('storageSet 不抛错（静默失败）', () => {
    vi.stubGlobal('localStorage', undefined)
    const original = (uni as any).setStorageSync
    ;(uni as any).setStorageSync = undefined
    try {
      expect(() => storageSet('k', 'v')).not.toThrow()
    } finally {
      ;(uni as any).setStorageSync = original
    }
  })

  it('storageRemove 不抛错（静默失败）', () => {
    vi.stubGlobal('localStorage', undefined)
    const original = (uni as any).removeStorageSync
    ;(uni as any).removeStorageSync = undefined
    try {
      expect(() => storageRemove('k')).not.toThrow()
    } finally {
      ;(uni as any).removeStorageSync = original
    }
  })
})
