/**
 * @file POST /api/game/resolve-decision — AI 解析玩家决策为结构化 effects
 *
 * 失败重试 1 次后降级返回默认 effects（military/economy/politics/people/diplomacy 各 -3）。
 * 并发锁冲突返回 429 + CONCURRENT_REQUEST。
 */

import { createOpenAI } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import { createSiliconFlowFetch } from '../../utils/siliconflow-fetch'
import { buildResolveDecisionPrompt } from '../../utils/prompts/resolve-decision'
import { acquireLock, isLocked } from '../../utils/concurrency-lock'

const bodySchema = z.object({
  saveId: z.string().uuid(),
  turn: z.number().int().positive(),
  playerDecision: z.string().min(1).max(200),
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
  event: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    eventType: z.enum(['民生', '军事', '外交', '随机', '历史剧情']),
    options: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          effects: z.record(z.string(), z.number())
        })
      )
      .min(2)
      .max(4)
  })
})

// LLM 返回结构
const effectsSchema = z.object({
  effects: z.record(z.string(), z.number())
})

/** 降级默认 effects（全属性 -3，模拟决策失误的惩罚） */
const FALLBACK_EFFECTS = {
  military: -3,
  economy: -3,
  politics: -3,
  people: -3,
  diplomacy: -3
}

/**
 * E2E 测试模式用的「强力负值」兜底：每回合把 5 维属性至少压低 30，
 * 配合前端自由行动循环可在 2~3 回合内稳定触发属性崩溃结局（≤0），
 * 避免真实 LLM 返回幅度不确定导致 E2E 跑不满 36 回合而超时。
 * 仅当请求头 x-e2e-test-mode=1 时启用，不影响正式游戏。
 */
const E2E_STRONG_FALLBACK = {
  military: -30,
  economy: -30,
  politics: -30,
  people: -30,
  diplomacy: -30
}

/** E2E 模式下放大自由行动 effects：每个属性取「原值」与「-30」的更小值，确保强力下压 */
function amplifyForE2E(effects: Record<string, number>): Record<string, number> {
  const keys = ['military', 'economy', 'politics', 'people', 'diplomacy']
  const out: Record<string, number> = { ...effects }
  for (const k of keys) {
    const cur = typeof out[k] === 'number' ? out[k] : 0
    out[k] = Math.min(cur, -30)
  }
  return out
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

  const { saveId, turn, playerDecision, stateSnapshot, event: gameEvent } = parseResult.data

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

  // 3. 获取锁调用 LLM
  const release = await acquireLock(saveId)
  try {
    // E2E 测试模式：请求头 x-e2e-test-mode=1 时放大自由行动效果，稳定触发崩溃结局
    const isE2E = getHeader(event, 'x-e2e-test-mode') === '1'
    const config = useRuntimeConfig(event)
    const openai = createOpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
      fetch: createSiliconFlowFetch(false)
    })
    const model = openai.chat('Qwen/Qwen3-8B')

    const prompt = buildResolveDecisionPrompt({
      event: gameEvent,
      playerDecision,
      stateSnapshot,
      turn
    })

    // 重试 1 次
    let lastErr: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { object } = await generateObject({
          model,
          schema: effectsSchema,
          prompt,
          providerOptions: { openai: { structuredOutputs: true } },
          abortSignal: AbortSignal.timeout(30_000)
        })
        // 诊断日志：记录 LLM 实际返回的 effects，便于排查字段名映射问题
        console.log('[resolve-decision] LLM 返回 effects:', JSON.stringify(object.effects))
        // E2E 模式：放大为负值，确保 2~3 回合内触发属性崩溃结局
        return { ok: true, data: { effects: isE2E ? amplifyForE2E(object.effects) : object.effects } }
      } catch (err) {
        lastErr = err
        console.warn(`[resolve-decision] 第 ${attempt + 1} 次调用失败:`, err)
      }
    }

    // 4. 降级：返回默认 effects
    console.error('[resolve-decision] 2 次重试均失败，降级返回默认 effects:', lastErr)
    setHeader(event, 'X-Fallback', 'true')
    // E2E 模式：使用强力负值兜底，稳定触发崩溃结局
    return { ok: true, data: { effects: isE2E ? E2E_STRONG_FALLBACK : FALLBACK_EFFECTS }, fallback: true }
  } finally {
    release()
  }
})
