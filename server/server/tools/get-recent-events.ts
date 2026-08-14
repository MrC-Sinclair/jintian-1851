/**
 * @file get-recent-events — 查询最近 N 回合事件历史
 *
 * 何时调用：玩家询问历史、军师需要上下文时。
 * 何时不用：只关心当前回合时。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { ToolContext } from '../utils/tool-context'

export function createGetRecentEventsTool(ctx: ToolContext) {
  return tool({
    description:
      '查询最近 N 回合历史事件（默认 5 条，上限 20 条）。' +
      '何时调用：玩家询问历史、军师需要上下文时。' +
      '何时不用：只关心当前回合时。',
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(5)
        .describe('返回事件条数，默认 5，范围 1-20')
    }),
    execute: async ({ limit }) => {
      try {
        const safeLimit = Math.min(Math.max(limit ?? 5, 1), 20)
        const events = ctx.recentEvents.slice(-safeLimit)
        if (events.length === 0) {
          return { events: [], note: '尚无历史事件' }
        }
        return { events }
      } catch (err) {
        return { error: 'INTERNAL_ERROR', detail: String(err) }
      }
    }
  })
}
