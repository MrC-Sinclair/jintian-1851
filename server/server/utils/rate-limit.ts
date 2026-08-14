/**
 * @file 简易频率限制
 *
 * 进程内 Map<deviceId, { count, resetAt }>，按 deviceId 每分钟最多 10 次 AI 调用。
 * 仅对 /api/game/ 下 AI 端点生效（init-factions、generate-event、resolve-decision、npc-actions、advisor-chat、advisor-briefing，共 6 个）。
 * sync-save 不限制（非 AI 调用）。
 *
 * 进程内实现：单实例 MVP 足够，多实例需换 Redis。
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

const MAX_REQUESTS_PER_MINUTE = 10
const WINDOW_MS = 60 * 1000

const buckets = new Map<string, RateLimitEntry>()

/** 触发频率限制的 AI 端点路径前缀（sync-save 不在其中） */
const AI_ENDPOINT_PREFIX = '/api/game/'
const SYNC_SAVE_PATH = '/api/game/sync-save'

/**
 * 检查请求是否应被频率限制
 * @returns true 表示限制（拒绝），false 表示放行
 */
export function isRateLimited(deviceId: string, now: number = Date.now()): boolean {
  const entry = buckets.get(deviceId)

  if (!entry || now > entry.resetAt) {
    // 新窗口
    buckets.set(deviceId, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }

  if (entry.count >= MAX_REQUESTS_PER_MINUTE) {
    return true
  }

  entry.count++
  return false
}

/**
 * 判断路径是否需要频率限制
 * 仅 /api/game/ 下非 sync-save 的 AI 端点需要
 */
export function shouldRateLimit(path: string): boolean {
  if (!path.startsWith(AI_ENDPOINT_PREFIX)) return false
  if (path === SYNC_SAVE_PATH || path.startsWith(SYNC_SAVE_PATH + '?')) return false
  return true
}

/**
 * 获取剩余次数（调试用）
 */
export function getRemaining(deviceId: string, now: number = Date.now()): number {
  const entry = buckets.get(deviceId)
  if (!entry || now > entry.resetAt) return MAX_REQUESTS_PER_MINUTE
  return Math.max(0, MAX_REQUESTS_PER_MINUTE - entry.count)
}

/**
 * 清空所有计数（测试用）
 */
export function clearRateLimit(): void {
  buckets.clear()
}
