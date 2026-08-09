/**
 * @file api.ts 单元测试
 *
 * 覆盖：
 *   - 成功响应（ok:true）返回 data
 *   - 业务失败（ok:false + 4xx/5xx）抛 ApiError
 *   - 网络层失败（fail 回调）抛 NETWORK 错误
 *   - 响应格式异常（非 {ok} 结构）抛 INVALID_RESPONSE
 *   - 自动注入 x-device-id header
 *   - body 自动序列化
 *   - get/post/put/del 便捷方法
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, del, get, post, put, request } from '../../src/utils/api'

// 捕获 uni.request 调用参数，便于断言
let lastCall: {
  url: string
  method: string
  data: unknown
  header: Record<string, string>
  success: (res: any) => void
  fail: (err: any) => void
} | null = null

beforeEach(() => {
  // 重置 uni.request 为可控 mock
  ;(uni as any).request = (opts: any) => {
    lastCall = opts
  }
  lastCall = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('request - 成功路径', () => {
  it('ok:true 响应返回 data 字段', async () => {
    const promise = request<{ factions: unknown[] }>(
      'POST',
      '/api/game/init-factions',
      { background: '文官' }
    )

    // 模拟服务端成功响应
    lastCall!.success({
      statusCode: 200,
      data: { ok: true, data: { factions: [{ id: 'f1', name: '清廷' }] } },
      header: {}
    })

    const result = await promise
    expect(result).toEqual({ factions: [{ id: 'f1', name: '清廷' }] })
  })

  it('ok:true 带 fallback 字段也正常返回 data', async () => {
    const promise = request('POST', '/api/game/init-factions', { background: '武将' })

    lastCall!.success({
      statusCode: 200,
      data: { ok: true, data: { factions: [] }, fallback: true },
      header: { 'X-Fallback': 'true' }
    })

    const result = await promise
    expect(result).toEqual({ factions: [] })
  })

  it('GET 请求不传 body', async () => {
    const promise = get('/api/game/sync-save?saveId=xxx')

    expect(lastCall!.method).toBe('GET')
    expect(lastCall!.data).toBeUndefined()

    lastCall!.success({
      statusCode: 200,
      data: { ok: true, data: { save: { saveId: 'xxx' } } },
      header: {}
    })

    const result = await promise
    expect(result).toEqual({ save: { saveId: 'xxx' } })
  })
})

describe('request - 业务失败', () => {
  it('ok:false + 400 抛 ApiError 含 code/message', async () => {
    const promise = request('POST', '/api/game/init-factions', { background: '无效' })

    lastCall!.success({
      statusCode: 400,
      data: {
        ok: false,
        error: {
          code: 'INVALID_PARAMS',
          message: 'background 必须为 文官/武将/商贾/士绅/宗室 之一'
        }
      },
      header: {}
    })

    await expect(promise).rejects.toThrow(ApiError)
    try {
      await promise
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.code).toBe('INVALID_PARAMS')
      expect(apiErr.statusCode).toBe(400)
      expect(apiErr.message).toContain('background')
    }
  })

  it('ok:false + 429 RATE_LIMITED 抛错', async () => {
    const promise = post('/api/game/generate-event', { saveId: 'x', turn: 1 })

    lastCall!.success({
      statusCode: 429,
      data: {
        ok: false,
        error: { code: 'RATE_LIMITED', message: '请求过于频繁' }
      },
      header: {}
    })

    await expect(promise).rejects.toThrow(ApiError)
    try {
      await promise
    } catch (err) {
      const apiErr = err as ApiError
      expect(apiErr.code).toBe('RATE_LIMITED')
      expect(apiErr.statusCode).toBe(429)
    }
  })

  it('ok:false 含 detail 字段透传', async () => {
    const promise = post('/api/game/init-factions', {})

    lastCall!.success({
      statusCode: 400,
      data: {
        ok: false,
        error: {
          code: 'INVALID_PARAMS',
          message: '参数校验失败',
          detail: [{ path: ['background'], message: 'Required' }]
        }
      },
      header: {}
    })

    try {
      await promise
    } catch (err) {
      const apiErr = err as ApiError
      expect(apiErr.detail).toEqual([{ path: ['background'], message: 'Required' }])
    }
  })

  it('404 SAVE_NOT_FOUND 抛错', async () => {
    const promise = get('/api/game/sync-save?saveId=not-exist')

    lastCall!.success({
      statusCode: 404,
      data: {
        ok: false,
        error: { code: 'SAVE_NOT_FOUND', message: '云端未找到此存档' }
      },
      header: {}
    })

    await expect(promise).rejects.toThrow(ApiError)
    try {
      await promise
    } catch (err) {
      const apiErr = err as ApiError
      expect(apiErr.code).toBe('SAVE_NOT_FOUND')
      expect(apiErr.statusCode).toBe(404)
    }
  })
})

describe('request - 网络层失败', () => {
  it('fail 回调抛 NETWORK 错误，message 白话化，原始 errMsg 存入 detail', async () => {
    const promise = post('/api/game/init-factions', { background: '文官' })

    lastCall!.fail({ errMsg: 'request:fail timeout' })

    await expect(promise).rejects.toThrow(ApiError)
    try {
      await promise
    } catch (err) {
      const apiErr = err as ApiError
      expect(apiErr.code).toBe('NETWORK')
      expect(apiErr.statusCode).toBe(0)
      // T3.4：message 统一为友好文案（不再暴露技术 errMsg）
      expect(apiErr.message).toBe('网络连接失败，请检查网络')
      // 原始 errMsg 保留在 detail 字段供调用方 console.error
      expect(apiErr.detail).toBe('request:fail timeout')
    }
  })
})

describe('request - 响应格式异常', () => {
  it('响应体不含 ok 字段抛 INVALID_RESPONSE', async () => {
    const promise = get('/api/game/sync-save')

    lastCall!.success({
      statusCode: 502,
      data: '<html>Bad Gateway</html>',
      header: {}
    })

    await expect(promise).rejects.toThrow(ApiError)
    try {
      await promise
    } catch (err) {
      const apiErr = err as ApiError
      expect(apiErr.code).toBe('INVALID_RESPONSE')
      expect(apiErr.statusCode).toBe(502)
    }
  })

  it('响应体为 null 抛 INVALID_RESPONSE', async () => {
    const promise = get('/api/game/sync-save')

    lastCall!.success({
      statusCode: 200,
      data: null,
      header: {}
    })

    await expect(promise).rejects.toThrow(ApiError)
  })
})

describe('request - header 注入', () => {
  it('自动注入 x-device-id 与 Content-Type', async () => {
    const promise = post('/api/game/init-factions', { background: '文官' })

    expect(lastCall!.header['x-device-id']).toBeTruthy()
    expect(lastCall!.header['Content-Type']).toBe('application/json')

    lastCall!.success({
      statusCode: 200,
      data: { ok: true, data: {} },
      header: {}
    })

    await promise
  })

  it('deviceId 失败时不阻断请求（x-device-id 为空字符串）', async () => {
    // 临时让 getDeviceId 抛错
    const storage = (uni as any).getStorageSync
    ;(uni as any).getStorageSync = () => {
      throw new Error('storage broken')
    }
    ;(uni as any).getSystemInfoSync = () => ({ uniPlatform: 'mp-weixin', platform: 'devtools' })

    const promise = post('/api/game/init-factions', { background: '文官' })

    // x-device-id 应为空字符串（不抛错）
    expect(lastCall!.header['x-device-id']).toBe('')

    lastCall!.success({
      statusCode: 200,
      data: { ok: true, data: {} },
      header: {}
    })

    await promise

    // 恢复
    ;(uni as any).getStorageSync = storage
    ;(uni as any).getSystemInfoSync = () => ({ uniPlatform: 'h5', platform: 'h5' })
  })
})

describe('request - body 传递', () => {
  it('POST 请求体原样传给 uni.request.data', async () => {
    const body = { saveId: 'abc', turn: 1, stateSnapshot: { turn: 1 } }
    const promise = post('/api/game/generate-event', body)

    expect(lastCall!.data).toEqual(body)

    lastCall!.success({
      statusCode: 200,
      data: { ok: true, data: { title: '事件' } },
      header: {}
    })

    await promise
  })
})

describe('便捷方法', () => {
  it('put 方法透传 body', async () => {
    const promise = put('/api/game/sync-save', { saveId: 'x' })

    expect(lastCall!.method).toBe('PUT')
    expect(lastCall!.data).toEqual({ saveId: 'x' })

    lastCall!.success({
      statusCode: 200,
      data: { ok: true, data: {} },
      header: {}
    })

    await promise
  })

  it('del 方法无 body', async () => {
    const promise = del('/api/game/sync-save')

    expect(lastCall!.method).toBe('DELETE')

    lastCall!.success({
      statusCode: 200,
      data: { ok: true, data: {} },
      header: {}
    })

    await promise
  })
})
