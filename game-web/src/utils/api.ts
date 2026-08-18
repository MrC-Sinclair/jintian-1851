/**
 * @file 网络请求封装
 *
 * 基于 uni.request 统一三端（H5/小程序/App）的 API 调用入口。
 *
 * - 自动注入 x-device-id header（rate-limit 中间件依赖）
 * - 统一响应格式：成功 { ok: true, data } 或 { ok: true, data, fallback: true }
 *   失败抛 ApiError，包含 code/message/detail/statusCode
 * - H5 走 Vite proxy（/api 转发到 Nuxt3 后端），小程序/App 走绝对 URL
 *   （由 VITE_API_BASE_URL 环境变量配置，缺省 http://localhost:3000）
 *
 * 注意：本封装不处理 SSE 流式响应，流式请用 composables/useSSE.ts。
 */

import { getDeviceId } from './device-id'
import { ERROR_TEXT } from './copywriting'

/** E2E 测试模式标志（由 vite.config.ts 的 __E2E__ define 注入，仅 PLAYWRIGHT_E2E=1 时为 '1'） */
declare const __E2E__: string
const IS_E2E = typeof __E2E__ !== 'undefined' && __E2E__ === '1'

/** API 错误（统一抛出，调用方用 try/catch 捕获） */
export class ApiError extends Error {
  /** 服务端错误码（如 INVALID_PARAMS / RATE_LIMITED / CONCURRENT_REQUEST） */
  readonly code: string
  /** HTTP 状态码（网络失败时为 0） */
  readonly statusCode: number
  /** 服务端返回的详细错误信息（可选，zod issues 等） */
  readonly detail?: unknown

  constructor(code: string, message: string, statusCode: number, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.statusCode = statusCode
    this.detail = detail
  }
}

/** 后端统一响应结构（成功） */
interface SuccessResponse<T> {
  ok: true
  data: T
  /** 降级标志（init-factions / generate-event 等可能返回） */
  fallback?: boolean
}

/** 后端统一响应结构（失败，由 createError 包装） */
interface ErrorResponse {
  ok: false
  error: {
    code: string
    message: string
    detail?: unknown
  }
}

/** uni.request 成功回调的响应结构 */
interface UniRequestResult {
  /** HTTP 状态码 */
  statusCode: number
  /** 响应体（已自动按 header 解析 JSON） */
  data: SuccessResponse<unknown> | ErrorResponse | unknown
  /** 响应头 */
  header: Record<string, string>
}

/**
 * 取 API base URL。
 *
 * H5 端开发期走 Vite proxy（/api 转发到 localhost:3000），BASE_URL 为空字符串；
 * 小程序/App 端必须绝对 URL，从 VITE_API_BASE_URL 读取。
 */
function getBaseUrl(): string {
  // import.meta.env 在 uni-app 三端均可访问（Vite 注入）
  const fromEnv = import.meta.env?.VITE_API_BASE_URL as string | undefined
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  // H5 端默认走相对路径（Vite proxy 处理）
  // 小程序/App 端必须配置 VITE_API_BASE_URL，否则开发期只能 localhost
  return ''
}

/**
 * 取当前设备 ID（首次调用会自动生成并持久化）。
 * 失败时返回空字符串，不阻断请求（rate-limit 会按空 ID 限流）。
 */
function getDeviceIdSafe(): string {
  try {
    return getDeviceId()
  } catch {
    return ''
  }
}

/**
 * 发起 API 请求（内部实现，同时返回顶层 fallback 标志）。
 *
 * @param method HTTP 方法（GET/POST/PUT/DELETE）
 * @param url 路径（如 '/api/game/init-factions'），不带 base URL
 * @param body 请求体（POST/PUT 时传入，自动 JSON.stringify）
 * @returns data 字段（已剥除 ok 包装）+ 顶层 fallback 标志
 * @throws ApiError 服务端返回 ok:false 或网络层失败时
 */
function requestRaw<T = unknown>(
  method: string,
  url: string,
  body?: unknown
): Promise<{ data: T; fallback: boolean }> {
  const fullUrl = getBaseUrl() + url
  const deviceId = getDeviceIdSafe()

  return new Promise<{ data: T; fallback: boolean }>((resolve, reject) => {
    uni.request({
      url: fullUrl,
      method: method.toUpperCase() as
        | 'GET'
        | 'POST'
        | 'PUT'
        | 'DELETE'
        | 'OPTIONS'
        | 'HEAD'
        | 'TRACE'
        | 'CONNECT',
      data: body as AnyObject | undefined,
      // uni.request 会自动 JSON.stringify 对象，并设置 Content-Type
      header: {
        'Content-Type': 'application/json',
        'x-device-id': deviceId,
        // E2E 测试模式下附加标记头，触发后端 npc-actions 加速与自由行动强力负值兜底
        ...(IS_E2E ? { 'x-e2e-test-mode': '1' } : {})
      },
      timeout: 60_000,
      success: (res: UniRequestResult) => {
        const { statusCode, data } = res

        // 网络层成功，但服务端可能返回业务错误（4xx/5xx + ok:false）
        if (data && typeof data === 'object' && 'ok' in data) {
          if (data.ok === true) {
            // 业务成功（fallback 标志随响应顶层返回，如 npc-actions / faction-negotiate 降级）
            const wrapped = data as SuccessResponse<T>
            resolve({ data: wrapped.data, fallback: wrapped.fallback === true })
            return
          }
          if (data.ok === false) {
            // 业务失败（含 400/404/429/500 等）
            const err = (data as ErrorResponse).error
            reject(
              new ApiError(
                err?.code ?? 'UNKNOWN',
                err?.message ?? '请求失败',
                statusCode,
                err?.detail
              )
            )
            return
          }
        }

        // 响应格式不符合约定（如 502 Bad Gateway 返回 HTML）
        reject(
          new ApiError(
            'INVALID_RESPONSE',
            `响应格式异常（HTTP ${statusCode}）`,
            statusCode
          )
        )
      },
      fail: (err: { errMsg?: string }) => {
        // T3.4：网络层失败（连接超时、DNS 失败、CORS 拦截等）
        // 技术错误码（'NETWORK'）保留供调用方判断；message 统一白话化友好文案
        // 原始 errMsg 由调用方 console.error 记录（如 game-main onError）
        reject(
          new ApiError(
            'NETWORK',
            ERROR_TEXT.networkError,
            0,
            err?.errMsg
          )
        )
      }
    })
  })
}

/**
 * 发起 API 请求。
 *
 * @param method HTTP 方法（GET/POST/PUT/DELETE）
 * @param url 路径（如 '/api/game/init-factions'），不带 base URL
 * @param body 请求体（POST/PUT 时传入，自动 JSON.stringify）
 * @returns 响应 data 字段（已剥除 ok 包装）
 * @throws ApiError 服务端返回 ok:false 或网络层失败时
 */
export function request<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  return requestRaw<T>(method, url, body).then((r) => r.data)
}

/** 便捷方法：GET 请求 */
export function get<T = unknown>(url: string): Promise<T> {
  return request<T>('GET', url)
}

/** 便捷方法：POST 请求 */
export function post<T = unknown>(url: string, body?: unknown): Promise<T> {
  return request<T>('POST', url, body)
}

/**
 * 便捷方法：POST 请求（保留顶层 fallback 标志）
 *
 * 供需要区分降级响应的调用方使用（如 faction-negotiate 降级不消耗谈判配额）。
 */
export function postWithMeta<T = unknown>(
  url: string,
  body?: unknown
): Promise<{ data: T; fallback: boolean }> {
  return requestRaw<T>('POST', url, body)
}

/** 便捷方法：PUT 请求 */
export function put<T = unknown>(url: string, body?: unknown): Promise<T> {
  return request<T>('PUT', url, body)
}

/** 便捷方法：DELETE 请求 */
export function del<T = unknown>(url: string): Promise<T> {
  return request<T>('DELETE', url)
}
