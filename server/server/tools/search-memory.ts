/**
 * @file search-memory — 军师语义检索本局历史记忆（AI 长期记忆提案 任务8）
 *
 * 何时调用：玩家询问过往事件（尤其 20 回合以前）、军师需要追溯因果时。优先调用，不要凭空编造历史。
 * 何时不用：只关心当前局势时（用 get-character-status / get-all-factions）。
 *
 * 检索走 searchEventMemories（saveId 全局作用域，阈值 0.45 / topK ≤10，D9）。
 * 失败返回 { error: 'MEMORY_UNAVAILABLE' }，由 LLM 自行转向其他工具或直接回答（D5）。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { ToolContext } from '../utils/tool-context'
import { searchEventMemories } from '../utils/memory'

/** D9：军师记忆检索阈值（召回优先，允许弱相关联想） */
const RECALL_THRESHOLD = 0.45
/** limit 钳制边界（任务8：1-10，默认 5） */
const LIMIT_MIN = 1
const LIMIT_MAX = 10
const LIMIT_DEFAULT = 5
/** query 长度上限（任务8：1-200 字符） */
const QUERY_MAX_CHARS = 200

export function createSearchMemoryTool(ctx: ToolContext) {
  return tool({
    description:
      '按语义检索本局历史记忆（跨回合往事，含 20 回合以前的旧事）。' +
      '何时调用：玩家询问过往事件、军师需要追溯历史因果时，涉及过往事件时优先调用此工具，不要凭空编造历史。' +
      '何时不用：只关心当前回合与当前局势时。',
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .max(QUERY_MAX_CHARS)
        .describe('检索内容（如"玩家早期对湘军做过什么"），1-200 字符'),
      limit: z
        .number()
        .int()
        .min(LIMIT_MIN)
        .max(LIMIT_MAX)
        .default(LIMIT_DEFAULT)
        .describe('返回记忆条数，默认 5，范围 1-10')
    }),
    execute: async ({ query, limit }) => {
      // 防御性校验：空/超长 query 返回 INVALID_PARAMS（LLM 偶尔会传空串或截断失败的超长串）
      const q = typeof query === 'string' ? query.trim() : ''
      if (!q || q.length > QUERY_MAX_CHARS) {
        return { error: 'INVALID_PARAMS', detail: `query 需为 1-${QUERY_MAX_CHARS} 字符` }
      }
      try {
        // 越界钳制（不抛错）：LLM 可能传 0 / 负数 / 超上限
        const safeLimit = Math.min(Math.max(Math.floor(limit ?? LIMIT_DEFAULT), LIMIT_MIN), LIMIT_MAX)
        const events = await searchEventMemories(ctx.saveId, q, {
          threshold: RECALL_THRESHOLD,
          topK: safeLimit
        })
        if (events.length === 0) {
          return { events: [], note: '未检索到相关历史记忆' }
        }
        return { events }
      } catch (err) {
        return { error: 'MEMORY_UNAVAILABLE', detail: String(err) }
      }
    }
  })
}
