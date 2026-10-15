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
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { deviceCredentials, gameSaves } from '../db/schema'
import { logAuthEvent } from './auth-event'

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

/** 首绑需要出示的「持有证明」：只存在于云端 save_data 里、读取又要凭据的两个值 */
export interface EnrollProof {
  saveId: string
  createdAt: number
}

/** 证明闸门对该次首绑的判定结果 */
export type ProofVerdict = 'not_required' | 'ok' | 'absent' | 'mismatch'

/**
 * 判定这次首绑是否需要持有证明，以及证明是否成立
 *
 * 只对「该 deviceId 已有云端存档、却还没有凭据」的设备要求证明：
 *   - 新设备（没有存档）照常注册，不受影响；
 *   - 已注册的设备走不到这里（主键冲突 → 409），本来就防得住。
 * 存档行本身带 saveId 与 createdAt，这两值随完整 save_data 入库，而读取 save_data
 * 需要先有凭据 —— 所以它们正是"只有属主拿得到、只知 deviceId 的人拿不到"的东西。
 *
 * 不用 sha256(save_data)：属主的本地档会比云端**更新**（离线继续玩），且 JS 对象键序
 * 不保证稳定，自己人会证明不了自己。saveId/createdAt 跨分歧恒定。
 */
export async function evaluateEnrollProof(
  deviceId: string,
  proof?: EnrollProof
): Promise<ProofVerdict> {
  const [ownsSave] = await db
    .select({ one: sql`1` })
    .from(gameSaves)
    .where(eq(gameSaves.deviceId, deviceId))
    .limit(1)
  if (!ownsSave) return 'not_required'

  if (!proof) return 'absent'

  // save_id 是 unique 列，createdAt 从 jsonb 里取出来是文本，按整数比
  const [matched] = await db
    .select({ one: sql`1` })
    .from(gameSaves)
    .where(
      and(
        eq(gameSaves.deviceId, deviceId),
        eq(gameSaves.saveId, proof.saveId),
        sql`(${gameSaves.saveData} ->> 'createdAt')::bigint = ${proof.createdAt}`
      )
    )
    .limit(1)
  return matched ? 'ok' : 'mismatch'
}

/**
 * 注册设备凭据（首绑即锁）
 *
 * 并发安全：不读后写。直接 INSERT ... ON CONFLICT DO NOTHING + RETURNING，
 * 由 device_id 主键约束裁决——返回 0 行即「该 deviceId 已被绑定」，无竞态窗口。
 *
 * 持有证明的判定确实是 check-then-act（要读存档表才能决定拦不拦），这里如实标注它的
 * 竞态边界：绑定的原子性仍由主键约束保证，竞态最多让"合法属主 vs 抢绑者"其一先赢，
 * 而先赢者本来就是今天既成的事实。拒绝必须发生在插入**之前**——
 * 先绑再拒等于把设备永久锁在 409 上（明文凭据只下发一次）。
 */
export async function registerDeviceCredential(
  deviceId: string,
  proof?: EnrollProof
): Promise<RegisterResult> {
  const config = useRuntimeConfig()
  if (config.deviceAuthAllowFirstBind === false) {
    logAuthEvent('enroll_closed', deviceId)
    return {
      ok: false,
      statusCode: 403,
      code: 'ENROLLMENT_CLOSED',
      message: '设备注册已关闭，无法获取新凭据'
    }
  }

  // 判定本身在观测期也要跑（phase 1 只记不拦），否则开关打开时没有任何历史数据可比
  let verdict: ProofVerdict = 'not_required'
  try {
    verdict = await evaluateEnrollProof(deviceId, proof)
  } catch (err) {
    // 判定查询失败时**放行**而不是拒绝：拒绝会把合法属主挡在门外，
    // 而查询失败多半是数据库抖动，此时误拦比误放的代价更高（误放仍受 409 首绑即锁保护）
    console.warn('[device-auth] 持有证明判定失败，本次按不要求处理:', err)
  }
  if (verdict === 'absent') logAuthEvent('enroll_proof_absent', deviceId)
  else if (verdict === 'mismatch') logAuthEvent('enroll_proof_mismatch', deviceId)
  else if (verdict === 'ok') logAuthEvent('enroll_proof_ok', deviceId)

  if (config.deviceAuthRequirePossession === true && (verdict === 'absent' || verdict === 'mismatch')) {
    return {
      ok: false,
      statusCode: 403,
      code: 'PROOF_REQUIRED',
      message: '该设备已有云端存档，需提供 saveId 与 createdAt 以证明持有该存档'
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
    logAuthEvent('enroll_exists', deviceId)
    return {
      ok: false,
      statusCode: 409,
      code: 'CREDENTIAL_EXISTS',
      message: '该设备标识已绑定凭据，不能重复注册'
    }
  }

  logAuthEvent('enrolled', deviceId)
  // 「首绑落在已有存档的设备上」这条观测：判定阶段已经查过属主，除判定本身失败的情况
  // 外不必再查一次（verdict 非 not_required 就说明这台设备有存档）。
  // 兜底查询仍包在 try 里：观测不能换来锁死——凭据此刻已落库，而路由的 catch 会把任何
  // 抛出变成 500，明文凭据只下发一次，500 等于"已绑定却永远拿不到凭据"。
  if (verdict !== 'not_required') {
    logAuthEvent('enroll_over_existing_saves', deviceId)
  } else {
    try {
      const [alreadyHasSaves] = await db
        .select({ one: sql`1` })
        .from(gameSaves)
        .where(eq(gameSaves.deviceId, deviceId))
        .limit(1)
      if (alreadyHasSaves) logAuthEvent('enroll_over_existing_saves', deviceId)
    } catch (err) {
      console.warn('[device-auth] 首绑存在性观测查询失败（不影响已下发的凭据）:', err)
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

    if (cred) {
      logAuthEvent('owner_by_token', cred.deviceId)
      return { ok: true, deviceId: cred.deviceId, via: 'token' }
    }
    // 反查落空时手上只有坏凭据，没有可记的标识（device 字段留空）
    logAuthEvent('invalid_token')
    return {
      ok: false,
      statusCode: 401,
      code: 'INVALID_DEVICE_TOKEN',
      message: '设备凭据无效或已吊销'
    }
  }

  // 无凭据：收紧后直接拒绝
  if (config.deviceAuthEnforced === true) {
    logAuthEvent('token_required', declaredDeviceId)
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
    logAuthEvent('owner_by_compat', declaredDeviceId)
    return { ok: true, deviceId: declaredDeviceId, via: 'legacy' }
  }

  // 兼容期且什么都没声明：维持原 INVALID_PARAMS 语义（老客户端漏传参数）
  logAuthEvent('missing_identity')
  return {
    ok: false,
    statusCode: 400,
    code: 'INVALID_PARAMS',
    message: '缺少 x-device-token 请求头或 deviceId 参数'
  }
}
