/**
 * @file rate-limit 单元测试
 *
 * 覆盖正常/超限/重置
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearRateLimit,
  getRemaining,
  isRateLimited,
  shouldRateLimit
} from '../../server/utils/rate-limit'

afterEach(() => {
  clearRateLimit()
})

describe('rate-limit', () => {
  it('首次请求放行（计数 1）', () => {
    expect(isRateLimited('device-1')).toBe(false)
    expect(getRemaining('device-1')).toBe(9)
  })

  it('10 次内都放行', () => {
    for (let i = 0; i < 10; i++) {
      expect(isRateLimited('device-2')).toBe(false)
    }
    expect(getRemaining('device-2')).toBe(0)
  })

  it('第 11 次被限制', () => {
    for (let i = 0; i < 10; i++) {
      isRateLimited('device-3')
    }
    expect(isRateLimited('device-3')).toBe(true)
  })

  it('不同 deviceId 独立计数', () => {
    for (let i = 0; i < 10; i++) {
      isRateLimited('device-A')
    }
    expect(isRateLimited('device-A')).toBe(true)
    // device-B 未耗尽，应放行
    expect(isRateLimited('device-B')).toBe(false)
  })

  it('1 分钟窗口重置后重新放行', () => {
    vi.useFakeTimers()
    try {
      const start = Date.now()
      vi.setSystemTime(start)

      for (let i = 0; i < 10; i++) {
        isRateLimited('device-4')
      }
      expect(isRateLimited('device-4')).toBe(true)

      // 推进 61 秒，窗口应已重置
      vi.setSystemTime(start + 61 * 1000)
      expect(isRateLimited('device-4')).toBe(false)
      expect(getRemaining('device-4')).toBe(9)
    } finally {
      vi.useRealTimers()
    }
  })

  it('窗口未结束时计数继续累加', () => {
    vi.useFakeTimers()
    try {
      const start = Date.now()
      vi.setSystemTime(start)

      isRateLimited('device-5')
      expect(getRemaining('device-5')).toBe(9)

      // 推进 30 秒，仍在窗口内
      vi.setSystemTime(start + 30 * 1000)
      isRateLimited('device-5')
      expect(getRemaining('device-5')).toBe(8)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('shouldRateLimit', () => {
  it('/api/game/init-factions 应限制', () => {
    expect(shouldRateLimit('/api/game/init-factions')).toBe(true)
  })

  it('/api/game/generate-event 应限制', () => {
    expect(shouldRateLimit('/api/game/generate-event')).toBe(true)
  })

  it('/api/game/resolve-decision 应限制', () => {
    expect(shouldRateLimit('/api/game/resolve-decision')).toBe(true)
  })

  it('/api/game/npc-actions 应限制', () => {
    expect(shouldRateLimit('/api/game/npc-actions')).toBe(true)
  })

  it('/api/game/advisor-chat 应限制', () => {
    expect(shouldRateLimit('/api/game/advisor-chat')).toBe(true)
  })

  it('/api/game/sync-save 不应限制', () => {
    expect(shouldRateLimit('/api/game/sync-save')).toBe(false)
  })

  it('/api/game/sync-save?saveId=xxx 不应限制', () => {
    expect(shouldRateLimit('/api/game/sync-save?saveId=xxx')).toBe(false)
  })

  it('/api/health 不应限制（非 /api/game/ 前缀）', () => {
    expect(shouldRateLimit('/api/health')).toBe(false)
  })

  it('非 API 路径不应限制', () => {
    expect(shouldRateLimit('/')).toBe(false)
    expect(shouldRateLimit('/index.html')).toBe(false)
  })
})
