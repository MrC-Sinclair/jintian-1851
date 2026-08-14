/**
 * @file 工具上下文与工具工厂
 *
 * 所有工具通过闭包访问 ToolContext，不查数据库、不调 LLM。
 * ToolContext 在每次请求时由端点构造一次，所有工具共享（设计文档 D6）。
 */

import type { StateSnapshot, Character, Faction, HistoryEvent } from '../../types/game'
import { createGetFactionInfoTool } from '../tools/get-faction-info'
import { createGetAllFactionsTool } from '../tools/get-all-factions'
import { createGetCharacterStatusTool } from '../tools/get-character-status'
import { createGetRecentEventsTool } from '../tools/get-recent-events'
import { createGetRelationshipTool } from '../tools/get-relationship'
import { createGetCurrentDateTool } from '../tools/get-current-date'

/** 工具上下文：单次请求内的全部查询数据源（来自请求 body 的内存数据） */
export interface ToolContext {
  saveId: string
  turn: number
  stateSnapshot: StateSnapshot
  character: Character
  factions: Faction[]
  recentEvents: HistoryEvent[]
}

/**
 * 基于 ToolContext 创建完整工具集（advisor-chat 使用全部 6 个工具）
 */
export function createTools(ctx: ToolContext) {
  return {
    'get-faction-info': createGetFactionInfoTool(ctx),
    'get-all-factions': createGetAllFactionsTool(ctx),
    'get-character-status': createGetCharacterStatusTool(ctx),
    'get-recent-events': createGetRecentEventsTool(ctx),
    'get-relationship': createGetRelationshipTool(ctx),
    'get-current-date': createGetCurrentDateTool(ctx)
  }
}

/**
 * NPC Agent 使用的 4 个核心查询工具（设计文档 D4：仅注册核心工具控制成本）
 * 不含 get-recent-events / get-current-date（NPC 决策不需要）
 */
export function createNpcTools(ctx: ToolContext) {
  return {
    'get-faction-info': createGetFactionInfoTool(ctx),
    'get-all-factions': createGetAllFactionsTool(ctx),
    'get-relationship': createGetRelationshipTool(ctx),
    'get-character-status': createGetCharacterStatusTool(ctx)
  }
}
