/**
 * @file get-relationship — 查询两势力之间的关系值
 *
 * 何时调用：NPC 决策结盟/挑衅前需要判断关系。
 * 何时不用：不涉及势力关系时。
 *
 * 说明：本游戏的 relationship 是势力相对玩家的好感度，两势力之间无独立关系矩阵，
 * 故返回两势力 relationship 的平均值作为"两势力关系"的近似（spec agent-tool-system 定义）。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { ToolContext } from '../utils/tool-context'

export function createGetRelationshipTool(ctx: ToolContext) {
  return tool({
    description:
      '查询两势力之间的关系值（取两势力各自与玩家关系值的平均值）。' +
      '何时调用：NPC 决策结盟/挑衅前需要判断关系。' +
      '何时不用：不涉及势力关系时。',
    inputSchema: z.object({
      factionIdA: z.string().min(1).describe('势力 A 的 ID'),
      factionIdB: z.string().min(1).describe('势力 B 的 ID')
    }),
    execute: async ({ factionIdA, factionIdB }) => {
      try {
        if (!factionIdA || !factionIdB) {
          return { error: 'INVALID_PARAMS', detail: 'factionIdA 与 factionIdB 均必填' }
        }
        const a = ctx.factions.find((f) => f.id === factionIdA)
        const b = ctx.factions.find((f) => f.id === factionIdB)
        if (!a || !b) {
          const missing = !a ? factionIdA : factionIdB
          return { error: 'FACTION_NOT_FOUND', detail: `势力 ID ${missing} 不存在` }
        }
        const relationship = Math.round((a.relationship + b.relationship) / 2)
        return { relationship, factionA: a.name, factionB: b.name }
      } catch (err) {
        return { error: 'INTERNAL_ERROR', detail: String(err) }
      }
    }
  })
}
