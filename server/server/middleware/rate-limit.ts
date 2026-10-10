/**
 * @file 频率限制中间件
 *
 * 对 /api/game/ 下的端点分桶限流（桶的划分与理由见 utils/rate-limit.ts）：
 *   - 'ai'（10 次/分钟）：7 个 AI 端点 + 存档读写 saves
 *   - 'save'（30 次/分钟）：sync-save —— 此前完全不限流，是唯一无上限的写端点
 *
 * 通过请求头 x-device-id 识别设备，缺失时返回 400。
 */

import { getRateBucket, isRateLimited } from '../utils/rate-limit'

export default defineEventHandler((event) => {
  const path = event.path || ''
  const bucket = getRateBucket(path)
  if (!bucket) return

  const deviceId = getHeader(event, 'x-device-id')
  if (!deviceId) {
    setResponseStatus(event, 400)
    return {
      ok: false,
      error: { code: 'MISSING_DEVICE_ID', message: '缺少 x-device-id 请求头' }
    }
  }

  if (isRateLimited(deviceId, undefined, bucket)) {
    setResponseStatus(event, 429)
    return {
      ok: false,
      error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' }
    }
  }
})
