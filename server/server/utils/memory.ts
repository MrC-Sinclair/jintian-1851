/**
 * @file 记忆读写模块（AI 长期记忆提案）
 *
 * 封装对 game_events（情景记忆）与 faction_memories（关系记忆）的写入与检索。
 * 设计约束见 design.md：
 *   - D4/D5：写入 fire-and-forget，try/catch 静默失败，不阻塞回合主流程
 *   - D6：检索**不 select embedding 列**，只返回 content/turn/similarity（规避 postgres-js 解析坑）
 *   - D7：faction 检索按 saveId + factionId 双隔离
 *   - D9：阈值/ topK 由调用方传入（DEDUP_THRESHOLD=0.76 / RECALL_THRESHOLD=0.45）
 */

import { and, cosineDistance, desc, eq, gt, sql } from 'drizzle-orm'
import { db } from '../db'
import { factionMemories, gameEvents } from '../db/schema'
import { embedText } from './embeddings'

export interface EventMemoryInput {
  saveId: string
  turn: number
  eventId: string
  eventType: string
  content: string
}

export interface FactionMemoryInput {
  saveId: string
  factionId: string
  turn: number
  source: 'npc_action' | 'player_action'
  sentiment: 'positive' | 'negative' | 'neutral'
  content: string
}

export interface MemorySearchResult {
  content: string
  turn: number
  similarity: number
}

/**
 * 异步写入一条事件记忆（game_events）。
 * fire-and-forget：调用方无需 await（直接 `void writeEventMemory(...)`），
 * 内部异常仅记 warn 日志，不影响调用方主流程。
 */
export async function writeEventMemory(input: EventMemoryInput): Promise<void> {
  try {
    const embedding = await embedText(input.content)
    if (!embedding) return
    await db.insert(gameEvents).values({
      saveId: input.saveId,
      turn: input.turn,
      eventId: input.eventId,
      eventType: input.eventType,
      content: input.content,
      embedding
    })
  } catch (err) {
    console.warn('[memory] writeEventMemory skipped (non-fatal):', err)
  }
}

/**
 * 异步写入一条势力关系记忆（faction_memories）。同 writeEventMemory 的 fire-and-forget 语义。
 */
export async function writeFactionMemory(input: FactionMemoryInput): Promise<void> {
  try {
    const embedding = await embedText(input.content)
    if (!embedding) return
    await db.insert(factionMemories).values({
      saveId: input.saveId,
      factionId: input.factionId,
      turn: input.turn,
      source: input.source,
      sentiment: input.sentiment,
      content: input.content,
      embedding
    })
  } catch (err) {
    console.warn('[memory] writeFactionMemory skipped (non-fatal):', err)
  }
}

/**
 * 检索同 saveId 下的历史事件（语义去重用）。
 * 不 select embedding 列，只投影 content/turn/similarity。
 * 空查询返回空数组；检索失败**抛错**（不吞），由调用方按各自策略降级：
 *   generate-event → catch 后不注入避重清单；npc-actions → 设 X-Memory-Skip；
 *   search-memory 工具 → 返回 MEMORY_UNAVAILABLE（design.md D5）。
 */
export async function searchEventMemories(
  saveId: string,
  query: string,
  opts: { threshold: number; topK: number }
): Promise<MemorySearchResult[]> {
  const queryVec = await embedText(query)
  if (!queryVec) return []
  const similarity = sql`1 - (${cosineDistance(gameEvents.embedding, queryVec)})`
  const rows = await db
    .select({
      content: gameEvents.content,
      turn: gameEvents.turn,
      similarity
    })
    .from(gameEvents)
    .where(and(eq(gameEvents.saveId, saveId), gt(similarity, opts.threshold)))
    .orderBy(desc(similarity))
    .limit(opts.topK)
  return rows.map((r) => ({ content: r.content, turn: r.turn, similarity: Number(r.similarity) }))
}

/**
 * 检索某势力自身的关系记忆（NPC 决策注入用）。按 saveId + factionId 双隔离（D7）。
 * 投影与错误传播语义同 searchEventMemories（失败抛错，调用方降级）。
 */
export async function searchFactionMemories(
  saveId: string,
  factionId: string,
  query: string,
  opts: {
    threshold: number
    topK: number
    /** 可选情感过滤（正负混合召回用），不传则不限情感 */
    sentiment?: 'positive' | 'negative' | 'neutral'
  }
): Promise<MemorySearchResult[]> {
  const queryVec = await embedText(query)
  if (!queryVec) return []
  const similarity = sql`1 - (${cosineDistance(factionMemories.embedding, queryVec)})`
  const rows = await db
    .select({
      content: factionMemories.content,
      turn: factionMemories.turn,
      similarity
    })
    .from(factionMemories)
    .where(
      and(
        eq(factionMemories.saveId, saveId),
        eq(factionMemories.factionId, factionId),
        gt(similarity, opts.threshold),
        // D8 正负混合召回：按情感过滤，确保恩怨两面都能被检索到
        ...(opts.sentiment ? [eq(factionMemories.sentiment, opts.sentiment)] : [])
      )
    )
    .orderBy(desc(similarity))
    .limit(opts.topK)
  return rows.map((r) => ({ content: r.content, turn: r.turn, similarity: Number(r.similarity) }))
}
