/**
 * @file AI 响应进程内缓存
 *
 * 用于 generate-event 等接口的 5 分钟缓存，避免相同 stateSnapshot 重复调用 LLM。
 * 进程内 Map 实现，重启失效（MVP 单实例足够，多实例需换 Redis）。
 *
 * 缓存键由调用方计算（如 sha256(saveId + turn + sha256(stateSnapshot))），
 * 本模块只负责存取与 TTL 过期判断。
 */

interface CacheEntry<T> {
  result: T
  expireAt: number
}

const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 分钟

const cache = new Map<string, CacheEntry<unknown>>()

/**
 * 读取缓存
 * @param key 缓存键
 * @returns 命中返回结果，未命中或已过期返回 undefined
 */
export function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expireAt) {
    cache.delete(key)
    return undefined
  }
  return entry.result as T
}

/**
 * 写入缓存
 * @param key 缓存键
 * @param result 缓存结果
 * @param ttlMs TTL 毫秒，默认 5 分钟
 */
export function setCached<T>(key: string, result: T, ttlMs: number = DEFAULT_TTL_MS): void {
  cache.set(key, { result, expireAt: Date.now() + ttlMs })
}

/**
 * 清空所有缓存（测试用）
 */
export function clearCache(): void {
  cache.clear()
}

/**
 * 获取缓存大小（测试/调试用）
 */
export function getCacheSize(): number {
  return cache.size
}
