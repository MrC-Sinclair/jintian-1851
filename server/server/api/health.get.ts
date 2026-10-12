/**
 * @file GET /api/health — 存活与依赖就绪探针
 *
 * 为什么放 `/api/health` 而不是裸 `/health`：
 *   Caddy 只把 `/api/*` 反代到 app（`deploy/Caddyfile`），裸 `/health` 会被静态站点的
 *   `try_files` 兜成 index.html —— 容器内探活能过，但从外部/域名侧探不到真实状态。
 *
 * 为什么要查 DB（原计划写「不查 DB」被推翻）：
 *   容器 healthcheck 此前打 `/api/game/saves`，而那个请求在 rate-limit 中间件里
 *   就因为缺 `x-device-id` 直接返 400 了 —— 连 DB 都没碰，「任意 HTTP 响应即存活」
 *   实际测的是「node 进程还在监听」。postgres 挂了容器仍然是 healthy，属于无声故障。
 *   本端点用 `select 1` 真查一次，DB 不可用时返回 **503**，让 `docker ps` 的 unhealthy
 *   成为可用的告警钩子（当前没有任何监控系统，容器状态是唯一能自动发现故障的信号面）。
 *
 * 不会引发重启风暴：compose 里没有 autoheal 之类的东西，unhealthy 只是状态标记；
 * 且 `depends_on: condition: service_healthy` 只作用于启动顺序。
 */

import { sql } from 'drizzle-orm'
import { db } from '../db'

/**
 * DB 探针超时（毫秒）。必须明显小于容器 healthcheck 的 timeout，
 * 否则探针卡住会让 Docker 把「慢」误判成「死」。
 */
const DB_PROBE_TIMEOUT_MS = 3000

/** 进程启动至今的秒数（Nitro/node 环境下 process.uptime 一定存在） */
function uptimeSeconds(): number {
  return Math.floor(process.uptime())
}

/**
 * 给探针加超时：只用于「读一次常量」，不取消底层查询，
 * postgres-js 的连接会在自身超时后释放，2C2G 上多等一次 select 1 不构成泄漏。
 */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DB_PROBE_TIMEOUT')), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()

  let dbUp = true
  let dbError: string | undefined
  try {
    await withTimeout(
      db.execute(sql.raw('select 1')) as unknown as Promise<unknown>,
      DB_PROBE_TIMEOUT_MS
    )
  } catch (err) {
    dbUp = false
    // 只记类型与 message，不打印堆栈：探针每分钟跑一次，日志会被噪音淹没
    dbError = err instanceof Error ? err.message : String(err)
  }

  const probeMs = Date.now() - startedAt

  if (!dbUp) {
    setResponseStatus(event, 503)
    console.warn(`[health] DB 不可用: ${dbError}`)
    return {
      ok: false,
      data: {
        status: 'degraded',
        db: 'down',
        uptimeSec: uptimeSeconds(),
        probeMs
      }
    }
  }

  return {
    ok: true,
    data: {
      status: 'ok',
      db: 'up',
      uptimeSec: uptimeSeconds(),
      probeMs
    }
  }
})
