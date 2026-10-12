/**
 * @file POST /api/game/generate-event — AI 生成回合事件
 *
 * 缓存键 sha256(saveId + turn + sha256(stateSnapshot) + sha256(chainState))，5 分钟 TTL。
 * 命中直接返回（header X-Cache: HIT），否则获取 saveId 锁。
 *
 * 三层触发优先级（D1）：
 *   1. 挂起节点（pendingChainNodes 非空）→ 不调 LLM，返回该节点 event（X-Event-Source: pending-chain）
 *   2. 下一条剧情链（startYear 不早于当前年份的最早一条）→ 不调 LLM，返回首节点（X-Event-Source: time-window）
 *      锚点年份晚于当前年份时下发 eventDate 做时光跳跃，否则「1 回合=1 月 + 单局约 35 回合」
 *      下日历只走到 1853~1855 年，绝大多数链（当年锚点之外）永不触发
 *   3. LLM 自主生成 → 调 Qwen/Qwen3-8B + generateObject()（X-Event-Source: llm）
 *
 * 失败重试 1 次后降级 fallback-events.ts（池已扩充到 90 条）。
 * 并发锁冲突返回 429 + CONCURRENT_REQUEST。
 */

import { createOpenAI } from '@ai-sdk/openai'
import { generateObject, streamText } from 'ai'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createSiliconFlowFetch } from '../../utils/siliconflow-fetch'
import { buildGenerateEventPrompt } from '../../utils/prompts/generate-event'
import { getCached, setCached } from '../../utils/ai-cache'
import { acquireLock, isLocked } from '../../utils/concurrency-lock'
import { logLlmUsage } from '../../utils/llm-usage'
import { getRandomFallbackEvent } from '../../runtime/fallback-events'
import { STORY_CHAINS } from '../../runtime/story-chains'
import { createTools, type ToolContext } from '../../utils/tool-context'
import { searchEventMemories, writeEventMemory } from '../../utils/memory'
import { extractEventJson, extractPartialField } from '../../utils/event-json'
import type { ChainNode, GameEvent, PendingChainNode, StoryChain } from '../../../types/game'

// 5 分钟 TTL 缓存
const CACHE_TTL_MS = 5 * 60 * 1000

const bodySchema = z.object({
  saveId: z.string().uuid(),
  turn: z.number().int().positive(),
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
  character: z.object({
    background: z.enum(['文官', '武将', '商贾', '士绅', '宗室']),
    factionName: z.string(),
    factionSummary: z.string()
  }),
  factions: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      summary: z.string(),
      power: z.number(),
      relationship: z.number(),
      status: z.enum(['active', 'destroyed', 'allied'])
    })
  ),
  recentEvents: z.array(z.any()).default([]),
  // 事件权重动态调整：前端计算的属性短板信号（值 < 30 的维度），仅作 LLM 输入提示，不参与业务计算
  attributeShortfall: z
    .array(
      z.object({
        dimension: z.enum(['military', 'economy', 'politics', 'people', 'diplomacy']),
        value: z.number()
      })
    )
    .optional(),
  // ===== 新增字段（v2 存档必传，老客户端兼容 .default([])）=====
  pendingChainNodes: z
    .array(
      z.object({
        chainId: z.string().min(1),
        nodeId: z.string().min(1),
        scheduledTurn: z.number().int().positive()
      })
    )
    .default([]),
  completedChainIds: z.array(z.string()).default([]),
  activeChainIds: z.array(z.string()).default([])
})

// LLM 返回结构（GameEvent）；剧情链字段为可选（仅剧情链路径返回，LLM 自主生成不返回）
const eventSchema = z.object({
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
    .max(4),
  chainId: z.string().optional(),
  chainNodeId: z.string().optional(),
  chainProgress: z.object({ current: z.number(), total: z.number() }).optional(),
  // 时光跳跃目标年月：剧情链锚点晚于当前日历时由服务端下发，前端据此推进日历
  eventDate: z.object({ year: z.number().int(), month: z.number().int().min(1).max(12) }).optional()
})

/** 三层触发解析结果 */
interface ResolvedChain {
  event: z.infer<typeof eventSchema>
  source: 'pending-chain' | 'time-window'
}

// ====================== 流式（SSE）支持 ======================
//
// 背景：网关存在「快实例 / 慢实例」，慢实例上生成 300+ tokens 的事件要 40-60s，
// 玩家只能干等。实测流式 TTFB 稳定在 0.5-1.1s，因此提供流式模式：
//   - 生成过程中持续推送 delta（尽力提取出的可读标题/描述片段），前端可渐进显示
//   - 生成完成后推送 { event } 完整事件对象，再推 [DONE] 结束
// 协议与 advisor-chat 一致（data: JSON 帧 \n\n），前端 useSSE 消费。
//
// 开关：?stream=1 或 Accept: text/event-stream；不开启时行为与改造前完全一致。

/** 流式响应句柄（Nitro 的 node.res，此处只用到 write/end） */
interface SseStream {
  write: (chunk: string) => void
  end: () => void
}

/** 写一帧 SSE 数据 */
function writeSseFrame(res: SseStream, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

/** 取 Nitro 事件的底层响应流 */
function getSseStream(event: unknown): SseStream {
  return (event as { node: { res: SseStream } }).node.res
}

/** 流式模式：推送完整事件并结束流 */
function endSseWithEvent(event: unknown, ev: z.infer<typeof eventSchema>): void {
  const res = getSseStream(event)
  writeSseFrame(res, { event: ev })
  res.write('data: [DONE]\n\n')
  res.end()
}

// 说明：extractPartialField / extractEventJson 已抽到 utils/event-json.ts（便于单测），在此引入使用

/**
 * 在 STORY_CHAINS 中查找指定 chainId/nodeId 的节点
 */
function findChainNode(chainId: string, nodeId: string): { chain: StoryChain; node: ChainNode } | null {
  const chain = STORY_CHAINS.find((c) => c.chainId === chainId)
  if (!chain) return null
  const node = chain.nodes.find((n) => n.nodeId === nodeId)
  if (!node) return null
  return { chain, node }
}

/**
 * 构造剧情链事件（注入 chainId/chainNodeId/chainProgress）
 */
function buildChainEvent(
  chain: StoryChain,
  node: ChainNode,
  source: 'pending-chain' | 'time-window',
  currentYear: number
): ResolvedChain {
  const current = chain.nodes.findIndex((n) => n.nodeId === node.nodeId) + 1
  const event: GameEvent = {
    ...node.event,
    chainId: chain.chainId,
    chainNodeId: node.nodeId,
    chainProgress: { current, total: chain.nodes.length }
  }

  // 时光跳跃：链的锚点年份晚于当前日历时，把日历推到锚点并补一段过场文案。
  // 只在 time-window（链首节点按年表触发）这条路径判定；链内后续节点走 pending-chain 接续，
  // 日历应停在链开始的年代，否则一条 5 节点的链会把时间往前推 5 次。
  const jumpYears = source === 'time-window' ? chain.startYear - currentYear : 0
  if (jumpYears > 0) {
    event.eventDate = { year: chain.startYear, month: 1 }
    event.description = `【${currentYear}—${chain.startYear} 年间】${chain.description} ${node.event.description}`
  }
  return { event, source }
}

/**
 * 下一条可触发的剧情链：startYear **不早于**当前年份的最早一条
 *
 * 原实现要求 `startYear === 当前年`，日历一旦跨过那一年，该链就永久错过。
 * 时光跳跃机制依赖「允许未来锚点」才能成立：跳跃的目标就是下一条链的 startYear。
 * 同年份多链按 startYear 升序 + chainId 字典序取第一条。
 */
function matchNextChain(
  year: number,
  completedChainIds: string[],
  activeChainIds: string[]
): { chain: StoryChain; node: ChainNode } | null {
  const candidates = STORY_CHAINS.filter(
    (c) =>
      c.startYear >= year &&
      !completedChainIds.includes(c.chainId) &&
      !activeChainIds.includes(c.chainId) &&
      (c.prerequisiteChainIds ?? []).every((pre) => completedChainIds.includes(pre))
  )
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.startYear - b.startYear || (a.chainId < b.chainId ? -1 : 1))
  const chain = candidates[0]
  return { chain, node: chain.nodes[0] }
}

/**
 * 计算缓存键：扩展含 pendingChainNodes/completedChainIds/activeChainIds（D6）
 */
function computeCacheKey(
  saveId: string,
  turn: number,
  stateSnapshot: unknown,
  pendingChainNodes: PendingChainNode[],
  completedChainIds: string[],
  activeChainIds: string[]
): string {
  const stateHash = createHash('sha256').update(JSON.stringify(stateSnapshot)).digest('hex')
  const chainHash = createHash('sha256')
    .update(JSON.stringify({ pendingChainNodes, completedChainIds, activeChainIds }))
    .digest('hex')
  return createHash('sha256').update(`${saveId}:${turn}:${stateHash}:${chainHash}`).digest('hex')
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

  const {
    saveId,
    turn,
    stateSnapshot,
    character,
    factions,
    recentEvents,
    pendingChainNodes,
    completedChainIds,
    activeChainIds,
    attributeShortfall
  } = parseResult.data

  // 流式开关：?stream=1 或 Accept: text/event-stream（未开启时行为与改造前完全一致）
  const wantStream =
    getQuery(event)?.stream === '1' || (getHeader(event, 'accept') ?? '').includes('text/event-stream')

  // 2. 检查缓存（含剧情链状态）
  const cacheKey = computeCacheKey(saveId, turn, stateSnapshot, pendingChainNodes, completedChainIds, activeChainIds)
  const cached = getCached<z.infer<typeof eventSchema>>(cacheKey)
  if (cached) {
    setHeader(event, 'X-Cache', 'HIT')
    if (wantStream) {
      // 缓存命中无需生成：直接推送事件并结束（前端无感知差异）
      setResponseHeader(event, 'Content-Type', 'text/event-stream')
      setResponseHeader(event, 'Cache-Control', 'no-cache, no-transform')
      setResponseHeader(event, 'Connection', 'keep-alive')
      setResponseHeader(event, 'X-Accel-Buffering', 'no')
      endSseWithEvent(event, cached)
      return
    }
    return { ok: true, data: { event: cached } }
  }

  // 3. 并发锁冲突检查（不阻塞，直接 429）
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

  // 4. 获取锁
  const release = await acquireLock(saveId)
  try {
    // ===== 三层触发优先级（挂起 > 下一条剧情链 > LLM）=====
    let resolved: ResolvedChain | null = null
    let chainFallback = false

    // 1) 挂起节点优先
    if (pendingChainNodes.length > 0) {
      const pcn = pendingChainNodes[0]
      const found = findChainNode(pcn.chainId, pcn.nodeId)
      if (found) {
        resolved = buildChainEvent(found.chain, found.node, 'pending-chain', stateSnapshot.date.year)
      } else {
        // 挂起节点 ID 找不到 → 告警 + 标记降级 + 继续走时间窗口/LLM
        console.error(`[generate-event] 挂起节点未找到：${pcn.chainId}/${pcn.nodeId}，降级到时间窗口/LLM`)
        chainFallback = true
      }
    }

    // 2) 下一条剧情链（锚点年份不早于当前年，晚于当前年时触发时光跳跃）
    if (!resolved) {
      const tw = matchNextChain(stateSnapshot.date.year, completedChainIds, activeChainIds)
      if (tw) {
        resolved = buildChainEvent(tw.chain, tw.node, 'time-window', stateSnapshot.date.year)
      }
    }

    // 命中剧情链 → 不调 LLM，直接返回
    if (resolved) {
      setCached(cacheKey, resolved.event, CACHE_TTL_MS)
      setHeader(event, 'X-Cache', 'MISS')
      setHeader(event, 'X-Event-Source', resolved.source)
      if (chainFallback) setHeader(event, 'X-Fallback', 'true')
      if (wantStream) {
        // 剧情链事件是预置内容，无需生成：直接推送
        setResponseHeader(event, 'Content-Type', 'text/event-stream')
        setResponseHeader(event, 'Cache-Control', 'no-cache, no-transform')
        setResponseHeader(event, 'Connection', 'keep-alive')
        setResponseHeader(event, 'X-Accel-Buffering', 'no')
        endSseWithEvent(event, resolved.event)
        return
      }
      return { ok: true, data: { event: resolved.event } }
    }

    // 3) LLM 自主生成（无剧情链触发）
    const config = useRuntimeConfig(event)
    const openai = createOpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
      fetch: createSiliconFlowFetch(false)
    })
    const model = openai.chat('Qwen/Qwen3-8B')

    // T4.1：LLM 路径前调用 get-recent-events 工具，丰富历史事件上下文（limit 10）
    // 工具查询内存 recentEvents，不查数据库；失败则降级到 body 中的 recentEvents（T4.2）
    let effectiveRecentEvents: any[] = recentEvents
    let toolFallback = false
    try {
      const ctx: ToolContext = {
        saveId,
        turn,
        stateSnapshot,
        character: {
          background: character.background,
          backgroundPerks: {},
          factionId: '',
          factionName: character.factionName,
          factionSummary: character.factionSummary
        },
        factions,
        recentEvents
      }
      const tools = createTools(ctx) as Record<
        string,
        { execute?: (args: { limit?: number }, opts?: object) => Promise<unknown> }
      >
      const recentEventsTool = tools['get-recent-events']
      if (recentEventsTool?.execute) {
        const toolResult = (await recentEventsTool.execute({ limit: 10 }, {})) as
          | { events?: unknown[] }
          | { error: string; detail: string }
          | undefined
        if (toolResult && 'events' in toolResult && Array.isArray(toolResult.events)) {
          effectiveRecentEvents = toolResult.events as any[]
        }
      }
    } catch (err) {
      console.warn('[generate-event] get-recent-events 工具调用失败，降级使用 body recentEvents:', err)
      toolFallback = true
    }

    // 兜底路径的避重清单：取已确定的近期事件标题（工具结果为权威来源）。
    // 语义去重只存在于 LLM 路径，兜底路径此前是纯随机、长局必然重复同一条事件。
    const recentTitles = effectiveRecentEvents
      .map((e: any) => (typeof e?.title === 'string' ? e.title : ''))
      .filter(Boolean)

    // ===== AI 长期记忆：LLM 路径生成前检索历史事件做语义去重（提案 任务5 / design D9）=====
    // 仅在 LLM 路径执行；缓存命中 / 剧情链 / fallback 路径不检索不写入。
    // 检索失败降级为不注入（不阻断生成），阈值 0.76 / topK 5。
    let dedupEvents: { turn: number; summary: string }[] = []
    try {
      const dedupQuery = [
        character.factionName,
        factions.map((f) => f.name).join('、'),
        recentEvents.map((e: any) => e.title).filter(Boolean).join('、'),
        `第${turn}回合`
      ]
        .filter(Boolean)
        .join(' ')
      const hits = await searchEventMemories(saveId, dedupQuery, { threshold: 0.76, topK: 5 })
      dedupEvents = hits.map((h) => ({ turn: h.turn, summary: h.content }))
    } catch (err) {
      console.warn('[generate-event] 历史去重检索失败，降级跳过:', err)
      try {
        setHeader(event, 'X-Memory-Skip', 'true')
      } catch {
        // header 设置失败不影响主流程
      }
    }
    if (dedupEvents.length > 0) {
      setHeader(event, 'X-Dedup-Applied', 'true')
    }

    const prompt = buildGenerateEventPrompt({
      character,
      stateSnapshot,
      factions,
      recentEvents: effectiveRecentEvents,
      turn,
      attributeShortfall,
      dedupEvents
    })

    // ===== 流式模式（?stream=1 / Accept: text/event-stream）=====
    // 慢实例上整包等待要 40-60s，流式让前端在 1s 内就开始收到内容。
    // 非流式请求完全不走这段，行为与改造前一致。
    if (wantStream) {
      setResponseHeader(event, 'Content-Type', 'text/event-stream')
      setResponseHeader(event, 'Cache-Control', 'no-cache, no-transform')
      setResponseHeader(event, 'Connection', 'keep-alive')
      // 关闭 Nginx 缓冲，否则 SSE 会被攒着一起发（上线清单里也要求 SSE 关闭缓冲）
      setResponseHeader(event, 'X-Accel-Buffering', 'no')
      setHeader(event, 'X-Cache', 'MISS')
      setHeader(event, 'X-Event-Source', 'llm')
      if (chainFallback) setHeader(event, 'X-Fallback', 'true')
      if (toolFallback) setHeader(event, 'X-Tool-Fallback', 'true')

      const res = getSseStream(event)
      try {
        const result = streamText({
          model,
          prompt,
          maxOutputTokens: 2000,
          // 用宽松 JSON 模式而非 structuredOutputs：实测流式下 json_object 解析成功率 5/5，
          // 且不需要把完整 schema 作为输入 token 发送（省输入、也省慢实例上的排队时间）
          providerOptions: { openai: { response_format: { type: 'json_object' } } },
          // 流式超时给到 45s（非流式是 30s×2 次重试）：
          // 1) 玩家已看到渐进内容，等待容忍度高于「整包干等」，不必急着砍
          // 2) 实测慢实例上生成常需 30-60s，30s 会让已生成的内容全部作废转为降级事件
          // 3) 流式分支无法像非流式那样静默重试（流已开始推给前端），只能一次给足时间
          abortSignal: AbortSignal.timeout(45_000),
          onFinish: ({ usage }) => logLlmUsage('generate-event-stream', usage, { saveId, turn })
        })

        let full = ''
        let sentTitle = ''
        let sentDesc = ''
        for await (const part of result.fullStream) {
          if (part.type !== 'text-delta') continue
          full += part.text
          // 尽力提取已生成部分，只把「新增字符」作为 delta 推送（前端即可渐进显示）
          const title = extractPartialField(full, 'title')
          const desc = extractPartialField(full, 'description')
          if (title.length > sentTitle.length) {
            const delta = title.slice(sentTitle.length)
            sentTitle = title
            writeSseFrame(res, { delta })
          }
          if (desc.length > sentDesc.length) {
            const delta = desc.slice(sentDesc.length)
            sentDesc = desc
            writeSseFrame(res, { delta })
          }
        }

        const parsed = extractEventJson(full)
        const validated = parsed ? eventSchema.safeParse(parsed) : null
        if (!validated || !validated.success) {
          throw new Error(validated ? `schema 校验失败: ${validated.error.issues.length} 项` : 'JSON 解析失败')
        }
        const ev = validated.data
        setCached(cacheKey, ev, CACHE_TTL_MS)
        void writeEventMemory({
          saveId,
          turn,
          eventId: randomUUID(),
          eventType: ev.eventType,
          content: `${ev.title} ${ev.description}`
        })
        writeSseFrame(res, { event: ev })
        res.write('data: [DONE]\n\n')
        res.end()
        return
      } catch (err) {
        console.error('[generate-event] 流式生成失败，降级返回预置事件:', err)
        const fb = getRandomFallbackEvent(undefined, recentTitles)
        setCached(cacheKey, fb, CACHE_TTL_MS)
        // 降级时 header 已发出，改用帧内字段告知前端
        writeSseFrame(res, { event: fb, fallback: true })
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
    }

    // 重试 1 次
    let lastErr: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { object, usage } = await generateObject({
          model,
          schema: eventSchema,
          prompt,
          maxOutputTokens: 2000,
          providerOptions: { openai: { structuredOutputs: true } },
          abortSignal: AbortSignal.timeout(30_000)
        })
        logLlmUsage('generate-event', usage, { saveId, turn, attempt: attempt + 1 })
        // 写入缓存
        setCached(cacheKey, object, CACHE_TTL_MS)
        // 写入长期记忆：事件语义去重基础（fire-and-forget，失败静默，不阻塞响应）
        void writeEventMemory({
          saveId,
          turn,
          eventId: randomUUID(),
          eventType: object.eventType,
          content: `${object.title} ${object.description}`
        })
        setHeader(event, 'X-Cache', 'MISS')
        setHeader(event, 'X-Event-Source', 'llm')
        if (chainFallback) setHeader(event, 'X-Fallback', 'true')
        if (toolFallback) setHeader(event, 'X-Tool-Fallback', 'true') // T4.2：工具降级标识
        return { ok: true, data: { event: object } }
      } catch (err) {
        lastErr = err
        console.warn(`[generate-event] 第 ${attempt + 1} 次调用失败:`, err)
      }
    }

    // 5. 降级：返回预置事件
    console.error('[generate-event] 2 次重试均失败，降级返回预置事件:', lastErr)
    setHeader(event, 'X-Cache', 'MISS')
    // 降级语义必须与 LLM 成功路径区分（此前误标 'llm' 会误导监控与前端）
    setHeader(event, 'X-Event-Source', 'fallback')
    setHeader(event, 'X-Fallback', 'true')
    if (toolFallback) setHeader(event, 'X-Tool-Fallback', 'true') // T4.2：工具降级标识
    const fallback = getRandomFallbackEvent(undefined, recentTitles)
    // 短暂缓存 fallback：同 cache key 下一请求直接命中，不再白打 2 次 LLM
    setCached(cacheKey, fallback, CACHE_TTL_MS)
    return { ok: true, data: { event: fallback }, fallback: true }
  } finally {
    release()
  }
})
