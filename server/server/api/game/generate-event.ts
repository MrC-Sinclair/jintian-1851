/**
 * @file POST /api/game/generate-event — AI 生成回合事件
 *
 * 缓存键 sha256(saveId + turn + sha256(stateSnapshot) + sha256(chainState))，5 分钟 TTL。
 * 命中直接返回（header X-Cache: HIT），否则获取 saveId 锁。
 *
 * 三层触发优先级（D1）：
 *   1. 挂起节点（pendingChainNodes 非空）→ 不调 LLM，返回该节点 event（X-Event-Source: pending-chain）
 *   2. 时间窗口匹配（当前年份命中某剧情链 startYear）→ 不调 LLM，返回首节点（X-Event-Source: time-window）
 *   3. LLM 自主生成 → 调 Qwen/Qwen3-8B + generateObject()（X-Event-Source: llm）
 *
 * 失败重试 1 次后降级 fallback-events.ts（池已扩充到 60 条）。
 * 并发锁冲突返回 429 + CONCURRENT_REQUEST。
 */

import { createOpenAI } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createSiliconFlowFetch } from '../../utils/siliconflow-fetch'
import { buildGenerateEventPrompt } from '../../utils/prompts/generate-event'
import { getCached, setCached } from '../../utils/ai-cache'
import { acquireLock, isLocked } from '../../utils/concurrency-lock'
import { getRandomFallbackEvent } from '../../runtime/fallback-events'
import { STORY_CHAINS } from '../../runtime/story-chains'
import { createTools, type ToolContext } from '../../utils/tool-context'
import type { ChainNode, PendingChainNode, StoryChain } from '../../../types/game'

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
  chainProgress: z.object({ current: z.number(), total: z.number() }).optional()
})

/** 三层触发解析结果 */
interface ResolvedChain {
  event: z.infer<typeof eventSchema>
  source: 'pending-chain' | 'time-window'
}

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
function buildChainEvent(chain: StoryChain, node: ChainNode, source: 'pending-chain' | 'time-window'): ResolvedChain {
  const current = chain.nodes.findIndex((n) => n.nodeId === node.nodeId) + 1
  return {
    event: {
      ...node.event,
      chainId: chain.chainId,
      chainNodeId: node.nodeId,
      chainProgress: { current, total: chain.nodes.length }
    },
    source
  }
}

/**
 * 时间窗口匹配：当前年份命中某剧情链 startYear 且满足前置/状态过滤
 * 同年份多链按 startYear 升序 + chainId 字典序选第一条
 */
function matchTimeWindow(
  year: number,
  completedChainIds: string[],
  activeChainIds: string[]
): { chain: StoryChain; node: ChainNode } | null {
  const candidates = STORY_CHAINS.filter(
    (c) =>
      c.startYear === year &&
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

  // 2. 检查缓存（含剧情链状态）
  const cacheKey = computeCacheKey(saveId, turn, stateSnapshot, pendingChainNodes, completedChainIds, activeChainIds)
  const cached = getCached<z.infer<typeof eventSchema>>(cacheKey)
  if (cached) {
    setHeader(event, 'X-Cache', 'HIT')
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
    // ===== 三层触发优先级（挂起 > 时间窗口 > LLM）=====
    let resolved: ResolvedChain | null = null
    let chainFallback = false

    // 1) 挂起节点优先
    if (pendingChainNodes.length > 0) {
      const pcn = pendingChainNodes[0]
      const found = findChainNode(pcn.chainId, pcn.nodeId)
      if (found) {
        resolved = buildChainEvent(found.chain, found.node, 'pending-chain')
      } else {
        // 挂起节点 ID 找不到 → 告警 + 标记降级 + 继续走时间窗口/LLM
        console.error(`[generate-event] 挂起节点未找到：${pcn.chainId}/${pcn.nodeId}，降级到时间窗口/LLM`)
        chainFallback = true
      }
    }

    // 2) 时间窗口匹配
    if (!resolved) {
      const tw = matchTimeWindow(stateSnapshot.date.year, completedChainIds, activeChainIds)
      if (tw) {
        resolved = buildChainEvent(tw.chain, tw.node, 'time-window')
      }
    }

    // 命中剧情链 → 不调 LLM，直接返回
    if (resolved) {
      setCached(cacheKey, resolved.event, CACHE_TTL_MS)
      setHeader(event, 'X-Cache', 'MISS')
      setHeader(event, 'X-Event-Source', resolved.source)
      if (chainFallback) setHeader(event, 'X-Fallback', 'true')
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

    const prompt = buildGenerateEventPrompt({
      character,
      stateSnapshot,
      factions,
      recentEvents: effectiveRecentEvents,
      turn,
      attributeShortfall
    })

    // 重试 1 次
    let lastErr: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { object } = await generateObject({
          model,
          schema: eventSchema,
          prompt,
          providerOptions: { openai: { structuredOutputs: true } },
          abortSignal: AbortSignal.timeout(30_000)
        })
        // 写入缓存
        setCached(cacheKey, object, CACHE_TTL_MS)
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
    setHeader(event, 'X-Event-Source', 'llm')
    setHeader(event, 'X-Fallback', 'true')
    if (toolFallback) setHeader(event, 'X-Tool-Fallback', 'true') // T4.2：工具降级标识
    const fallback = getRandomFallbackEvent()
    return { ok: true, data: { event: fallback }, fallback: true }
  } finally {
    release()
  }
})
