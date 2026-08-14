/**
 * @file 频率限制中间件
 *
 * 仅对 /api/game/ 下 AI 端点生效（init-factions、generate-event、resolve-decision、npc-actions、advisor-chat、advisor-briefing，共 6 个）。
 * sync-save 不限制。
 *
 * 通过请求头 x-device-id 识别设备，缺失时返回 400。
 */

import { isRateLimited, shouldRateLimit } from '../utils/rate-limit'

export default defineEventHandler((event) => {
  const path = event.path || ''
  if (!shouldRateLimit(path)) return

  const deviceId = getHeader(event, 'x-device-id')
  if (!deviceId) {
    setResponseStatus(event, 400)
    return {
      ok: false,
      error: { code: 'MISSING_DEVICE_ID', message: '缺少 x-device-id 请求头' }
    }
  }

  if (isRateLimited(deviceId)) {
    setResponseStatus(event, 429)
    return {
      ok: false,
      error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' }
    }
  }
})
