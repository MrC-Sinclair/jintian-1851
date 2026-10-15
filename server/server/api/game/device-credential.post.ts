/**
 * @file POST /api/game/device-credential — 注册设备凭据（存档归属鉴权）
 *
 * 语义：一个 deviceId 只能成功注册一次（首绑即锁）。
 *   - 未绑定过 → 服务端生成 256bit 凭据，**仅此一次**在响应里返回明文，库里只存 sha256
 *   - 已绑定过 → 409 CREDENTIAL_EXISTS（含被吊销的设备，吊销即封禁，不再发凭据）
 *
 * 安全边界（诚实标注）：本接口防的是「事后冒领」——攻击者获知他人 deviceId 后换不到凭据。
 * 它防不住「首个声明者」：任何人都能替尚未注册的 deviceId 抢下绑定。
 *
 * 收窄这条窗口的办法**不是**关闭注册（`allowFirstBind=false` 的代价是所有新装用户从此
 * 用不了云端同步，而不只是挡住抢注者）。改成定向闸门：`requirePossession=true` 时，只有
 * 「该 deviceId 已有云端存档却还没凭据」这类首绑必须出示 `proof`（saveId + createdAt）
 * 证明持有该存档——这两个值只存在于云端 save_data 里，而读 save_data 需要先有凭据，
 * 所以恰好是"只知 deviceId 的人拿不到、真属主一定拿得到"的东西。
 *
 * 默认关闭（phase 1 只观测不拦截）：先跑出一个 verdict 分布，确认合法属主都能出示证明，
 * 再翻开开关。判定查询失败时按"不要求"放行——误拦真人比误放更糟，且误放仍有 409 兜底。
 * 彻底解决需要真实身份（微信 openid），不属本次范围。
 *
 * 限流：走独立的 `auth` 桶（见 utils/rate-limit.ts），防止被脚本扫库式注册。
 */

import { z } from 'zod'
import { registerDeviceCredential } from '../../utils/device-auth'

const bodySchema = z.strictObject({
  deviceId: z.string().uuid(),
  /**
   * 持有证明（可选）：该 deviceId 已有云端存档却还没凭据时才用得上。
   * 观测期（DEVICE_AUTH_REQUIRE_POSSESSION=false）带着不拦、不带也不拦，
   * 只把判定记进 [auth-event]；开关打开后缺证明或证明不符 → 403 PROOF_REQUIRED
   */
  proof: z
    .object({
      saveId: z.string().uuid(),
      createdAt: z.number().int()
    })
    .optional()
})

export default defineEventHandler(async (event) => {
  if (getMethod(event) !== 'POST') {
    return createError({
      statusCode: 405,
      statusMessage: 'METHOD_NOT_ALLOWED',
      data: { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 POST' } }
    })
  }

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

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return createError({
      statusCode: 400,
      statusMessage: 'INVALID_PARAMS',
      data: {
        ok: false,
        error: {
          code: 'INVALID_PARAMS',
          message: 'deviceId 必须是 UUID',
          detail: parsed.error.issues
        }
      }
    })
  }

  try {
    const result = await registerDeviceCredential(parsed.data.deviceId, parsed.data.proof)
    if (!result.ok) {
      return createError({
        statusCode: result.statusCode,
        statusMessage: result.code,
        data: { ok: false, error: { code: result.code, message: result.message } }
      })
    }
    return { ok: true, data: { deviceId: result.deviceId, token: result.secret } }
  } catch (err) {
    console.error('[device-credential POST] DB error:', err)
    return createError({
      statusCode: 500,
      statusMessage: 'DB_ERROR',
      data: { ok: false, error: { code: 'DB_ERROR', message: '设备凭据注册失败' } }
    })
  }
})
