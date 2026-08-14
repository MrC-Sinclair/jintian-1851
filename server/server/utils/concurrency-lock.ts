/**
 * @file 并发锁
 *
 * 按 saveId 互斥，同一 saveId 同时只能有一个 generate-event/resolve-decision/npc-actions 进行中。
 * 进程内 Map 实现，重启失效。链式 Promise 模式保证后到的请求 await 前一个完成后再执行。
 *
 * 30 秒超时强制释放：防止 LLM 调用挂死导致 saveId 永久锁死。
 *
 * ⚠️ 实现关键：`locks.set` 必须在 `await prev` 之前，否则后续 acquire 读不到最新 chain，
 *    会导致 B/C 同时进入临界区（曾踩坑：串行测试变成 A→B-start→C-start→B-end→C-end）
 */

const LOCK_TIMEOUT_MS = 30 * 1000
const locks = new Map<string, Promise<void>>()

/**
 * 获取 saveId 锁
 * @returns release 函数，调用以释放锁。同一 saveId 的后续 acquire 会 await 前一个 release
 */
export async function acquireLock(saveId: string): Promise<() => void> {
  const prev = locks.get(saveId) ?? Promise.resolve()

  let releaseFn!: () => void
  const myRelease = new Promise<void>((resolve) => {
    releaseFn = resolve
  })

  // ⚠️ 关键：先 set 再 await，确保后续 acquire 读到最新 chain（链式排队）
  locks.set(saveId, myRelease)

  // 30s 超时兜底：prev 不 resolve 时强制继续（防止 LLM 挂死永久锁死）
  await Promise.race([
    prev.catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, LOCK_TIMEOUT_MS))
  ])

  return () => {
    // 仅当当前锁还是 myRelease 时才释放，避免误释放后续锁
    if (locks.get(saveId) === myRelease) {
      locks.delete(saveId)
    }
    releaseFn()
  }
}

/**
 * 检查 saveId 是否被锁定（测试用）
 */
export function isLocked(saveId: string): boolean {
  return locks.has(saveId)
}

/**
 * 清空所有锁（测试用）
 */
export function clearLocks(): void {
  locks.clear()
}
