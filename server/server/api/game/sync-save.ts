/**
 * @file POST/GET /api/game/sync-save — 云端存档同步
 *
 * 服务端权威 updated_at 方案：
 *   - POST：zod `.strict()` 模式拒绝 updatedAt 字段，updated_at 由 DB `NOW()` 生成
 *   - GET：按 saveId + 属主 deviceId 查询，404 if 不存在或不属于该设备
 *
 * 属主校验（防越权读写）：
 *   - 属主 deviceId 由 `x-device-token` 凭据反查得出（见 utils/device-auth.ts），
 *     **不再采信客户端自声明**；双轨兼容期允许无凭据请求回落到声明的 deviceId
 *   - POST：写入与冲突更新条件都用裁决出的属主 deviceId。这同时封掉了原先的一个注档口：
 *     客户端可以在 body 里填任意 deviceId，首插时会造出一行「归属他人」的存档
 *   - POST：`ON CONFLICT DO UPDATE` 附加 `setWhere(属主 deviceId)` 原子条件更新，
 *     冲突且设备不匹配 → 0 行更新 → 403 SAVE_FORBIDDEN（无 Read-Modify-Write 竞态窗口）
 *   - GET：WHERE 同时匹配 saveId + 属主 deviceId；不匹配与不存在统一返回 404（不泄漏他人存档存在性）
 *   - `saveData` JSONB 内的 `deviceId` 是**客户端快照**，服务端不采信，也不迁移存量值
 *
 * 限流：走独立的 'save' 桶（30 次/分钟）。
 */

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db'
import { gameSaves } from '../../db/schema'
import { DEVICE_TOKEN_HEADER, resolveOwnerDeviceId } from '../../utils/device-auth'

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
  // 年钟新增：「中兴已定」锁定年份。strict 模式下不显式声明就会把带该字段的存档整条拒掉
  zenithYear: z.number().int().positive().optional(),
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

    // 属主裁决：凭据优先。用裁决结果而非 body 自声明值写库，
    // 否则首插可以造出一行「归属任意他人 deviceId」的存档
    const owner = await resolveOwnerDeviceId(
      getHeader(event, DEVICE_TOKEN_HEADER),
      save.deviceId
    )
    if (!owner.ok) {
      return createError({
        statusCode: owner.statusCode,
        statusMessage: owner.code,
        data: { ok: false, error: { code: owner.code, message: owner.message } }
      })
    }

    try {
      // INSERT ... ON CONFLICT (save_id) DO UPDATE
      // updated_at 由 DB NOW() 强制生成，不接受客户端值
      // setWhere：冲突时仅当已有行属于同一属主才允许覆盖（原子属主校验）
      const [inserted] = await db
        .insert(gameSaves)
        .values({
          saveId: save.saveId,
          deviceId: owner.deviceId,
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
          },
          setWhere: eq(gameSaves.deviceId, owner.deviceId)
        })
        .returning({
          saveId: gameSaves.saveId,
          updatedAt: gameSaves.updatedAt,
          endedAt: gameSaves.endedAt,
          endedReason: gameSaves.endedReason
        })

      // 0 行返回 = saveId 已存在且属于其他设备（首插无冲突时必有 1 行）
      if (!inserted) {
        return createError({
          statusCode: 403,
          statusMessage: 'SAVE_FORBIDDEN',
          data: {
            ok: false,
            error: { code: 'SAVE_FORBIDDEN', message: '该存档归属于其他设备，禁止覆盖' }
          }
        })
      }

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
    const declaredDeviceId = query.deviceId as string | undefined

    if (!saveId) {
      return createError({
        statusCode: 400,
        statusMessage: 'INVALID_PARAMS',
        data: {
          ok: false,
          error: { code: 'INVALID_PARAMS', message: 'saveId 必填' }
        }
      })
    }

    // UUID 格式校验（saveId）
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(saveId)) {
      return createError({
        statusCode: 400,
        statusMessage: 'INVALID_PARAMS',
        data: { ok: false, error: { code: 'INVALID_PARAMS', message: 'saveId must be a UUID' } }
      })
    }

    // 属主裁决：凭据优先，兼容期允许回落到 query 里声明的 deviceId
    const owner = await resolveOwnerDeviceId(
      getHeader(event, DEVICE_TOKEN_HEADER),
      declaredDeviceId
    )
    if (!owner.ok) {
      return createError({
        statusCode: owner.statusCode,
        statusMessage: owner.code,
        data: { ok: false, error: { code: owner.code, message: owner.message } }
      })
    }

    try {
      // 属主校验：saveId + 属主 deviceId 双条件；不匹配与不存在统一 404（不泄漏存在性）
      const rows = await db
        .select({
          saveData: gameSaves.saveData,
          updatedAt: gameSaves.updatedAt
        })
        .from(gameSaves)
        .where(and(eq(gameSaves.saveId, saveId), eq(gameSaves.deviceId, owner.deviceId)))
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
