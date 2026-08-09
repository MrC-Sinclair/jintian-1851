/**
 * @file useSSE.ts 单元测试
 *
 * 覆盖：
 *   - processSSEText 核心 SSE 帧解析（含跨 chunk 拼接）
 *   - H5 端 fetch + ReadableStream 正常流
 *   - 小程序/App 端 chunked 正常流 + 跨 chunk 拼接
 *   - 非流式降级（stream=false）
 *   - iOS 微信探测失败 → 降级
 *   - 探测结果缓存到 storage
 *   - 首 chunk 超时触发 onError('TIMEOUT')
 *   - abort 取消连接
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSSE } from '../../src/composables/useSSE'

let lastUniRequest: any = null
let chunkedCallback: ((res: { data: ArrayBuffer }) => void) | null = null
let uniRequestTask: any = null

beforeEach(() => {
  lastUniRequest = null
  chunkedCallback = null
  uniRequestTask = null

  ;(uni as any).request = (opts: any) => {
    lastUniRequest = opts
    uniRequestTask = {
      abort: vi.fn(),
      onChunkReceived: (cb: (res: { data: ArrayBuffer }) => void) => {
        chunkedCallback = cb
      }
    }
    return uniRequestTask
  }

  ;(uni as any).getSystemInfoSync = () => ({
    uniPlatform: 'h5',
    platform: 'h5'
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function encodeChunk(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer
}

function deltaFrame(text: string): string {
  return `data: ${JSON.stringify({ delta: text })}\n\n`
}

describe('useSSE - 基础接口', () => {
  it('useSSE 返回 connect 方法', () => {
    const { connect } = useSSE()
    expect(typeof connect).toBe('function')
  })
})

describe('useSSE - 小程序 chunked 流式', () => {
  beforeEach(() => {
    // 切换到小程序环境
    ;(uni as any).getSystemInfoSync = () => ({
      uniPlatform: 'mp-weixin',
      platform: 'android'
    })
    // 假设已探测可用
    ;(uni as any).setStorageSync('sse_chunked_available', true)
  })

  it('收到完整 delta 帧触发 onChunk', () => {
    const chunks: string[] = []
    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: (delta) => chunks.push(delta),
        onDone: () => {},
        onError: () => {}
      },
      firstChunkTimeoutMs: 5000
    })

    // 模拟服务端推送一个完整 delta 帧
    expect(lastUniRequest).not.toBeNull()
    expect(lastUniRequest.enableChunked).toBe(true)
    expect(lastUniRequest.responseType).toBe('arraybuffer')

    chunkedCallback!({ data: encodeChunk(deltaFrame('你好')) })

    expect(chunks).toEqual(['你好'])

    task.abort()
    expect(uniRequestTask.abort).toHaveBeenCalled()
  })

  it('跨 chunk 拼接：delta 帧分两次到达', () => {
    const chunks: string[] = []
    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: (delta) => chunks.push(delta),
        onDone: () => {},
        onError: () => {}
      }
    })

    // 第一段：data: {"delta":"部 （未完整，无尾随双换行）
    chunkedCallback!({ data: encodeChunk('data: {"delta":"部') })
    // 第二段：分"}\n\n （完整帧尾）
    chunkedCallback!({ data: encodeChunk('分"}\n\n') })

    expect(chunks).toEqual(['部分'])

    task.abort()
  })

  it('收到 [DONE] 帧触发 onDone', () => {
    let done = false
    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: () => {},
        onDone: () => { done = true },
        onError: () => {}
      }
    })

    chunkedCallback!({ data: encodeChunk('data: [DONE]\n\n') })

    expect(done).toBe(true)
    task.abort()
  })

  it('收到 error 帧触发 onError', () => {
    let errCode: string | null = null
    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: () => {},
        onDone: () => {},
        onError: (code) => { errCode = code }
      }
    })

    chunkedCallback!({ data: encodeChunk('data: {"error":"AI_CALL_FAILED"}\n\n') })

    expect(errCode).toBe('AI_CALL_FAILED')
    task.abort()
  })

  it('多个 delta 帧在一个 chunk 中按顺序触发', () => {
    const chunks: string[] = []
    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: (delta) => chunks.push(delta),
        onDone: () => {},
        onError: () => {}
      }
    })

    const payload = deltaFrame('第一') + deltaFrame('第二') + deltaFrame('第三')
    chunkedCallback!({ data: encodeChunk(payload) })

    expect(chunks).toEqual(['第一', '第二', '第三'])
    task.abort()
  })
})

describe('useSSE - 非流式降级', () => {
  beforeEach(() => {
    ;(uni as any).getSystemInfoSync = () => ({
      uniPlatform: 'mp-weixin',
      platform: 'android'
    })
    // 标记不可用，触发降级
    ;(uni as any).setStorageSync('sse_chunked_available', false)
  })

  it('chunked 不可用时 URL 追加 stream=false 并走非流式', () => {
    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: () => {},
        onDone: () => {},
        onError: () => {}
      }
    })

    expect(lastUniRequest.url).toContain('stream=false')
    expect(lastUniRequest.enableChunked).toBeUndefined()

    task.abort()
  })

  it('非流式响应触发 onChunk + onDone', () => {
    let received = ''
    let done = false
    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: (delta) => { received = delta },
        onDone: () => { done = true },
        onError: () => {}
      }
    })

    // 模拟服务端非流式响应
    lastUniRequest.success({
      statusCode: 200,
      data: { ok: true, data: { delta: '完整回复', done: true } }
    })

    expect(received).toBe('完整回复')
    expect(done).toBe(true)
    task.abort()
  })

  it('非流式响应 ok:false 触发 onError', () => {
    let errCode: string | null = null
    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: () => {},
        onDone: () => {},
        onError: (code) => { errCode = code }
      }
    })

    lastUniRequest.success({
      statusCode: 500,
      data: { ok: false, error: { code: 'AI_CALL_FAILED', message: '失败' } }
    })

    expect(errCode).toBe('AI_CALL_FAILED')
    task.abort()
  })
})

describe('useSSE - 首 chunk 超时', () => {
  beforeEach(() => {
    ;(uni as any).getSystemInfoSync = () => ({
      uniPlatform: 'mp-weixin',
      platform: 'android'
    })
    ;(uni as any).setStorageSync('sse_chunked_available', true)
  })

  it('首 chunk 超时触发 onError(TIMEOUT) 并 abort', () => {
    vi.useFakeTimers()
    let errCode: string | null = null
    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: () => {},
        onDone: () => {},
        onError: (code) => { errCode = code }
      },
      firstChunkTimeoutMs: 1000
    })

    // 未收到任何 chunk，推进 1000ms
    vi.advanceTimersByTime(1000)

    expect(errCode).toBe('TIMEOUT')
    expect(uniRequestTask.abort).toHaveBeenCalled()

    task.abort()
  })

  it('收到首 chunk 后超时不再触发', () => {
    vi.useFakeTimers()
    let errCode: string | null = null
    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: () => {},
        onDone: () => {},
        onError: (code) => { errCode = code }
      },
      firstChunkTimeoutMs: 1000
    })

    // 500ms 时收到首 chunk
    vi.advanceTimersByTime(500)
    chunkedCallback!({ data: encodeChunk(deltaFrame('第一')) })

    // 推进到 1500ms（已超过 1000ms 超时窗口）
    vi.advanceTimersByTime(1000)

    expect(errCode).toBeNull()
    task.abort()
  })
})

describe('useSSE - iOS 微信未探测场景', () => {
  beforeEach(() => {
    ;(uni as any).getSystemInfoSync = () => ({
      uniPlatform: 'mp-weixin',
      platform: 'ios'
    })
    // 清除缓存，模拟未探测
    ;(uni as any).removeStorageSync('sse_chunked_available')
  })

  it('未探测时本次走非流式降级（URL 含 stream=false）', () => {
    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: () => {},
        onDone: () => {},
        onError: () => {}
      }
    })

    // 未探测 + iOS mp-weixin → 本次降级走非流式
    expect(lastUniRequest.url).toContain('stream=false')

    task.abort()
  })
})

describe('useSSE - H5 端 fetch 流式', () => {
  beforeEach(() => {
    ;(uni as any).getSystemInfoSync = () => ({
      uniPlatform: 'h5',
      platform: 'h5'
    })

    // mock fetch 返回 ReadableStream
    const encoder = new TextEncoder()
    const chunks: Uint8Array[] = []
    const stream = {
      getReader: () => ({
        read: async () => {
          if (chunks.length === 0) return { done: true, value: undefined }
          const v = chunks.shift()!
          return { done: false, value: v }
        }
      })
    }

    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: stream
    })

    // 暴露 push 方法供测试塞数据
    ;(globalThis as any).__pushH5Chunk = (text: string) => {
      chunks.push(encoder.encode(text))
    }
  })

  afterEach(() => {
    delete (globalThis as any).__pushH5Chunk
  })

  it('H5 fetch 流式接收 delta', async () => {
    const received: string[] = []
    let done = false
    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: (delta) => received.push(delta),
        onDone: () => { done = true },
        onError: () => {}
      }
    })

    ;(globalThis as any).__pushH5Chunk(deltaFrame('hello'))
    ;(globalThis as any).__pushH5Chunk('data: [DONE]\n\n')

    // 等待 fetch 微任务执行
    await new Promise((r) => setTimeout(r, 50))

    expect(received).toEqual(['hello'])
    expect(done).toBe(true)

    task.abort()
  })

  it('H5 fetch 非 ok 响应触发 onError(NETWORK)', async () => {
    let errCode: string | null = null
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: false,
      body: null
    })

    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: () => {},
        onDone: () => {},
        onError: (code) => { errCode = code }
      }
    })

    await new Promise((r) => setTimeout(r, 50))

    expect(errCode).toBe('NETWORK')
    task.abort()
  })
})

describe('useSSE - 工具调用事件 (T2.4)', () => {
  beforeEach(() => {
    ;(uni as any).getSystemInfoSync = () => ({
      uniPlatform: 'mp-weixin',
      platform: 'android'
    })
    ;(uni as any).setStorageSync('sse_chunked_available', true)
  })

  function toolCallFrame(name: string, args: unknown): string {
    return `data: ${JSON.stringify({ type: 'tool-call', toolName: name, args })}\n\n`
  }
  function toolResultFrame(name: string, result: unknown): string {
    return `data: ${JSON.stringify({ type: 'tool-result', toolName: name, result })}\n\n`
  }

  it('tool-call 帧触发 onToolCall(toolName, args)', () => {
    let capturedName = ''
    let capturedArgs: unknown = null
    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: () => {},
        onToolCall: (name: string, args: unknown) => {
          capturedName = name
          capturedArgs = args
        },
        onDone: () => {},
        onError: () => {}
      }
    })
    chunkedCallback!({
      data: encodeChunk(toolCallFrame('get-faction-info', { factionId: 'xiang-jun' }))
    })
    expect(capturedName).toBe('get-faction-info')
    expect(capturedArgs).toEqual({ factionId: 'xiang-jun' })
    task.abort()
  })

  it('tool-result 帧触发 onToolResult(toolName, result)', () => {
    let capturedName = ''
    let capturedResult: unknown = null
    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: () => {},
        onToolResult: (name: string, result: unknown) => {
          capturedName = name
          capturedResult = result
        },
        onDone: () => {},
        onError: () => {}
      }
    })
    chunkedCallback!({
      data: encodeChunk(toolResultFrame('get-faction-info', { faction: { id: 'xiang-jun' } }))
    })
    expect(capturedName).toBe('get-faction-info')
    expect(capturedResult).toEqual({ faction: { id: 'xiang-jun' } })
    task.abort()
  })

  it('未提供 onToolCall/onToolResult 时 tool 帧被静默忽略（向后兼容）', () => {
    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: () => {},
        onDone: () => {},
        onError: () => {}
      }
    })
    expect(() => {
      chunkedCallback!({
        data: encodeChunk(toolCallFrame('get-faction-info', { factionId: 'x' }))
      })
      chunkedCallback!({
        data: encodeChunk(toolResultFrame('get-faction-info', { faction: {} }))
      })
    }).not.toThrow()
    task.abort()
  })

  it('tool-call 与 delta 交错时均正确触发', () => {
    const chunks: string[] = []
    const toolCalls: string[] = []
    const { connect } = useSSE()
    const task = connect('/api/game/advisor-chat', { saveId: 'x' }, {
      callbacks: {
        onChunk: (d: string) => chunks.push(d),
        onToolCall: (name: string) => toolCalls.push(name),
        onDone: () => {},
        onError: () => {}
      }
    })
    const payload =
      toolCallFrame('get-recent-events', { limit: 5 }) +
      deltaFrame('军师') +
      toolResultFrame('get-recent-events', { events: [] })
    chunkedCallback!({ data: encodeChunk(payload) })
    expect(toolCalls).toEqual(['get-recent-events'])
    expect(chunks).toEqual(['军师'])
    task.abort()
  })
})

