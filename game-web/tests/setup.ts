import { vi } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'

// 每个测试结束后自动 unmount 组件，触发 onUnmounted 钩子，确保组件间状态隔离。
// 通用清理机制：组件若注册了定时器、事件监听器或 watch，自动卸载可防止残留。
enableAutoUnmount(afterEach)

// uni-app 测试环境 mock：在 Node.js/jsdom 中模拟 uni 全局 API
// 仅覆盖存档/SSE/网络相关 API，其他 API 按需扩展

// uni storage 与 localStorage 用独立 Map，模拟多端差异：
//   - H5 端：uni.getStorageSync 底层调 localStorage（测试中也可让两者独立，仅验证 API 路径）
//   - 小程序/App 端：只有 uni storage，无 localStorage
const uniStorage = new Map<string, unknown>()
const localStorageMap = new Map<string, string>()

const uniMock = {
  // 异步存储 API
  setStorage: ({ key, data, success }: any) => {
    uniStorage.set(key, data)
    success && success()
  },
  getStorage: ({ key, success, fail }: any) => {
    if (uniStorage.has(key)) {
      success && success({ data: uniStorage.get(key) })
    } else {
      // 真实 uni API 的 fail 回调传 { errMsg: string }，不是 Error 对象
      fail && fail({ errMsg: 'getStorage:fail data not found' })
    }
  },
  removeStorage: ({ key, success }: any) => {
    uniStorage.delete(key)
    success && success()
  },
  // 同步存储 API
  setStorageSync: (key: string, data: unknown) => uniStorage.set(key, data),
  getStorageSync: (key: string) => uniStorage.get(key),
  removeStorageSync: (key: string) => uniStorage.delete(key),
  // 网络请求
  request: vi.fn(),
  // 路由跳转（useTurn 结局判定调用）
  redirectTo: vi.fn(),
  navigateTo: vi.fn(),
  // 系统信息
  getSystemInfoSync: () => ({
    platform: 'h5',
    uniPlatform: 'h5',
    screenWidth: 375,
    screenHeight: 812,
    pixelRatio: 2,
    statusBarHeight: 20
  })
}

globalThis.uni = uniMock as any

// mock localStorage（H5 端 device-id.ts 使用）
// 用独立 Map 与 uni storage 隔离，便于测试验证不同平台走不同存储路径
const localStorageMock = {
  getItem: (key: string) => (localStorageMap.has(key) ? localStorageMap.get(key)! : null),
  setItem: (key: string, value: string) => localStorageMap.set(key, value),
  removeItem: (key: string) => localStorageMap.delete(key),
  clear: () => localStorageMap.clear()
}
globalThis.localStorage = localStorageMock as any
