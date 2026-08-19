/**
 * @file useAdvisor — 军师对话（SSE 流式）
 *
 * 职责：
 *   - send(content): 调用 useSSE 发起流式请求
 *   - onChunk(delta): 追加到当前流式消息
 *   - onDone(): 把完整消息追加到 save.advisorMessages（store 自动截断 20 条）
 *   - onError(): 显示「军师沉默」占位
 *   - setBriefing(b, turn): 设置本回合 AI 简报（由 useTurn.startTurn 调用）
 *
 * 依赖：
 *   - useSSE: 三端 SSE 流式封装
 *   - useGameStore: 存档状态
 *   - useGameState.save(): 流式完成后持久化
 *
 * T2.6：briefing / briefingTurn 为模块级单例 ref，
 * 跨组件共享（game-main 的 useTurn onBriefing 写入 → AdvisorDrawer 读取并插入消息）。
 */

import { ref } from 'vue'
import { useSSE, type SSEConnectTask } from '@/composables/useSSE'
import { useGameStore } from '@/stores/game'
import { useGameState } from '@/composables/useGameState'
import { ERROR_TEXT } from '@/utils/copywriting'
import type { AdvisorMessage, BriefingResult } from '@/types/game'

/** 工具调用状态：calling=调用中 / done=完成 / fail=失败 */
export type ToolCallStatus = 'calling' | 'done' | 'fail'

/** 单次工具调用过程记录（T2.4，仅本回合展示，不持久化） */
export interface ToolCallEntry {
  /** 工具名（如 get-faction-info） */
  toolName: string
  /** 工具中文标签（如「势力详情」，用于气泡文案） */
  label: string
  /** 调用参数 */
  args: unknown
  /** 调用状态 */
  status: ToolCallStatus
  /** 调用结果；工具失败时含 { error, detail } */
  result?: unknown
}

/** 工具名 → 中文标签（AdvisorDrawer 气泡文案用） */
const TOOL_LABELS: Record<string, string> = {
  'get-faction-info': '势力详情',
  'get-all-factions': '全部势力',
  'get-character-status': '自身状态',
  'get-recent-events': '历史事件',
  'get-relationship': '势力关系',
  'get-current-date': '当前日期'
}

/** 取工具中文标签，未知工具名回退为原名 */
function labelForTool(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName
}

export interface UseAdvisorOptions {
  /** 首 chunk 超时（默认 3000ms） */
  firstChunkTimeoutMs?: number
  /** 错误回调（如 toast.error） */
  onError?: (code: string) => void
}

// ====================== T2.6 模块级单例：briefing 跨组件共享 ======================
/**
 * 本回合 AI 简报（由 useTurn.startTurn 内调 /api/game/advisor-briefing 后通过 setBriefing 写入）
 *
 * 初始 null。game-main 的 onBriefing 回调写入；AdvisorDrawer 读取后插入「局势简报」消息。
 * 模块级 ref 保证 game-main 与 AdvisorDrawer 多次调用 useAdvisor() 时共享同一份状态。
 */
const briefing = ref<BriefingResult | null>(null)
/**
 * 本回合简报所属的 turn（用于 AdvisorDrawer 判断「本回合是否已展示过」）
 *
 * 仅当 briefing 非 null 时有效；briefing 为 null 时此值也为 null。
 */
const briefingTurn = ref<number | null>(null)

/**
 * 设置本回合 AI 简报（由 useTurn.startTurn 的 onBriefing 回调调用）
 *
 * @param b 简报对象（成功）或 null（失败/降级）
 * @param turn 当前回合 turn（用于 AdvisorDrawer 判断是否本回合已展示）
 */
function setBriefing(b: BriefingResult | null, turn: number): void {
  briefing.value = b
  briefingTurn.value = b ? turn : null
}

export function useAdvisor(options: UseAdvisorOptions = {}) {
  const store = useGameStore()
  const { save: persistSave } = useGameState()
  const { connect } = useSSE()

  /** 当前流式响应文本（流式过程中实时更新，UI 监听展示） */
  const streamingText = ref('')
  /** 当前是否正在流式响应 */
  const isStreaming = ref(false)
  /** 错误码（流式失败时设置） */
  const errorCode = ref<string | null>(null)
  /** 工具调用过程记录（T2.4，仅本回合展示，不持久化） */
  const toolCalls = ref<ToolCallEntry[]>([])

  let currentTask: SSEConnectTask | null = null

  /**
   * 发送消息给军师
   *
   * @param content 玩家输入文本
   * @returns 流式是否成功完成（true=完成，false=失败/中断）
   */
  async function send(content: string): Promise<boolean> {
    if (!store.currentSave) {
      options.onError?.('NO_SAVE')
      return false
    }
    if (isStreaming.value) {
      // 已在流式中，忽略重复请求
      return false
    }
    if (!content.trim()) {
      return false
    }

    const save = store.currentSave
    const userMessage: AdvisorMessage = {
      role: 'user',
      content,
      turn: save.state.turn,
      timestamp: Date.now()
    }

    // 立即把用户消息写入 store（UI 即时反馈）
    store.appendAdvisorMessage(userMessage)

    // 准备请求体（消息列表含本次用户输入）
    // 防御：过滤历史空 content 消息（如简报超时降级曾插入的空简报），
    // 否则 server zod 校验 content min(1) 会整包拒绝为 400
    const messages = [
      ...save.advisorMessages.filter((m) => m.content.trim().length > 0),
      userMessage
    ]

    // 重置流式状态
    streamingText.value = ''
    errorCode.value = null
    isStreaming.value = true
    // 工具调用记录仅本回合展示，每次发送前清空（NG5：不持久化）
    toolCalls.value = []
    store.setAdvisorStreaming(true)

    return new Promise<boolean>((resolve) => {
      let aborted = false

      currentTask = connect(
        '/api/game/advisor-chat',
        {
          saveId: save.saveId,
          turn: save.state.turn,
          messages,
          character: save.character,
          stateSnapshot: save.state,
          factions: save.factions,
          recentEvents: save.events.slice(-5)
        },
        {
          callbacks: {
            onChunk: (delta) => {
              streamingText.value += delta
            },
            // T2.4：工具调用开始 → 追加一条 calling 状态记录
            onToolCall: (toolName, args) => {
              toolCalls.value.push({
                toolName,
                label: labelForTool(toolName),
                args,
                status: 'calling'
              })
            },
            // T2.4：工具调用结果 → 匹配最近一条同名的 calling 记录并更新状态
            // 工具失败（result 含 error 字段）标记 fail，否则 done
            onToolResult: (toolName, result) => {
              let idx = -1
              for (let i = toolCalls.value.length - 1; i >= 0; i--) {
                if (
                  toolCalls.value[i].toolName === toolName &&
                  toolCalls.value[i].status === 'calling'
                ) {
                  idx = i
                  break
                }
              }
              if (idx === -1) return
              const isFail =
                !!result &&
                typeof result === 'object' &&
                'error' in (result as Record<string, unknown>)
              toolCalls.value[idx].status = isFail ? 'fail' : 'done'
              toolCalls.value[idx].result = result
            },
            onDone: () => {
              if (aborted) return
              const fullText = streamingText.value
              isStreaming.value = false
              store.setAdvisorStreaming(false)
              currentTask = null

              // 追加 assistant 消息到存档
              if (fullText.trim()) {
                const assistantMessage: AdvisorMessage = {
                  role: 'assistant',
                  content: fullText,
                  turn: save.state.turn,
                  timestamp: Date.now()
                }
                store.appendAdvisorMessage(assistantMessage)
                // 异步持久化（不阻塞 UI）
                void persistSave().catch(() => {
                  /* 持久化失败不影响对话，下次 save 时会重试 */
                })
              }
              resolve(true)
            },
            onError: (code) => {
              if (aborted) return
              aborted = true
              isStreaming.value = false
              store.setAdvisorStreaming(false)
              errorCode.value = code
              currentTask = null

              // T3.4：显示「军师沉默」占位（spec ai-advisor）+ 补充"可重新提问"提示
              // 保留古风占位感，并使用 ERROR_TEXT.advisorFailed 统一白话化文案提示重试
              const placeholder: AdvisorMessage = {
                role: 'assistant',
                content: `（军师沉默不语，似乎不愿多言。）${ERROR_TEXT.advisorFailed}`,
                turn: save.state.turn,
                timestamp: Date.now()
              }
              store.appendAdvisorMessage(placeholder)

              options.onError?.(code)
              resolve(false)
            }
          },
          firstChunkTimeoutMs: options.firstChunkTimeoutMs ?? 3000
        }
      )
    })
  }

  /**
   * 取消当前流式请求
   */
  function abort(): void {
    if (currentTask) {
      currentTask.abort()
      currentTask = null
      isStreaming.value = false
      store.setAdvisorStreaming(false)
    }
  }

  return {
    streamingText,
    isStreaming,
    errorCode,
    toolCalls,
    send,
    abort,
    // T2.6：briefing 模块级单例（跨组件共享）
    briefing,
    briefingTurn,
    setBriefing
  }
}
