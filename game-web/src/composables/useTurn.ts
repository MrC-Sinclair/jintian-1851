/**
 * @file useTurn — 回合循环编排
 *
 * 完整回合流程（design.md D3）：
 *   startTurn(): 调用 generate-event 获取本回合事件
 *     - 事件成功后追加：危机检查（属性<30 触发 onCrisis）+ 调 advisor-briefing 获取 AI 简报（onBriefing）
 *   makeDecision(optionId?): 选项决策（前端本地应用 effects）或自由输入（resolve-decision）
 *   endTurn(): npc-actions + 状态演化 + turn+1 + 持久化 + 结局判定
 *
 * 任一步失败降级不阻断（fallback 数据由服务端返回）。
 * 整个流程 isProcessingTurn 守卫，禁止重复点击。
 */

import { useGameStore } from '@/stores/game'
import { useGameState } from '@/composables/useGameState'
import { post, ApiError } from '@/utils/api'
import { checkEndConditions } from '@/utils/end-conditions'
import { getCrisis, type Crisis } from '@/utils/goal-hint'
import { calcAttributeShortfall } from '@/utils/attribute-shortfall'
import { calcTurnYield } from '@/utils/turn-yield'
import { SYSTEM_EVENT } from '@/utils/copywriting'
import type {
  Attributes,
  EventOption,
  GameEvent,
  HistoryEvent,
  NpcAction,
  Resources
} from '@/types/game'

/** 后端 generate-event 响应数据类型（data.event 包装） */
interface GenerateEventResponse {
  event: {
    title: string
    description: string
    eventType: GameEvent['eventType']
    options: EventOption[]
    /** 剧情链事件携带的链元数据（与 GameEvent 对齐，仅剧情链路径有值） */
    chainId?: string
    chainNodeId?: string
    chainProgress?: { current: number; total: number }
  }
}

/** 后端 resolve-decision 响应数据类型 */
interface ResolveDecisionResponse {
  effects: Partial<Attributes & Resources>
}

/** 后端 npc-actions 响应数据类型 */
interface NpcActionsResponse {
  actions: NpcAction[]
  /** T3.3：决策失败的 NPC 势力 ID（部分/全部失败时存在） */
  failedFactionIds?: string[]
  fallback?: boolean
}

/** 后端 advisor-briefing 响应数据类型（与 FocusPanel 的 AdvisorBriefing 接口一致） */
export interface AdvisorBriefing {
  /** 局势摘要（可选展示，本版本不直接渲染） */
  summary: string
  /** AI 给出的本回合建议（覆盖规则 suggestion） */
  suggestion: string
}

/** 后端 advisor-briefing 响应（data 字段已剥除 ok 包装） */
interface AdvisorBriefingResponse {
  summary: string
  suggestion: string
}

export interface UseTurnOptions {
  /** 回合阶段错误回调（如 toast.error） */
  onError?: (stage: string, message: string) => void
  /** 回合完成回调（可用于触发自动同步等） */
  onTurnEnd?: () => void
  /**
   * 回合开始后危机检查回调（T1.15）
   *
   * 触发时机：startTurn 内 generate-event 成功后，调用 getCrisis 检查 5 维属性，
   * 若存在属性 < 30 的危机，调用此回调（用于上层 toast.warning 提示玩家）。
   */
  onCrisis?: (crisis: Crisis) => void
  /**
   * 回合开始后 AI 简报回调（T1.15）
   *
   * 触发时机：startTurn 内 generate-event 成功后，调用 /api/game/advisor-briefing 获取 AI 简报，
   * 成功传 briefing 对象，失败传 null（上层 FocusPanel 收到 null 时使用规则 suggestion 兜底）。
   */
  onBriefing?: (briefing: AdvisorBriefing | null) => void
}

export function useTurn(options: UseTurnOptions = {}) {
  const store = useGameStore()
  const { save, applyEventOption } = useGameState()

  /**
   * 开始新回合：调用 generate-event 获取事件
   *
   * 事件获取成功后追加（T1.15）：
   *   1. 危机检查：调 getCrisis 检查 5 维属性，存在 <30 的危机则触发 onCrisis 回调
   *   2. AI 简报：调 /api/game/advisor-briefing 获取本回合建议，成功触发 onBriefing(briefing)，失败 onBriefing(null)
   *
   * 危机检查和 AI 简报失败均不阻断主流程，事件已写入 store 即视为回合开始成功。
   *
   * @returns 事件对象（失败时返回 null，UI 可显示降级提示）
   */
  async function startTurn(): Promise<GameEvent | null> {
    if (!store.currentSave) {
      options.onError?.('startTurn', '无存档')
      return null
    }
    if (store.isProcessingTurn) {
      return null
    }

    // 新回合解锁玩家主动外交上限（player-active-diplomacy 提案 D3）
    store.resetDiplomacy()

    store.setProcessingTurn(true)

    const s = store.currentSave
    try {
      const res = await post<GenerateEventResponse>('/api/game/generate-event', {
        saveId: s.saveId,
        turn: s.state.turn,
        stateSnapshot: s.state,
        character: {
          background: s.character.background,
          factionName: s.character.factionName,
          factionSummary: s.character.factionSummary
        },
        factions: s.factions,
        recentEvents: s.events.slice(-5),
        // T3.3：v2 存档必传的剧情链运行时状态，供后端三层触发优先级判断
        pendingChainNodes: s.pendingChainNodes,
        completedChainIds: s.completedChainIds,
        activeChainIds: s.activeChainIds,
        // 事件权重动态调整：携带属性短板信号，引导后端 LLM 生成补短板事件
        attributeShortfall: calcAttributeShortfall(s.state.attributes)
      })

      const gameEvent: GameEvent = {
        title: res.event.title,
        description: res.event.description,
        eventType: res.event.eventType,
        options: res.event.options,
        // T4.1/T3.2：保留剧情链元数据，供 EventCard 显示「剧情 X/Y」角标与链名，
        // 也供 makeDecision → applyEventOption 入队下一节点（否则剧情链无法推进）
        chainId: res.event.chainId,
        chainNodeId: res.event.chainNodeId,
        chainProgress: res.event.chainProgress
      }
      store.setEvent(gameEvent)

      // ====================== T1.15+T3.2 事件成功后追加：危机检查 + AI 简报 ======================
      // 注意：这两步失败均不阻断主流程（事件已写入 store），仅在 catch 内 console.error
      //
      // T3.2 优化：危机检查（同步）立即执行，AI 简报（异步网络）并行进行不阻塞危机提示
      //   - 危机检查：同步 getCrisis，无网络开销，立即触发 onCrisis
      //   - AI 简报：异步 post advisor-briefing，失败降级为 null
      //   - 简报与 generate-event 无依赖关系（简报基于当前 stateSnapshot，不需要事件结果），
      //     理论上可与 generate-event 并行，但为保持「事件成功才进入回合」语义，这里在事件成功后启动

      // 1. 危机检查（同步，立即触发，让玩家尽早感知危机）
      try {
        const crisis = getCrisis(s.state.attributes)
        if (crisis) {
          options.onCrisis?.(crisis)
        }
      } catch (err) {
        console.error('[useTurn] 危机检查失败:', err)
      }

      // 2. AI 简报（异步，失败降级为 null，上层 FocusPanel 使用规则 suggestion 兜底）
      try {
        const briefingRes = await post<AdvisorBriefingResponse>(
          '/api/game/advisor-briefing',
          {
            saveId: s.saveId,
            turn: s.state.turn,
            stateSnapshot: s.state
          }
        )
        options.onBriefing?.({
          summary: briefingRes.summary,
          suggestion: briefingRes.suggestion
        })
      } catch (err) {
        console.error('[useTurn] AI 简报获取失败，降级为 null:', err)
        options.onBriefing?.(null)
      }

      return gameEvent
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '事件生成失败'
      options.onError?.('startTurn', msg)
      store.setEvent(null)
      return null
    } finally {
      store.setProcessingTurn(false)
    }
  }

  /**
   * 玩家做决策
   *
   * @param optionId 事件选项 ID（选项决策）
   * @param freeInput 自由输入文本（自由行动，调用 resolve-decision）
   *   - optionId 与 freeInput 二选一：optionId 优先
   *
   * @returns 决策应用的 effects（用于 UI 反馈），失败返回 null
   */
  async function makeDecision(
    optionId?: string,
    freeInput?: string
  ): Promise<Partial<Attributes & Resources> | null> {
    if (!store.currentSave || !store.currentEvent) {
      options.onError?.('makeDecision', '无存档或当前回合无事件')
      return null
    }

    const s = store.currentSave
    const evt = store.currentEvent

    // 选项决策：本地直接应用 effects（不调 API）
    if (optionId) {
      const option = evt.options.find((o) => o.id === optionId)
      if (!option) {
        options.onError?.('makeDecision', `选项 ${optionId} 不存在`)
        return null
      }
      store.applyEffects(option.effects)
      // T3.2：应用选项后处理剧情链入队（非剧情链事件自动无操作）
      applyEventOption(evt, option)
      return option.effects
    }

    // 自由输入：调用 resolve-decision 让 LLM 解析 effects
    if (freeInput && freeInput.trim()) {
      if (store.isProcessingTurn) return null
      store.setProcessingTurn(true)

      try {
        const res = await post<ResolveDecisionResponse>('/api/game/resolve-decision', {
          saveId: s.saveId,
          turn: s.state.turn,
          playerDecision: freeInput.trim().slice(0, 200),
          stateSnapshot: s.state,
          event: evt
        })
        store.applyEffects(res.effects)
        return res.effects
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : '决策解析失败'
        options.onError?.('makeDecision', msg)
        return null
      } finally {
        store.setProcessingTurn(false)
      }
    }

    return null
  }

  /**
   * 结束回合：
   *   1. 调用 npc-actions 获取 NPC 行动
   *   2. 应用 NPC effects
   *   3. 追加历史事件
   *   4. turn+1, date.month+1（溢出 year+1）
   *   5. 持久化 + 结局判定
   *
   * @param playerChoice 玩家最终选择描述（用于历史记录）
   */
  async function endTurn(playerChoice: string): Promise<void> {
    if (!store.currentSave || !store.currentEvent) {
      options.onError?.('endTurn', '无存档或当前回合无事件')
      return
    }
    if (store.isProcessingTurn) return

    store.setProcessingTurn(true)

    const s = store.currentSave
    const evt = store.currentEvent

    try {
      // 1. NPC 行动
      let npcActions: NpcAction[] = []
      let res: NpcActionsResponse = { actions: [] }
      try {
        res = await post<NpcActionsResponse>('/api/game/npc-actions', {
          saveId: s.saveId,
          turn: s.state.turn,
          character: {
            background: s.character.background,
            factionName: s.character.factionName
          },
          stateSnapshot: s.state,
          factions: s.factions
        })
        npcActions = res.actions ?? []
      } catch {
        // NPC 失败降级为空数组，不阻断
        npcActions = []
      }
      store.setNpcActions(npcActions)

      // 解析失败 NPC 名称（从存档 factions 查），供 NpcActionList 展示失败角标（T3.4）
      const failed = (res.failedFactionIds ?? []).map((id: string) => ({
        id,
        name: s.factions.find((f) => f.id === id)?.name ?? id
      }))
      store.setNpcFailedFactionIds(failed)

      // 2. 应用 NPC effects
      for (const action of npcActions) {
        if (action.effects) {
          store.applyEffects(action.effects)
        }
      }

      // 3. 追加历史事件
      const historyEvent: HistoryEvent = {
        turn: s.state.turn,
        eventType: evt.eventType,
        title: evt.title,
        description: evt.description,
        playerChoice: playerChoice.slice(0, 200),
        effects: {}, // 实际 effects 已通过 applyEffects 应用，这里仅记录元数据
        // T3.2：剧情链事件携带 chainId/chainNodeId，供 TurnTimeline 渲染书卷图标
        chainId: evt.chainId,
        chainNodeId: evt.chainNodeId
      }
      store.appendEvent(historyEvent)

      // 3.5 回合资源自动产出（game-design.md:572）：结算银两 +50，并记录系统历史事件（可追溯）
      const turnYield = calcTurnYield()
      store.applyEffects(turnYield)
      store.appendEvent({
        turn: s.state.turn,
        eventType: '系统',
        title: SYSTEM_EVENT.turnYield,
        description: SYSTEM_EVENT.turnYield,
        playerChoice: '',
        effects: { ...turnYield }
      })

      // 4. turn+1, date 推进
      const nextMonth = s.state.date.month + 1
      const nextDate =
        nextMonth > 12
          ? { year: s.state.date.year + 1, month: 1 }
          : { year: s.state.date.year, month: nextMonth }
      store.updateState({
        turn: s.state.turn + 1,
        date: nextDate
      })

      // 5. 持久化
      await save()

      // 6. 清空当前回合事件（NPC 行动/失败记录保留，持续到下一回合展示「天下动静」，
      //    见 game-main 天下动静区块；下一回合 endTurn 拉取新数据时再被覆盖）
      store.setEvent(null)

      // 7. 检查结局条件（属性崩溃 > 胜利 > 时光尽头）
      // 触发结局：标记存档结束 + 持久化 + 跳转结局页（不触发 onTurnEnd 自动同步）
      const endReason = checkEndConditions(store.currentSave!)
      if (endReason !== 'continue') {
        store.markEnded(endReason)
        await save()
        uni.redirectTo({ url: '/pages/end-game/index' })
        return
      }

      // 8. 触发回合结束回调（用于自动同步等）
      options.onTurnEnd?.()
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '回合结束失败'
      options.onError?.('endTurn', msg)
    } finally {
      store.setProcessingTurn(false)
    }
  }

  return {
    startTurn,
    makeDecision,
    endTurn
  }
}
