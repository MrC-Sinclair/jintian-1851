/**
 * @file fallback-factions 单元测试
 *
 * 验证 5 类 background 均返回 6 势力
 */

import { describe, expect, it } from 'vitest'
import { getFallbackFactions } from '../../server/runtime/fallback-factions'

const BACKGROUNDS = ['文官', '武将', '商贾', '士绅', '宗室'] as const

describe('fallback-factions', () => {
  it('5 类 background 均返回 6 势力', () => {
    for (const bg of BACKGROUNDS) {
      const factions = getFallbackFactions(bg)
      expect(factions).toHaveLength(6)
    }
  })

  it('势力名称符合近代历史（湘军、淮军、太平天国、清廷、北洋、革命党）', () => {
    const factions = getFallbackFactions('文官')
    const names = factions.map((f) => f.name)
    // 不依赖 sort 顺序（中文 sort 不稳定），用 Set 比较元素集合
    expect(new Set(names)).toEqual(
      new Set(['北洋', '淮军', '清廷', '湘军', '革命党', '太平天国'])
    )
  })

  it('每条势力含 id/name/summary/initialPower/initialRelationship', () => {
    for (const bg of BACKGROUNDS) {
      const factions = getFallbackFactions(bg)
      for (const f of factions) {
        expect(typeof f.id).toBe('string')
        expect(f.id.length).toBeGreaterThan(0)
        expect(typeof f.name).toBe('string')
        expect(typeof f.summary).toBe('string')
        expect(f.summary.length).toBeGreaterThan(10)
        expect(typeof f.initialPower).toBe('number')
        expect(f.initialPower).toBeGreaterThan(0)
        expect(f.initialPower).toBeLessThanOrEqual(100)
        expect(typeof f.initialRelationship).toBe('number')
        expect(f.initialRelationship).toBeGreaterThanOrEqual(-100)
        expect(f.initialRelationship).toBeLessThanOrEqual(100)
      }
    }
  })

  it('每个 background 有且仅有 1 个推荐势力', () => {
    for (const bg of BACKGROUNDS) {
      const factions = getFallbackFactions(bg)
      const recommended = factions.filter((f) => f.recommended)
      expect(recommended).toHaveLength(1)
    }
  })

  it('文官推荐清廷', () => {
    const factions = getFallbackFactions('文官')
    const recommended = factions.find((f) => f.recommended)
    expect(recommended?.name).toBe('清廷')
  })

  it('武将推荐湘军', () => {
    const factions = getFallbackFactions('武将')
    const recommended = factions.find((f) => f.recommended)
    expect(recommended?.name).toBe('湘军')
  })

  it('商贾推荐淮军', () => {
    const factions = getFallbackFactions('商贾')
    const recommended = factions.find((f) => f.recommended)
    expect(recommended?.name).toBe('淮军')
  })

  it('士绅与宗室均推荐清廷', () => {
    for (const bg of ['士绅', '宗室'] as const) {
      const factions = getFallbackFactions(bg)
      const recommended = factions.find((f) => f.recommended)
      expect(recommended?.name).toBe('清廷')
    }
  })

  it('宗室对清廷关系最高（80），对太平天国最低（-70）', () => {
    const factions = getFallbackFactions('宗室')
    const qingTing = factions.find((f) => f.name === '清廷')
    const taiPing = factions.find((f) => f.name === '太平天国')
    expect(qingTing?.initialRelationship).toBe(80)
    expect(taiPing?.initialRelationship).toBe(-70)
  })

  it('不同 background 同一势力关系不同', () => {
    const wenguan = getFallbackFactions('文官').find((f) => f.name === '清廷')
    const zongshi = getFallbackFactions('宗室').find((f) => f.name === '清廷')
    expect(wenguan?.initialRelationship).not.toBe(zongshi?.initialRelationship)
    expect(zongshi?.initialRelationship).toBeGreaterThan(wenguan!.initialRelationship)
  })
})
