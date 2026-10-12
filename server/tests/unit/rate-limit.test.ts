/**
 * @file rate-limit 单元测试
 *
 * 覆盖正常/超限/重置、路径→桶的映射、以及两个桶互相独立计数。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearRateLimit,
  getRateBucket,
  getRemaining,
  isRateLimited
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

describe('getRateBucket', () => {
  it('AI 端点归入 ai 桶', () => {
    expect(getRateBucket('/api/game/init-factions')).toBe('ai')
    expect(getRateBucket('/api/game/generate-event')).toBe('ai')
    expect(getRateBucket('/api/game/resolve-decision')).toBe('ai')
    expect(getRateBucket('/api/game/npc-actions')).toBe('ai')
    expect(getRateBucket('/api/game/advisor-chat')).toBe('ai')
    expect(getRateBucket('/api/game/advisor-briefing')).toBe('ai')
    expect(getRateBucket('/api/game/faction-negotiate')).toBe('ai')
  })

  it('存档读写也归 ai 桶（能批量读删，不能免限）', () => {
    expect(getRateBucket('/api/game/saves')).toBe('ai')
    expect(getRateBucket('/api/game/saves?deviceId=x')).toBe('ai')
    expect(getRateBucket('/api/game/saves?saveId=x')).toBe('ai')
  })

  it('sync-save 归独立的 save 桶（此前是完全不限流）', () => {
    expect(getRateBucket('/api/game/sync-save')).toBe('save')
    expect(getRateBucket('/api/game/sync-save?saveId=xxx')).toBe('save')
  })

  it('设备凭据注册归独立的 auth 桶', () => {
    expect(getRateBucket('/api/game/device-credential')).toBe('auth')
    expect(getRateBucket('/api/game/device-credential?x=1')).toBe('auth')
  })

  it('非 /api/game/ 前缀不限流', () => {
    expect(getRateBucket('/api/health')).toBeNull()
    expect(getRateBucket('/')).toBeNull()
    expect(getRateBucket('/index.html')).toBeNull()
  })
})

describe('auth 桶', () => {
  it('每分钟 5 次：第 6 次被限制（注册成功即插一行，且首绑即锁不容扫注）', () => {
    for (let i = 0; i < 5; i++) {
      expect(isRateLimited('device-auth', undefined, 'auth')).toBe(false)
    }
    expect(isRateLimited('device-auth', undefined, 'auth')).toBe(true)
    expect(getRemaining('device-auth', undefined, 'auth')).toBe(0)
  })

  it('auth 桶打满不影响 save 桶', () => {
    for (let i = 0; i < 5; i++) isRateLimited('device-auth2', undefined, 'auth')
    expect(isRateLimited('device-auth2', undefined, 'auth')).toBe(true)
    expect(isRateLimited('device-auth2', undefined, 'save')).toBe(false)
  })
})

describe('save 桶', () => {
  it('每分钟 30 次：第 31 次才被限制', () => {
    for (let i = 0; i < 30; i++) {
      expect(isRateLimited('device-save', undefined, 'save')).toBe(false)
    }
    expect(isRateLimited('device-save', undefined, 'save')).toBe(true)
    expect(getRemaining('device-save', undefined, 'save')).toBe(0)
  })

  it('两个桶互不影响：save 桶打满不会饿死 ai 桶', () => {
    // 正常一回合就要发 4-5 个请求（事件/简报/NPC/决策/同步），
    // 若共用一个 10 次/分钟的桶，玩家两三个回合就会被 429 卡住
    for (let i = 0; i < 30; i++) isRateLimited('device-mix', undefined, 'save')
    expect(isRateLimited('device-mix', undefined, 'save')).toBe(true)
    expect(isRateLimited('device-mix', undefined, 'ai')).toBe(false)
    expect(getRemaining('device-mix', undefined, 'ai')).toBe(9)
  })

  it('ai 桶打满也不影响 save 桶', () => {
    for (let i = 0; i < 10; i++) isRateLimited('device-mix2', undefined, 'ai')
    expect(isRateLimited('device-mix2', undefined, 'ai')).toBe(true)
    expect(isRateLimited('device-mix2', undefined, 'save')).toBe(false)
  })
})
