/**
 * @file 设备指纹生成
 *
 * H5 端用 localStorage + crypto.randomUUID；小程序与 App 端用 uni.getStorageSync。
 * 平台判断走 `uni.getSystemInfoSync().uniPlatform`，统一 API 入口便于测试 mock。
 *
 * 首次调用生成 UUID 持久化，后续调用直接读取，保证同设备同 ID。
 */

const STORAGE_KEY = 'game_device_id'

// UUID v4 格式校验正则
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * 获取设备唯一标识（首次调用自动生成并持久化）
 * @returns UUID v4 格式的设备 ID
 */
export function getDeviceId(): string {
  // 通过 uni.getSystemInfoSync().uniPlatform 判断平台
  // H5 端 uniPlatform 实际返回 'web'（uni-app 3.x 官方取值），兼容历史 'h5'；
  // mp-weixin/app: 走 uni.getStorageSync
  const { uniPlatform } = uni.getSystemInfoSync()
  const isH5 = uniPlatform === 'web' || uniPlatform === 'h5'

  if (isH5) {
    let id = localStorage.getItem(STORAGE_KEY)
    if (!id) {
      id = generateUUID()
      localStorage.setItem(STORAGE_KEY, id)
    }
    return id
  }

  // 小程序/App 端
  const stored = uni.getStorageSync(STORAGE_KEY) as string | undefined
  if (stored && UUID_V4_REGEX.test(stored)) {
    return stored
  }
  const newId = generateUUID()
  uni.setStorageSync(STORAGE_KEY, newId)
  return newId
}

/**
 * 生成 UUID v4
 * 优先用 crypto.randomUUID（secure context: https/localhost），
 * 回退到基于 Math.random 的手动生成（兼容非 secure context）
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // 回退：手动生成 UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
