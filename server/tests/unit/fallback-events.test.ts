/**
 * @file fallback-events 单元测试
 *
 * 验证总数 = 60 与 5 类型各 12 条；兜底事件不携带 chainId
 */

import { describe, expect, it } from 'vitest'
import { FALLBACK_EVENTS, getRandomFallbackEvent } from '../../server/runtime/fallback-events'

describe('fallback-events', () => {
  it('总数 = 60', () => {
    expect(FALLBACK_EVENTS.length).toBe(60)
  })

  it('5 类型各 12 条', () => {
    const counts: Record<string, number> = {}
    for (const e of FALLBACK_EVENTS) {
      counts[e.type] = (counts[e.type] ?? 0) + 1
    }
    expect(counts['民生']).toBe(12)
    expect(counts['军事']).toBe(12)
    expect(counts['外交']).toBe(12)
    expect(counts['随机']).toBe(12)
    expect(counts['历史剧情']).toBe(12)
  })

  it('兜底事件不携带 chainId 字段', () => {
    for (const e of FALLBACK_EVENTS) {
      expect(e).not.toHaveProperty('chainId')
      expect(e).not.toHaveProperty('chainNodeId')
      expect(e).not.toHaveProperty('chainProgress')
    }
  })

  it('每条事件含 title/description/options(2-4)/eventType', () => {
    for (const e of FALLBACK_EVENTS) {
      expect(typeof e.title).toBe('string')
      expect(e.title.length).toBeGreaterThan(0)
      expect(typeof e.description).toBe('string')
      expect(e.description.length).toBeGreaterThanOrEqual(20)
      expect(Array.isArray(e.options)).toBe(true)
      expect(e.options.length).toBeGreaterThanOrEqual(2)
      expect(e.options.length).toBeLessThanOrEqual(4)
      expect(['民生', '军事', '外交', '随机', '历史剧情']).toContain(e.eventType)
    }
  })

  it('每个 option 含 id/label/effects，effects 数值合理', () => {
    // 属性（military/economy/politics/people/diplomacy/reputation）变化幅度 ±1~15
    // 资源（silver/troops/food）变化幅度 ±50~500（绝对值更大）
    const attrKeys = ['military', 'economy', 'politics', 'people', 'diplomacy', 'reputation']
    for (const e of FALLBACK_EVENTS) {
      for (const opt of e.options) {
        expect(typeof opt.id).toBe('string')
        expect(opt.id.length).toBeGreaterThan(0)
        expect(typeof opt.label).toBe('string')
        expect(opt.label.length).toBeGreaterThan(0)
        expect(typeof opt.effects).toBe('object')
        // effects 不能全为 0
        const allValues = Object.values(opt.effects)
        expect(allValues.some((v) => v !== 0)).toBe(true)
        for (const [k, v] of Object.entries(opt.effects)) {
          if (attrKeys.includes(k)) {
            expect(Math.abs(v as number)).toBeLessThanOrEqual(15)
          } else {
            // silver/troops/food 资源类
            expect(Math.abs(v as number)).toBeLessThanOrEqual(500)
          }
        }
      }
    }
  })

  it('getRandomFallbackEvent 返回合法事件', () => {
    for (let i = 0; i < 20; i++) {
      const e = getRandomFallbackEvent()
      expect(e).toBeDefined()
      expect(e.options.length).toBeGreaterThanOrEqual(2)
      // 返回的 GameEvent 不应含 type 字段
      expect(e).not.toHaveProperty('type')
    }
  })

  it('getRandomFallbackEvent 按类型筛选', () => {
    for (let i = 0; i < 10; i++) {
      const e = getRandomFallbackEvent('军事')
      expect(e.eventType).toBe('军事')
    }
  })

  it('getRandomFallbackEvent 不存在的类型返回全池随机', () => {
    // @ts-expect-error 故意传不存在的类型测试兜底
    const e = getRandomFallbackEvent('不存在的类型')
    expect(e).toBeDefined()
    expect(e.options.length).toBeGreaterThanOrEqual(2)
  })
})
