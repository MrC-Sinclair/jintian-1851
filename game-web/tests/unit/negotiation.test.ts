/**
 * @file 谈判（faction-negotiation 提案）前端单测
 *
 * 覆盖：
 *   - scaleNegotiationEffect 缩放计算（ratio 0 / 0.5 / 1 三档）
 *   - store.applyLetterDelta（clamp ±10 / relationship clamp / 事件入档）
 *   - store.applyNegotiationDeal（资源不足拒绝 / 扣费 / alliance status / 事件追加 / 信件 delta 并入）
 *   - 配额语义（markNegotiationUsed / resetDiplomacy 双重置 / 与外交按钮独立）
 *   - useTurn.sendNegotiationLetter / respondNegotiationDeal（letter 置位 / counter 延迟应用 /
 *     fallback 退还 / settle 成交执行 / settle 降级仅信件影响）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// mock utils/api（useTurn 依赖 post / postWithMeta / ApiError）
vi.mock('@/utils/api', () => ({
  post: vi.fn(),
  postWithMeta: vi.fn(),
  ApiError: class ApiError extends Error {
    code: string
    statusCode: number
    constructor(code: string, message: string, statusCode: number) {
      super(message)
      this.code = code
      this.statusCode = statusCode
    }
  }
}))

// mock utils/storage（useGameState.save 调用）
vi.mock('@/utils/storage', () => ({
  saveSave: vi.fn().mockResolvedValue(undefined),
  loadSave: vi.fn().mockResolvedValue(null),
  clearSave: vi.fn().mockResolvedValue(undefined),
  loadSaveSync: vi.fn().mockReturnValue(null)
}))

// mock device-id
vi.mock('@/utils/device-id', () => ({
  getDeviceId: () => 'test-device-id'
}))

import { postWithMeta } from '@/utils/api'
import {
  NEGOTIATION_DEALS,
  getNegotiationDealById,
  scaleNegotiationEffect,
  counterPriceRange
} from '@/utils/constants'
import { useTurn } from '@/composables/useTurn'
import { useGameStore } from '@/stores/game'
import type { GameSave } from '@/types/game'

const postWithMetaMock = vi.mocked(postWithMeta)

function createMockSave(): GameSave {
  return {
    saveVersion: 1,
    saveId: '550e8400-e29b-41d4-a716-446655440000',
    deviceId: 'test-device-id',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    character: {
      background: '文官',
      backgroundPerks: { politics: 5 },
      factionId: 'f1',
      factionName: '清廷',
      factionSummary: '晚清朝廷'
    },
    state: {
      turn: 1,
      date: { year: 1851, month: 1 },
      attributes: { military: 50, economy: 50, politics: 55, people: 50, diplomacy: 50 },
      resources: { silver: 1000, troops: 500, food: 800, reputation: 30 }
    },
    factions: [
      // 谈判目标势力：关系 40（满足 alliance-deal ≥35 门槛）
      { id: 'huai', name: '淮军', summary: '淮勇武装', power: 60, relationship: 40, status: 'active' },
      { id: 'f2', name: '太平天国', summary: '', power: 60, relationship: -50, status: 'active' }
    ],
    events: [],
    advisorMessages: [],
    pendingChainNodes: [],
    completedChainIds: [],
    activeChainIds: [],
    ended: false
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  postWithMetaMock.mockReset()
})

// ====================== 缩放计算 ======================

describe('scaleNegotiationEffect 缩放计算', () => {
  it('gift-deal ratio 0（价 60）→ 关系 +10', () => {
    expect(scaleNegotiationEffect(getNegotiationDealById('gift-deal')!, 60).effect.relationship).toBe(10)
  })

  it('gift-deal ratio 0.5（价 90）→ 关系 +15', () => {
    expect(scaleNegotiationEffect(getNegotiationDealById('gift-deal')!, 90).effect.relationship).toBe(15)
  })

  it('gift-deal ratio 1（价 120）→ 关系 +20', () => {
    expect(scaleNegotiationEffect(getNegotiationDealById('gift-deal')!, 120).effect.relationship).toBe(20)
  })

  it('alliance-deal 价 160（ratio 0.5）→ 关系 +28 / 名望成本 8 / status allied', () => {
    const r = scaleNegotiationEffect(getNegotiationDealById('alliance-deal')!, 160)
    expect(r.cost.reputation).toBe(8)
    expect(r.effect.relationship).toBe(28)
    expect(r.effect.status).toBe('allied')
  })

  it('还价区间：gift-deal 原价 100 → [30, 100]', () => {
    expect(counterPriceRange(getNegotiationDealById('gift-deal')!, 100)).toEqual({ min: 30, max: 100 })
  })

  it('兑换表 4 条且 id 唯一', () => {
    expect(NEGOTIATION_DEALS).toHaveLength(4)
    expect(new Set(NEGOTIATION_DEALS.map((d) => d.id)).size).toBe(4)
  })
})

// ====================== store：applyLetterDelta ======================

describe('store.applyLetterDelta', () => {
  it('应用负 delta 并入档外交事件', () => {
    const store = useGameStore()
    store.setSave(createMockSave())

    store.applyLetterDelta('huai', -8)

    const fac = store.currentSave!.factions.find((f) => f.id === 'huai')!
    expect(fac.relationship).toBe(32)
    const last = store.currentSave!.events[store.currentSave!.events.length - 1]
    expect(last.eventType).toBe('外交')
    expect(last.title).toContain('致书')
  })

  it('delta clamp ±10 / relationship clamp -100~100', () => {
    const store = useGameStore()
    store.setSave(createMockSave())

    store.applyLetterDelta('huai', 99)
    expect(store.currentSave!.factions.find((f) => f.id === 'huai')!.relationship).toBe(50)

    store.applyLetterDelta('f2', -99)
    expect(store.currentSave!.factions.find((f) => f.id === 'f2')!.relationship).toBe(-60)
  })
})

// ====================== store：applyNegotiationDeal ======================

describe('store.applyNegotiationDeal', () => {
  it('成交：扣费正确、关系并入信件 delta、事件追加（gift-deal 价 100）', () => {
    const store = useGameStore()
    store.setSave(createMockSave())

    // gift-deal 价 100 → ratio 2/3 → 关系 +17；信件 +3 → 合计 +20
    const ok = store.applyNegotiationDeal('huai', 'gift-deal', 100, 3)
    expect(ok).toBe(true)
    expect(store.currentSave!.state.resources.silver).toBe(900)
    expect(store.currentSave!.factions.find((f) => f.id === 'huai')!.relationship).toBe(60)
    const last = store.currentSave!.events[store.currentSave!.events.length - 1]
    expect(last.eventType).toBe('外交')
    expect(last.title).toBe('与淮军馈赠通好')
  })

  it('alliance-deal 触发 status=allied + 名望扣减 + lastAction', () => {
    const store = useGameStore()
    store.setSave(createMockSave())

    const ok = store.applyNegotiationDeal('huai', 'alliance-deal', 160, 2)
    expect(ok).toBe(true)
    const fac = store.currentSave!.factions.find((f) => f.id === 'huai')!
    // 银两 1000-160=840；名望 30-8=22；关系 40+2+28=70
    expect(store.currentSave!.state.resources.silver).toBe(840)
    expect(store.currentSave!.state.resources.reputation).toBe(22)
    expect(fac.relationship).toBe(70)
    expect(fac.status).toBe('allied')
    expect(fac.lastAction).toBe('歃血为盟')
  })

  it('资源不足拒绝（银两不够）', () => {
    const store = useGameStore()
    const save = createMockSave()
    save.state.resources.silver = 50
    store.setSave(save)

    expect(store.applyNegotiationDeal('huai', 'gift-deal', 100, 0)).toBe(false)
    expect(store.currentSave!.state.resources.silver).toBe(50)
    expect(store.currentSave!.events).toHaveLength(0)
  })

  it('非法 dealId / 势力不存在 → false', () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    expect(store.applyNegotiationDeal('huai', 'hack-deal' as never, 100, 0)).toBe(false)
    expect(store.applyNegotiationDeal('nope', 'gift-deal', 100, 0)).toBe(false)
  })
})

// ====================== store：配额语义 ======================

describe('谈判配额（negotiationUsedThisTurn）', () => {
  it('markNegotiationUsed 置位，resetDiplomacy 双重重置', () => {
    const store = useGameStore()
    store.setSave(createMockSave())

    store.markNegotiationUsed()
    expect(store.negotiationUsedThisTurn).toBe(true)

    store.resetDiplomacy()
    expect(store.negotiationUsedThisTurn).toBe(false)
    expect(store.diplomacyUsedThisTurn).toBe(false)
  })

  it('与外交按钮配额独立：applyDiplomacyAction 置位外交不影响谈判', () => {
    const store = useGameStore()
    store.setSave(createMockSave())

    // 对 f2（太平天国）宣战：耗 troops 100（500 足够）
    const ok = store.applyDiplomacyAction('f2', '宣战')
    expect(ok).toBe(true)
    expect(store.diplomacyUsedThisTurn).toBe(true)
    expect(store.negotiationUsedThisTurn).toBe(false)
  })
})

// ====================== useTurn：letter 阶段 ======================

describe('useTurn.sendNegotiationLetter', () => {
  it('counter：置位配额，信件 delta 延迟应用（relationship 不变）', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    postWithMetaMock.mockResolvedValueOnce({
      data: {
        stance: 'counter',
        reply: '条件已开。',
        relationshipDelta: 5,
        deal: { dealId: 'gift-deal', price: 100 }
      },
      fallback: false
    })

    const { sendNegotiationLetter } = useTurn()
    const res = await sendNegotiationLetter('huai', '愿以薄礼相赠')

    expect(res?.stance).toBe('counter')
    expect(res?.fallback).toBe(false)
    expect(store.negotiationUsedThisTurn).toBe(true)
    // counter 时 delta 延迟到 settle，relationship 保持 40
    expect(store.currentSave!.factions.find((f) => f.id === 'huai')!.relationship).toBe(40)
    // 请求体校验
    expect(postWithMetaMock).toHaveBeenCalledWith(
      '/api/game/faction-negotiate',
      expect.objectContaining({ phase: 'letter', factionId: 'huai' })
    )
  })

  it('reject：立即应用信件 delta 并入档', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    postWithMetaMock.mockResolvedValueOnce({
      data: { stance: 'reject', reply: '不必了。', relationshipDelta: -8 },
      fallback: false
    })

    const { sendNegotiationLetter } = useTurn()
    const res = await sendNegotiationLetter('huai', '可否结盟？')

    expect(res?.stance).toBe('reject')
    expect(store.negotiationUsedThisTurn).toBe(true)
    expect(store.currentSave!.factions.find((f) => f.id === 'huai')!.relationship).toBe(32)
    expect(store.currentSave!.events).toHaveLength(1)
  })

  it('fallback：不置位配额、不应用效果（允许重试）', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    postWithMetaMock.mockResolvedValueOnce({
      data: { stance: 'reject', reply: '', relationshipDelta: 0 },
      fallback: true
    })

    const { sendNegotiationLetter } = useTurn()
    const res = await sendNegotiationLetter('huai', '试一试')

    expect(res?.fallback).toBe(true)
    expect(store.negotiationUsedThisTurn).toBe(false)
    expect(store.currentSave!.factions.find((f) => f.id === 'huai')!.relationship).toBe(40)
    expect(store.currentSave!.events).toHaveLength(0)
  })

  it('配额已用：直接返回 null 不调 API', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    store.markNegotiationUsed()

    const { sendNegotiationLetter } = useTurn()
    const res = await sendNegotiationLetter('huai', '再写一封')
    expect(res).toBeNull()
    expect(postWithMetaMock).not.toHaveBeenCalled()
  })
})

// ====================== useTurn：settle 阶段 ======================

describe('useTurn.respondNegotiationDeal', () => {
  it('接受条件成交：按原价执行兑换（扣费 + 关系并入信件 delta）', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    postWithMetaMock.mockResolvedValueOnce({
      data: { stance: 'accept', reply: '一言为定。', relationshipDelta: 2 },
      fallback: false
    })

    const { respondNegotiationDeal } = useTurn()
    const res = await respondNegotiationDeal({
      factionId: 'huai',
      letter: '愿以薄礼相赠',
      previousReply: '条件已开。',
      deal: { dealId: 'gift-deal', price: 100 },
      playerResponse: 'accept',
      letterDelta: 3
    })

    expect(res?.stance).toBe('accept')
    // gift-deal 价 100 → 关系 +17；信件 +3 → 40+20=60；银两 1000-100=900
    expect(store.currentSave!.factions.find((f) => f.id === 'huai')!.relationship).toBe(60)
    expect(store.currentSave!.state.resources.silver).toBe(900)
    // settle 不重复计配额
    expect(store.negotiationUsedThisTurn).toBe(false)
    expect(postWithMetaMock).toHaveBeenCalledWith(
      '/api/game/faction-negotiate',
      expect.objectContaining({ phase: 'settle', playerResponse: 'accept' })
    )
  })

  it('还价被接受：按还价成交（低价新 ratio）', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    postWithMetaMock.mockResolvedValueOnce({
      data: { stance: 'accept', reply: '也罢。', relationshipDelta: 0 },
      fallback: false
    })

    const { respondNegotiationDeal } = useTurn()
    const res = await respondNegotiationDeal({
      factionId: 'huai',
      letter: '愿以薄礼相赠',
      previousReply: '条件已开。',
      deal: { dealId: 'gift-deal', price: 100 },
      playerResponse: 'counter',
      counterPrice: 60,
      letterDelta: 0
    })

    expect(res?.stance).toBe('accept')
    // 还价 60 = 下限 → ratio 0 → 关系 +10 → 40+10=50；银两扣 60
    expect(store.currentSave!.factions.find((f) => f.id === 'huai')!.relationship).toBe(50)
    expect(store.currentSave!.state.resources.silver).toBe(940)
  })

  it('还价被拒：仅应用信件 delta', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    postWithMetaMock.mockResolvedValueOnce({
      data: { stance: 'reject', reply: '断然不可。', relationshipDelta: -1 },
      fallback: false
    })

    const { respondNegotiationDeal } = useTurn()
    const res = await respondNegotiationDeal({
      factionId: 'huai',
      letter: '愿以薄礼相赠',
      previousReply: '条件已开。',
      deal: { dealId: 'gift-deal', price: 100 },
      playerResponse: 'counter',
      counterPrice: 30,
      letterDelta: -5
    })

    expect(res?.stance).toBe('reject')
    expect(store.currentSave!.factions.find((f) => f.id === 'huai')!.relationship).toBe(35)
    expect(store.currentSave!.state.resources.silver).toBe(1000)
  })

  it('settle 降级：仅应用信件 delta（配额不退）', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    postWithMetaMock.mockResolvedValueOnce({
      data: { stance: 'reject', reply: '', relationshipDelta: 0 },
      fallback: true
    })

    const { respondNegotiationDeal } = useTurn()
    const res = await respondNegotiationDeal({
      factionId: 'huai',
      letter: '愿以薄礼相赠',
      previousReply: '条件已开。',
      deal: { dealId: 'gift-deal', price: 100 },
      playerResponse: 'accept',
      letterDelta: 4
    })

    expect(res?.fallback).toBe(true)
    expect(store.currentSave!.factions.find((f) => f.id === 'huai')!.relationship).toBe(44)
    expect(store.currentSave!.state.resources.silver).toBe(1000)
  })
})
