/**
 * @file get-character-status — 查询玩家当前状态详情
 *
 * 何时调用：军师需要分析玩家状态、给出建议前。
 * 何时不用：玩家状态已在对话上下文中时。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { ToolContext } from '../utils/tool-context'

export function createGetCharacterStatusTool(ctx: ToolContext) {
  return tool({
    description:
      '查询玩家当前状态（身份背景/所属势力/各项属性/资源/当前回合与日期）。' +
      '何时调用：军师需要分析玩家状态、给出建议前。' +
      '何时不用：玩家状态已在对话上下文中时。',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const { character, stateSnapshot } = ctx
        return {
          character: {
            background: character.background,
            factionId: character.factionId,
            factionName: character.factionName,
            attributes: stateSnapshot.attributes,
            resources: stateSnapshot.resources,
            turn: stateSnapshot.turn,
            date: stateSnapshot.date
          }
        }
      } catch (err) {
        return { error: 'INTERNAL_ERROR', detail: String(err) }
      }
    }
  })
}
