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
import {
  DIPLOMACY_RULES,
  NEGOTIATION_LETTER_DELTA_LIMIT,
  canAfford,
  clamp,
  getNegotiationDealById,
  scaleNegotiationEffect
} from '@/utils/constants'
import type {
  AdvisorMessage,
  Attributes,
  EndedReason,
  Faction,
  FreeFactionEffect,
  GameEvent,
  GameSave,
  HistoryEvent,
  NegotiationDealId,
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

  /**
   * 谈判（faction-negotiation 提案 D4）：本回合是否已发起过写信。
   * 与 diplomacyUsedThisTurn 互不占用；letter 成功（非降级）时由 useTurn 置位，
   * settle 追答不重复计；降级（X-Fallback）不置位允许重试；随 resetDiplomacy 一并重置。
   */
  const negotiationUsedThisTurn = ref(false)

  /**
   * T4（自由行动势力微调）本次自由行动应用的势力变化列表，供决策反馈 UI 展示。
   * 每回合决策成功后由 applyFreeFactionEffects 填充，UI 读取后由 useTurn 在下一决策前清空。
   */
  const lastFreeFactionEffects = ref<{ name: string; relationshipDelta?: number; powerDelta?: number }[]>([])

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
   * 新回合开始时由 useTurn.startTurn 调用，解锁外交行动；
   * faction-negotiation 提案 D4：谈判配额一并重置（两配额同生命周期，均每回合 1 次）。
   */
  function resetDiplomacy(): void {
    diplomacyUsedThisTurn.value = false
    negotiationUsedThisTurn.value = false
  }

  /** 谈判配额置位（letter 成功非降级时由 useTurn 调用） */
  function markNegotiationUsed(): void {
    negotiationUsedThisTurn.value = true
  }

  /**
   * 谈判（faction-negotiation 提案）：应用信件软性关系影响
   *
   * 适用场景：letter 阶段直接 accept/reject、settle 拒绝、玩家放弃——
   * 即"未成交，仅信件态度影响"。delta clamp ±10（弱于行贿 +15），最终 clamp -100~100。
   * 追加 eventType '外交' 历史事件（谈判记录入档）。
   */
  function applyLetterDelta(factionId: string, delta: number): void {
    const save = currentSave.value
    if (!save) return
    const fac = save.factions.find((f) => f.id === factionId)
    if (!fac) return

    const clamped = clamp(Math.round(delta), -NEGOTIATION_LETTER_DELTA_LIMIT, NEGOTIATION_LETTER_DELTA_LIMIT)
    const newFactions = save.factions.map((f) =>
      f.id === factionId
        ? { ...f, relationship: clamp(f.relationship + clamped, -100, 100) }
        : f
    )
    currentSave.value = { ...save, factions: newFactions, updatedAt: Date.now() }

    appendEvent({
      turn: save.state.turn,
      eventType: '外交',
      title: `你向${fac.name}致书`,
      description: `书信往来，${fac.name}态度${clamped >= 0 ? '转好' : '转冷'}（关系 ${clamped >= 0 ? '+' : ''}${clamped}）`,
      playerChoice: '写信',
      effects: {}
    })
  }

  /**
   * 谈判（faction-negotiation 提案 D5）：按兑换表确定性执行成交
   *
   * 流程：资源校验 → 扣减（price + 按比例缩放的副资源成本）→ 应用缩放效果
   * （relationship 并入信件 delta；可能的 reputation 增益；alliance-deal 置 status='allied'）
   * → 追加 eventType '外交' 历史事件。数值权威在本表（LLM 不产出最终数值，防幻觉破坏平衡）。
   *
   * @returns 成功返回 true；无存档/deal 不在表内/势力不存在/资源不足返回 false
   */
  function applyNegotiationDeal(
    factionId: string,
    dealId: NegotiationDealId,
    price: number,
    letterDelta: number
  ): boolean {
    const save = currentSave.value
    if (!save) return false
    const deal = getNegotiationDealById(dealId)
    if (!deal) return false
    const fac = save.factions.find((f) => f.id === factionId)
    if (!fac) return false

    const scaled = scaleNegotiationEffect(deal, price)
    // 资源校验（cost 为正值扣减量）
    const costPayload: Partial<Resources> = { silver: -scaled.cost.silver }
    if (scaled.cost.reputation !== undefined) {
      costPayload.reputation = -scaled.cost.reputation
    }
    if (!canAfford(costPayload, save.state.resources)) return false

    // 1. 扣资源 + 效果增益（trade-deal 的 reputation +N）
    applyEffects(costPayload)
    if (scaled.effect.reputation !== undefined) {
      applyEffects({ reputation: scaled.effect.reputation })
    }

    // 2. relationship：信件 delta（clamp ±10）+ 兑换效果，最终 clamp -100~100
    const letterPart = clamp(Math.round(letterDelta), -NEGOTIATION_LETTER_DELTA_LIMIT, NEGOTIATION_LETTER_DELTA_LIMIT)
    const relTotal = letterPart + scaled.effect.relationship
    const newFactions = currentSave.value!.factions.map((f) =>
      f.id === factionId
        ? {
            ...f,
            relationship: clamp(f.relationship + relTotal, -100, 100),
            // status 变更仅 alliance-deal 有（前端按表映射，LLM 不产出）
            ...(deal.effect.status ? { status: deal.effect.status } : {}),
            lastAction: deal.label
          }
        : f
    )
    currentSave.value = {
      ...currentSave.value!,
      factions: newFactions,
      updatedAt: Date.now()
    }

    // 3. 历史事件入档（eventType 复用 '外交'）
    const costText = `耗银两 ${scaled.cost.silver}${scaled.cost.reputation !== undefined ? `、名望 ${scaled.cost.reputation}` : ''}`
    appendEvent({
      turn: save.state.turn,
      eventType: '外交',
      title: `与${fac.name}${deal.label}`,
      description: `谈判成交：${costText}，关系 +${relTotal}${deal.effect.status === 'allied' ? '，结为盟友' : ''}`,
      playerChoice: deal.label,
      effects: { ...costPayload, ...(scaled.effect.reputation !== undefined ? { reputation: scaled.effect.reputation } : {}) }
    })

    return true
  }

  /**
   * T4（自由行动打通势力关系与实力）：应用自由行动的势力软性微调
   *
   * 与 applyDiplomacyAction 的区别：
   *   - 不受 diplomacyUsedThisTurn 守卫（自由行动是事件决策的一部分，与"每回合 1 次确定性外交"是不同系统）
   *   - 仅做 soft 微调（relationshipDelta/powerDelta），禁止改 status（status 变更仍走确定性按钮）
   *   - 不可变更新范式同 applyDiplomacyAction：建新 factions 数组 + 重赋 currentSave + 刷 updatedAt
   *
   * 资源代价由 AI 在 effects.resources 中表达，经 applyEffects 扣减（与本次调用顺序叠加）。
   *
   * @param effects 后端返回的 factionEffects（已 sanitize 过 factionId ∈ factions）
   */
  function applyFreeFactionEffects(effects: FreeFactionEffect[]): void {
    const save = currentSave.value
    if (!save || !effects || effects.length === 0) return

    const applied: { name: string; relationshipDelta?: number; powerDelta?: number }[] = []
    const newFactions: Faction[] = save.factions.map((f) => {
      const eff = effects.find((e) => e.factionId === f.id)
      if (!eff) return f

      // relationship：软性微调 ±20，最终 clamp(-100,100)
      const relDelta = clamp(eff.relationshipDelta ?? 0, -20, 20)
      const newRelationship = clamp(f.relationship + relDelta, -100, 100)
      // power：软性微调 ±30，最终 Math.max(0)
      const powDelta = clamp(eff.powerDelta ?? 0, -30, 30)
      const newPower = Math.max(0, f.power + powDelta)

      applied.push({
        name: f.name,
        relationshipDelta: relDelta !== 0 ? relDelta : undefined,
        powerDelta: powDelta !== 0 ? powDelta : undefined
      })

      return { ...f, relationship: newRelationship, power: newPower }
    })

    currentSave.value = {
      ...save,
      factions: newFactions,
      updatedAt: Date.now()
    }

    // 仅记录确有变化的条目，供 UI 反馈
    lastFreeFactionEffects.value = applied.filter(
      (a) => a.relationshipDelta !== undefined || a.powerDelta !== undefined
    )
  }

  /** 清空上次自由行动势力变化记录（UI 读取展示后调用） */
  function clearLastFreeFactionEffects(): void {
    lastFreeFactionEffects.value = []
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
    diplomacyUsedThisTurn.value = false
    negotiationUsedThisTurn.value = false
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
    negotiationUsedThisTurn,
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
    markNegotiationUsed,
    applyLetterDelta,
    applyNegotiationDeal,
    applyFreeFactionEffects,
    clearLastFreeFactionEffects,
    lastFreeFactionEffects,
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
