/**
 * @file 谈判兑换表纯函数单测（sanitizeDeal / scaleDealValues）
 */
import { describe, expect, it } from 'vitest'
import {
  NEGOTIATION_DEALS,
  getDealById,
  sanitizeDeal,
  scaleDealValues
} from '../../server/utils/negotiation-deals'

describe('NEGOTIATION_DEALS 表完整性', () => {
  it('4 条交易，id 唯一', () => {
    expect(NEGOTIATION_DEALS).toHaveLength(4)
    const ids = NEGOTIATION_DEALS.map((d) => d.id)
    expect(new Set(ids).size).toBe(4)
  })

  it('所有价格/效果区间下限 ≤ 上限', () => {
    for (const d of NEGOTIATION_DEALS) {
      expect(d.cost.silver[0]).toBeLessThanOrEqual(d.cost.silver[1])
      expect(d.effect.relationship[0]).toBeLessThanOrEqual(d.effect.relationship[1])
      if (d.cost.reputation) {
        expect(d.cost.reputation[0]).toBeLessThanOrEqual(d.cost.reputation[1])
      }
      if (d.effect.reputation) {
        expect(d.effect.reputation[0]).toBeLessThanOrEqual(d.effect.reputation[1])
      }
    }
  })

  it('status 变更仅 alliance-deal 拥有', () => {
    for (const d of NEGOTIATION_DEALS) {
      if (d.id === 'alliance-deal') expect(d.effect.status).toBe('allied')
      else expect(d.effect.status).toBeUndefined()
    }
  })
})

describe('getDealById', () => {
  it('命中返回定义，未命中返回 undefined', () => {
    expect(getDealById('gift-deal')?.label).toBe('馈赠通好')
    expect(getDealById('war-deal')).toBeUndefined()
  })
})

describe('sanitizeDeal（防幻觉）', () => {
  it('合法 dealId + 区间内价格：原样通过', () => {
    expect(sanitizeDeal({ dealId: 'gift-deal', price: 100 }, 10)).toEqual({
      dealId: 'gift-deal',
      price: 100
    })
  })

  it('非法 dealId → null', () => {
    expect(sanitizeDeal({ dealId: 'war-deal', price: 100 }, 10)).toBeNull()
    expect(sanitizeDeal({ dealId: 123, price: 100 }, 10)).toBeNull()
    expect(sanitizeDeal(null, 10)).toBeNull()
  })

  it('价格越界 clamp 回区间（gift-deal [60,120]）', () => {
    expect(sanitizeDeal({ dealId: 'gift-deal', price: 500 }, 10)?.price).toBe(120)
    expect(sanitizeDeal({ dealId: 'gift-deal', price: 1 }, 10)?.price).toBe(60)
  })

  it('非数字价格兜底取区间上限', () => {
    expect(sanitizeDeal({ dealId: 'gift-deal', price: 'abc' }, 10)?.price).toBe(120)
    expect(sanitizeDeal({ dealId: 'gift-deal' }, 10)?.price).toBe(120)
  })

  it('关系门槛：alliance-deal 需 ≥35，truce-deal 需 ≤-30', () => {
    // alliance-deal：关系 10 < 35 → 拒绝
    expect(sanitizeDeal({ dealId: 'alliance-deal', price: 160 }, 10)).toBeNull()
    // alliance-deal：关系 40 ≥ 35 → 通过
    expect(sanitizeDeal({ dealId: 'alliance-deal', price: 160 }, 40)).toEqual({
      dealId: 'alliance-deal',
      price: 160
    })
    // truce-deal：关系 0 > -30 → 拒绝（非敌对状态无破财止战）
    expect(sanitizeDeal({ dealId: 'truce-deal', price: 100 }, 0)).toBeNull()
    // truce-deal：关系 -50 ≤ -30 → 通过
    expect(sanitizeDeal({ dealId: 'truce-deal', price: 100 }, -50)).toEqual({
      dealId: 'truce-deal',
      price: 100
    })
  })
})

describe('scaleDealValues（线性缩放）', () => {
  it('gift-deal ratio=0（下限价 60）→ 效果取下限', () => {
    const r = scaleDealValues(getDealById('gift-deal')!, 60)
    expect(r.cost.silver).toBe(60)
    expect(r.effect.relationship).toBe(10)
  })

  it('gift-deal ratio=1（上限价 120）→ 效果取上限', () => {
    const r = scaleDealValues(getDealById('gift-deal')!, 120)
    expect(r.cost.silver).toBe(120)
    expect(r.effect.relationship).toBe(20)
  })

  it('gift-deal ratio=0.5（价 90）→ 效果 15', () => {
    const r = scaleDealValues(getDealById('gift-deal')!, 90)
    expect(r.effect.relationship).toBe(15)
  })

  it('alliance-deal 价 160（ratio 0.5）→ 关系 28 / 名望成本 8 / status allied（effect 无名望项）', () => {
    const r = scaleDealValues(getDealById('alliance-deal')!, 160)
    expect(r.cost.silver).toBe(160)
    expect(r.cost.reputation).toBe(8)
    expect(r.effect.relationship).toBe(28)
    expect(r.effect.reputation).toBeUndefined()
    expect(r.effect.status).toBe('allied')
  })

  it('越界价格 ratio clamp 0~1', () => {
    expect(scaleDealValues(getDealById('gift-deal')!, 10).effect.relationship).toBe(10)
    expect(scaleDealValues(getDealById('gift-deal')!, 999).effect.relationship).toBe(20)
  })

  it('还价低于下限（如 30）→ ratio 0，按下限效果执行', () => {
    const r = scaleDealValues(getDealById('gift-deal')!, 30)
    expect(r.cost.silver).toBe(30)
    expect(r.effect.relationship).toBe(10)
  })
})
