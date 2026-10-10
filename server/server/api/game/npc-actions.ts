/**
 * @file POST /api/game/npc-actions — 多 Agent 并行生成 NPC 势力行动
 *
 * 设计文档 D4（G3）：每个活跃 NPC 势力作为独立 Agent 并行决策，
 * 每个 Agent 注册 4 个核心工具（createNpcTools），stopWhen: stepCountIs(5)。
 * LLM 自主决定调用哪些工具、调用顺序（AGENTS.md「LLM 自主决策 = Agent」）。
 * 最终决策由 Agent 输出 JSON，runNpcAgent 解析为 NpcAction 结构。
 * 步数被工具调用耗尽导致 text 为空时，走一次「不带 tools」的兜底调用强制出 JSON。
 *
 * 失败隔离（D4 / T3.3）：
 *   - 单个 NPC Agent 失败：不影响其他 NPC，加入 failedFactionIds，响应头 X-Partial-Failure: true
 *   - 全部失败：{ actions: [], fallback: true } + X-Fallback: true（既有降级语义）
 *   - 无活跃 NPC：直接返回空 actions（不调 LLM）
 *   - 并发锁冲突：429 + CONCURRENT_REQUEST（既有逻辑）
 */

import { createOpenAI } from '@ai-sdk/openai'
import { streamText, stepCountIs, type LanguageModel, type ModelMessage } from 'ai'
import { z } from 'zod'
import { getModelCapabilities } from '../../config/models'
import { createSiliconFlowFetch } from '../../utils/siliconflow-fetch'
import { buildNpcAgentPrompt, type NpcMemories } from '../../utils/prompts/npc-agent'
import { createNpcTools, type ToolContext } from '../../utils/tool-context'
import { searchFactionMemories, writeFactionMemory, type MemorySearchResult } from '../../utils/memory'
import { acquireLock, isLocked } from '../../utils/concurrency-lock'
import { isE2eTestMode } from '../../utils/e2e-test-mode'
import { logLlmUsage } from '../../utils/llm-usage'
import type {
  Attributes,
  Faction,
  NpcAction,
  NpcActionType,
  Resources
} from '../../../types/game'

/** 单请求允许的最大 NPC Agent 数（游戏内 6 势力，留余量防成本放大） */
const MAX_NPC_AGENTS_PER_REQUEST = 10

const bodySchema = z.object({
  saveId: z.string().uuid(),
  turn: z.number().int().positive(),
  character: z.object({
    background: z.enum(['文官', '武将', '商贾', '士绅', '宗室']),
    factionName: z.string()
  }),
  stateSnapshot: z.object({
    turn: z.number().int().positive(),
    date: z.object({ year: z.number().int(), month: z.number().int().min(1).max(12) }),
    attributes: z.object({
      military: z.number(),
      economy: z.number(),
      politics: z.number(),
      people: z.number(),
      diplomacy: z.number()
    }),
    resources: z.object({
      silver: z.number(),
      troops: z.number(),
      food: z.number(),
      reputation: z.number()
    })
  }),
  factions: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        summary: z.string(),
        power: z.number(),
        relationship: z.number(),
        status: z.enum(['active', 'destroyed', 'allied'])
      })
    )
    .min(1)
    // 每个 active 势力触发 1 个独立 Agent（多次 LLM 调用），必须设上限防成本放大 DoS
    // （限流按请求数计数，拦不住 1 请求内 N 个 Agent）；游戏内 6 势力，上限 10 留余量
    .max(MAX_NPC_AGENTS_PER_REQUEST)
})

/** runNpcAgent 返回：成功为 NpcAction，失败携带 factionId 以便隔离 */
type NpcAgentResult = NpcAction | { failed: true; factionId: string }

const ACTION_TYPES: readonly NpcActionType[] = [
  '扩张',
  '结盟',
  '备战',
  '休养',
  '挑衅',
  '外交'
]

const KNOWN_EFFECT_KEYS: readonly string[] = [
  'military',
  'economy',
  'politics',
  'people',
  'diplomacy',
  'silver',
  'troops',
  'food',
  'reputation'
]

/**
 * 从 Agent 文本输出中提取 JSON 对象
 * Agent 可能输出带 markdown 代码块或混杂文字，需鲁棒提取首个 { ... } 片段。
 */
function extractNpcActionJson(text: string): Record<string, unknown> | null {
  if (!text || !text.trim()) return null
  // 1. 直接解析（理想情况：纯 JSON）
  try {
    return JSON.parse(text.trim()) as Record<string, unknown>
  } catch {
    // 继续尝试截取
  }
  // 2. 截取首个 { 到最后一个 } 之间的内容（容忍前后多余文字 / markdown）
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1 || last === -1 || last < first) return null
  const slice = text.slice(first, last + 1)
  try {
    return JSON.parse(slice) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * 将解析后的 JSON 规范化为 NpcAction。
 * factionId / factionName 强制取自入参 faction（不信任 LLM 自报），
 * action 必须合法，effects 仅保留已知键并过滤非数字值。
 * 返回 null 表示格式非法（视为该 NPC 决策失败）。
 */
function normalizeNpcAction(
  parsed: Record<string, unknown>,
  faction: Faction
): NpcAction | null {
  const rawAction = typeof parsed.action === 'string' ? parsed.action : ''
  if (!ACTION_TYPES.includes(rawAction as NpcActionType)) return null

  const effects: Partial<Attributes & Resources> = {}
  const rawEffects = parsed.effects
  if (rawEffects && typeof rawEffects === 'object') {
    const effObj = rawEffects as Record<string, unknown>
    for (const key of KNOWN_EFFECT_KEYS) {
      const v = effObj[key]
      if (typeof v === 'number') {
        ;(effects as Record<string, number>)[key] = v
      }
    }
  }

  const description =
    typeof parsed.description === 'string' && parsed.description.trim()
      ? parsed.description
      : '（无描述）'
  const target = typeof parsed.target === 'string' ? parsed.target : undefined

  return {
    factionId: faction.id,
    factionName: faction.name,
    action: rawAction as NpcActionType,
    target,
    description,
    effects
  }
}

/**
 * 按行动类型推导记忆情感（提案 任务6）：
 * 结盟/外交=positive，挑衅/备战=negative，扩张/休养=neutral。
 */
function deriveSentiment(action: NpcActionType): 'positive' | 'negative' | 'neutral' {
  switch (action) {
    case '结盟':
    case '外交':
      return 'positive'
    case '挑衅':
    case '备战':
      return 'negative'
    default:
      return 'neutral'
  }
}

/**
 * 检索该势力自身的历史记忆（D7 双隔离 + D8 正负混合召回）。
 * 正/负各 topK 2、中性 topK 1；检索失败返回 null（调用方降级不注入并标记 X-Memory-Skip）。
 */
async function recallFactionMemories(
  factionId: string,
  factionName: string,
  ctx: ToolContext,
  setSkipHeader: () => void
): Promise<NpcMemories | null> {
  const query = `${factionName} 与玩家势力${ctx.character.factionName} 的关系与往来`
  try {
    const [pos, neg, neu] = await Promise.all([
      searchFactionMemories(ctx.saveId, factionId, query, { threshold: 0.45, topK: 2, sentiment: 'positive' }),
      searchFactionMemories(ctx.saveId, factionId, query, { threshold: 0.45, topK: 2, sentiment: 'negative' }),
      searchFactionMemories(ctx.saveId, factionId, query, { threshold: 0.45, topK: 1, sentiment: 'neutral' })
    ])
    const fmt = (m: MemorySearchResult) => `第${m.turn}回合：${m.content}`
    return {
      positive: pos.map(fmt),
      negative: neg.map(fmt),
      neutral: neu.map(fmt)
    }
  } catch (err) {
    console.warn(`[npc-actions] 势力 ${factionName} 记忆检索失败，降级跳过:`, err)
    setSkipHeader()
    return null
  }
}

/**
 * 运行单个 NPC 势力的 Agent 决策。
 * 失败（异常 / 无法解析 JSON / 格式非法）返回 { failed, factionId }，由主流程隔离处理。
 * 决策成功后 fire-and-forget 写入 faction_memories（source='npc_action'）。
 */
async function runNpcAgent(
  faction: Faction,
  ctx: ToolContext,
  model: LanguageModel,
  testMode: boolean,
  setSkipHeader: () => void
): Promise<NpcAgentResult> {
  // 长期记忆（提案 任务6 / D7/D8）：决策前检索本势力记忆注入 prompt
  const memories = await recallFactionMemories(faction.id, faction.name, ctx, setSkipHeader)

  const tools = createNpcTools(ctx)
  const system = buildNpcAgentPrompt(faction, ctx, memories ?? undefined)
  const prompt = '请决策本回合行动'
  const providerOptions = { openai: { structuredOutputs: true } }
  try {
    // E2E 测试模式：压缩 Agent 步数与超时，避免 6 个并行 Agent 拖垮整轮（~30s→~8s），
    // 生产环境恒关闭（见 e2e-test-mode.ts）。
    const result = streamText({
      model,
      system,
      tools,
      // 步数预算要包含「模型终于开口输出 JSON」那一步。只给 3 步时，连续查工具的 Agent
      // 会在 finishReason='tool-calls' 上耗尽预算、text 为空串（实测约 10% 触发率），
      // 表现为「NPC 决策生成失败」但没有任何异常。
      stopWhen: testMode ? stepCountIs(1) : stepCountIs(5),
      maxOutputTokens: 1000,
      prompt,
      providerOptions,
      abortSignal: AbortSignal.timeout(testMode ? 8_000 : 30_000),
      onFinish: ({ usage }) => logLlmUsage('npc-actions', usage, { factionId: faction.id })
    })

    let fullText = await result.text

    // 末步兜底：预算被工具调用吃光时模型根本没输出文本。此时复用已含工具结果的对话，
    // 但不再注册 tools —— 没有工具可调，模型只能直接给结论，比整轮重跑便宜且确定。
    // 实测该形态下硅基流动接受「assistant(tool_calls)+tool」消息但不带 tools 参数。
    if (!fullText.trim()) {
      const { messages: generated } = await result.response
      // response.messages 只含生成的 assistant/tool，不含 system 与原始 user，
      // 两者都要补回，否则请求里没有用户意图那一轮
      const forcedMessages: ModelMessage[] = [{ role: 'user', content: prompt }, ...generated]
      const forced = streamText({
        model,
        system,
        messages: forcedMessages,
        maxOutputTokens: 1000,
        providerOptions,
        // 兜底轮无工具可查、单步即出，只给一半超时预算
        abortSignal: AbortSignal.timeout(testMode ? 4_000 : 15_000),
        onFinish: ({ usage }) =>
          logLlmUsage('npc-actions-finalize', usage, { factionId: faction.id })
      })
      fullText = await forced.text
    }

    const parsed = extractNpcActionJson(fullText)
    if (!parsed) {
      console.warn(`[npc-actions] NPC ${faction.name} 未返回可解析 JSON`)
      return { failed: true, factionId: faction.id }
    }

    const action = normalizeNpcAction(parsed, faction)
    if (!action) {
      console.warn(`[npc-actions] NPC ${faction.name} 决策格式非法`)
      return { failed: true, factionId: faction.id }
    }

    // 决策成功 → fire-and-forget 写入关系记忆（source='npc_action'，sentiment 按行动类型推导；
    // 内部 try/catch 静默失败，不阻塞响应，D4/D5）
    void writeFactionMemory({
      saveId: ctx.saveId,
      factionId: faction.id,
      turn: ctx.turn,
      source: 'npc_action',
      sentiment: deriveSentiment(action.action),
      content: `${action.action}${action.target ? `（${action.target}）` : ''}：${action.description}`
    })

    return action
  } catch (err) {
    console.warn(`[npc-actions] NPC ${faction.name} Agent 失败:`, err)
    return { failed: true, factionId: faction.id }
  }
}

export default defineEventHandler(async (event) => {
  // 1. 参数校验
  let body: unknown
  try {
    body = await readBody(event)
  } catch {
    return createError({
      statusCode: 400,
      statusMessage: 'INVALID_PARAMS',
      data: { ok: false, error: { code: 'INVALID_PARAMS', message: '请求体解析失败' } }
    })
  }

  const parseResult = bodySchema.safeParse(body)
  if (!parseResult.success) {
    return createError({
      statusCode: 400,
      statusMessage: 'INVALID_PARAMS',
      data: {
        ok: false,
        error: {
          code: 'INVALID_PARAMS',
          message: '参数校验失败',
          detail: parseResult.error.issues
        }
      }
    })
  }

  const { saveId, turn, character, stateSnapshot, factions } = parseResult.data

  // 2. 过滤 active 势力（不压缩：工具基于 ToolContext.factions 全量查询）
  const activeFactions: Faction[] = factions.filter((f) => f.status === 'active')
  if (activeFactions.length === 0) {
    // 无活跃 NPC 势力，直接返回空数组（不调 LLM）
    return { ok: true, data: { actions: [] } }
  }

  // 3. 并发锁冲突检查
  if (isLocked(saveId)) {
    return createError({
      statusCode: 429,
      statusMessage: 'CONCURRENT_REQUEST',
      data: {
        ok: false,
        error: { code: 'CONCURRENT_REQUEST', message: '该存档有进行中的请求，请稍后' }
      }
    })
  }

  // 4. 获取锁，并行运行所有 NPC Agent
  const release = await acquireLock(saveId)
  try {
    const config = useRuntimeConfig(event)
    // E2E 测试模式：压缩 NPC Agent 步数/超时，加速整轮（生产环境恒关闭）
    const testMode = isE2eTestMode(getHeader(event, 'x-e2e-test-mode'))
    const caps = getModelCapabilities('Qwen/Qwen3-8B')
    const openai = createOpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
      fetch: createSiliconFlowFetch(caps.toggleableThinking ? false : undefined)
    })
    const model = openai.chat('Qwen/Qwen3-8B')

    // 工具上下文：单次请求内共享（设计文档 D6），含全部活跃势力全量信息
    const ctx: ToolContext = {
      saveId,
      turn,
      stateSnapshot,
      character: {
        background: character.background,
        backgroundPerks: {},
        factionId: '',
        factionName: character.factionName,
        factionSummary: ''
      },
      factions: activeFactions,
      recentEvents: []
    }

    // 记忆检索失败时统一设 X-Memory-Skip: true（D5，多 Agent 重复设置无害）
    const setMemorySkipHeader = () => {
      try {
        setHeader(event, 'X-Memory-Skip', 'true')
      } catch {
        // header 设置失败不影响主流程
      }
    }
    const results = await Promise.all(
      activeFactions.map((f) => runNpcAgent(f, ctx, model, testMode, setMemorySkipHeader))
    )

    const actions: NpcAction[] = []
    const failedFactionIds: string[] = []
    for (const r of results) {
      if ('failed' in r) {
        failedFactionIds.push(r.factionId)
      } else {
        actions.push(r)
      }
    }

    // 5. 组装响应 + 失败容错头
    const responseBody: {
      ok: true
      data: { actions: NpcAction[]; failedFactionIds?: string[] }
      fallback?: boolean
    } = { ok: true, data: { actions } }

    const allFailed = failedFactionIds.length === activeFactions.length
    if (allFailed) {
      // 全部失败：降级语义（既有 X-Fallback）
      responseBody.fallback = true
      responseBody.data.failedFactionIds = failedFactionIds
      setHeader(event, 'X-Fallback', 'true')
    } else if (failedFactionIds.length > 0) {
      // 部分失败：标记 X-Partial-Failure，成功部分仍返回
      responseBody.data.failedFactionIds = failedFactionIds
      setHeader(event, 'X-Partial-Failure', 'true')
    }

    return responseBody
  } finally {
    release()
  }
})
