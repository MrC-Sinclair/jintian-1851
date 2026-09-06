/**
 * @file DELETE /api/game/saves — 删除云端存档（多存档管理收尾能力）
 *
 * 设计要点：
 *   - 属主校验与 sync-save 同口径：DELETE 条件带 save_id + device_id 双条件（原子操作，
 *     无 Read-Modify-Write 竞态）；0 行命中 → 404 SAVE_NOT_FOUND（与「不存在」同响应，
 *     不泄漏他人存档存在性）
 *   - 顺带清理该 saveId 的 game_events / faction_memories 记忆行（存档删除后记忆成孤儿，
 *     永远不会再被检索到，留着只占空间）；记忆清理先于存档删除，且失败不阻断主删除
 *     （孤儿记忆无害，存档删除成功即达到业务目的）
 *   - 非 AI 端点：不受 rate-limit 中间件限制、不使用并发锁（与 saves GET 同口径）
 */

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db'
import { factionMemories, gameEvents, gameSaves } from '../../db/schema'

const querySchema = z.object({
  saveId: z.string().uuid(),
  deviceId: z.string().min(1)
})

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  const parseResult = querySchema.safeParse({
    saveId: query.saveId,
    deviceId: query.deviceId
  })
  if (!parseResult.success) {
    return createError({
      statusCode: 400,
      statusMessage: 'INVALID_PARAMS',
      data: {
        ok: false,
        error: {
          code: 'INVALID_PARAMS',
          message: 'saveId（UUID 格式）与 deviceId（至少 1 字符）均为必填',
          detail: parseResult.error.issues
        }
      }
    })
  }

  const { saveId, deviceId } = parseResult.data

  try {
    // 1. 清理该存档的记忆行（best-effort：失败仅告警，不阻断存档删除）
    try {
      await db.delete(gameEvents).where(eq(gameEvents.saveId, saveId))
      await db.delete(factionMemories).where(eq(factionMemories.saveId, saveId))
    } catch (memErr) {
      console.warn(`[saves DELETE] saveId=${saveId} 记忆行清理失败（不阻断）:`, memErr)
    }

    // 2. 删除存档本体（双条件原子删除：deviceId 即属主凭证）
    const removed = await db
      .delete(gameSaves)
      .where(and(eq(gameSaves.saveId, saveId), eq(gameSaves.deviceId, deviceId)))
      .returning({ saveId: gameSaves.saveId })

    if (removed.length === 0) {
      // 0 行命中：不存在 或 归属其他设备 —— 同响应，防存在性泄漏（与 GET sync-save 口径一致）
      return createError({
        statusCode: 404,
        statusMessage: 'SAVE_NOT_FOUND',
        data: {
          ok: false,
          error: { code: 'SAVE_NOT_FOUND', message: '云端未找到此存档' }
        }
      })
    }

    return { ok: true, data: { saveId, deleted: true } }
  } catch (err) {
    console.error('[saves DELETE] DB error:', err)
    return createError({
      statusCode: 500,
      statusMessage: 'DB_ERROR',
      data: { ok: false, error: { code: 'DB_ERROR', message: '存档删除失败' } }
    })
  }
})
