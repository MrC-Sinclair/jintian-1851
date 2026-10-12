/**
 * @file POST /api/game/advisor-briefing — 局势简报（T1.14）
 *
 * 每回合开始时调用，让 LLM 给出当前局势总结 + 本回合建议，供 FocusPanel 展示。
 *
 * 设计要点（详见 openspec/changes/improve-ux-playability/tasks.md T1.14）：
 *   - 模型：Qwen/Qwen3-8B + generateObject + createSiliconFlowFetch(false)（关闭思考）
 *   - 超时：20s（AbortSignal.timeout，实测线上 10s 会 100% 命中超时）
 *   - 调用方（useTurn.startTurn）**不 await** 本接口，慢返回不会拖住回合开始
 *   - 失败降级：返回空简报 + X-Fallback: true header，不 throw（不阻断主流程）
 *   - 并发锁：不占用 concurrency-lock（无副作用，可与其他 AI 端点并发）
 *   - rate-limit：复用 server/middleware/rate-limit.ts（/api/game/ 路径自动生效）
 *   - 开关：runtimeConfig.enableBriefing 为 false 时直接返回空简报
 *
 * 响应：
 *   - 正常：{ ok: true, data: { summary, suggestion } }
 *   - 降级：{ ok: true, data: { summary: '', suggestion: '' }, fallback: true } + X-Fallback: true
 *   - 开关关闭：{ ok: true, data: { summary: '', suggestion: '' }, disabled: true }
 *   - 参数错误：400 + INVALID_PARAMS
 */

import { createOpenAI } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import { createSiliconFlowFetch } from '../../utils/siliconflow-fetch'
import { logLlmUsage } from '../../utils/llm-usage'

/** 局势简报请求体校验 */
const bodySchema = z.object({
  saveId: z.string().uuid(),
  turn: z.number().int().min(1),
  stateSnapshot: z.object({
    turn: z.number().int().min(1),
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
  })
})

/** LLM 返回结构（BriefingResult） */
const briefingSchema = z.object({
  summary: z.string().max(60),
  suggestion: z.string().max(60)
})

/**
 * 简报超时。原值 10s 画在了实测延迟分布的中位数上（线上连续 8 次调用 8/8 卡在 10.09s
 * 超时、静默返回空简报），等于功能长期不可用。放宽到 20s 覆盖 P99。
 * 代价由前端消化：advisor-briefing 已改为非阻塞，慢返回不再拖住回合开始。
 */
const BRIEFING_TIMEOUT_MS = 20_000

/** 降级返回的空简报 */
const FALLBACK_BRIEFING = { summary: '', suggestion: '' }

/**
 * 构造局势简报 prompt
 * 不传 character/factions（T1.14 规范只要求 stateSnapshot），保持轻量
 */
function buildBriefingPrompt(
  turn: number,
  stateSnapshot: z.infer<typeof bodySchema>['stateSnapshot']
): string {
  const { date, attributes, resources } = stateSnapshot
  return [
    '你是金田：1851 的军师，为玩家提供本回合局势简报。',
    '',
    `当前局势：`,
    `- 回合：第 ${turn} 回合（1 回合 = 1 年）`,
    // 年钟：只报年份。报月份会让模型按「一个月内发生的事」给建议，
    // 而 month 在年钟下恒为 1，写出来本身就是误导（时钟改造当时漏了这个 prompt）
    `- 日期：${date.year} 年`,
    `- 五维属性：军事 ${attributes.military} / 经济 ${attributes.economy} / 政治 ${attributes.politics} / 民心 ${attributes.people} / 外交 ${attributes.diplomacy}`,
    `- 资源：银两 ${resources.silver} / 兵员 ${resources.troops} / 粮草 ${resources.food} / 名望 ${resources.reputation}`,
    '',
    '请给出：',
    '1. summary：当前局势一句话总结（不超过 60 字，白话为主）',
    '2. suggestion：本回合建议（不超过 60 字，关注属性 < 30 的危机时优先提示）',
    '',
    '要求：',
    '- 白话为主，新手能懂',
    '- 综合实力 = 5 维**加权**平均（政治 / 民心权重更高），达到 85 即锁定「中兴」',
    '- 但结局要到 1912 年之后才结算，锁定之后仍需守住局面不被击穿',
    '- 任一属性 ≤ 0 立即触发对应维度崩溃（优先级高于胜利）',
    '- summary/suggestion 均不超过 60 字'
  ].join('\n')
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

  const { turn, stateSnapshot } = parseResult.data

  // 2. 开关检查：enableBriefing 为 false 时直接返回空简报
  const config = useRuntimeConfig(event)
  if (config.enableBriefing === false) {
    return { ok: true, data: FALLBACK_BRIEFING, disabled: true }
  }

  // 3. 调用 LLM（不占用 concurrency-lock，无副作用可并发）
  try {
    const openai = createOpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
      fetch: createSiliconFlowFetch(false) // enable_thinking: false
    })
    const model = openai.chat('Qwen/Qwen3-8B')

    const { object, usage } = await generateObject({
      model,
      schema: briefingSchema,
      prompt: buildBriefingPrompt(turn, stateSnapshot),
      maxOutputTokens: 800,
      providerOptions: { openai: { structuredOutputs: true } },
      abortSignal: AbortSignal.timeout(BRIEFING_TIMEOUT_MS)
    })
    logLlmUsage('advisor-briefing', usage)

    return { ok: true, data: object }
  } catch (err) {
    // 4. 失败降级：返回空简报 + X-Fallback header，不 throw（不阻断主流程）
    console.error('[advisor-briefing] LLM 调用失败，降级返回空简报:', err)
    setHeader(event, 'X-Fallback', 'true')
    return { ok: true, data: FALLBACK_BRIEFING, fallback: true }
  }
})
