/**
 * @file 设备凭据与存档属主解析（存档归属鉴权）
 *
 * 解决的问题：`game_saves.device_id` 此前是「客户端自声明即凭证」——
 * 三个存档端点直接把请求里的 deviceId 当身份拿去查库，
 * 报上别人的 deviceId 就能列出/读取/删除其全部存档。
 *
 * 方案（设备注册换发凭据）：
 *   1. 客户端用 deviceId 调 `POST /api/game/device-credential` 注册一次
 *   2. 服务端生成 256bit 随机明文凭据下发（只在这一次返回），库里只存 sha256
 *   3. 此后请求带 `x-device-token`，服务端按 hash 反查出**权威 deviceId**
 *   4. 已绑定的 deviceId 拒绝重复注册 → 事后获知他人 deviceId 的人换不到凭据，也就无法访问
 *
 * 为什么用 bearer 凭据而不是「HMAC 请求签名」：
 * 小程序端没有 Web Crypto（`game-web/src/utils/device-id.ts` 为 crypto.randomUUID
 * 写 Math.random 兜底就是因为这个），做签名要引入 crypto-js 之类的纯 JS 依赖，
 * 而收益（防重放）在本场景不关键——存档操作本身是幂等覆盖，重放不额外造成损害。
 *
 * 双轨迁移（`deviceAuthEnforced=false` 为默认，即兼容期）：
 *   - 带有效凭据 → 按凭据反查的 deviceId 裁决
 *   - 不带凭据但带 deviceId（老客户端）→ 放行并打 `[auth-compat]` 日志，据此观察残余流量
 *   - 带**无效**凭据 → 一律 401，不静默降级（否则冒领尝试会被兼容逻辑吞掉，排查不到）
 *   观察期内 `[auth-compat]` 归零后把 `DEVICE_AUTH_ENFORCED=true` 关掉旧通道。
 */

import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { deviceCredentials } from '../db/schema'

/** 凭据请求头名（与前端 utils/device-credential.ts 约定一致） */
export const DEVICE_TOKEN_HEADER = 'x-device-token'

/** 注册错误码 → HTTP 状态码 */
type RegisterFailure = {
  ok: false
  statusCode: number
  code: string
  message: string
}

export type RegisterResult =
  | { ok: true; deviceId: string; secret: string }
  | RegisterFailure

/** 属主解析结果 */
export type OwnerResolution =
  | { ok: true; deviceId: string; via: 'token' | 'legacy' }
  | { ok: false; statusCode: number; code: string; message: string }

/** 明文凭据 → sha256 十六进制（库里只存这个，拖库也拿不到可用凭据） */
export function hashDeviceSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/** 生成服务端权威凭据：32 字节 CSPRNG，十六进制 64 字符 */
export function generateDeviceSecret(): string {
  return randomBytes(32).toString('hex')
}

/**
 * 注册设备凭据（首绑即锁）
 *
 * 并发安全：不读后写。直接 INSERT ... ON CONFLICT DO NOTHING + RETURNING，
 * 由 device_id 主键约束裁决——返回 0 行即「该 deviceId 已被绑定」，无竞态窗口。
 */
export async function registerDeviceCredential(deviceId: string): Promise<RegisterResult> {
  const config = useRuntimeConfig()
  if (config.deviceAuthAllowFirstBind === false) {
    return {
      ok: false,
      statusCode: 403,
      code: 'ENROLLMENT_CLOSED',
      message: '设备注册已关闭，无法获取新凭据'
    }
  }

  const secret = generateDeviceSecret()
  const [row] = await db
    .insert(deviceCredentials)
    .values({ deviceId, secretHash: hashDeviceSecret(secret) })
    .onConflictDoNothing()
    .returning({ deviceId: deviceCredentials.deviceId })

  if (!row) {
    // 含两种情况：正常重复注册（冒领）/ 该设备已被吊销。两者都不再发凭据。
    return {
      ok: false,
      statusCode: 409,
      code: 'CREDENTIAL_EXISTS',
      message: '该设备标识已绑定凭据，不能重复注册'
    }
  }

  return { ok: true, deviceId, secret }
}

/**
 * 解析请求的权威属主 deviceId
 *
 * @param presentedToken `x-device-token` 头的值（可为 undefined）
 * @param declaredDeviceId 客户端自声明的 deviceId（query/body 里的值，兼容期才采信）
 */
export async function resolveOwnerDeviceId(
  presentedToken: string | undefined,
  declaredDeviceId?: string | null
): Promise<OwnerResolution> {
  const config = useRuntimeConfig()

  if (presentedToken) {
    const [cred] = await db
      .select({ deviceId: deviceCredentials.deviceId })
      .from(deviceCredentials)
      .where(
        and(
          eq(deviceCredentials.secretHash, hashDeviceSecret(presentedToken)),
          isNull(deviceCredentials.revokedAt)
        )
      )
      .limit(1)

    if (cred) return { ok: true, deviceId: cred.deviceId, via: 'token' }
    return {
      ok: false,
      statusCode: 401,
      code: 'INVALID_DEVICE_TOKEN',
      message: '设备凭据无效或已吊销'
    }
  }

  // 无凭据：收紧后直接拒绝
  if (config.deviceAuthEnforced === true) {
    return {
      ok: false,
      statusCode: 401,
      code: 'DEVICE_TOKEN_REQUIRED',
      message: '缺少 x-device-token 请求头'
    }
  }

  // 兼容期：沿用客户端声明（与收紧前行为一致）
  if (declaredDeviceId) {
    // 只记前 8 位：deviceId 本身是敏感标识，日志不该把它完整落盘
    console.log(`[auth-compat] deviceId=${declaredDeviceId.slice(0, 8)}*** 走无凭据旧通道`)
    return { ok: true, deviceId: declaredDeviceId, via: 'legacy' }
  }

  // 兼容期且什么都没声明：维持原 INVALID_PARAMS 语义（老客户端漏传参数）
  return {
    ok: false,
    statusCode: 400,
    code: 'INVALID_PARAMS',
    message: '缺少 x-device-token 请求头或 deviceId 参数'
  }
}
