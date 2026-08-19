/**
 * @file composables/useGameState.ts 单元测试
 *
 * 覆盖 T4.2 验证要求：
 *   - initSave 生成的存档结构与初始值（5 维属性 50 ± 偏移、4 资源默认值、1851-1、turn=1）
 *   - 玩家势力被过滤作为 NPC
 *   - 5 种身份的偏移正确
 *   - 存档写入本地 storage
 *   - store.currentSave 被更新
 *   - save/load/clear 行为
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameState } from '../../src/composables/useGameState'
import { useGameStore } from '../../src/stores/game'
import { loadSave } from '../../src/utils/storage'
import type {
  Background,
  EventOption,
  Faction,
  GameEvent,
  GameSave
} from '../../src/types/game'

/** 构造 initSave 所需的 allFactions 输入（含玩家势力 + 5 个 NPC） */
function buildAllFactions(playerId: string): Array<{
  id: string
  name: string
  summary: string
  initialPower: number
  initialRelationship: number
}> {
  const names = ['清廷', '湘军', '淮军', '太平天国', '北洋', '革命党']
  return names.map((name, idx) => ({
    id: idx === 0 ? playerId : `f-npc-${idx}`,
    name,
    summary: `${name} 势力简介`,
    initialPower: 40 + idx * 5,
    initialRelationship: idx === 0 ? 100 : 0
  }))
}

describe('useGameState.initSave', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // 清空 uni storage
    uni.removeStorageSync('game_save')
  })

  it('生成存档基础结构（saveVersion/saveId/deviceId/createdAt/updatedAt）', async () => {
    const { initSave } = useGameState()
    const before = Date.now()
    const save = await initSave({
      background: '文官',
      faction: { id: 'f-player', name: '清廷', summary: '晚清朝廷' },
      allFactions: buildAllFactions('f-player')
    })
    const after = Date.now()

    expect(save.saveVersion).toBe(2)
    // v2 新增的三个剧情链运行时数组初始化为空
    expect(save.pendingChainNodes).toEqual([])
    expect(save.completedChainIds).toEqual([])
    expect(save.activeChainIds).toEqual([])
    // saveId 应是 UUID v4 格式或 save- 前缀的回退格式
    expect(save.saveId).toBeTruthy()
    expect(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(save.saveId) ||
        /^save-\d+-[a-z0-9]+$/.test(save.saveId)
    ).toBe(true)
    expect(save.deviceId).toBeTruthy()
    expect(save.createdAt).toBeGreaterThanOrEqual(before)
    expect(save.createdAt).toBeLessThanOrEqual(after)
    expect(save.updatedAt).toBe(save.createdAt)
  })

  it('初始 state：1851-1，turn=1', async () => {
    const { initSave } = useGameState()
    const save = await initSave({
      background: '武将',
      faction: { id: 'f-player', name: '清廷', summary: '晚清朝廷' },
      allFactions: buildAllFactions('f-player')
    })
    expect(save.state.turn).toBe(1)
    expect(save.state.date).toEqual({ year: 1851, month: 1 })
  })

  it('初始资源：silver 1000 / troops 500 / food 800 / reputation 10', async () => {
    const { initSave } = useGameState()
    const save = await initSave({
      background: '商贾',
      faction: { id: 'f-player', name: '清廷', summary: '晚清朝廷' },
      allFactions: buildAllFactions('f-player')
    })
    expect(save.state.resources).toEqual({
      silver: 1000,
      troops: 500,
      food: 800,
      reputation: 10
    })
  })

  it('5 种身份偏移：文官/武将/商贾/士绅/宗室', async () => {
    const { initSave } = useGameState()
    const cases: Array<{ bg: Background; expected: GameSave['state']['attributes'] }> = [
      // 50 基线 + BACKGROUND_PERKS（useGameState.ts 内的偏移表）
      { bg: '文官', expected: { military: 45, economy: 50, politics: 60, people: 50, diplomacy: 55 } },
      { bg: '武将', expected: { military: 60, economy: 50, politics: 45, people: 55, diplomacy: 50 } },
      { bg: '商贾', expected: { military: 50, economy: 65, politics: 45, people: 50, diplomacy: 55 } },
      { bg: '士绅', expected: { military: 45, economy: 50, politics: 55, people: 60, diplomacy: 50 } },
      { bg: '宗室', expected: { military: 45, economy: 50, politics: 55, people: 50, diplomacy: 60 } }
    ]

    for (const c of cases) {
      const save = await initSave({
        background: c.bg,
        faction: { id: 'f-player', name: '清廷', summary: '晚清朝廷' },
        allFactions: buildAllFactions('f-player')
      })
      expect(save.state.attributes).toEqual(c.expected)
    }
  })

  it('玩家势力被过滤，其余作为 NPC factions', async () => {
    const { initSave } = useGameState()
    const save = await initSave({
      background: '文官',
      faction: { id: 'f-player', name: '清廷', summary: '晚清朝廷' },
      allFactions: buildAllFactions('f-player')
    })
    // 玩家势力不在 factions 列表中
    expect(save.factions.find((f) => f.id === 'f-player')).toBeUndefined()
    // NPC 势力共 5 个（6 个 - 1 个玩家）
    expect(save.factions).toHaveLength(5)
    // 第一个 NPC 的字段映射正确（initialPower → power, initialRelationship → relationship）
    const firstNpc: Faction = save.factions[0]
    expect(firstNpc).toEqual({
      id: 'f-npc-1',
      name: '湘军',
      summary: '湘军 势力简介',
      power: 45,
      relationship: 0,
      status: 'active'
    })
  })

  it('events 与 advisorMessages 初始化为空数组，ended=false', async () => {
    const { initSave } = useGameState()
    const save = await initSave({
      background: '文官',
      faction: { id: 'f-player', name: '清廷', summary: '晚清朝廷' },
      allFactions: buildAllFactions('f-player')
    })
    expect(save.events).toEqual([])
    expect(save.advisorMessages).toEqual([])
    expect(save.ended).toBe(false)
    expect(save.endedAt).toBeUndefined()
    expect(save.endedReason).toBeUndefined()
  })

  it('character 字段完整（background/backgroundPerks/factionId/factionName/factionSummary）', async () => {
    const { initSave } = useGameState()
    const save = await initSave({
      background: '武将',
      faction: { id: 'f-player', name: '清廷', summary: '晚清朝廷' },
      allFactions: buildAllFactions('f-player')
    })
    expect(save.character.background).toBe('武将')
    expect(save.character.backgroundPerks).toEqual({ military: 10, politics: -5, people: 5 })
    expect(save.character.factionId).toBe('f-player')
    expect(save.character.factionName).toBe('清廷')
    expect(save.character.factionSummary).toBe('晚清朝廷')
  })

  it('存档写入本地 storage + store.currentSave 同步更新', async () => {
    const store = useGameStore()
    expect(store.currentSave).toBeNull()

    const { initSave } = useGameState()
    const save = await initSave({
      background: '文官',
      faction: { id: 'f-player', name: '清廷', summary: '晚清朝廷' },
      allFactions: buildAllFactions('f-player')
    })

    // store 已更新
    expect(store.currentSave).toEqual(save)

    // 本地 storage 已写入
    const persisted = await loadSave()
    expect(persisted).toEqual(save)
  })
})

describe('useGameState save/load/clear', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    uni.removeStorageSync('game_save')
  })

  it('save 持久化当前 store.currentSave', async () => {
    const { initSave, save } = useGameState()
    await initSave({
      background: '文官',
      faction: { id: 'f-player', name: '清廷', summary: '晚清朝廷' },
      allFactions: buildAllFactions('f-player')
    })

    // 修改 store 内存值后 save
    const store = useGameStore()
    store.updateState({ turn: 5 })
    await save()

    // 重新 load 应得到 turn=5
    const { load } = useGameState()
    const reloaded = await load()
    expect(reloaded?.state.turn).toBe(5)
  })

  it('load 无存档返回 null', async () => {
    const { load } = useGameState()
    const result = await load()
    expect(result).toBeNull()
  })

  it('clear 删除本地存档 + 清空 store', async () => {
    const { initSave, clear } = useGameState()
    await initSave({
      background: '文官',
      faction: { id: 'f-player', name: '清廷', summary: '晚清朝廷' },
      allFactions: buildAllFactions('f-player')
    })

    const store = useGameStore()
    expect(store.currentSave).not.toBeNull()

    await clear()

    expect(store.currentSave).toBeNull()
    const persisted = await loadSave()
    expect(persisted).toBeNull()
  })

  it('save 在无存档时抛错', async () => {
    const { save } = useGameState()
    await expect(save()).rejects.toThrow('无存档可保存')
  })
})

// ====================== T3.1：v1 → v2 存档迁移 ======================
describe('useGameState 存档迁移 v1→v2', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    uni.removeStorageSync('game_save')
  })

  /** 构造一个"旧版 v1 存档"对象（saveVersion=1，缺三个剧情链数组字段） */
  function buildV1Save(): GameSave {
    return {
      saveVersion: 1 as unknown as 2, // 运行时为 1，类型层面仍是字面量 2
      saveId: 'v1-save-id',
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
        turn: 10,
        date: { year: 1860, month: 5 },
        attributes: { military: 50, economy: 50, politics: 55, people: 50, diplomacy: 50 },
        resources: { silver: 1000, troops: 500, food: 800, reputation: 10 }
      },
      factions: [],
      events: [
        {
          turn: 1,
          eventType: '随机',
          title: '旧事件',
          description: '',
          playerChoice: '旧选择',
          effects: { military: 3 }
        }
      ],
      advisorMessages: [],
      ended: false
    } as unknown as GameSave
  }

  it('v1 存档加载后自动升级为 v2 + 三字段补齐', async () => {
    // 将 v1 存档植入本地存储（绕过 initSave，模拟老玩家遗留存档）
    uni.setStorageSync('game_save', buildV1Save())

    const { load } = useGameState()
    const loaded = await load()

    expect(loaded).not.toBeNull()
    expect(loaded?.saveVersion).toBe(2)
    expect(loaded?.pendingChainNodes).toEqual([])
    expect(loaded?.completedChainIds).toEqual([])
    expect(loaded?.activeChainIds).toEqual([])
    // v1 的既有数据（events）保持不变，chainId 字段缺省为 undefined
    expect(loaded?.events).toHaveLength(1)
    expect(loaded?.events[0].title).toBe('旧事件')
    expect(loaded?.events[0].chainId).toBeUndefined()
    expect(loaded?.state.turn).toBe(10)
  })

  it('已为 v2 且字段齐全的存档不触发迁移（引用不变，不写回）', async () => {
    const { initSave, load } = useGameState()
    const save = await initSave({
      background: '文官',
      faction: { id: 'f-player', name: '清廷', summary: '晚清朝廷' },
      allFactions: buildAllFactions('f-player')
    })

    // v2 存档写入后重新 load，应原样返回（migrateSaveV1ToV2 返回同一引用）
    const reloaded = await load()
    expect(reloaded).toBe(save)
    expect(reloaded?.saveVersion).toBe(2)
  })
})

// ====================== T3.2：applyEventOption 剧情链入队 ======================
describe('useGameState.applyEventOption', () => {
  /** 构造带剧情链上下文的 v2 存档（turn=3，剧情链状态为空） */
  function buildChainSave(): GameSave {
    return {
      saveVersion: 2,
      saveId: 'chain-save-id',
      deviceId: 'test-device-id',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      character: {
        background: '武将',
        backgroundPerks: { military: 10 },
        factionId: 'f1',
        factionName: '清廷',
        factionSummary: '晚清朝廷'
      },
      state: {
        turn: 3,
        date: { year: 1851, month: 3 },
        attributes: { military: 50, economy: 50, politics: 50, people: 50, diplomacy: 50 },
        resources: { silver: 1000, troops: 500, food: 800, reputation: 10 }
      },
      factions: [],
      events: [],
      advisorMessages: [],
      pendingChainNodes: [],
      completedChainIds: [],
      activeChainIds: [],
      ended: false
    }
  }

  /** 剧情链事件（node-1，非末节点） */
  function chainEvent(nodeId: string, isLast = false): GameEvent {
    return {
      title: '金田起义',
      description: '',
      eventType: '历史剧情',
      options: [{ id: 'a', label: '选项', effects: {} }],
      chainId: 'tai-ping-tian-guo',
      chainNodeId: nodeId,
      chainProgress: { current: isLast ? 5 : 1, total: 5 }
    }
  }

  it('选项含 nextChainNodeId 时正确入队（指定下一节点）', () => {
    const store = useGameStore()
    store.setSave(buildChainSave())
    const { applyEventOption } = useGameState()

    const evt = chainEvent('node-1')
    const option: EventOption = { id: 'a', label: '出兵', effects: {}, nextChainNodeId: 'node-2' }
    applyEventOption(evt, option)

    // chainId 进入 active
    expect(store.currentSave?.activeChainIds).toEqual(['tai-ping-tian-guo'])
    // node-2 入队，scheduledTurn = 当前 turn(3) + 1 = 4
    expect(store.currentSave?.pendingChainNodes).toEqual([
      { chainId: 'tai-ping-tian-guo', nodeId: 'node-2', scheduledTurn: 4 }
    ])
    // 未完成，completed 为空
    expect(store.currentSave?.completedChainIds).toEqual([])
  })

  it('选项不含 nextChainNodeId 时按节点顺序默认推进', () => {
    const store = useGameStore()
    store.setSave(buildChainSave())
    const { applyEventOption } = useGameState()

    const evt = chainEvent('node-1')
    const option: EventOption = { id: 'b', label: '观望', effects: {} }
    applyEventOption(evt, option)

    // 默认推进到 node-2（线性链下一序位）
    expect(store.currentSave?.pendingChainNodes).toEqual([
      { chainId: 'tai-ping-tian-guo', nodeId: 'node-2', scheduledTurn: 4 }
    ])
  })

  it('末节点完成时出队 + 加入 completedChainIds', () => {
    const store = useGameStore()
    store.setSave(buildChainSave())
    const { applyEventOption } = useGameState()

    const evt = chainEvent('node-5', true) // 末节点
    const option: EventOption = { id: 'a', label: '论功', effects: {} }
    applyEventOption(evt, option)

    // 末节点：active → completed，pending 不入队
    expect(store.currentSave?.activeChainIds).toEqual([])
    expect(store.currentSave?.completedChainIds).toEqual(['tai-ping-tian-guo'])
    expect(store.currentSave?.pendingChainNodes).toEqual([])
  })

  it('当前节点已作为挂起节点入队时：决策后移除自身并推进下一节点（修复卡死 bug）', () => {
    const store = useGameStore()
    const save = buildChainSave()
    // 模拟真实流程：上一回合已将 node-2 入队（scheduledTurn = 当前 turn 3），
    // 本回合 node-2 被 generate-event 以 pending[0] 服务出来
    save.pendingChainNodes = [
      { chainId: 'tai-ping-tian-guo', nodeId: 'node-2', scheduledTurn: 3 }
    ]
    store.setSave(save)
    const { applyEventOption } = useGameState()

    const evt = chainEvent('node-2') // 非末节点、无 nextChainNodeId，按线性链推进到 node-3
    const option: EventOption = { id: 'a', label: '派兵江防', effects: {} }
    applyEventOption(evt, option)

    // 关键：已服务的 node-2 必须从 pending 移除，否则永远停在 pending[0] → 卡死在 node-2
    expect(store.currentSave?.pendingChainNodes).toEqual([
      { chainId: 'tai-ping-tian-guo', nodeId: 'node-3', scheduledTurn: 4 }
    ])
    // 链仍在进行中（node-2 不是末节点）
    expect(store.currentSave?.activeChainIds).toEqual(['tai-ping-tian-guo'])
    expect(store.currentSave?.completedChainIds).toEqual([])
  })

  it('非剧情链事件（无 chainId）直接返回，无副作用', () => {
    const store = useGameStore()
    store.setSave(buildChainSave())
    const { applyEventOption } = useGameState()

    const evt: GameEvent = {
      title: '普通事件',
      description: '',
      eventType: '随机',
      options: [{ id: 'a', label: '选项', effects: {} }]
    }
    const option: EventOption = { id: 'a', label: '选项', effects: {} }
    applyEventOption(evt, option)

    expect(store.currentSave?.pendingChainNodes).toEqual([])
    expect(store.currentSave?.activeChainIds).toEqual([])
    expect(store.currentSave?.completedChainIds).toEqual([])
  })

  it('自由行动路径（option 缺省）：移除挂起节点并按线性推进下一节点', () => {
    const store = useGameStore()
    const save = buildChainSave()
    // 模拟挂起节点：本回合 node-1 被 pending[0] 服务出来
    save.pendingChainNodes = [
      { chainId: 'tai-ping-tian-guo', nodeId: 'node-1', scheduledTurn: 3 }
    ]
    store.setSave(save)
    const { applyEventOption } = useGameState()

    // 自由行动：不传 option
    applyEventOption(chainEvent('node-1'))

    // 挂起的 node-1 已移除，线性推进 node-2（与无 nextChainNodeId 的选项 b/c 行为一致）
    expect(store.currentSave?.pendingChainNodes).toEqual([
      { chainId: 'tai-ping-tian-guo', nodeId: 'node-2', scheduledTurn: 4 }
    ])
    expect(store.currentSave?.activeChainIds).toEqual(['tai-ping-tian-guo'])
    expect(store.currentSave?.completedChainIds).toEqual([])
  })

  it('自由行动路径（option 缺省）：末节点完成剧情链', () => {
    const store = useGameStore()
    const save = buildChainSave()
    save.activeChainIds = ['tai-ping-tian-guo']
    store.setSave(save)
    const { applyEventOption } = useGameState()

    applyEventOption(chainEvent('node-5', true))

    expect(store.currentSave?.activeChainIds).toEqual([])
    expect(store.currentSave?.completedChainIds).toEqual(['tai-ping-tian-guo'])
    expect(store.currentSave?.pendingChainNodes).toEqual([])
  })
})
