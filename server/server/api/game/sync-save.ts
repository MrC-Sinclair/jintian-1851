/**
 * @file POST/GET /api/game/sync-save — 云端存档同步
 *
 * 服务端权威 updated_at 方案：
 *   - POST：zod `.strict()` 模式拒绝 updatedAt 字段，updated_at 由 DB `NOW()` 生成
 *   - GET：按 saveId 查询，404 if 不存在
 *
 * 注意：sync-save 不受 rate-limit 中间件限制（非 AI 调用）。
 */

import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db'
import { gameSaves } from '../../db/schema'

// ====================== POST：上传/覆盖存档 ======================

/**
 * GameSave zod schema（strict 模式，拒绝 updatedAt）
 *
 * 关键：不含 updatedAt 字段，从源头消除两设备并发 race
 */
const saveDataSchema = z.strictObject({
  // v1（原版存档）与 v2（扩充事件引擎：新增 pendingChainNodes/completedChainIds/activeChainIds）均接受
  saveVersion: z.union([z.literal(1), z.literal(2)]),
  saveId: z.string().uuid(),
  deviceId: z.string().min(1),
  createdAt: z.number(),
  // ⚠️ updatedAt 不接受客户端值（strict 模式拒绝）
  character: z.object({
    background: z.enum(['文官', '武将', '商贾', '士绅', '宗室']),
    backgroundPerks: z.record(z.string(), z.number()),
    factionId: z.string().min(1),
    factionName: z.string().min(1),
    factionSummary: z.string()
  }),
  state: z.object({
    turn: z.number().int().positive(),
    date: z.object({ year: z.number().int(), month: z.number().int().min(1).max(12) }),
    attributes: z.object({
      military: z.number(),
      economy: z.number(),
      politics: z.number(),
      people: z.number(),
      diplomacy: z.number()
    }),
    resources: z.object({
      silver: z.number(),
      troops: z.number(),
      food: z.number(),
      reputation: z.number()
    })
  }),
  factions: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        summary: z.string(),
        power: z.number(),
        relationship: z.number(),
        status: z.enum(['active', 'destroyed', 'allied'])
      })
    )
    .min(1),
  events: z.array(z.any()),
  advisorMessages: z.array(z.any()),
  // v2 新增：剧情链运行时状态（strict 模式下必须显式声明，否则 v2 存档被拒）
  pendingChainNodes: z
    .array(
      z.object({
        chainId: z.string().min(1),
        nodeId: z.string().min(1),
        scheduledTurn: z.number().int().positive()
      })
    )
    .default([]),
  completedChainIds: z.array(z.string()).default([]),
  activeChainIds: z.array(z.string()).default([]),
  ended: z.boolean(),
  endedAt: z.number().nullable().optional(),
  endedReason: z.string().nullable().optional()
})

/**
 * 提取错误字段名（zod 错误路径拼接）
 */
function formatZodError(errors: z.ZodError): string {
  return errors.issues
    .map((i) => {
      const path = i.path.join('.') || '(root)'
      return `${path}: ${i.message}`
    })
    .join('; ')
}

export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  // ====================== POST：上传/覆盖 ======================
  if (method === 'POST') {
    let body: unknown
    try {
      body = await readBody(event)
    } catch {
      return createError({
        statusCode: 400,
        statusMessage: 'INVALID_PARAMS',
        data: { ok: false, error: { code: 'INVALID_PARAMS', message: '请求体解析失败' } }
      })
    }

    const parseResult = saveDataSchema.safeParse(body)
    if (!parseResult.success) {
      // 区分 updatedAt 字段被拒绝的情况
      const isUpdatedAtRejected = parseResult.error.issues.some(
        (i) => i.code === 'unrecognized_keys' && i.keys.includes('updatedAt')
      )
      const message = isUpdatedAtRejected
        ? 'updatedAt is not allowed (server-authoritative)'
        : formatZodError(parseResult.error)
      return createError({
        statusCode: 400,
        statusMessage: 'INVALID_PARAMS',
        data: {
          ok: false,
          error: {
            code: 'INVALID_PARAMS',
            message,
            detail: parseResult.error.issues
          }
        }
      })
    }

    const save = parseResult.data

    try {
      // INSERT ... ON CONFLICT (save_id) DO UPDATE
      // updated_at 由 DB NOW() 强制生成，不接受客户端值
      const [inserted] = await db
        .insert(gameSaves)
        .values({
          saveId: save.saveId,
          deviceId: save.deviceId,
          saveData: save,
          saveVersion: save.saveVersion,
          endedAt: save.endedAt ? new Date(save.endedAt) : null,
          endedReason: save.endedReason ?? null
        })
        .onConflictDoUpdate({
          target: gameSaves.saveId,
          set: {
            saveData: save,
            saveVersion: save.saveVersion,
            updatedAt: new Date(), // 强制服务端时间
            endedAt: save.endedAt ? new Date(save.endedAt) : null,
            endedReason: save.endedReason ?? null
          }
        })
        .returning({
          saveId: gameSaves.saveId,
          updatedAt: gameSaves.updatedAt,
          endedAt: gameSaves.endedAt,
          endedReason: gameSaves.endedReason
        })

      return {
        ok: true,
        data: {
          saveId: inserted.saveId,
          updatedAt: inserted.updatedAt.getTime(),
          endedAt: inserted.endedAt ? inserted.endedAt.getTime() : null,
          endedReason: inserted.endedReason
        }
      }
    } catch (err) {
      console.error('[sync-save POST] DB error:', err)
      return createError({
        statusCode: 500,
        statusMessage: 'DB_ERROR',
        data: { ok: false, error: { code: 'DB_ERROR', message: '存档写入失败' } }
      })
    }
  }

  // ====================== GET：拉取存档 ======================
  if (method === 'GET') {
    const query = getQuery(event)
    const saveId = query.saveId as string | undefined

    if (!saveId) {
      return createError({
        statusCode: 400,
        statusMessage: 'INVALID_PARAMS',
        data: { ok: false, error: { code: 'INVALID_PARAMS', message: 'saveId must be a UUID' } }
      })
    }

    // UUID 格式校验
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(saveId)) {
      return createError({
        statusCode: 400,
        statusMessage: 'INVALID_PARAMS',
        data: { ok: false, error: { code: 'INVALID_PARAMS', message: 'saveId must be a UUID' } }
      })
    }

    try {
      const rows = await db
        .select({
          saveData: gameSaves.saveData,
          updatedAt: gameSaves.updatedAt
        })
        .from(gameSaves)
        .where(eq(gameSaves.saveId, saveId))
        .limit(1)

      if (rows.length === 0) {
        return createError({
          statusCode: 404,
          statusMessage: 'SAVE_NOT_FOUND',
          data: { ok: false, error: { code: 'SAVE_NOT_FOUND', message: '云端未找到此存档' } }
        })
      }

      return {
        ok: true,
        data: {
          save: rows[0].saveData,
          updatedAt: rows[0].updatedAt.getTime()
        }
      }
    } catch (err) {
      console.error('[sync-save GET] DB error:', err)
      return createError({
        statusCode: 500,
        statusMessage: 'DB_ERROR',
        data: { ok: false, error: { code: 'DB_ERROR', message: '存档查询失败' } }
      })
    }
  }

  // 其他方法不支持
  return createError({
    statusCode: 405,
    statusMessage: 'METHOD_NOT_ALLOWED',
    data: { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 POST/GET' } }
  })
})
