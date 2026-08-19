/**
 * @file useGameState — 存档生命周期管理
 *
 * 提供：
 *   - initSave(character, factions): 创建新存档并写入本地存储
 *   - save(): 持久化当前 store.currentSave 到本地
 *   - load(): 从本地读取存档到 store
 *   - clear(): 删除本地存档 + 清空 store
 *
 * 与 useSaveSync 的边界：本 composable 只管本地，不触达云端。
 */

import { useGameStore } from '@/stores/game'
import { clearSave, loadSave, saveSave } from '@/utils/storage'
import { getDeviceId } from '@/utils/device-id'
import {
  getChainMeta,
  getNextNodeId,
  isLastNode
} from '@/data/story-chains'
import type {
  Background,
  Character,
  EventOption,
  Faction,
  GameEvent,
  GameSave,
  StateSnapshot
} from '@/types/game'

/** 身份偏移（design.md D10：每项 50 ± 10） */
const BACKGROUND_PERKS: Record<Background, Record<string, number>> = {
  文官: { politics: 10, diplomacy: 5, military: -5 },
  武将: { military: 10, politics: -5, people: 5 },
  商贾: { economy: 15, diplomacy: 5, politics: -5 },
  士绅: { politics: 5, people: 10, military: -5 },
  宗室: { diplomacy: 10, politics: 5, military: -5 }
}

/** 起始资源（design.md D10） */
const INITIAL_RESOURCES = {
  silver: 1000,
  troops: 500,
  food: 800,
  reputation: 10
}

/**
 * 应用身份偏移到 50 基线上
 */
function applyBackgroundPerks(background: Background) {
  const perks = BACKGROUND_PERKS[background]
  return {
    military: 50 + (perks.military ?? 0),
    economy: 50 + (perks.economy ?? 0),
    politics: 50 + (perks.politics ?? 0),
    people: 50 + (perks.people ?? 0),
    diplomacy: 50 + (perks.diplomacy ?? 0)
  }
}

/**
 * 生成存档 ID（UUID v4，优先 crypto.randomUUID，回退手动生成）
 */
function generateSaveId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fallback below */
  }
  // 回退：手动生成 UUID v4（保证与非 secure context 兼容）
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * T3.1：v1 → v2 存档迁移（design.md D4）
 *
 * 仅补齐 v2 新增的三个运行时数组字段，不改动既有数据。
 * v1 存档的 `events` 数组保持不变（新增 chainId/chainNodeId 字段为 undefined，向后兼容）。
 *
 * 返回：
 *   - 无需迁移（已是 v2 且三字段齐全）时返回原对象（同一引用，避免无谓写回）
 *   - 需要迁移时返回新对象（字段补齐 + saveVersion=2）
 *
 * 注意：本地存储反序列化的对象 `saveVersion` 实际可能是 1，而类型层面为字面量 `2`，
 * 故用松散断言读取版本号。
 */
function migrateSaveV1ToV2(save: GameSave): GameSave {
  const version = (save as unknown as { saveVersion?: number }).saveVersion
  const needsMigration =
    version !== 2 ||
    !Array.isArray(save.pendingChainNodes) ||
    !Array.isArray(save.completedChainIds) ||
    !Array.isArray(save.activeChainIds)

  if (!needsMigration) return save

  return {
    ...save,
    saveVersion: 2,
    pendingChainNodes: Array.isArray(save.pendingChainNodes) ? save.pendingChainNodes : [],
    completedChainIds: Array.isArray(save.completedChainIds) ? save.completedChainIds : [],
    activeChainIds: Array.isArray(save.activeChainIds) ? save.activeChainIds : [],
    // v1 的 events 保持原样（chainId/chainNodeId 留空，向后兼容）
    events: (save.events ?? []).map((e) => ({ ...e }))
  }
}

export interface InitSaveParams {
  /** 玩家身份 */
  background: Background
  /** 玩家所选势力（来自 init-factions 接口） */
  faction: {
    id: string
    name: string
    summary: string
  }
  /** AI 生成的所有势力（含玩家势力，initSave 会过滤掉玩家势力作为 NPC） */
  allFactions: Array<{
    id: string
    name: string
    summary: string
    initialPower: number
    initialRelationship: number
  }>
}

export function useGameState() {
  const store = useGameStore()

  /**
   * 初始化新存档并写入本地
   *
   * 步骤：
   *   1. 构建 Character（含 backgroundPerks）
   *   2. 构建 StateSnapshot（1851-1，属性 50 ± 偏移，资源默认值）
   *   3. 过滤掉玩家势力作为 NPC factions
   *   4. 写入本地存储 + store
   */
  async function initSave(params: InitSaveParams): Promise<GameSave> {
    const { background, faction, allFactions } = params
    const perks = BACKGROUND_PERKS[background]
    const now = Date.now()

    const character: Character = {
      background,
      backgroundPerks: perks,
      factionId: faction.id,
      factionName: faction.name,
      factionSummary: faction.summary
    }

    const state: StateSnapshot = {
      turn: 1,
      date: { year: 1851, month: 1 },
      attributes: applyBackgroundPerks(background),
      resources: { ...INITIAL_RESOURCES }
    }

    // 过滤掉玩家势力，其余作为 NPC
    const factions: Faction[] = allFactions
      .filter((f) => f.id !== faction.id)
      .map((f) => ({
        id: f.id,
        name: f.name,
        summary: f.summary,
        power: f.initialPower,
        relationship: f.initialRelationship,
        status: 'active' as const
      }))

    const save: GameSave = {
      saveVersion: 2,
      saveId: generateSaveId(),
      deviceId: getDeviceId(),
      createdAt: now,
      updatedAt: now,
      character,
      state,
      factions,
      events: [],
      advisorMessages: [],
      pendingChainNodes: [],
      completedChainIds: [],
      activeChainIds: [],
      ended: false
    }

    await saveSave(save)
    store.setSave(save)
    return save
  }

  /**
   * 持久化当前 store.currentSave 到本地
   * 调用方需保证 store.currentSave 不为 null
   */
  async function save(): Promise<void> {
    if (!store.currentSave) {
      throw new Error('无存档可保存')
    }
    await saveSave(store.currentSave)
  }

  /**
   * 从本地读取存档并写入 store
   *
   * 读取后执行 v1→v2 迁移（若需要），迁移后的存档写回本地，
   * 下次同步上传云端时覆盖旧版本。
   *
   * @returns 存档对象（无存档返回 null）
   */
  async function load(): Promise<GameSave | null> {
    const raw = await loadSave()
    if (!raw) {
      store.setSave(null)
      return null
    }
    const save = migrateSaveV1ToV2(raw)
    // 仅当发生实际迁移（引用不同）时才写回本地，避免无谓 IO
    if (save !== raw) {
      await saveSave(save)
    }
    store.setSave(save)
    return save
  }

  /**
   * 清除本地存档 + 清空 store 内存状态
   */
  async function clear(): Promise<void> {
    await clearSave()
    store.clear()
  }

  /**
   * T3.2：玩家决策后处理剧情链入队逻辑（选项决策与自由行动共用）
   *
   * 触发条件：仅当事件为剧情链事件（同时具备 `chainId` 与 `chainNodeId`）时才生效，
   * 普通事件直接返回，无副作用。
   *
   * 行为：
   *   0. **（关键修复）移除已服务的当前节点**：当前事件若是上一回合入队的挂起节点、
   *      本回合被 `generate-event` 以 `pendingChainNodes[0]` 服务出来的，玩家做出决策即
   *      视为已解决，必须从 `pendingChainNodes` 移除。否则该节点永远停在 `pending[0]`，
   *      导致同一节点被反复服务、剧情链卡死在第二个节点（如停滞在 node-2 不再推进到 node-3）。
   *      按 `chainId + nodeId` 精确匹配，避免误删其它链的同源节点（nodeId 跨链不唯一，如各链都有 node-1）。
   *   1. 将 `event.chainId` 加入 `activeChainIds`（若尚未存在）——标识剧情链进行中，
   *      防止时间窗口重复触发同一链首节点
   *   2. 若当前节点为末节点（isLastNode）：完成剧情链——
   *      从 `activeChainIds` 移除并加入 `completedChainIds`，**不入队**
   *   3. 否则确定下一节点并入队 `pendingChainNodes`（scheduledTurn = 当前 turn + 1）：
   *       a) `option.nextChainNodeId` 存在 → 使用该值（玩家选项显式指定，最高优先）
   *       b) 否则按当前节点在链中的下一序位推进（线性链约定，design.md D2）
   *
   * 注意：attributes/resources 的 effects 由调用方（useTurn.makeDecision）先行应用，
   * 本函数只维护剧情链的运行时状态（pending/active/completed）。
   *
   * @param event 当前回合事件（含 chainId/chainNodeId）
   * @param option 玩家选择的选项（含可选的 nextChainNodeId）；缺省表示自由行动路径，
   *               按线性链下一序位推进（与无 nextChainNodeId 的选项 b/c 行为一致）
   */
  function applyEventOption(event: GameEvent, option?: EventOption): void {
    const save = store.currentSave
    if (!save || !event.chainId || !event.chainNodeId) return

    const currentTurn = save.state.turn
    let pendingChainNodes = [...save.pendingChainNodes]
    let activeChainIds = [...save.activeChainIds]
    let completedChainIds = [...save.completedChainIds]

    // 0. 移除已服务的当前节点（见上方 doc 注释）：当前事件若是上一回合入队的挂起节点，
    //    本回合被服务出来后、玩家决策即视为已解决，必须从 pending 移除，否则会卡在 pending[0]。
    pendingChainNodes = pendingChainNodes.filter(
      (n) => !(n.chainId === event.chainId && n.nodeId === event.chainNodeId)
    )

    // 1. chainId 加入 active（若尚未存在）
    if (!activeChainIds.includes(event.chainId)) {
      activeChainIds = [...activeChainIds, event.chainId]
    }

    const meta = getChainMeta(event.chainId)
    const last = meta ? isLastNode(event.chainId, event.chainNodeId) : false

    if (last) {
      // 2. 末节点：完成剧情链（活跃 → 已完成），不再入队
      activeChainIds = activeChainIds.filter((id) => id !== event.chainId)
      if (!completedChainIds.includes(event.chainId)) {
        completedChainIds = [...completedChainIds, event.chainId]
      }
    } else {
      // 3. 确定下一节点并入队（scheduledTurn = 当前回合 + 1）
      //    option 缺省（自由行动路径）时与无 nextChainNodeId 的选项一致，按线性链下一序位推进
      const nextNodeId = option?.nextChainNodeId ?? getNextNodeId(event.chainId, event.chainNodeId)
      if (nextNodeId) {
        pendingChainNodes = [
          ...pendingChainNodes,
          { chainId: event.chainId, nodeId: nextNodeId, scheduledTurn: currentTurn + 1 }
        ]
      }
    }

    store.updateChainState({ pendingChainNodes, activeChainIds, completedChainIds })
  }

  return {
    initSave,
    save,
    load,
    clear,
    applyEventOption
  }
}
