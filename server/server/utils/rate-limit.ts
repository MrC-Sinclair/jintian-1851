/**
 * @file 简易频率限制
 *
 * 进程内 Map<bucketKey, { count, resetAt }>，按 deviceId 分桶计数。
 *
 * 两个桶（刻意分开，不共用一个计数器）：
 *   - 'ai'   ：7 个 AI 端点 + 存档读写，10 次/分钟
 *   - 'save' ：sync-save，30 次/分钟
 * 分桶的原因是正常一回合就要发 generate-event / advisor-briefing / npc-actions /
 * resolve-decision / sync-save 共 4-5 个请求，若把 sync-save 也塞进 10 次/分钟的桶，
 * 手快的玩家两三个回合就会被 429 卡住；而完全不限 sync-save 又留下真实风险：
 * 它是唯一无上限的写端点，每次带一个新 saveId 就插一行，可被用来把 44G 的盘写满。
 *
 * 进程内实现：单实例 MVP 足够，多实例需换 Redis。
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

/** 限流桶类型 */
export type RateBucket = 'ai' | 'save'

const LIMITS: Record<RateBucket, number> = { ai: 10, save: 30 }
const WINDOW_MS = 60 * 1000

const buckets = new Map<string, RateLimitEntry>()

const API_GAME_PREFIX = '/api/game/'
const SYNC_SAVE_PATH = '/api/game/sync-save'

/** 去掉 query 后判断是否 sync-save 路径 */
function isSyncSavePath(path: string): boolean {
  return path === SYNC_SAVE_PATH || path.startsWith(SYNC_SAVE_PATH + '?')
}

/**
 * 该路径属于哪个限流桶；null 表示不限流（非 /api/game/ 下的路径、静态资源等）
 *
 * 注意 /api/game/saves 与 /api/game/saves?saveId= 走的是 'ai' 桶：
 * 它们同样能批量读删数据，且正常客户端每分钟远不到 10 次。
 */
export function getRateBucket(path: string): RateBucket | null {
  if (!path.startsWith(API_GAME_PREFIX)) return null
  if (isSyncSavePath(path)) return 'save'
  return 'ai'
}

/**
 * 检查请求是否应被频率限制
 * @returns true 表示限制（拒绝），false 表示放行
 */
export function isRateLimited(
  deviceId: string,
  now: number = Date.now(),
  bucket: RateBucket = 'ai'
): boolean {
  const key = `${deviceId}::${bucket}`
  const limit = LIMITS[bucket]
  const entry = buckets.get(key)

  if (!entry || now > entry.resetAt) {
    // 新窗口
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }

  if (entry.count >= limit) {
    return true
  }

  entry.count++
  return false
}

/**
 * 获取剩余次数（调试用）
 */
export function getRemaining(
  deviceId: string,
  now: number = Date.now(),
  bucket: RateBucket = 'ai'
): number {
  const limit = LIMITS[bucket]
  const entry = buckets.get(`${deviceId}::${bucket}`)
  if (!entry || now > entry.resetAt) return limit
  return Math.max(0, limit - entry.count)
}

/**
 * 清空所有计数（测试用）
 */
export function clearRateLimit(): void {
  buckets.clear()
}
