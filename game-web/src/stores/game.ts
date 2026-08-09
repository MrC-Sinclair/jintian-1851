/**
 * @file Pinia 游戏状态 Store
 *
 * 持有 currentSave 与回合/流式/同步等运行时状态。
 * 持久化通过 utils/storage.ts 完成（store 不直接调 uni API）。
 *
 * 状态分类：
 *   - 存档数据：currentSave（含 state/character/factions/events/advisorMessages）
 *   - 回合临时态：currentEvent / npcActions（每回合开始重置）
 *   - 加载态：isProcessingTurn / isAdvisorStreaming / isSyncing（防重复提交）
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { DIPLOMACY_RULES, canAfford, clamp } from '@/utils/constants'
import type {
  AdvisorMessage,
  Attributes,
  EndedReason,
  GameEvent,
  GameSave,
  HistoryEvent,
  NpcAction,
  PendingChainNode,
  PlayerDiplomacyAction,
  Resources,
  StateSnapshot
} from '@/types/game'

/** 军师对话最大保留条数（design.md D6 截断策略） */
const MAX_ADVISOR_MESSAGES = 20
/** 历史事件最大保留条数（design.md D6 截断策略） */
const MAX_EVENTS = 50

export const useGameStore = defineStore('game', () => {
  // ====================== 存档数据 ======================
  /** 当前存档（null 表示无存档，需新建角色） */
  const currentSave = ref<GameSave | null>(null)

  // ====================== 回合临时态 ======================
  /** 当前回合事件（每回合开始时由 generate-event 接口返回） */
  const currentEvent = ref<GameEvent | null>(null)
  /** 当前回合 NPC 行动列表（npc-actions 接口返回） */
  const npcActions = ref<NpcAction[]>([])
  /**
   * T3.4：本回合决策失败的 NPC（id + 名称，从存档 factions 解析）。
   * 用于 NpcActionList 展示失败角标，不阻断成功 NPC 的行动应用。
   */
  const npcFailedFactionIds = ref<{ id: string; name: string }[]>([])
  /**
   * T3.1：当前选中的选项 ID（两步交互：选中后高亮，点确认决策才生效）
   *
   * - null 表示未选中
   * - 跨组件同步：EventCard 内 DecisionButton 读取此值判断选中态，game-main 写入
   * - 每回合开始/确认决策后重置为 null
   */
  const selectedOptionId = ref<string | null>(null)

  // ====================== 加载态（防重复提交） ======================
  /** 回合流程进行中（generate-event / resolve-decision / npc-actions 任一阶段） */
  const isProcessingTurn = ref(false)
  /** 军师对话流式响应进行中 */
  const isAdvisorStreaming = ref(false)
  /** 存档同步进行中 */
  const isSyncing = ref(false)
  /** 兼容旧调用（= isProcessingTurn） */
  const isLoading = computed(() => isProcessingTurn.value)

  /**
   * 玩家主动外交：本回合是否已用尽上限（player-active-diplomacy 提案 D3）
   * 新回合由 useTurn.startTurn 调 resetDiplomacy 解锁。
   */
  const diplomacyUsedThisTurn = ref(false)

  // ====================== 计算属性 ======================
  /** 当前回合数（无存档时为 0） */
  const currentTurn = computed(() => currentSave.value?.state.turn ?? 0)

  /**
   * T3.3：当前回合是否为"剧情回合"（即本回合事件属于某条历史剧情链）
   * 派生自 currentEvent.chainId，供 FocusPanel 等 UI 区分剧情/普通回合。
   */
  const isStoryTurn = computed(() => !!currentEvent.value?.chainId)

  // ====================== 存档操作 ======================
  /**
   * 设置当前存档（整体替换）
   */
  function setSave(save: GameSave | null): void {
    currentSave.value = save
  }

  /**
   * 更新游戏状态快照（attributes/resources/date/turn）
   * 仅更新传入的字段，其余保留
   */
  function updateState(patch: Partial<StateSnapshot>): void {
    if (!currentSave.value) return
    currentSave.value = {
      ...currentSave.value,
      state: {
        ...currentSave.value.state,
        ...patch,
        attributes: { ...currentSave.value.state.attributes, ...(patch.attributes ?? {}) },
        resources: { ...currentSave.value.state.resources, ...(patch.resources ?? {}) },
        date: { ...currentSave.value.state.date, ...(patch.date ?? {}) }
      },
      updatedAt: Date.now()
    }
  }

  /**
   * 应用属性与资源变化（增量）
   *
   * 兼容 LLM 误用同义词：将 army / soldiers / forces / 兵 等同义词重命名为 troops，
   * 避免"扣银两但 troops 不增加"的字段映射丢失。
   */
  function applyEffects(effects: Partial<Attributes & Resources>): void {
    if (!currentSave.value) return
    // 归一化：同义词 → 标准字段名
    const normalized = normalizeEffects(effects)
    const { attributes, resources } = currentSave.value.state
    const newAttrs: Attributes = { ...attributes }
    const newRes: Resources = { ...resources }
    if (normalized.military !== undefined) newAttrs.military += normalized.military
    if (normalized.economy !== undefined) newAttrs.economy += normalized.economy
    if (normalized.politics !== undefined) newAttrs.politics += normalized.politics
    if (normalized.people !== undefined) newAttrs.people += normalized.people
    if (normalized.diplomacy !== undefined) newAttrs.diplomacy += normalized.diplomacy
    if (normalized.silver !== undefined) newRes.silver += normalized.silver
    if (normalized.troops !== undefined) newRes.troops += normalized.troops
    if (normalized.food !== undefined) newRes.food += normalized.food
    if (normalized.reputation !== undefined) newRes.reputation += normalized.reputation
    updateState({ attributes: newAttrs, resources: newRes })
  }

  /**
   * 归一化 effects 字段名：将 LLM 常用的同义词重命名为标准字段
   * 防止 army/soldiers/forces/兵 等被前端忽略导致资源变动丢失
   */
  function normalizeEffects(
    effects: Partial<Attributes & Resources>
  ): Partial<Attributes & Resources> {
    if (!effects || typeof effects !== 'object') return {}
    const result: Record<string, number> = {}
    for (const [key, value] of Object.entries(effects)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      const normalizedKey = normalizeKey(key)
      // 同名 key 累加（防止 army 和 troops 同时出现被覆盖）
      result[normalizedKey] = (result[normalizedKey] ?? 0) + value
    }
    return result as Partial<Attributes & Resources>
  }

  /** 单个 key 归一化：小写 + 同义词映射 */
  function normalizeKey(key: string): string {
    const k = key.toLowerCase().trim()
    // 兵力的同义词
    if (k === 'army' || k === 'soldiers' || k === 'forces' || k === '兵' || k === '兵力' || k === '军队') {
      return 'troops'
    }
    // 银两的同义词
    if (k === 'money' || k === 'gold' || k === 'cash' || k === '银' || k === '银子' || k === '银两') {
      return 'silver'
    }
    // 粮草的同义词
    if (k === 'grain' || k === 'food_supply' || k === '粮' || k === '粮食' || k === '粮草') {
      return 'food'
    }
    // 威望的同义词
    if (k === 'prestige' || k === 'fame' || k === '声望' || k === '名望') {
      return 'reputation'
    }
    return k
  }

  /**
   * 追加历史事件（自动截断保留最新 MAX_EVENTS 条）
   */
  function appendEvent(event: HistoryEvent): void {
    if (!currentSave.value) return
    const events = [...currentSave.value.events, event]
    if (events.length > MAX_EVENTS) {
      currentSave.value = {
        ...currentSave.value,
        events: events.slice(-MAX_EVENTS),
        updatedAt: Date.now()
      }
    } else {
      currentSave.value = {
        ...currentSave.value,
        events,
        updatedAt: Date.now()
      }
    }
  }

  /**
   * 追加军师对话消息（自动截断保留最新 MAX_ADVISOR_MESSAGES 条）
   */
  function appendAdvisorMessage(message: AdvisorMessage): void {
    if (!currentSave.value) return
    const messages = [...currentSave.value.advisorMessages, message]
    if (messages.length > MAX_ADVISOR_MESSAGES) {
      currentSave.value = {
        ...currentSave.value,
        advisorMessages: messages.slice(-MAX_ADVISOR_MESSAGES),
        updatedAt: Date.now()
      }
    } else {
      currentSave.value = {
        ...currentSave.value,
        advisorMessages: messages,
        updatedAt: Date.now()
      }
    }
  }

  /**
   * 标记存档已结束（ended/endedAt/endedReason 同步设置）
   */
  function markEnded(reason: EndedReason): void {
    if (!currentSave.value) return
    const now = Date.now()
    currentSave.value = {
      ...currentSave.value,
      ended: true,
      endedAt: now,
      endedReason: reason,
      updatedAt: now
    }
  }

  /**
   * T3.2：更新剧情链运行时状态（pending/active/completed）
   *
   * 仅合并传入的字段，未传入的保持原值。用于 applyEventOption 入队 / 完成剧情链后写回。
   */
  function updateChainState(partial: {
    pendingChainNodes?: PendingChainNode[]
    activeChainIds?: string[]
    completedChainIds?: string[]
  }): void {
    if (!currentSave.value) return
    currentSave.value = {
      ...currentSave.value,
      ...(partial.pendingChainNodes ? { pendingChainNodes: partial.pendingChainNodes } : {}),
      ...(partial.activeChainIds ? { activeChainIds: partial.activeChainIds } : {}),
      ...(partial.completedChainIds ? { completedChainIds: partial.completedChainIds } : {}),
      updatedAt: Date.now()
    }
  }

  /**
   * 玩家主动外交（player-active-diplomacy 提案 T2）
   *
   * 确定性地扣资源 + 改目标势力 relationship/status/power，受每回合上限守卫。
   * 不可变更新范式：建新 factions 数组 + 重赋 currentSave + 刷 updatedAt（与 updateState/applyEffects 一致）。
   *
   * @returns 成功应用返回 true；门槛/资源不足/已用上限/处理中/势力不存在返回 false
   */
  function applyDiplomacyAction(
    factionId: string,
    action: PlayerDiplomacyAction
  ): boolean {
    const save = currentSave.value
    if (!save) return false
    if (isProcessingTurn.value) return false
    if (diplomacyUsedThisTurn.value) return false

    const fac = save.factions.find((f) => f.id === factionId)
    if (!fac) return false

    const rule = DIPLOMACY_RULES[action]
    // 门槛 + 成本二次校验（UI 预校验之外，防绕过）
    if (fac.relationship < rule.minRelationship) return false
    if (!canAfford(rule.cost, save.state.resources)) return false

    // 扣资源（cost 负值经 applyEffects 扣减）
    applyEffects(rule.cost)
    // 额外正增量（如通商 reputation+5）
    if (rule.bonus) applyEffects(rule.bonus)

    // relationship 计算：setRelationship 优先（宣战=-100），否则增量并 clamp
    // （离间仅有 powerDelta，无 relDelta，此分支按 +0 处理，关系不变）
    const newRelationship =
      rule.setRelationship !== undefined
        ? clamp(rule.setRelationship, -100, 100)
        : clamp(fac.relationship + (rule.relDelta ?? 0), -100, 100)

    const newFactions = save.factions.map((f) => {
      if (f.id !== factionId) return f
      return {
        ...f,
        relationship: newRelationship,
        ...(rule.setStatus ? { status: rule.setStatus } : {}),
        ...(rule.powerDelta !== undefined
          ? { power: Math.max(0, f.power + rule.powerDelta) }
          : {}),
        lastAction: action
      }
    })

    // 基于 applyEffects 后的最新 currentSave 重赋（用 ! 排除 null，避免 saveVersion 推断为 2|undefined）
    currentSave.value = {
      ...currentSave.value!,
      factions: newFactions,
      updatedAt: Date.now()
    }
    diplomacyUsedThisTurn.value = true

    // 时间线记录（复用 '外交' EventType，与 AI 外交事件共用 badge；靠 title + playerChoice 区分）
    appendEvent({
      turn: save.state.turn,
      eventType: '外交',
      title: `你向${fac.name}${action}`,
      description: `对${fac.name}发动「${action}」`,
      playerChoice: action,
      effects: { ...rule.cost, ...(rule.bonus ?? {}) }
    })

    return true
  }

  /**
   * 重置本回合外交上限（player-active-diplomacy 提案 D3）
   *
   * 新回合开始时由 useTurn.startTurn 调用，解锁外交行动。
   */
  function resetDiplomacy(): void {
    diplomacyUsedThisTurn.value = false
  }

  // ====================== 回合临时态操作 ======================
  /**
   * 设置当前回合事件
   */
  function setEvent(event: GameEvent | null): void {
    currentEvent.value = event
  }

  /**
   * 设置 NPC 行动列表
   */
  function setNpcActions(actions: NpcAction[]): void {
    npcActions.value = actions
  }

  /**
   * T3.4：设置本回合决策失败的 NPC 列表
   */
  function setNpcFailedFactionIds(ids: { id: string; name: string }[]): void {
    npcFailedFactionIds.value = ids
  }

  /**
   * T3.1：设置当前选中选项 ID（null 表示取消选中）
   */
  function setSelectedOptionId(id: string | null): void {
    selectedOptionId.value = id
  }

  // ====================== 加载态操作 ======================
  function setProcessingTurn(value: boolean): void {
    isProcessingTurn.value = value
  }
  function setAdvisorStreaming(value: boolean): void {
    isAdvisorStreaming.value = value
  }
  function setSyncing(value: boolean): void {
    isSyncing.value = value
  }

  // ====================== 清空状态 ======================
  /**
   * 清空内存状态（不删除本地存档）
   */
  function clear(): void {
    currentSave.value = null
    currentEvent.value = null
    npcActions.value = []
    npcFailedFactionIds.value = []
    selectedOptionId.value = null
    isProcessingTurn.value = false
    isAdvisorStreaming.value = false
    isSyncing.value = false
  }

  return {
    // 存档数据
    currentSave,
    // 回合临时态
    currentEvent,
    npcActions,
    npcFailedFactionIds,
    selectedOptionId,
    // 加载态
    isProcessingTurn,
    isAdvisorStreaming,
    isSyncing,
    isLoading,
    diplomacyUsedThisTurn,
    // 计算属性
    currentTurn,
    isStoryTurn,
    // 存档操作
    setSave,
    updateState,
    applyEffects,
    appendEvent,
    appendAdvisorMessage,
    markEnded,
    updateChainState,
    applyDiplomacyAction,
    resetDiplomacy,
    // 回合临时态操作
    setEvent,
    setNpcActions,
    setNpcFailedFactionIds,
    setSelectedOptionId,
    // 加载态操作
    setProcessingTurn,
    setAdvisorStreaming,
    setSyncing,
    // 清空
    clear
  }
})
