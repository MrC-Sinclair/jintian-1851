/**
 * @file POST /api/game/advisor-chat — 军师对话（SSE 流式）
 *
 * 自定义 SSE 协议：
 *   - 每个 text-delta 写为 `data: {"delta":"..."}\n\n`
 *   - 工具调用写 `data: {"type":"tool-call","toolName":"...","args":{...}}\n\n`
 *   - 工具结果写 `data: {"type":"tool-result","toolName":"...","result":{...}}\n\n`
 *   - 完成后写 `data: [DONE]\n\n`
 *   - 错误写 `data: {"error":"AI_CALL_FAILED"}\n\n` 后 end
 *
 * thinking 控制：Qwen/Qwen3-8B + enable_thinking: false（军师对话不展示 reasoning）
 * reasoning-delta 事件应被丢弃（方案 A：enable_thinking:false 时不产生 reasoning）
 *
 * 响应头在锁检查前设置，并发锁冲突返回 429（不写流式响应体）。
 */

import { createOpenAI } from '@ai-sdk/openai'
import { streamText, stepCountIs, type CoreMessage } from 'ai'
import { z } from 'zod'
import { getModelCapabilities } from '../../config/models'
import { createSiliconFlowFetch } from '../../utils/siliconflow-fetch'
import { buildAdvisorSystemPrompt } from '../../utils/prompts/advisor-chat'
import { createTools, type ToolContext } from '../../utils/tool-context'
import { acquireLock, isLocked } from '../../utils/concurrency-lock'

const MAX_MESSAGES = 20

const bodySchema = z.object({
  saveId: z.string().uuid(),
  turn: z.number().int().positive(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1),
        turn: z.number().int().positive(),
        timestamp: z.number()
      })
    )
    .min(1),
  character: z.object({
    background: z.enum(['文官', '武将', '商贾', '士绅', '宗室']),
    backgroundPerks: z.record(z.string(), z.number()),
    factionId: z.string().min(1),
    factionName: z.string().min(1),
    factionSummary: z.string()
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
    .default([]),
  recentEvents: z.array(z.any()).default([])
})

export default defineEventHandler(async (event) => {
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

  const { saveId, turn, messages, character, stateSnapshot, factions, recentEvents } = parseResult.data

  if (messages[messages.length - 1].role !== 'user') {
    return createError({
      statusCode: 400,
      statusMessage: 'INVALID_PARAMS',
      data: {
        ok: false,
        error: { code: 'INVALID_PARAMS', message: '最后一条消息 role 必须为 user' }
      }
    })
  }

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

  let truncatedMessages = messages
  let wasTruncated = false
  if (messages.length > MAX_MESSAGES) {
    truncatedMessages = messages.slice(-MAX_MESSAGES)
    wasTruncated = true
  }

  setResponseHeader(event, 'Content-Type', 'text/event-stream')
  setResponseHeader(event, 'Cache-Control', 'no-cache, no-transform')
  setResponseHeader(event, 'Connection', 'keep-alive')
  setResponseHeader(event, 'X-Accel-Buffering', 'no')
  if (wasTruncated) {
    setResponseHeader(event, 'X-Truncated-Messages', 'true')
  }

  const release = await acquireLock(saveId)

  try {
    const config = useRuntimeConfig(event)
    const caps = getModelCapabilities('Qwen/Qwen3-8B')
    const openai = createOpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
      fetch: createSiliconFlowFetch(caps.toggleableThinking ? false : undefined)
    })
    const model = openai.chat('Qwen/Qwen3-8B')

    const systemPrompt = buildAdvisorSystemPrompt({
      character,
      stateSnapshot,
      turn
    })

    // 构造工具上下文（单次请求内共享，不查库/不调 LLM），注册 6 个工具
    const ctx: ToolContext = {
      saveId,
      turn,
      stateSnapshot,
      character,
      factions,
      recentEvents
    }
    const tools = createTools(ctx)

    const coreMessages: CoreMessage[] = truncatedMessages.map((m) => ({
      role: m.role,
      content: m.content
    }))

    const result = streamText({
      model,
      system: systemPrompt,
      messages: coreMessages,
      tools,
      stopWhen: stepCountIs(5),
      providerOptions: { openai: { structuredOutputs: false } },
      abortSignal: AbortSignal.timeout(60_000)
    })

    let fullText = ''
    for await (const chunk of result.fullStream) {
      if (chunk.type === 'text-delta') {
        fullText += chunk.text
        await event.node.res.write(`data: ${JSON.stringify({ delta: chunk.text })}\n\n`)
      } else if (chunk.type === 'tool-call') {
        // 前端用于展示"军师正在查询 XXX…"气泡（设计文档 D7）
        await event.node.res.write(
          `data: ${JSON.stringify({ type: 'tool-call', toolName: chunk.toolName, args: chunk.input })}\n\n`
        )
      } else if (chunk.type === 'tool-result') {
        // 动态工具变体可能无 result 字段，收窄后安全读取
        const toolResult = chunk as { toolName: string; result?: unknown }
        await event.node.res.write(
          `data: ${JSON.stringify({ type: 'tool-result', toolName: toolResult.toolName, result: toolResult.result })}\n\n`
        )
      }
    }

    if (fullText.length > 300) {
      console.warn(`[advisor-chat] 军师回复超长 ${fullText.length} 字（saveId=${saveId}）`)
    }

    await event.node.res.write('data: [DONE]\n\n')
    event.node.res.end()
  } catch (err) {
    console.error('[advisor-chat] LLM 调用失败:', err)
    try {
      await event.node.res.write('data: {"error":"AI_CALL_FAILED"}\n\n')
    } catch {
      // res 已结束则忽略
    }
    event.node.res.end()
  } finally {
    release()
  }
})

