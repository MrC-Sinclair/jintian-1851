/**
 * @file ai-cache 单元测试
 *
 * 覆盖命中/未命中/过期
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearCache, getCacheSize, getCached, setCached } from '../../server/utils/ai-cache'

afterEach(() => {
  clearCache()
})

describe('ai-cache', () => {
  it('未命中返回 undefined', () => {
    expect(getCached('missing-key')).toBeUndefined()
  })

  it('命中返回缓存值', () => {
    setCached('k1', { hello: 'world' })
    expect(getCached<{ hello: string }>('k1')).toEqual({ hello: 'world' })
  })

  it('TTL 过期后返回 undefined', async () => {
    setCached('k2', 'value', 100) // 100ms TTL
    expect(getCached('k2')).toBe('value')
    await new Promise((r) => setTimeout(r, 150))
    expect(getCached('k2')).toBeUndefined()
  })

  it('默认 TTL 5 分钟', () => {
    setCached('k3', 'value')
    expect(getCacheSize()).toBe(1)
    // 验证 5 分钟内仍命中
    expect(getCached('k3')).toBe('value')
  })

  it('相同 key 覆盖写入', () => {
    setCached('k4', 'v1')
    setCached('k4', 'v2')
    expect(getCached('k4')).toBe('v2')
    expect(getCacheSize()).toBe(1)
  })

  it('clearCache 清空所有缓存', () => {
    setCached('k5', 'v1')
    setCached('k6', 'v2')
    expect(getCacheSize()).toBe(2)
    clearCache()
    expect(getCacheSize()).toBe(0)
    expect(getCached('k5')).toBeUndefined()
  })

  it('过期清理不误删其他 key', async () => {
    setCached('k7', 'v1', 100)
    setCached('k8', 'v2', 10000)
    await new Promise((r) => setTimeout(r, 150))
    expect(getCached('k7')).toBeUndefined()
    expect(getCached('k8')).toBe('v2')
  })

  it('用 vi.useFakeTimers 模拟 TTL 过期', () => {
    vi.useFakeTimers()
    try {
      setCached('k9', 'v', 300000) // 5 min
      expect(getCached('k9')).toBe('v')
      vi.advanceTimersByTime(299999)
      expect(getCached('k9')).toBe('v')
      vi.advanceTimersByTime(2)
      expect(getCached('k9')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
