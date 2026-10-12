/**
 * @file POST /api/game/device-credential — 注册设备凭据（存档归属鉴权）
 *
 * 语义：一个 deviceId 只能成功注册一次（首绑即锁）。
 *   - 未绑定过 → 服务端生成 256bit 凭据，**仅此一次**在响应里返回明文，库里只存 sha256
 *   - 已绑定过 → 409 CREDENTIAL_EXISTS（含被吊销的设备，吊销即封禁，不再发凭据）
 *
 * 安全边界（诚实标注）：本接口防的是「事后冒领」——攻击者获知他人 deviceId 后换不到凭据。
 * 它防不住「首个声明者」：兼容期任何人都能替未注册的 deviceId 抢下绑定。
 * 这是「不要求老玩家重装、存量存档无损归属」的对价，靠 `deviceAuthAllowFirstBind`
 * 在迁移完成后关闭注册来收窄窗口。彻底解决需要真实身份（微信 openid），不属本次范围。
 *
 * 限流：走独立的 `auth` 桶（见 utils/rate-limit.ts），防止被脚本扫库式注册。
 */

import { z } from 'zod'
import { registerDeviceCredential } from '../../utils/device-auth'

const bodySchema = z.strictObject({
  deviceId: z.string().uuid()
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
    const result = await registerDeviceCredential(parsed.data.deviceId)
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
