/**
 * @file SSE 流式响应封装（三端兼容）
 *
 * 自定义 SSE 协议（参见 design.md D8）：
 *   - delta 帧: data-colon-双引号-delta-双引号-冒号-双引号-content-双引号-双引号-加双换行
 *   - error 帧: data-colon-双引号-error-双引号-冒号-双引号-code-双引号-双引号-加双换行
 *   - tool-call 帧: data-colon-双引号-type-双引号-冒号-双引号-tool-call-双引号-逗号-双引号-toolName-双引号-冒号-双引号-<名>-双引号-逗号-双引号-args-双引号-冒号-<参数>-加双换行
 *   - tool-result 帧: data-colon-双引号-type-双引号-冒号-双引号-tool-result-双引号-逗号-双引号-toolName-双引号-冒号-双引号-<名>-双引号-逗号-双引号-result-双引号-冒号-<结果>-加双换行
 *   - done  帧: data-colon-中括号-DONE-中括号-加双换行
 *
 * 三端实现：
 *   - H5：fetch + ReadableStream + TextDecoder
 *   - 小程序/App：uni.request enableChunked + RequestTask.onChunkReceived
 *
 * 跨 chunk 拼接：维护 lastText 变量，按双换行切分，最后一段 JSON.parse 失败时
 * 保留到下次拼接（design.md D8 关键代码）。
 *
 * 自动探测降级（仅 iOS + mp-weixin）：
 *   - 启动检查 storage sse_chunked_available
 *   - 未探测过 → 发探测请求（2000ms 超时），失败标记不可用，后续走非流式
 *   - 不可用时 connect() 自动在 URL 追加 stream=false
 */

import { getDeviceId } from '@/utils/device-id'

/** connect 回调 */
export interface SSECallbacks {
  /** 收到单个 delta 文本片段 */
  onChunk: (delta: string) => void
  /**
   * 收到工具调用开始事件（T2.4）
   * @param toolName 工具名（如 get-faction-info）
   * @param args 调用参数（可能为空对象 {}）
   */
  onToolCall?: (toolName: string, args: unknown) => void
  /**
   * 收到工具调用结果事件（T2.4）
   * @param toolName 工具名（与 tool-call 对应）
   * @param result 调用结果；工具失败时为 { error, detail }
   */
  onToolResult?: (toolName: string, result: unknown) => void
  onDone: () => void
  onError: (code: string) => void
}

/** connect 选项 */
export interface SSEOptions {
  callbacks: SSECallbacks
  firstChunkTimeoutMs?: number
}

const CHUNKED_AVAILABLE_KEY = 'sse_chunked_available'
const DEFAULT_FIRST_CHUNK_TIMEOUT_MS = 3000
const PROBE_TIMEOUT_MS = 2000
const FRAME_DELIMITER = '\n\n'
const DATA_PREFIX = 'data: '
const DONE_MARKER = 'data: [DONE]'

/**
 * 判断当前是否 H5 环境
 */
function isH5(): boolean {
  try {
    return uni.getSystemInfoSync().uniPlatform === 'h5'
  } catch {
    return false
  }
}

/**
 * 判断是否 iOS 微信小程序（需要探测 chunked 兼容性）
 */
function isIOSWeixinMP(): boolean {
  try {
    const info = uni.getSystemInfoSync()
    return info.platform === 'ios' && info.uniPlatform === 'mp-weixin'
  } catch {
    return false
  }
}

/**
 * 读取 chunked 探测结果缓存
 * @returns true=可用 / false=不可用 / undefined=未探测
 */
function getChunkedAvailable(): boolean | undefined {
  const v = uni.getStorageSync(CHUNKED_AVAILABLE_KEY)
  if (v === true) return true
  if (v === false) return false
  return undefined
}

/**
 * 写入 chunked 探测结果缓存
 */
function setChunkedAvailable(available: boolean): void {
  uni.setStorageSync(CHUNKED_AVAILABLE_KEY, available)
}

/**
 * 取 API base URL（与 utils/api.ts 一致）
 */
function getBaseUrl(): string {
  const fromEnv = import.meta.env?.VITE_API_BASE_URL as string | undefined
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return ''
}

/**
 * 安全取 deviceId
 */
function getDeviceIdSafe(): string {
  try {
    return getDeviceId()
  } catch {
    return ''
  }
}

/**
 * 在 URL 上追加 query 参数
 */
function appendQuery(url: string, key: string, value: string): string {
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

/** SSE 解析状态（跨 chunk 拼接用） */
interface SSEParserState {
  /** 上一次未解析完的文本（不完整的帧） */
  lastText: string
  /** 是否已触发 onDone（避免重复触发） */
  done: boolean
}

/**
 * 处理一段新到达的 SSE 文本，触发对应回调
 *
 * 维护 lastText 变量，按双换行切分，最后一段不完整时保留到下次拼接。
 *
 * @returns true 表示流已结束（收到 [DONE] 或 error 帧）
 */
function processSSEText(
  text: string,
  state: SSEParserState,
  callbacks: SSECallbacks
): boolean {
  if (state.done) return true

  const fullText = state.lastText + text
  state.lastText = ''

  const frames = fullText.split(FRAME_DELIMITER)
  const lastIdx = frames.length - 1
  const lastFrame = frames[lastIdx]

  // 如果 fullText 末尾不是双换行，最后一段未完整，保留到下次拼接
  const endsWithDelimiter = fullText.endsWith(FRAME_DELIMITER)
  if (!endsWithDelimiter && lastFrame) {
    state.lastText = lastFrame
    frames.pop()
  }

  for (const frame of frames) {
    if (!frame) continue

    const payload = frame.startsWith(DATA_PREFIX)
      ? frame.slice(DATA_PREFIX.length)
      : frame

    // done 帧：[DONE] 标记
    if (frame === DONE_MARKER) {
      state.done = true
      callbacks.onDone()
      return true
    }

    // 解析 JSON 帧（delta / error / tool-call / tool-result）
    try {
      const obj = JSON.parse(payload)
      if (typeof obj === 'object' && obj !== null) {
        if (typeof obj.delta === 'string') {
          callbacks.onChunk(obj.delta)
        } else if (typeof obj.error === 'string') {
          state.done = true
          callbacks.onError(obj.error)
          return true
        } else if (obj.type === 'tool-call' && typeof obj.toolName === 'string') {
          // T2.4：工具调用开始（args 透传，可能为空对象）。无回调时静默忽略，保持向后兼容
          callbacks.onToolCall?.(obj.toolName, obj.args)
        } else if (obj.type === 'tool-result' && typeof obj.toolName === 'string') {
          // T2.4：工具调用结果（result 透传，工具失败时为 { error, detail }）
          callbacks.onToolResult?.(obj.toolName, obj.result)
        }
      }
    } catch {
      // JSON 解析失败：可能是未完整帧或非法格式，忽略
      // lastText 已在外层保留，这里不再处理
    }
  }

  return false
}

/**
 * uni.request 返回的任务类型，扩展支持 onChunkReceived
 *
 * 注：@dcloudio/types 的 RequestTask 未声明 onChunkReceived，
 * 但微信小程序/App 运行时已支持（基础库 8.0.56+），此处本地扩展。
 */
interface ChunkedRequestTask {
  /** 中断请求任务 */
  abort(): void
  /** 监听分块响应（仅 enableChunked: true 时有效） */
  onChunkReceived?(callback: (res: { data: ArrayBuffer }) => void): void
}

/**
 * H5 端 SSE 实现：fetch + ReadableStream + TextDecoder
 *
 * 返回 RequestTask 兼容对象（含 abort 方法）
 */
function connectH5(
  fullUrl: string,
  body: unknown,
  options: SSEOptions
): { abort: () => void } {
  const { callbacks, firstChunkTimeoutMs = DEFAULT_FIRST_CHUNK_TIMEOUT_MS } = options
  const state: SSEParserState = { lastText: '', done: false }

  const controller = new AbortController()
  let firstChunkTimer: ReturnType<typeof setTimeout> | null = null
  let firstChunkReceived = false

  firstChunkTimer = setTimeout(() => {
    if (!firstChunkReceived) {
      controller.abort()
      if (!state.done) {
        state.done = true
        callbacks.onError('TIMEOUT')
      }
    }
  }, firstChunkTimeoutMs)

  fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-device-id': getDeviceIdSafe()
    },
    body: JSON.stringify(body),
    signal: controller.signal
  })
    .then(async (response) => {
      if (!response.ok || !response.body) {
        if (firstChunkTimer) {
          clearTimeout(firstChunkTimer)
          firstChunkTimer = null
        }
        if (!state.done) {
          state.done = true
          callbacks.onError('NETWORK')
        }
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!firstChunkReceived) {
            firstChunkReceived = true
            if (firstChunkTimer) {
              clearTimeout(firstChunkTimer)
              firstChunkTimer = null
            }
          }
          const text = decoder.decode(value, { stream: true })
          const ended = processSSEText(text, state, callbacks)
          if (ended) return
        }
        // 流自然结束，未收到 [DONE] 也调用 onDone（兼容服务端正常关闭但漏发 [DONE]）
        if (!state.done) {
          state.done = true
          callbacks.onDone()
        }
      } catch {
        if (!state.done) {
          state.done = true
          callbacks.onError('NETWORK')
        }
      }
    })
    .catch((err: { name?: string }) => {
      if (firstChunkTimer) {
        clearTimeout(firstChunkTimer)
        firstChunkTimer = null
      }
      if (!state.done) {
        // abort 触发的错误不再回调（onError 已在超时处理中调用）
        if (err?.name !== 'AbortError') {
          state.done = true
          callbacks.onError('NETWORK')
        }
      }
    })

  return {
    abort: () => {
      if (firstChunkTimer) {
        clearTimeout(firstChunkTimer)
        firstChunkTimer = null
      }
      controller.abort()
    }
  }
}

/**
 * 小程序/App 端 SSE 实现：uni.request + enableChunked + onChunkReceived
 *
 * - responseType: 'arraybuffer'，避免中文乱码（不用 String.fromCharCode）
 * - onChunkReceived 监听分块响应，前端 TextDecoder 解码
 * - 跨 chunk 拼接由 processSSEText 处理（lastText 变量）
 */
function connectUniApp(
  fullUrl: string,
  body: unknown,
  options: SSEOptions
): { abort: () => void } {
  const { callbacks, firstChunkTimeoutMs = DEFAULT_FIRST_CHUNK_TIMEOUT_MS } = options
  const state: SSEParserState = { lastText: '', done: false }

  let firstChunkTimer: ReturnType<typeof setTimeout> | null = null
  let firstChunkReceived = false
  let aborted = false
  // 先声明，setTimeout 回调内引用（setTimeout 触发时 requestTask 已赋值）
  let requestTask: ChunkedRequestTask | undefined

  firstChunkTimer = setTimeout(() => {
    if (!firstChunkReceived && !aborted) {
      aborted = true
      state.done = true
      callbacks.onError('TIMEOUT')
      try {
        requestTask?.abort()
      } catch {
        /* noop */
      }
    }
  }, firstChunkTimeoutMs)

  const decoder = new TextDecoder('utf-8')

  // uni.request 返回 UniNamespace.RequestTask，运行时支持 onChunkReceived
  // 但类型定义缺失，此处通过 ChunkedRequestTask 接口断言访问
  requestTask = uni.request({
    url: fullUrl,
    method: 'POST',
    data: body as AnyObject,
    header: {
      'Content-Type': 'application/json',
      'x-device-id': getDeviceIdSafe()
    },
    responseType: 'arraybuffer',
    enableChunked: true,
    timeout: 60_000,
    success: () => {
      if (firstChunkTimer) {
        clearTimeout(firstChunkTimer)
        firstChunkTimer = null
      }
      // 流自然结束，未收到 [DONE] 也调用 onDone（兼容服务端正常关闭但漏发 [DONE]）
      if (!state.done) {
        state.done = true
        callbacks.onDone()
      }
    },
    fail: () => {
      if (firstChunkTimer) {
        clearTimeout(firstChunkTimer)
        firstChunkTimer = null
      }
      if (!state.done && !aborted) {
        state.done = true
        callbacks.onError('NETWORK')
      }
    }
  }) as unknown as ChunkedRequestTask

  // onChunkReceived 监听分块响应（小程序/App 专用 API）
  if (requestTask && typeof requestTask.onChunkReceived === 'function') {
    requestTask.onChunkReceived((res: { data: ArrayBuffer }) => {
      // 超时或已 done 后不再处理
      if (state.done) return
      if (!firstChunkReceived) {
        firstChunkReceived = true
        if (firstChunkTimer) {
          clearTimeout(firstChunkTimer)
          firstChunkTimer = null
        }
      }
      const text = decoder.decode(new Uint8Array(res.data), { stream: true })
      processSSEText(text, state, callbacks)
    })
  }

  return {
    abort: () => {
      if (firstChunkTimer) {
        clearTimeout(firstChunkTimer)
        firstChunkTimer = null
      }
      aborted = true
      if (requestTask) {
        try {
          requestTask.abort()
        } catch {
          /* noop */
        }
      }
    }
  }
}

/**
 * 非流式降级连接（stream=false）
 *
 * 服务端按 stream=false 返回完整 JSON（沿用通用 `{ ok: true, data: ... }` 包装），
 * 数据结构：`{ ok: true, data: { delta: <full text>, done: true } }`，
 * 前端一次性触发 onChunk(fullText) + onDone。
 */
function connectUniAppNonStream(
  fullUrl: string,
  body: unknown,
  options: SSEOptions
): { abort: () => void } {
  const { callbacks, firstChunkTimeoutMs = DEFAULT_FIRST_CHUNK_TIMEOUT_MS } = options

  let aborted = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let requestTask: ChunkedRequestTask | undefined

  timer = setTimeout(() => {
    if (!aborted) {
      aborted = true
      callbacks.onError('TIMEOUT')
      try {
        requestTask?.abort()
      } catch {
        /* noop */
      }
    }
  }, firstChunkTimeoutMs)

  requestTask = uni.request({
    url: fullUrl,
    method: 'POST',
    data: body as AnyObject,
    header: {
      'Content-Type': 'application/json',
      'x-device-id': getDeviceIdSafe()
    },
    timeout: 60_000,
    success: (res) => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (aborted) return

      // 服务端通用响应包装：{ ok: true, data: { delta, done } } 或 { ok: false, error: {...} }
      const data = res.data as
        | {
            ok: true
            data?: { delta?: string; done?: boolean }
          }
        | { ok: false; error?: { code?: string; message?: string } }
        | undefined

      if (data?.ok === true && data.data) {
        if (typeof data.data.delta === 'string') {
          callbacks.onChunk(data.data.delta)
        }
        callbacks.onDone()
      } else if (data?.ok === false && data.error) {
        callbacks.onError(data.error.code ?? 'AI_CALL_FAILED')
      } else {
        callbacks.onError('NETWORK')
      }
    },
    fail: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (!aborted) {
        aborted = true
        callbacks.onError('NETWORK')
      }
    }
  }) as unknown as ChunkedRequestTask

  return {
    abort: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      aborted = true
      if (requestTask) {
        try {
          requestTask.abort()
        } catch {
          /* noop */
        }
      }
    }
  }
}

/**
 * 探测 iOS 微信小程序 chunked 兼容性
 *
 * 发送一个最小探测请求到同 SSE 端点：
 * - 2 秒内收到首个 chunk（onChunkReceived 触发） → 标记可用
 * - 超时未收到或 success 触发但未收到 chunk → 标记不可用
 * - 运行时不支持 onChunkReceived 方法 → 直接判为不可用
 *
 * 探测请求 body 含 `__probe: true` 标识，服务端可识别后短返回（如未识别将走正常流程，
 * 不影响探测结果判定 —— 只要响应是 chunked 编码就会触发 onChunkReceived）。
 *
 * @param fullUrl 探测目标 URL（完整 URL）
 * @returns true=可用 / false=不可用
 */
function probeChunkedAvailable(fullUrl: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let resolved = false
    let firstChunkReceived = false
    let requestTask: ChunkedRequestTask | undefined

    const settle = (result: boolean) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      try {
        requestTask?.abort()
      } catch {
        /* noop */
      }
      resolve(result)
    }

    const timer = setTimeout(() => {
      settle(false)
    }, PROBE_TIMEOUT_MS)

    requestTask = uni.request({
      url: fullUrl,
      method: 'POST',
      data: { __probe: true } as AnyObject,
      header: {
        'Content-Type': 'application/json',
        'x-device-id': getDeviceIdSafe()
      },
      responseType: 'arraybuffer',
      enableChunked: true,
      timeout: PROBE_TIMEOUT_MS + 500,
      success: () => {
        // 成功完成但未收到 chunk：判定为不支持 chunked（一次性返回模式）
        settle(firstChunkReceived)
      },
      fail: () => {
        settle(false)
      }
    }) as unknown as ChunkedRequestTask

    if (requestTask && typeof requestTask.onChunkReceived === 'function') {
      requestTask.onChunkReceived(() => {
        firstChunkReceived = true
        settle(true)
      })
    } else {
      // 不支持 onChunkReceived 方法，直接判为不可用
      settle(false)
    }
  })
}

/**
 * SSE 连接任务（含 abort 方法）
 */
export interface SSEConnectTask {
  /** 中断连接（触发底层 abort，不再回调） */
  abort: () => void
}

/**
 * 主连接入口（三端分发 + 自动探测降级）
 *
 * 调用流程：
 * 1. H5 端：直接走 `connectH5`（fetch + ReadableStream）
 * 2. 小程序/App 端：
 *    - 已探测可用 → 走 `connectUniApp`（chunked 流式）
 *    - 已探测不可用 → URL 追加 `stream=false`，走 `connectUniAppNonStream`（非流式降级）
 *    - 未探测过且为 iOS mp-weixin → 本次先走非流式，异步发起探测请求写缓存供下次使用
 *    - 未探测过且非 iOS mp-weixin → 默认假设可用（Android/开发者工具已稳定）
 *
 * @param url 路径（如 '/api/game/advisor-chat'），不带 base URL
 * @param body 请求体
 * @param options 回调与超时配置
 */
export function connectSSE(
  url: string,
  body: unknown,
  options: SSEOptions
): SSEConnectTask {
  const fullUrl = getBaseUrl() + url

  // H5 端直接走 fetch
  if (isH5()) {
    return connectH5(fullUrl, body, options)
  }

  // 小程序/App 端
  let chunkedAvailable = getChunkedAvailable()
  if (chunkedAvailable === undefined) {
    if (isIOSWeixinMP()) {
      // iOS mp-weixin：本次降级走非流式，异步探测写缓存供下次使用
      chunkedAvailable = false
      void probeChunkedAvailable(fullUrl).then((available) => {
        setChunkedAvailable(available)
      })
    } else {
      // 其他环境（Android mp-weixin / 开发者工具 / App）默认假设可用
      chunkedAvailable = true
      setChunkedAvailable(true)
    }
  }

  if (chunkedAvailable) {
    return connectUniApp(fullUrl, body, options)
  }

  // 不可用：URL 追加 stream=false，走非流式降级
  const nonStreamUrl = appendQuery(fullUrl, 'stream', 'false')
  return connectUniAppNonStream(nonStreamUrl, body, options)
}

/**
 * useSSE composable
 *
 * 返回 `connect` 方法发起 SSE 连接，返回带 `abort` 方法的 task。
 *
 * @example
 * ```ts
 * const { connect } = useSSE()
 * const task = connect('/api/game/advisor-chat', body, {
 *   callbacks: {
 *     onChunk: (delta) => { message.value += delta },
 *     onDone: () => { /* 流结束 *\/ },
 *     onError: (code) => { toast.error(code) }
 *   },
 *   firstChunkTimeoutMs: 3000
 * })
 *
 * // 取消连接
 * task.abort()
 * ```
 */
export function useSSE() {
  return {
    connect: connectSSE
  }
}