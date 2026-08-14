/**
 * @file POST /api/game/init-factions — 开局 AI 生成势力列表
 *
 * 评审补充 2026-07-20：开局换 Qwen/Qwen3-8B（原 R1 强制思考延迟 10-30 秒，玩家流失率高）
 * 改用 Qwen3-8B + enable_thinking: true（延迟 3-8 秒），通过 siliconflow-fetch.ts 注入。
 *
 * 失败降级：fallback-factions.ts 返回 6 个预置势力，header X-Fallback: true。
 */

import { createOpenAI } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import { createSiliconFlowFetch } from '../../utils/siliconflow-fetch'
import { buildInitFactionsPrompt } from '../../utils/prompts/init-factions'
import { getFallbackFactions } from '../../runtime/fallback-factions'

const bodySchema = z.object({
  background: z.enum(['文官', '武将', '商贾', '士绅', '宗室'])
})

// LLM 返回结构 zod schema
const factionsSchema = z.object({
  factions: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        summary: z.string(),
        initialPower: z.number(),
        initialRelationship: z.number()
      })
    )
    .min(6)
    .max(8)
})

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
          message: 'background 必须为 文官/武将/商贾/士绅/宗室 之一',
          detail: parseResult.error.issues
        }
      }
    })
  }

  const { background } = parseResult.data
  const config = useRuntimeConfig(event)

  // 2. 调用 LLM（Qwen/Qwen3-8B，关闭 thinking 避免 generateObject 超时）
  const openai = createOpenAI({
    apiKey: config.openaiApiKey,
    baseURL: config.openaiBaseUrl,
    fetch: createSiliconFlowFetch(false)
  })
  const model = openai.chat('Qwen/Qwen3-8B')

  try {
    const { object } = await generateObject({
      model,
      schema: factionsSchema,
      prompt: buildInitFactionsPrompt(background),
      providerOptions: {
        openai: { structuredOutputs: true }
      },
      // 30 秒超时（评审补充：玩家首次进入等待 < 30s）
      abortSignal: AbortSignal.timeout(30_000)
    })

    return {
      ok: true,
      data: { factions: object.factions }
    }
  } catch (err) {
    console.error('[init-factions] LLM 调用失败，降级返回预置势力:', err)

    // 3. 降级：返回预置势力，X-Fallback: true
    setHeader(event, 'X-Fallback', 'true')
    const fallback = getFallbackFactions(background)
    return {
      ok: true,
      data: { factions: fallback },
      fallback: true
    }
  }
})
