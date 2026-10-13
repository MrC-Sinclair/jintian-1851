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
 *
 * 另外输出备份新鲜度（`backup` / `backupAgeHours`，见 utils/backup-status.ts）：
 * cron 的失败过去只体现在退出码与 backup.log 里，没人读。这里把它变成探活即可见的状态，
 * 但**不参与状态码**——caddy 依赖本容器 healthy，让备份故障返 503 会把静态站一起卡住。
 */

import { sql } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { db } from '../db'
import { evaluateBackupStatus } from '../utils/backup-status'

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
  const backup = await readBackupVerdict()

  if (!dbUp) {
    setResponseStatus(event, 503)
    console.warn(`[health] DB 不可用: ${dbError}`)
    return {
      ok: false,
      data: {
        status: 'degraded',
        db: 'down',
        uptimeSec: uptimeSeconds(),
        probeMs,
        ...backupFields(backup)
      }
    }
  }

  return {
    ok: true,
    data: {
      status: 'ok',
      db: 'up',
      uptimeSec: uptimeSeconds(),
      probeMs,
      ...backupFields(backup)
    }
  }
})

/**
 * 读备份状态文件并判定新鲜度
 *
 * 读失败（不存在 / 无权限 / IO 错）一律归入判定函数的 `raw=null` 分支，
 * 让「备份从没跑过」和「备份跑失败了」都是可观测状态，而不是 500。
 */
async function readBackupVerdict(): Promise<ReturnType<typeof evaluateBackupStatus>> {
  const config = useRuntimeConfig()
  const file = (config.backupStatusFile as string | undefined) || ''
  const maxAgeHours = Number(config.backupMaxAgeHours)

  let raw: string | null = null
  if (file) {
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      raw = null
    }
  }
  return evaluateBackupStatus({ configured: !!file, raw, nowMs: Date.now(), maxAgeHours })
}

/**
 * 备份状态字段
 *
 * ⚠ 刻意不影响 HTTP 状态码与 `ok`：caddy 的 `depends_on: app: condition: service_healthy`
 * 会让 503 把整个静态站的启动卡住（备份坏 ≠ 服务死）。监控要判备份，就读 `backup` 字段，
 * 别只看 200 / ok:true。
 */
function backupFields(v: ReturnType<typeof evaluateBackupStatus>): Record<string, unknown> {
  const out: Record<string, unknown> = { backup: v.state, backupAgeHours: v.ageHours }
  if (v.detail) out.backupDetail = v.detail
  return out
}
