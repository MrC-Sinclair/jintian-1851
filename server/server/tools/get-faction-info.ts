/**
 * @file get-faction-info — 查询单个势力详情
 *
 * 何时调用：玩家询问某势力情况、NPC 决策需要了解对手时。
 * 何时不用：已知势力全部信息时（用 get-all-factions 获取全局）。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { ToolContext } from '../utils/tool-context'

export function createGetFactionInfoTool(ctx: ToolContext) {
  return tool({
    description:
      '查询单个势力详情（id/name/summary/power/relationship/status/lastAction）。' +
      '何时调用：玩家询问某势力情况、NPC 决策需要了解对手时。' +
      '何时不用：已知势力全部信息时（改用 get-all-factions）。',
    inputSchema: z.object({
      factionId: z.string().min(1).describe('势力 ID，如 "xiang-jun"')
    }),
    execute: async ({ factionId }) => {
      try {
        if (!factionId || factionId.trim() === '') {
          return { error: 'INVALID_PARAMS', detail: 'factionId 必填' }
        }
        const faction = ctx.factions.find((f) => f.id === factionId)
        if (!faction) {
          return { error: 'FACTION_NOT_FOUND', detail: `势力 ID ${factionId} 不存在` }
        }
        return { faction }
      } catch (err) {
        return { error: 'INTERNAL_ERROR', detail: String(err) }
      }
    }
  })
}
