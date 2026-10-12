/**
 * @file device-id 单元测试
 *
 * mock 三端环境（H5/小程序/App）验证 UUID 格式与持久化，以及设备凭据的存取
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDeviceCredential,
  getDeviceCredential,
  getDeviceId,
  setDeviceCredential
} from '../../src/utils/device-id'

const STORAGE_KEY = 'game_device_id'
const CREDENTIAL_KEY = 'game_device_token'
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// 每个测试前清空 storage，避免测试间污染
beforeEach(() => {
  if (typeof uni !== 'undefined' && uni.removeStorageSync) {
    uni.removeStorageSync(STORAGE_KEY)
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }
})

describe('getDeviceId - H5 端', () => {
  beforeEach(() => {
    // uni-app 3.x H5 端 uniPlatform 实际返回 'web'（官方文档取值）
    vi.spyOn(uni, 'getSystemInfoSync').mockReturnValue({
      uniPlatform: 'web',
      platform: 'web',
      screenWidth: 375,
      screenHeight: 812,
      pixelRatio: 2,
      statusBarHeight: 20
    } as any)
  })

  it('首次调用应生成 UUID v4 格式', () => {
    const id = getDeviceId()
    expect(UUID_V4_REGEX.test(id)).toBe(true)
  })

  it('二次调用应返回相同 ID（持久化）', () => {
    const id1 = getDeviceId()
    const id2 = getDeviceId()
    expect(id1).toBe(id2)
  })

  it('应写入 localStorage', () => {
    const id = getDeviceId()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(id)
  })

  it('uniPlatform 历史取值 h5 时同样走 localStorage', () => {
    vi.spyOn(uni, 'getSystemInfoSync').mockReturnValue({
      uniPlatform: 'h5',
      platform: 'h5'
    } as any)
    const id = getDeviceId()
    expect(UUID_V4_REGEX.test(id)).toBe(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(id)
  })
})

describe('getDeviceId - 微信小程序端', () => {
  beforeEach(() => {
    vi.spyOn(uni, 'getSystemInfoSync').mockReturnValue({
      uniPlatform: 'mp-weixin',
      platform: 'devtools',
      screenWidth: 375,
      screenHeight: 812,
      pixelRatio: 2,
      statusBarHeight: 20
    } as any)
  })

  it('首次调用应生成 UUID v4 格式', () => {
    const id = getDeviceId()
    expect(UUID_V4_REGEX.test(id)).toBe(true)
  })

  it('二次调用应返回相同 ID（uni storage 持久化）', () => {
    const id1 = getDeviceId()
    const id2 = getDeviceId()
    expect(id1).toBe(id2)
  })

  it('应写入 uni storage（非 localStorage）', () => {
    const id = getDeviceId()
    expect(uni.getStorageSync(STORAGE_KEY)).toBe(id)
    // H5 路径不应触发，localStorage 应为空
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('getDeviceId - App 端', () => {
  beforeEach(() => {
    vi.spyOn(uni, 'getSystemInfoSync').mockReturnValue({
      uniPlatform: 'app',
      platform: 'android',
      screenWidth: 375,
      screenHeight: 812,
      pixelRatio: 2,
      statusBarHeight: 20
    } as any)
  })

  it('首次调用应生成 UUID v4 格式', () => {
    const id = getDeviceId()
    expect(UUID_V4_REGEX.test(id)).toBe(true)
  })

  it('二次调用应返回相同 ID', () => {
    const id1 = getDeviceId()
    const id2 = getDeviceId()
    expect(id1).toBe(id2)
  })
})

describe('getDeviceId - 跨平台一致性', () => {
  it('H5 与小程序独立存储（互不污染）', () => {
    // H5 端生成
    vi.spyOn(uni, 'getSystemInfoSync').mockReturnValue({ uniPlatform: 'h5' } as any)
    const h5Id = getDeviceId()

    // 切到小程序，应生成新 ID（不同存储）
    vi.spyOn(uni, 'getSystemInfoSync').mockReturnValue({ uniPlatform: 'mp-weixin' } as any)
    const mpId = getDeviceId()

    expect(h5Id).not.toBe(mpId)
  })
})

describe('设备凭据存取', () => {
  const TOKEN = 'a'.repeat(64)

  // 两条存储通道都要清：clearDeviceCredential() 只清「当前平台」那一条，
  // 而 getSystemInfoSync 的 spy 会跨用例残留，单靠它会漏
  beforeEach(() => {
    localStorage.removeItem(CREDENTIAL_KEY)
    uni.removeStorageSync(CREDENTIAL_KEY)
    clearDeviceCredential()
  })

  it('H5 端：写入 localStorage 后能读回', () => {
    vi.spyOn(uni, 'getSystemInfoSync').mockReturnValue({ uniPlatform: 'web' } as any)
    setDeviceCredential(TOKEN)

    expect(getDeviceCredential()).toBe(TOKEN)
    expect(localStorage.getItem(CREDENTIAL_KEY)).toBe(TOKEN)
  })

  it('小程序端：走 uni.setStorageSync', () => {
    vi.spyOn(uni, 'getSystemInfoSync').mockReturnValue({ uniPlatform: 'mp-weixin' } as any)
    setDeviceCredential(TOKEN)

    expect(getDeviceCredential()).toBe(TOKEN)
    expect(uni.getStorageSync(CREDENTIAL_KEY)).toBe(TOKEN)
  })

  it('格式不符（长度/字符）的凭据既不落库也读不出', () => {
    vi.spyOn(uni, 'getSystemInfoSync').mockReturnValue({ uniPlatform: 'web' } as any)
    setDeviceCredential('too-short')

    expect(getDeviceCredential()).toBe('')
    expect(localStorage.getItem(CREDENTIAL_KEY)).toBeNull()

    // 绕过 setter 直接塞脏数据：读取侧同样要拒绝
    localStorage.setItem(CREDENTIAL_KEY, 'z'.repeat(64))
    expect(getDeviceCredential()).toBe('')
  })

  it('clearDeviceCredential 同时清内存副本与持久化', () => {
    vi.spyOn(uni, 'getSystemInfoSync').mockReturnValue({ uniPlatform: 'web' } as any)
    setDeviceCredential(TOKEN)
    clearDeviceCredential()

    expect(getDeviceCredential()).toBe('')
    expect(localStorage.getItem(CREDENTIAL_KEY)).toBeNull()
  })
})
