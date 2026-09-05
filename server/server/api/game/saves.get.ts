/**
 * @file GET /api/game/saves — 按设备拉取存档列表（多存档管理基础能力）
 *
 * 设计要点：
 *   - deviceId 即归属凭证（与 sync-save 的属主模型一致：deviceId 随存档传播，跨设备拉取后继承），
 *     仅返回该 deviceId 名下的存档摘要，不返回完整 saveData（列表页无需全量 blob，防响应膨胀）
 *   - 命中 `idx_game_saves_device_id` 索引（此前该索引仅预留、无对应查询）
 *   - 按 updated_at 倒序（最近游玩的在前），limit 上限 50 防止单响应过大
 *   - 非 AI 端点：不受 rate-limit 中间件限制、不使用并发锁（只读，与 sync-save 同口径）
 *
 * 摘要字段从 saveData JSONB 中提取（character.background / character.factionName / state.turn），
 * 行内解析而非额外建表——MVP 不为列表单独做反范式列。
 */

import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db'
import { gameSaves } from '../../db/schema'

/** 列表单条摘要 */
interface SaveListItem {
  saveId: string
  saveVersion: number
  updatedAt: number
  endedAt: number | null
  endedReason: string | null
  summary: {
    background: string
    factionName: string
    turn: number
    ended: boolean
  }
}

const querySchema = z.object({
  deviceId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(50).default(20)
})

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  const parseResult = querySchema.safeParse({
    deviceId: query.deviceId,
    limit: query.limit ?? undefined
  })
  if (!parseResult.success) {
    return createError({
      statusCode: 400,
      statusMessage: 'INVALID_PARAMS',
      data: {
        ok: false,
        error: {
          code: 'INVALID_PARAMS',
          message: 'deviceId 必填（≤50 字符），limit 为 1-50 的整数',
          detail: parseResult.error.issues
        }
      }
    })
  }

  const { deviceId, limit } = parseResult.data

  try {
    const rows = await db
      .select({
        saveId: gameSaves.saveId,
        saveVersion: gameSaves.saveVersion,
        saveData: gameSaves.saveData,
        updatedAt: gameSaves.updatedAt,
        endedAt: gameSaves.endedAt,
        endedReason: gameSaves.endedReason
      })
      .from(gameSaves)
      .where(eq(gameSaves.deviceId, deviceId))
      .orderBy(desc(gameSaves.updatedAt))
      .limit(limit)

    const saves: SaveListItem[] = rows.map((row) => {
      const data = row.saveData as {
        character?: { background?: string; factionName?: string }
        state?: { turn?: number }
      }
      return {
        saveId: row.saveId,
        saveVersion: row.saveVersion,
        updatedAt: row.updatedAt.getTime(),
        endedAt: row.endedAt ? row.endedAt.getTime() : null,
        endedReason: row.endedReason,
        summary: {
          background: data?.character?.background ?? '',
          factionName: data?.character?.factionName ?? '',
          turn: data?.state?.turn ?? 0,
          ended: row.endedAt !== null
        }
      }
    })

    return { ok: true, data: { saves } }
  } catch (err) {
    console.error('[saves GET] DB error:', err)
    return createError({
      statusCode: 500,
      statusMessage: 'DB_ERROR',
      data: { ok: false, error: { code: 'DB_ERROR', message: '存档列表查询失败' } }
    })
  }
})
