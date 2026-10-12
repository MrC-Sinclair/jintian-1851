/**
 * @file DELETE /api/game/saves — 删除云端存档（多存档管理收尾能力）
 *
 * 设计要点：
 *   - 属主由 `x-device-token` 凭据反查得出（见 utils/device-auth.ts）；
 *     query 里的 deviceId 只在双轨兼容期作为兜底
 *   - DELETE 条件带 save_id + device_id 双条件（原子操作，无 Read-Modify-Write 竞态）；
 *     0 行命中 → 404 SAVE_NOT_FOUND（与「不存在」同响应，不泄漏他人存档存在性）
 *   - **记忆行清理必须在存档主删除成功之后**：game_events / faction_memories 没有 device_id 列，
 *     「这个 saveId 是不是你的」只能靠存档主删除的返回行数来证明。原先先清记忆再删存档，
 *     等于任何知道他人 saveId 的人都能把对方的记忆行删干净，而主删除返回的 404 还会假装已拒绝请求。
 *   - 记忆清理失败不阻断已成功的存档删除（孤儿记忆无害）
 *   - 不使用并发锁（与 saves GET 同口径）；限流走 rate-limit 的 'ai' 桶
 */

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db'
import { factionMemories, gameEvents, gameSaves } from '../../db/schema'
import { DEVICE_TOKEN_HEADER, resolveOwnerDeviceId } from '../../utils/device-auth'

const querySchema = z.object({
  saveId: z.string().uuid(),
  // 兼容期兜底：收紧后属主一律由凭据反查，此参数不再采信
  deviceId: z.string().min(1).max(64).optional()
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
          message: 'saveId 必须是 UUID 格式',
          detail: parseResult.error.issues
        }
      }
    })
  }

  const { saveId } = parseResult.data

  // 属主裁决：凭据优先，兼容期允许回落到客户端声明的 deviceId
  const owner = await resolveOwnerDeviceId(
    getHeader(event, DEVICE_TOKEN_HEADER),
    parseResult.data.deviceId
  )
  if (!owner.ok) {
    return createError({
      statusCode: owner.statusCode,
      statusMessage: owner.code,
      data: { ok: false, error: { code: owner.code, message: owner.message } }
    })
  }

  try {
    // 1. 删除存档本体（双条件原子删除：命中的那一行 device_id 即属主证明）
    const removed = await db
      .delete(gameSaves)
      .where(and(eq(gameSaves.saveId, saveId), eq(gameSaves.deviceId, owner.deviceId)))
      .returning({ saveId: gameSaves.saveId })

    if (removed.length === 0) {
      // 0 行命中：不存在 或 归属其他设备 —— 同响应，防存在性泄漏（与 GET sync-save 口径一致）
      // 必须在清理记忆之前返回，否则他人可借它擦除别人的记忆行
      return createError({
        statusCode: 404,
        statusMessage: 'SAVE_NOT_FOUND',
        data: {
          ok: false,
          error: { code: 'SAVE_NOT_FOUND', message: '云端未找到此存档' }
        }
      })
    }

    // 2. 清理该存档的记忆行（best-effort：失败仅告警，不影响已成功的存档删除）
    try {
      await db.delete(gameEvents).where(eq(gameEvents.saveId, saveId))
      await db.delete(factionMemories).where(eq(factionMemories.saveId, saveId))
    } catch (memErr) {
      console.warn(`[saves DELETE] saveId=${saveId} 记忆行清理失败（不阻断）:`, memErr)
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
