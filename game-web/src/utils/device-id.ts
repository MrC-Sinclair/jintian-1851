/**
 * @file 设备指纹与设备凭据的本地存储
 *
 * H5 端用 localStorage + crypto.randomUUID；小程序与 App 端用 uni.getStorageSync。
 * 平台判断走 `uni.getSystemInfoSync().uniPlatform`，统一 API 入口便于测试 mock。
 *
 * 首次调用生成 UUID 持久化，后续调用直接读取，保证同设备同 ID。
 *
 * 凭据（game_device_token）由服务端 `POST /api/game/device-credential` 下发，
 * 是存档读写的属主证明；deviceId 退化为「注册用的设备名」，不再单独构成权限。
 * 这里只放**同步读写**，换取流程在 utils/device-credential.ts ——
 * 那个模块要用 utils/api.ts，而 api.ts 要读本模块取凭据，放一起会成循环 import。
 */

const STORAGE_KEY = 'game_device_id'
const CREDENTIAL_STORAGE_KEY = 'game_device_token'

// UUID v4 格式校验正则
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// 服务端下发的凭据形态：64 位十六进制（sha256 反查库里存的 hash）
const CREDENTIAL_REGEX = /^[0-9a-f]{64}$/

// 凭据的内存副本：存储被隐私模式/配额挡住时，本会话仍能完成同步
let memoryCredential = ''

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

/** 当前是否 H5 端（uni 3.x 的 uniPlatform 实际值是 'web'，兼容历史 'h5'） */
function isH5Platform(): boolean {
  const { uniPlatform } = uni.getSystemInfoSync()
  return uniPlatform === 'web' || uniPlatform === 'h5'
}

/**
 * 读取本地缓存的设备凭据（无/格式不符时返回空串）
 *
 * 同步读：供 utils/api.ts 每次请求注入 x-device-token 头。
 * 换取与持久化流程在 utils/device-credential.ts。
 */
export function getDeviceCredential(): string {
  if (memoryCredential) return memoryCredential
  let stored: string | undefined
  try {
    stored = isH5Platform()
      ? localStorage.getItem(CREDENTIAL_STORAGE_KEY) ?? undefined
      : (uni.getStorageSync(CREDENTIAL_STORAGE_KEY) as string | undefined)
  } catch {
    // 隐私模式/存储配额异常：当作未注册，由调用方走兜底通道
    return ''
  }
  if (stored && CREDENTIAL_REGEX.test(stored)) {
    memoryCredential = stored
    return stored
  }
  return ''
}

/** 清除本地凭据（内存副本 + 持久化），用于凭据失效后的重置与测试隔离 */
export function clearDeviceCredential(): void {
  memoryCredential = ''
  try {
    if (isH5Platform()) {
      localStorage.removeItem(CREDENTIAL_STORAGE_KEY)
    } else {
      uni.removeStorageSync(CREDENTIAL_STORAGE_KEY)
    }
  } catch {
    // 清不掉也无妨：内存副本已置空
  }
}

/** 持久化服务端下发的凭据（明文只存本地，服务端只存其 sha256） */
export function setDeviceCredential(token: string): void {
  if (!CREDENTIAL_REGEX.test(token)) return
  memoryCredential = token
  try {
    if (isH5Platform()) {
      localStorage.setItem(CREDENTIAL_STORAGE_KEY, token)
    } else {
      uni.setStorageSync(CREDENTIAL_STORAGE_KEY, token)
    }
  } catch {
    // 存不下也不影响本次会话：内存副本已生效，下次冷启动需要重新注册
  }
}
