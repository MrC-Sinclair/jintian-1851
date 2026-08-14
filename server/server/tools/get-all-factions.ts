/**
 * @file get-all-factions — 查询所有势力列表（压缩为 4 字段）
 *
 * 何时调用：需要全局势力格局、了解有哪些势力时。
 * 何时不用：只需单个势力详情时（用 get-faction-info）。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { ToolContext } from '../utils/tool-context'

export function createGetAllFactionsTool(ctx: ToolContext) {
  return tool({
    description:
      '查询所有势力列表（压缩为 id/name/power/relationship/status 四字段，不含 summary 以控制 token）。' +
      '何时调用：需要全局势力格局、了解有哪些势力时。' +
      '何时不用：只需单个势力详情时（改用 get-faction-info）。',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const factions = ctx.factions.map((f) => ({
          id: f.id,
          name: f.name,
          power: f.power,
          relationship: f.relationship,
          status: f.status
        }))
        return { factions }
      } catch (err) {
        return { error: 'INTERNAL_ERROR', detail: String(err) }
      }
    }
  })
}
