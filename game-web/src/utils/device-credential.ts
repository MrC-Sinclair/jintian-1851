/**
 * @file 设备凭据换取（存档归属鉴权的客户端侧）
 *
 * 流程：本地无凭据 → `POST /api/game/device-credential` 用 deviceId 注册一次 →
 * 服务端返回 256bit 明文凭据，持久化后所有存档请求带 `x-device-token` 头（由 utils/api.ts 注入）。
 *
 * 为什么凭据比 deviceId 更可信：deviceId 是客户端自己生成并**自声明**的，
 * 报上别人的就能读别人的存档；凭据由服务端生成，且一个 deviceId 只能绑定一次，
 * 事后获知他人 deviceId 也换不到凭据。
 *
 * 降级策略（配合服务端双轨）：注册失败时返回空串而不是抛错——
 * 调用方据此回落到「query 带 deviceId」的旧参数，兼容期服务端仍认，
 * 这样服务端先发、客户端后发都不会把存档功能打断。
 */

import { ApiError, post } from './api'
import { getDeviceCredential, getDeviceId, setDeviceCredential } from './device-id'

interface RegisterResponse {
  deviceId: string
  token: string
}

/** 并发去重：同一时刻只允许一个注册请求在飞 */
let pending: Promise<string> | null = null

/** 注册被服务端判定为「不再可能成功」后停止重试，免得每次同步都撞一次 409 */
let enrollmentBlocked = false

/**
 * 确保拿到设备凭据
 * @returns 凭据明文；拿不到返回空串（调用方走兼容通道）
 */
export async function ensureCredential(): Promise<string> {
  const cached = getDeviceCredential()
  if (cached) return cached
  if (enrollmentBlocked) return ''
  if (pending) return pending

  pending = register().finally(() => {
    pending = null
  })
  return pending
}

/**
 * 双轨兼容期的属主声明参数
 *
 * 拿到凭据就**不用**在 query 里带 deviceId（服务端按凭据反查属主，
 * 也就不会再把这些标识写进 URL / 浏览器历史）；拿不到才回落到自声明。
 * 服务端 `DEVICE_AUTH_ENFORCED=true` 后这条回落会被拒绝，届时删掉本函数。
 *
 * @param token ensureCredential() 的结果
 * @param deviceId 本地 deviceId
 * @param sep 分隔符（前面已有查询参数时用 '&'）
 */
export function ownerParam(token: string, deviceId: string, sep = '&'): string {
  if (!token && deviceId) return `${sep}deviceId=${encodeURIComponent(deviceId)}`
  return ''
}

async function register(): Promise<string> {
  let deviceId = ''
  try {
    deviceId = getDeviceId()
  } catch {
    return ''
  }
  if (!deviceId) return ''

  try {
    const res = await post<RegisterResponse>('/api/game/device-credential', { deviceId })
    setDeviceCredential(res.token)
    return getDeviceCredential()
  } catch (err) {
    if (
      err instanceof ApiError &&
      (err.code === 'CREDENTIAL_EXISTS' || err.code === 'ENROLLMENT_CLOSED')
    ) {
      enrollmentBlocked = true
    }
    // 网络抖动 / 429 等不置 blocked：下次同步再试
    return ''
  }
}
