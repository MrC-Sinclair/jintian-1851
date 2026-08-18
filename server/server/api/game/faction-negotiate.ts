/**
 * @file POST /api/game/faction-negotiate — 玩家与单个 NPC 势力的自然语言谈判（design.md D1-D6）
 *
 * 两阶段状态机（单次谈判最多 2 次 AI 调用）：
 *   - phase='letter'：玩家写信（1-200 字）→ Agent 回信并表态（accept/reject/counter，counter 附表内条件）
 *   - phase='settle'：仅 letter 返回 counter 后可达，玩家「接受条件」或「还价」→ Agent 最终裁定（不再提新条件）
 *
 * 防幻觉边界：LLM 只产出意图（dealId + 区间内 price）与文案；最终数值由前端按镜像兑换表确定性执行。
 * 基建全复用：saveId 并发锁（429 CONCURRENT_REQUEST）、x-device-id 10 次/分钟限流（middleware 自动覆盖）、
 * 失败降级（{ ok, fallback:true } + X-Fallback，不重试）、x-e2e-test-mode（步数压 1 + 8s 超时）。
 */

import { createOpenAI } from '@ai-sdk/openai'
import { streamText, stepCountIs } from 'ai'
import { z } from 'zod'
import { getModelCapabilities } from '../../config/models'
import { createSiliconFlowFetch } from '../../utils/siliconflow-fetch'
import { buildNegotiationPrompt } from '../../utils/prompts/negotiation-agent'
import { createNpcTools, type ToolContext } from '../../utils/tool-context'
import { acquireLock, isLocked } from '../../utils/concurrency-lock'
import {
  sanitizeDeal,
  getDealById,
  NEGOTIATION_LETTER_DELTA_LIMIT,
  type NegotiationDealId
} from '../../utils/negotiation-deals'

// ====================== 请求 schema ======================

const baseFields = {
  saveId: z.string().uuid(),
  turn: z.number().int().positive(),
  factionId: z.string().min(1),
  letter: z.string().min(1).max(200),
  character: z.object({
    background: z.enum(['文官', '武将', '商贾', '士绅', '宗室']),
    factionName: z.string().min(1)
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
  faction: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    summary: z.string(),
    power: z.number(),
    relationship: z.number(),
    status: z.enum(['active', 'destroyed', 'allied'])
  })
}

const letterBodySchema = z.object({ ...baseFields, phase: z.literal('letter') })

const settleBodySchema = z
  .object({
    ...baseFields,
    phase: z.literal('settle'),
    previousReply: z.string().min(1).max(200),
    deal: z.object({ dealId: z.string(), price: z.number() }),
    playerResponse: z.enum(['accept', 'counter']),
    counterPrice: z.number().optional()
  })
  .superRefine((val, ctx) => {
    if (val.playerResponse === 'counter' && typeof val.counterPrice !== 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "playerResponse='counter' 时 counterPrice 必填",
        path: ['counterPrice']
      })
    }
  })

// 注意：settle 带 superRefine（counterPrice 联动校验），产物为 ZodEffects，
// 不能进 discriminatedUnion（其要求选项为纯 ZodObject），故用 z.union。
const bodySchema = z.union([letterBodySchema, settleBodySchema])

// ====================== 出参结构 ======================

interface NegotiationAgentOutput {
  stance: 'accept' | 'reject' | 'counter'
  reply: string
  relationshipDelta: number
  deal?: { dealId: NegotiationDealId; price: number }
}

/** 降级结构（AI 异常 / JSON 不可解析，不重试） */
const FALLBACK_DATA: NegotiationAgentOutput = {
  stance: 'reject',
  reply: '',
  relationshipDelta: 0
}

// ====================== JSON 鲁棒提取与 sanitize ======================

/**
 * 从 Agent 文本输出中提取 JSON 对象（容忍 markdown 代码块 / 前后杂文）
 * 与 npc-actions 的 extractNpcActionJson 同款逻辑。
 */
function extractNegotiationJson(text: string): Record<string, unknown> | null {
  if (!text || !text.trim()) return null
  try {
    return JSON.parse(text.trim()) as Record<string, unknown>
  } catch {
    // 继续尝试截取
  }
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1 || last === -1 || last < first) return null
  try {
    return JSON.parse(text.slice(first, last + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * sanitize 链（防幻觉，design.md D2）：
 * - stance 白名单，非法降 reject；settle 阶段不允许 counter（降 reject）
 * - letter 阶段 deal 经 sanitizeDeal（dealId ∈ 表 / 门槛满足 / price clamp 区间），非法 → 丢 deal + stance 降 reject
 * - 非 counter 态下的 deal 一律丢弃
 * - relationshipDelta clamp ±10；reply 截断 200 字
 */
function sanitizeNegotiation(
  parsed: Record<string, unknown>,
  phase: 'letter' | 'settle',
  relationship: number
): NegotiationAgentOutput {
  const STANCES = ['accept', 'reject', 'counter'] as const
  let stance = typeof parsed.stance === 'string' ? parsed.stance : ''
  if (!STANCES.includes(stance as (typeof STANCES)[number])) stance = 'reject'
  if (phase === 'settle' && stance === 'counter') stance = 'reject' // settle 不再提新条件

  const rawDelta = parsed.relationshipDelta
  const relationshipDelta =
    typeof rawDelta === 'number' && Number.isFinite(rawDelta)
      ? Math.round(
          Math.min(Math.max(rawDelta, -NEGOTIATION_LETTER_DELTA_LIMIT), NEGOTIATION_LETTER_DELTA_LIMIT)
        )
      : 0

  const rawReply = typeof parsed.reply === 'string' ? parsed.reply.trim() : ''
  const reply = rawReply ? rawReply.slice(0, 200) : '（无回信）'

  let deal: NegotiationAgentOutput['deal']
  if (phase === 'letter' && stance === 'counter' && parsed.deal && typeof parsed.deal === 'object') {
    const sanitized = sanitizeDeal(parsed.deal as { dealId: unknown; price: unknown }, relationship)
    if (sanitized) {
      deal = sanitized
    } else {
      // 非法 dealId / 门槛不满足 → 丢 deal 且 stance 强制降 reject（spec：玩家侧不展示条件卡片）
      stance = 'reject'
    }
  }

  return { stance: stance as NegotiationAgentOutput['stance'], reply, relationshipDelta, deal }
}

// ====================== 端点 ======================

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
        error: { code: 'INVALID_PARAMS', message: '参数校验失败', detail: parseResult.error.issues }
      }
    })
  }

  const parsed = parseResult.data
  const { saveId, turn, factionId, letter, character, stateSnapshot, faction } = parsed
  const phase = parsed.phase

  // factionId 与 faction.id 一致性校验（防错位请求）
  if (factionId !== faction.id) {
    return createError({
      statusCode: 400,
      statusMessage: 'INVALID_PARAMS',
      data: {
        ok: false,
        error: { code: 'INVALID_PARAMS', message: 'factionId 与 faction.id 不一致' }
      }
    })
  }

  const relationship = faction.relationship

  // settle 阶段：sanitize 玩家带回的 deal（前端原样带回 Agent 上轮条件，此处防篡改）
  let settleDeal: { dealId: NegotiationDealId; price: number } | undefined
  let settlePreviousReply: string | undefined
  let settlePlayerResponse: 'accept' | 'counter' | undefined
  let settleCounterPrice: number | undefined
  if (parsed.phase === 'settle') {
    const sanitized = sanitizeDeal(parsed.deal, relationship)
    if (!sanitized) {
      return createError({
        statusCode: 400,
        statusMessage: 'INVALID_PARAMS',
        data: {
          ok: false,
          error: { code: 'INVALID_PARAMS', message: 'deal 非法（dealId 不在表内或门槛不满足）' }
        }
      })
    }
    settleDeal = sanitized
    settlePreviousReply = parsed.previousReply
    settlePlayerResponse = parsed.playerResponse
    // 还价 clamp 回合法区间 [floor(silverMin×0.5), 原价]（design.md D2），防止恶意出价污染 prompt
    if (parsed.playerResponse === 'counter') {
      const dealDef = getDealById(sanitized.dealId)!
      const lowerBound = Math.floor(dealDef.cost.silver[0] * 0.5)
      settleCounterPrice = Math.round(
        Math.min(Math.max(parsed.counterPrice!, lowerBound), sanitized.price)
      )
    }
  }

  // 2. 并发锁冲突检查
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

  // 3. 获取锁调用 Agent
  const release = await acquireLock(saveId)
  try {
    const testMode = getHeader(event, 'x-e2e-test-mode') === '1'
    const config = useRuntimeConfig(event)
    const caps = getModelCapabilities('Qwen/Qwen3-8B')
    const openai = createOpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
      fetch: createSiliconFlowFetch(caps.toggleableThinking ? false : undefined)
    })
    const model = openai.chat('Qwen/Qwen3-8B')

    // 工具上下文：单势力谈判，factions 仅含目标势力（工具查询范围即该势力）
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
      factions: [faction],
      recentEvents: []
    }

    const system = buildNegotiationPrompt(faction, character, relationship, phase, letter, {
      previousReply: settlePreviousReply,
      deal:
        settleDeal && phase === 'settle'
          ? { deal: getDealById(settleDeal.dealId)!, price: settleDeal.price }
          : undefined,
      playerResponse: settlePlayerResponse,
      counterPrice: settleCounterPrice
    })

    try {
      const result = streamText({
        model,
        system,
        tools: createNpcTools(ctx),
        stopWhen: testMode ? stepCountIs(1) : stepCountIs(3),
        prompt: phase === 'letter' ? '请以该势力决策者的身份回信并表态' : '请做出最终裁定',
        providerOptions: { openai: { structuredOutputs: true } },
        abortSignal: AbortSignal.timeout(testMode ? 8_000 : 30_000)
      })

      const fullText = await result.text
      const extracted = extractNegotiationJson(fullText)
      if (!extracted) {
        console.warn('[faction-negotiate] Agent 未返回可解析 JSON，降级')
        setHeader(event, 'X-Fallback', 'true')
        return { ok: true, data: { ...FALLBACK_DATA }, fallback: true }
      }

      const data = sanitizeNegotiation(extracted, phase, relationship)
      // 诊断日志：记录原始输出与 sanitize 结果，便于排查
      console.log(
        '[faction-negotiate] phase=%s stance=%s delta=%d deal=%s',
        phase,
        data.stance,
        data.relationshipDelta,
        data.deal ? `${data.deal.dealId}@${data.deal.price}` : 'none'
      )
      return { ok: true, data }
    } catch (err) {
      // 4. 降级：AI 异常不重试（spec），返回 fallback 结构（前端不置位谈判配额，允许重试）
      console.warn('[faction-negotiate] Agent 调用失败，降级:', err)
      setHeader(event, 'X-Fallback', 'true')
      return { ok: true, data: { ...FALLBACK_DATA }, fallback: true }
    }
  } finally {
    release()
  }
})
