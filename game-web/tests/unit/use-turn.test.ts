/**
 * @file useTurn.ts 单元测试
 *
 * 验证回合流程编排：
 *   - startTurn: 调用 generate-event，写入 store.currentEvent
 *   - makeDecision（选项）: 本地应用 effects，不调 API
 *   - makeDecision（自由输入）: 调用 resolve-decision
 *   - endTurn: npc-actions + effects + 历史 + turn+1 + 持久化
 *   - 失败降级不阻断
 *   - isProcessingTurn 守卫防重复
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTurn } from '../../src/composables/useTurn'
import { useGameStore } from '../../src/stores/game'
import type { GameSave } from '../../src/types/game'

// mock utils/api 的 post / postWithMeta（useTurn 谈判方法依赖 postWithMeta）
vi.mock('@/utils/api', () => ({
  post: vi.fn(),
  postWithMeta: vi.fn(),
  // 与 src/utils/api.ts 保持一致：这两类码的 message 是给开发者看的，UI 展示前要归一
  TECHNICAL_ERROR_CODES: new Set(['NETWORK', 'INVALID_RESPONSE']),
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

// mock utils/storage 的 saveSave（useGameState.save 调用）
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

import { post, ApiError } from '@/utils/api'
import { ERROR_TEXT } from '@/utils/copywriting'

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
      resources: { silver: 1000, troops: 500, food: 800, reputation: 10 }
    },
    factions: [
      { id: 'f2', name: '太平天国', summary: '', power: 60, relationship: -50, status: 'active' }
    ],
    events: [],
    advisorMessages: [],
    // T3.3：v2 存档必传的剧情链运行时状态
    pendingChainNodes: [],
    completedChainIds: [],
    activeChainIds: [],
    ended: false
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(post).mockReset()
  vi.mocked(uni.redirectTo).mockReset()
})

describe('startTurn', () => {
  it('调用 generate-event 写入 store.currentEvent', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    // 注意：后端 generate-event 真实响应是 { ok: true, data: { event: { title, ... } } }
    // 单元测试中 post 工具返回 res.data（详见 utils/api），所以这里直接给 { event: { ... } }
    vi.mocked(post).mockResolvedValueOnce({
      event: {
        title: '事件1',
        description: '描述',
        eventType: '随机',
        options: [{ id: 'o1', label: '选项', effects: { military: 5 } }]
      }
    })
    // T1.15：startTurn 内 generate-event 成功后会再调 advisor-briefing，需补 mock
    vi.mocked(post).mockResolvedValueOnce({
      summary: '局势平稳',
      suggestion: '本回合建议：稳步发展各项实力'
    })

    const { startTurn } = useTurn()
    const event = await startTurn()

    expect(post).toHaveBeenCalledWith(
      '/api/game/generate-event',
      expect.objectContaining({
        saveId: '550e8400-e29b-41d4-a716-446655440000',
        turn: 1
      })
    )
    expect(post).toHaveBeenCalledWith(
      '/api/game/advisor-briefing',
      expect.objectContaining({
        saveId: '550e8400-e29b-41d4-a716-446655440000',
        turn: 1
      })
    )
    expect(event).not.toBeNull()
    expect(event?.title).toBe('事件1')
    expect(store.currentEvent?.title).toBe('事件1')
  })

  it('时光跳跃：事件带 eventDate 且晚于当前日历时，把游戏年月推到锚点', async () => {
    const store = useGameStore()
    store.setSave(createMockSave()) // state.date = 1851-01
    vi.mocked(post).mockResolvedValueOnce({
      event: {
        title: '定都天京',
        description: '太平军攻陷江宁。',
        eventType: '历史剧情',
        options: [{ id: 'o1', label: '选项', effects: {} }],
        chainId: 'tai-ping-tian-guo',
        chainNodeId: 'node-2',
        eventDate: { year: 1853, month: 1 }
      }
    })
    vi.mocked(post).mockResolvedValueOnce({ summary: '', suggestion: '' })

    const { startTurn } = useTurn()
    const event = await startTurn()

    expect(event?.eventDate).toEqual({ year: 1853, month: 1 })
    expect(store.currentSave?.state.date).toEqual({ year: 1853, month: 1 })
  })

  it('时光跳跃：eventDate 早于或等于当前日历时不回拨时间', async () => {
    const store = useGameStore()
    store.setSave(createMockSave()) // state.date = 1851-01
    vi.mocked(post).mockResolvedValueOnce({
      event: {
        title: '金田起义',
        description: '桂平举旗。',
        eventType: '历史剧情',
        options: [{ id: 'o1', label: '选项', effects: {} }],
        eventDate: { year: 1850, month: 6 }
      }
    })
    vi.mocked(post).mockResolvedValueOnce({ summary: '', suggestion: '' })

    const { startTurn } = useTurn()
    await startTurn()

    expect(store.currentSave?.state.date).toEqual({ year: 1851, month: 1 })
  })

  it('普通事件无 eventDate 时日历保持不变', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    vi.mocked(post).mockResolvedValueOnce({
      event: {
        title: '事件',
        description: '',
        eventType: '随机',
        options: [{ id: 'o1', label: '选项', effects: {} }]
      }
    })
    vi.mocked(post).mockResolvedValueOnce({ summary: '', suggestion: '' })

    const { startTurn } = useTurn()
    await startTurn()

    expect(store.currentSave?.state.date).toEqual({ year: 1851, month: 1 })
  })

  it('无存档返回 null', async () => {
    const { startTurn } = useTurn()
    const event = await startTurn()
    expect(event).toBeNull()
    expect(post).not.toHaveBeenCalled()
  })

  it('generate-event 失败返回 null 并清空 currentEvent', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    vi.mocked(post).mockRejectedValueOnce(new Error('LLM 失败'))

    const { startTurn } = useTurn()
    const event = await startTurn()

    expect(event).toBeNull()
    expect(store.currentEvent).toBeNull()
    // generate-event 失败不应触发 advisor-briefing 调用
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('isProcessingTurn 期间重复调用返回 null', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    store.setProcessingTurn(true)

    const { startTurn } = useTurn()
    const event = await startTurn()

    expect(event).toBeNull()
    expect(post).not.toHaveBeenCalled()
  })

  // ====================== T1.15 新增：危机检查 + AI 简报 ======================
  it('T1.15：属性 <30 时触发 onCrisis 回调（取最低者）', async () => {
    const store = useGameStore()
    const save = createMockSave()
    // military=15 触发危机，people=20 也触发，应取最低者 military
    save.state.attributes = { military: 15, economy: 50, politics: 50, people: 20, diplomacy: 50 }
    store.setSave(save)
    vi.mocked(post).mockResolvedValueOnce({
      event: {
        title: '事件',
        description: '',
        eventType: '随机',
        options: [{ id: 'o1', label: '选项', effects: {} }]
      }
    })
    vi.mocked(post).mockResolvedValueOnce({ summary: '', suggestion: '' })

    const onCrisis = vi.fn()
    const { startTurn } = useTurn({ onCrisis })
    await startTurn()

    expect(onCrisis).toHaveBeenCalledOnce()
    expect(onCrisis).toHaveBeenCalledWith(
      expect.objectContaining({
        attr: 'military',
        name: '军事',
        value: 15
      })
    )
  })

  it('T1.15：属性都 ≥30 时不触发 onCrisis', async () => {
    const store = useGameStore()
    store.setSave(createMockSave()) // 默认 50/50/55/50/50，无危机
    vi.mocked(post).mockResolvedValueOnce({
      event: {
        title: '事件',
        description: '',
        eventType: '随机',
        options: [{ id: 'o1', label: '选项', effects: {} }]
      }
    })
    vi.mocked(post).mockResolvedValueOnce({ summary: '', suggestion: '' })

    const onCrisis = vi.fn()
    const { startTurn } = useTurn({ onCrisis })
    await startTurn()

    expect(onCrisis).not.toHaveBeenCalled()
  })

  /** 排空微任务：简报已改为非阻塞，回调在 startTurn 返回后的微任务里才落地 */
  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }

  it('T1.15：advisor-briefing 成功触发 onBriefing 回调', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    vi.mocked(post).mockResolvedValueOnce({
      event: {
        title: '事件',
        description: '',
        eventType: '随机',
        options: [{ id: 'o1', label: '选项', effects: {} }]
      }
    })
    vi.mocked(post).mockResolvedValueOnce({
      summary: '局势紧张',
      suggestion: '优先应对军事危机'
    })

    const onBriefing = vi.fn()
    const { startTurn } = useTurn({ onBriefing })
    const event = await startTurn()
    await flushMicrotasks()

    expect(onBriefing).toHaveBeenCalledOnce()
    expect(onBriefing).toHaveBeenCalledWith({
      summary: '局势紧张',
      suggestion: '优先应对军事危机'
    })
    // 事件仍正常返回（briefing 失败不阻断主流程）
    expect(event).not.toBeNull()
  })

  it('T1.15：advisor-briefing 失败触发 onBriefing(null)，事件仍正常返回', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    vi.mocked(post).mockResolvedValueOnce({
      event: {
        title: '事件',
        description: '',
        eventType: '随机',
        options: [{ id: 'o1', label: '选项', effects: {} }]
      }
    })
    // advisor-briefing 失败
    vi.mocked(post).mockRejectedValueOnce(new Error('briefing 失败'))

    const onBriefing = vi.fn()
    const { startTurn } = useTurn({ onBriefing })
    const event = await startTurn()
    await flushMicrotasks()

    expect(onBriefing).toHaveBeenCalledWith(null)
    // 事件仍正常返回（briefing 失败不阻断主流程）
    expect(event).not.toBeNull()
    expect(event?.title).toBe('事件')
  })

  it('简报不阻塞回合开始：事件已返回时简报仍未落地', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    vi.mocked(post).mockResolvedValueOnce({
      event: {
        title: '事件',
        description: '',
        eventType: '随机',
        options: [{ id: 'o1', label: '选项', effects: {} }]
      }
    })
    let settleBriefing: (v: unknown) => void = () => {}
    vi.mocked(post).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settleBriefing = resolve
        }) as never
    )

    const onBriefing = vi.fn()
    const { startTurn } = useTurn({ onBriefing })
    const event = await startTurn()

    // 关键断言：startTurn 没有等简报
    expect(event?.title).toBe('事件')
    expect(onBriefing).not.toHaveBeenCalled()

    settleBriefing({ summary: '稍后到达', suggestion: '稍后建议' })
    await flushMicrotasks()
    expect(onBriefing).toHaveBeenCalledWith({ summary: '稍后到达', suggestion: '稍后建议' })
  })

  it('旧回合的慢简报不得覆盖新简报（briefingSeq 守卫）', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const settles: Array<(v: unknown) => void> = []
    // 按 URL 分派：事件立即返回，简报挂起等待手动 resolve
    // （不用 mockResolvedValueOnce 队列，因为它是按调用顺序消费的，会串台）
    vi.mocked(post).mockImplementation(((url: string) => {
      if (url === '/api/game/generate-event') {
        return Promise.resolve({
          event: {
            title: '事件',
            description: '',
            eventType: '随机',
            options: [{ id: 'o1', label: '选项', effects: {} }]
          }
        })
      }
      return new Promise((resolve) => {
        settles.push(resolve as (v: unknown) => void)
      })
    }) as never)

    const onBriefing = vi.fn()
    const { startTurn } = useTurn({ onBriefing })

    await startTurn() // 发起简报 #1
    await startTurn() // 发起简报 #2，#1 作废
    expect(settles).toHaveLength(2)

    settles[1]({ summary: '新简报', suggestion: '新建议' })
    await flushMicrotasks()
    expect(onBriefing).toHaveBeenCalledWith({ summary: '新简报', suggestion: '新建议' })

    // #1 迟到：必须被丢弃，不能再回调
    settles[0]({ summary: '旧简报', suggestion: '旧建议' })
    await flushMicrotasks()
    expect(onBriefing).toHaveBeenCalledTimes(1)
  })

  // ====================== T3.3：请求 body 携带剧情链运行时状态 ======================
  it('T3.3：startTurn 请求体含 pendingChainNodes/completedChainIds/activeChainIds', async () => {
    const store = useGameStore()
    const save = createMockSave()
    // 预置一些剧情链运行时状态，验证被原样透传给后端
    save.pendingChainNodes = [
      { chainId: 'tai-ping-tian-guo', nodeId: 'node-2', scheduledTurn: 4 }
    ]
    save.completedChainIds = ['yang-wu-yun-dong']
    save.activeChainIds = ['tai-ping-tian-guo']
    store.setSave(save)

    vi.mocked(post).mockResolvedValueOnce({
      event: { title: '事件', description: '', eventType: '随机', options: [{ id: 'o1', label: '选项', effects: {} }] }
    })
    vi.mocked(post).mockResolvedValueOnce({ summary: '', suggestion: '' })

    const { startTurn } = useTurn()
    await startTurn()

    // 取 generate-event 那次调用的 body
    const generateCall = vi.mocked(post).mock.calls[0]
    const body = generateCall[1] as Record<string, unknown>
    expect(body.pendingChainNodes).toEqual([
      { chainId: 'tai-ping-tian-guo', nodeId: 'node-2', scheduledTurn: 4 }
    ])
    expect(body.completedChainIds).toEqual(['yang-wu-yun-dong'])
    expect(body.activeChainIds).toEqual(['tai-ping-tian-guo'])
  })

  it('事件权重提案：startTurn 请求体携带 attributeShortfall（属性短板信号）', async () => {
    const store = useGameStore()
    const save = createMockSave()
    // military=15 低于 CRISIS_THRESHOLD(30)，应被识别为短板
    save.state.attributes = { military: 15, economy: 50, politics: 50, people: 50, diplomacy: 50 }
    store.setSave(save)

    vi.mocked(post).mockResolvedValueOnce({
      event: { title: '事件', description: '', eventType: '随机', options: [{ id: 'o1', label: '选项', effects: {} }] }
    })
    vi.mocked(post).mockResolvedValueOnce({ summary: '', suggestion: '' })

    const { startTurn } = useTurn()
    await startTurn()

    const generateCall = vi.mocked(post).mock.calls[0]
    const body = generateCall[1] as Record<string, unknown>
    expect(body.attributeShortfall).toEqual([{ dimension: 'military', value: 15 }])
  })
})

describe('makeDecision - 选项决策', () => {
  it('选项决策本地应用 effects，不调 API', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [
        { id: 'o1', label: '增兵', effects: { military: 10, silver: -100 } },
        { id: 'o2', label: '减税', effects: { economy: -5, people: 10 } }
      ]
    })

    const { makeDecision } = useTurn()
    const effects = await makeDecision('o1')

    expect(effects).toEqual({ military: 10, silver: -100 })
    expect(post).not.toHaveBeenCalled()
    expect(store.currentSave?.state.attributes.military).toBe(60)
    expect(store.currentSave?.state.resources.silver).toBe(900)
  })

  it('选项不存在返回 null', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })

    const { makeDecision } = useTurn()
    const effects = await makeDecision('not-exist')

    expect(effects).toBeNull()
  })

  // ====================== T3.2：选项决策触发剧情链入队 ======================
  it('T3.2：选择带 nextChainNodeId 的选项后入队 pendingChainNodes + activeChainIds', async () => {
    const store = useGameStore()
    const save = createMockSave()
    save.state.turn = 3 // 当前回合，scheduledTurn = 4
    store.setSave(save)
    store.setEvent({
      title: '金田起义',
      description: '',
      eventType: '历史剧情',
      chainId: 'tai-ping-tian-guo',
      chainNodeId: 'node-1',
      chainProgress: { current: 1, total: 5 },
      options: [
        { id: 'o1', label: '出兵镇压', effects: { military: 8 }, nextChainNodeId: 'node-2' },
        { id: 'o2', label: '观望', effects: {} }
      ]
    })

    const { makeDecision } = useTurn()
    const effects = await makeDecision('o1')

    expect(effects).toEqual({ military: 8 })
    // 剧情链已激活
    expect(store.currentSave?.activeChainIds).toEqual(['tai-ping-tian-guo'])
    // 下一节点入队（scheduledTurn = 3 + 1 = 4）
    expect(store.currentSave?.pendingChainNodes).toEqual([
      { chainId: 'tai-ping-tian-guo', nodeId: 'node-2', scheduledTurn: 4 }
    ])
  })

  it('T3.2：末节点选项决策后完成剧情链（active→completed）', async () => {
    const store = useGameStore()
    const save = createMockSave()
    save.state.turn = 7
    save.activeChainIds = ['tai-ping-tian-guo']
    store.setSave(save)
    store.setEvent({
      title: '天京陷落',
      description: '',
      eventType: '历史剧情',
      chainId: 'tai-ping-tian-guo',
      chainNodeId: 'node-5',
      chainProgress: { current: 5, total: 5 },
      options: [{ id: 'o1', label: '论功', effects: { military: 10 }, nextChainNodeId: 'node-5' }]
    })

    const { makeDecision } = useTurn()
    await makeDecision('o1')

    expect(store.currentSave?.activeChainIds).toEqual([])
    expect(store.currentSave?.completedChainIds).toEqual(['tai-ping-tian-guo'])
    expect(store.currentSave?.pendingChainNodes).toEqual([])
  })
})

describe('makeDecision - 自由行动推进剧情链', () => {
  it('自由行动（无 option）结算后移除挂起节点并按线性推进下一节点', async () => {
    const store = useGameStore()
    const save = createMockSave()
    save.state.turn = 3
    // 模拟挂起节点：本回合 node-1 被 pending[0] 服务出来
    save.pendingChainNodes = [
      { chainId: 'tai-ping-tian-guo', nodeId: 'node-1', scheduledTurn: 3 }
    ]
    store.setSave(save)
    store.setEvent({
      title: '金田起义',
      description: '',
      eventType: '历史剧情',
      chainId: 'tai-ping-tian-guo',
      chainNodeId: 'node-1',
      chainProgress: { current: 1, total: 5 },
      options: [
        { id: 'o1', label: '出兵镇压', effects: { military: 8 }, nextChainNodeId: 'node-2' },
        { id: 'o2', label: '观望', effects: {} }
      ]
    })
    vi.mocked(post).mockResolvedValueOnce({ effects: { military: 3 } })

    const { makeDecision } = useTurn()
    const effects = await makeDecision(undefined, '自行募兵抗敌')

    expect(effects).toEqual({ military: 3 })
    // 剧情链已激活
    expect(store.currentSave?.activeChainIds).toEqual(['tai-ping-tian-guo'])
    // 挂起的 node-1 已移除，线性推进 node-2 入队（scheduledTurn = 3 + 1 = 4）
    expect(store.currentSave?.pendingChainNodes).toEqual([
      { chainId: 'tai-ping-tian-guo', nodeId: 'node-2', scheduledTurn: 4 }
    ])
  })

  it('自由行动末节点结算后完成剧情链', async () => {
    const store = useGameStore()
    const save = createMockSave()
    save.state.turn = 7
    save.activeChainIds = ['tai-ping-tian-guo']
    store.setSave(save)
    store.setEvent({
      title: '天京陷落',
      description: '',
      eventType: '历史剧情',
      chainId: 'tai-ping-tian-guo',
      chainNodeId: 'node-5',
      chainProgress: { current: 5, total: 5 },
      options: [{ id: 'o1', label: '论功', effects: {} }]
    })
    vi.mocked(post).mockResolvedValueOnce({ effects: { reputation: 5 } })

    const { makeDecision } = useTurn()
    await makeDecision(undefined, '抚恤阵亡将士')

    expect(store.currentSave?.activeChainIds).toEqual([])
    expect(store.currentSave?.completedChainIds).toEqual(['tai-ping-tian-guo'])
    expect(store.currentSave?.pendingChainNodes).toEqual([])
  })

  it('非剧情链事件的自由行动不产生剧情链副作用', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    store.setEvent({
      title: '普通事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })
    vi.mocked(post).mockResolvedValueOnce({ effects: { economy: 5 } })

    const { makeDecision } = useTurn()
    await makeDecision(undefined, '兴修水利')

    expect(store.currentSave?.pendingChainNodes).toEqual([])
    expect(store.currentSave?.activeChainIds).toEqual([])
    expect(store.currentSave?.completedChainIds).toEqual([])
  })
})

describe('makeDecision - 自由输入', () => {
  it('自由输入调用 resolve-decision', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })
    vi.mocked(post).mockResolvedValueOnce({ effects: { politics: 8, people: -3 } })

    const { makeDecision } = useTurn()
    const effects = await makeDecision(undefined, '我要上书朝廷')

    expect(post).toHaveBeenCalledWith(
      '/api/game/resolve-decision',
      expect.objectContaining({
        playerDecision: '我要上书朝廷',
        turn: 1
      })
    )
    expect(effects).toEqual({ politics: 8, people: -3 })
    expect(store.currentSave?.state.attributes.politics).toBe(63) // 55+8
    expect(store.currentSave?.state.attributes.people).toBe(47) // 50-3
  })

  it('resolve-decision 失败返回 null', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })
    vi.mocked(post).mockRejectedValueOnce(new Error('LLM 失败'))

    const { makeDecision } = useTurn()
    const effects = await makeDecision(undefined, '自由行动')

    expect(effects).toBeNull()
  })

  // 错误文案归一：UI 层会把 makeDecision 的 message 直接做成 toast，
  // 服务端裁决过的业务码要透出原话，客户端自造的技术码不能把开发者措辞丢给玩家
  it('自由输入失败文案：业务码透出服务端 message，技术码归一成友好文案', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })
    const onError = vi.fn()

    vi.mocked(post).mockRejectedValueOnce(
      new ApiError('INVALID_DECISION', '这段行动描述无法判定后果', 400)
    )
    await useTurn({ onError }).makeDecision(undefined, '召集群臣密议')
    expect(onError).toHaveBeenLastCalledWith('makeDecision', '这段行动描述无法判定后果')

    vi.mocked(post).mockRejectedValueOnce(
      new ApiError('INVALID_RESPONSE', '响应格式异常（HTTP 502）', 502)
    )
    await useTurn({ onError }).makeDecision(undefined, '召集群臣密议')
    expect(onError).toHaveBeenLastCalledWith('makeDecision', ERROR_TEXT.networkError)

    vi.mocked(post).mockRejectedValueOnce(new Error('非 ApiError 的意外异常'))
    await useTurn({ onError }).makeDecision(undefined, '召集群臣密议')
    expect(onError).toHaveBeenLastCalledWith('makeDecision', ERROR_TEXT.networkError)
  })

  it('自由输入超过 200 字自动截断', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })
    vi.mocked(post).mockResolvedValueOnce({ effects: {} })

    const { makeDecision } = useTurn()
    const longText = 'a'.repeat(300)
    await makeDecision(undefined, longText)

    expect(post).toHaveBeenCalledWith(
      '/api/game/resolve-decision',
      expect.objectContaining({
        playerDecision: expect.stringMatching(/^a{200}$/)
      })
    )
  })
})

describe('endTurn', () => {
  it('完整结束回合：NPC + effects + 历史 + turn+1 + 持久化 + 回合资源产出', async () => {
    const store = useGameStore()
    const save = createMockSave()
    store.setSave(save)
    store.setEvent({
      title: '事件1',
      description: '描述',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: { military: 5 } }]
    })
    // 先应用一次 effects（模拟 makeDecision 已调用）
    store.applyEffects({ military: 5 })

    vi.mocked(post).mockResolvedValueOnce({
      actions: [
        {
          factionId: 'f2',
          factionName: '太平天国',
          action: '扩张',
          description: '扩张领土',
          effects: { diplomacy: -5 }
        }
      ]
    })

    const { endTurn } = useTurn()
    await endTurn('选项')

    // NPC effects 已应用
    expect(store.currentSave?.state.attributes.diplomacy).toBe(45) // 50-5
    // 历史事件追加（玩家决策事件 + 系统产出事件，共 2 条）
    expect(store.currentSave?.events).toHaveLength(2)
    expect(store.currentSave?.events[0].title).toBe('事件1')
    expect(store.currentSave?.events[0].playerChoice).toBe('选项')
    // 系统产出事件（末条，eventType '系统'）
    const systemEvt = store.currentSave?.events[1]
    expect(systemEvt?.eventType).toBe('系统')
    expect(systemEvt?.playerChoice).toBe('')
    expect(systemEvt?.effects).toEqual({ silver: 30, troops: 15, reputation: -3 })
    // 银两净 +30（1000 → 1030）：产出 +50 扣掉养饷 20（兵员 500 → ceil(500/100)×4）
    expect(store.currentSave?.state.resources.silver).toBe(1030)
    // turn +1
    expect(store.currentSave?.state.turn).toBe(2)
    // date.year +1（1 回合 = 1 年；month 保留但恒为 1）
    expect(store.currentSave?.state.date).toEqual({ year: 1852, month: 1 })
    // currentEvent 清空（下一回合事件由 startTurn 重新拉取）
    expect(store.currentEvent).toBeNull()
    // npcActions 保留至下一回合展示「天下动静」（endTurn 末尾不再清空，避免面板永不显示）
    expect(store.npcActions).toEqual([
      expect.objectContaining({ factionId: 'f2', action: '扩张' })
    ])
  })

  // ====================== T3.2：endTurn 历史记录携带 chainId/chainNodeId ======================
  it('T3.2：剧情链事件结束时历史记录携带 chainId/chainNodeId', async () => {
    const store = useGameStore()
    const save = createMockSave()
    store.setSave(save)
    store.setEvent({
      title: '金田起义',
      description: '描述',
      eventType: '历史剧情',
      chainId: 'tai-ping-tian-guo',
      chainNodeId: 'node-1',
      chainProgress: { current: 1, total: 5 },
      options: [{ id: 'o1', label: '选项', effects: { military: 5 } }]
    })
    store.applyEffects({ military: 5 })
    vi.mocked(post).mockResolvedValueOnce({ actions: [] })

    const { endTurn } = useTurn()
    await endTurn('出兵镇压')

    const hist = store.currentSave?.events[0]
    expect(hist?.title).toBe('金田起义')
    expect(hist?.chainId).toBe('tai-ping-tian-guo')
    expect(hist?.chainNodeId).toBe('node-1')
  })

  it('老存档停在年中：下一回合直接落到次年 1 月（month 被年钟收拢）', async () => {
    const store = useGameStore()
    const save = createMockSave()
    // 月钟时代留下的存档可能停在任意月份；年钟下不保留，统一收拢到次年 1 月
    save.state.date = { year: 1851, month: 7 }
    store.setSave(save)
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })

    vi.mocked(post).mockResolvedValueOnce({ actions: [] })

    const { endTurn } = useTurn()
    await endTurn('选项')

    expect(store.currentSave?.state.date).toEqual({ year: 1852, month: 1 })
  })

  it('NPC 失败降级为空数组不阻断', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })

    vi.mocked(post).mockRejectedValueOnce(new Error('NPC 失败'))

    const { endTurn } = useTurn()
    await endTurn('选项')

    // 仍正常推进 turn
    expect(store.currentSave?.state.turn).toBe(2)
    expect(store.npcActions).toEqual([])
  })

  it('触发 onTurnEnd 回调', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })
    vi.mocked(post).mockResolvedValueOnce({ actions: [] })

    const onTurnEnd = vi.fn()
    const { endTurn } = useTurn({ onTurnEnd })
    await endTurn('选项')

    expect(onTurnEnd).toHaveBeenCalledOnce()
  })

  it('T7.3：onTurnEnd 钩子可读取 auto_sync 并触发 sync（契约验证）', async () => {
    // 本测试验证 useTurn 暴露的 onTurnEnd 钩子能被调用方用于 auto_sync 集成
    // 实际的 auto_sync 检查逻辑在 game-main/index.vue 的 onTurnEnd 回调中实现
    const store = useGameStore()
    store.setSave(createMockSave())
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })
    vi.mocked(post).mockResolvedValueOnce({ actions: [] })

    // 模拟 game-main 中的 auto_sync 检查逻辑
    uni.setStorageSync('auto_sync', true)
    const syncFn = vi.fn().mockResolvedValue({ action: 'uploaded', message: 'ok' })
    const onTurnEnd = () => {
      if (uni.getStorageSync('auto_sync') === true) {
        void syncFn()
      }
    }

    const { endTurn } = useTurn({ onTurnEnd })
    await endTurn('选项')

    expect(syncFn).toHaveBeenCalledOnce()

    // 关闭 auto_sync 后不应触发
    uni.setStorageSync('auto_sync', false)
    syncFn.mockClear()
    vi.mocked(post).mockResolvedValueOnce({ actions: [] })
    store.setEvent({
      title: '事件2',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })
    await endTurn('选项')
    expect(syncFn).not.toHaveBeenCalled()
  })

  it('资源产出提案：endTurn 注入净产出（+50 减养饷）且追加系统历史事件（eventType 系统）', async () => {
    const store = useGameStore()
    const save = createMockSave()
    save.state.resources.silver = 500
    store.setSave(save)
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })
    vi.mocked(post).mockResolvedValueOnce({ actions: [] })

    const { endTurn } = useTurn()
    await endTurn('选项')

    // 银两净 +30（500 → 530）：产出 +50 − 养饷 20（兵员 500），与玩家/NPC 决策无关
    expect(store.currentSave?.state.resources.silver).toBe(530)
    // 末条历史事件为系统产出事件
    const events = store.currentSave?.events ?? []
    const last = events[events.length - 1]
    expect(last?.eventType).toBe('系统')
    expect(last?.playerChoice).toBe('')
    expect(last?.effects).toEqual({ silver: 30, troops: 15, reputation: -3 })
  })

  it('endTurn 按在编兵员发饷：兵员越多净产出越少，超过 1250 后转为净负', async () => {
    // 养饷是「兵多则饷重」的联动而非固定值——锁住三档净额，
    // 防止 upkeep 被改回常量或调用处漏传 troops（漏传会静默退化成不扣饷）
    const cases: { troops: number; netSilver: number }[] = [
      { troops: 300, netSilver: 50 - 12 }, // ceil(300/100)×4 = 12
      { troops: 500, netSilver: 50 - 20 }, // 20
      { troops: 1300, netSilver: 50 - 52 } // 52 > 50 → 财政倒挂
    ]
    for (const c of cases) {
      setActivePinia(createPinia())
      const store = useGameStore()
      const save = createMockSave()
      save.state.resources.troops = c.troops
      save.state.resources.silver = 500
      store.setSave(save)
      store.setEvent({
        title: '事件',
        description: '',
        eventType: '随机',
        options: [{ id: 'o1', label: '选项', effects: {} }]
      })
      vi.mocked(post).mockResolvedValueOnce({ actions: [] })

      const { endTurn } = useTurn()
      await endTurn('选项')

      expect(store.currentSave?.state.resources.silver).toBe(500 + c.netSilver)
    }
  })

  it('endTurn 接线势力存亡判定：power ≤ 0 的势力在结算时转 destroyed', async () => {
    // 锁住接线：store.applyFactionSurvival 单测通过不代表 endTurn 真的调了它，
    // 而「实现了却没人调用」正是这个状态此前不存在的原因
    const store = useGameStore()
    const save = createMockSave()
    save.factions = [
      { id: 'f2', name: '太平天国', summary: '', power: 0, relationship: -50, status: 'active' }
    ]
    store.setSave(save)
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })
    vi.mocked(post).mockResolvedValueOnce({ actions: [] })

    const spy = vi.spyOn(store, 'applyFactionSurvival')
    const { endTurn } = useTurn()
    await endTurn('选项')

    expect(spy).toHaveBeenCalledTimes(1)
    expect(store.currentSave?.factions[0].status).toBe('destroyed')
  })
})

describe('endTurn - 结局判定', () => {
  it('属性崩溃触发结局：markEnded + redirectTo，不触发 onTurnEnd', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })
    // NPC effects 将 military 压到 ≤ 0（50 - 100 = -50）
    vi.mocked(post).mockResolvedValueOnce({
      actions: [
        {
          factionId: 'f2',
          factionName: '太平天国',
          action: '扩张',
          description: '',
          effects: { military: -100 }
        }
      ]
    })

    const onTurnEnd = vi.fn()
    const { endTurn } = useTurn({ onTurnEnd })
    await endTurn('选项')

    expect(store.currentSave?.ended).toBe(true)
    expect(store.currentSave?.endedReason).toBe('military_collapse')
    expect(uni.redirectTo).toHaveBeenCalledWith({ url: '/pages/end-game/index' })
    expect(onTurnEnd).not.toHaveBeenCalled()
  })

  it('中途达标不再立即通关：只锁定「中兴已定」并播一条系统事件', async () => {
    const store = useGameStore()
    const save = createMockSave()
    save.state.attributes = { military: 90, economy: 90, politics: 90, people: 90, diplomacy: 90 }
    store.setSave(save)
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })
    vi.mocked(post).mockResolvedValueOnce({ actions: [] })

    const { endTurn } = useTurn()
    await endTurn('选项')

    // 年钟下胜利改到 1912 结算：本回合只锁定年份，游戏继续
    expect(store.currentSave?.ended).toBe(false)
    expect(store.currentSave?.zenithYear).toBe(1851)
    expect(uni.redirectTo).not.toHaveBeenCalled()
    const zenithEvt = store.currentSave?.events.find((e) => e.eventType === '系统' && e.title.includes('中兴已定'))
    expect(zenithEvt).toBeDefined()
  })

  it('已锁定中兴 → 走到 1912 年后结算为 victory', async () => {
    const store = useGameStore()
    const save = createMockSave()
    save.state.date = { year: 1912, month: 1 }
    save.zenithYear = 1890
    // 结算时实力已跌下阈值也无妨：中兴评价在锁定的那一年就已经拿到
    save.state.attributes = { military: 60, economy: 60, politics: 60, people: 60, diplomacy: 60 }
    store.setSave(save)
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })
    vi.mocked(post).mockResolvedValueOnce({ actions: [] })

    const { endTurn } = useTurn()
    await endTurn('选项')

    expect(store.currentSave?.state.date).toEqual({ year: 1913, month: 1 })
    expect(store.currentSave?.ended).toBe(true)
    expect(store.currentSave?.endedReason).toBe('victory')
  })

  it('从未锁定但结算时实力达标 → 同样 victory', async () => {
    const store = useGameStore()
    const save = createMockSave()
    save.state.date = { year: 1912, month: 1 }
    save.state.attributes = { military: 90, economy: 90, politics: 90, people: 90, diplomacy: 90 }
    store.setSave(save)
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })
    vi.mocked(post).mockResolvedValueOnce({ actions: [] })

    const { endTurn } = useTurn()
    await endTurn('选项')

    expect(store.currentSave?.endedReason).toBe('victory')
  })

  it('时光尽头触发结局：year > 1912', async () => {
    const store = useGameStore()
    const save = createMockSave()
    save.state.date = { year: 1912, month: 12 }
    store.setSave(save)
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })
    vi.mocked(post).mockResolvedValueOnce({ actions: [] })

    const { endTurn } = useTurn()
    await endTurn('选项')

    // 1912 + 1 回合 = 1913 → 跨年结算；本局从未锁定中兴、结算时实力也不达标 → time_up
    expect(store.currentSave?.state.date).toEqual({ year: 1913, month: 1 })
    expect(store.currentSave?.ended).toBe(true)
    expect(store.currentSave?.endedReason).toBe('time_up')
    expect(uni.redirectTo).toHaveBeenCalledWith({ url: '/pages/end-game/index' })
  })

  it('未触发结局时正常调用 onTurnEnd', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    store.setEvent({
      title: '事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'o1', label: '选项', effects: {} }]
    })
    vi.mocked(post).mockResolvedValueOnce({ actions: [] })

    const onTurnEnd = vi.fn()
    const { endTurn } = useTurn({ onTurnEnd })
    await endTurn('选项')

    expect(store.currentSave?.ended).toBe(false)
    expect(uni.redirectTo).not.toHaveBeenCalled()
    expect(onTurnEnd).toHaveBeenCalledOnce()
  })
})
