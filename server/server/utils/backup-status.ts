/**
 * @file 备份新鲜度判定（纯函数，供 /api/health 与单测共用）
 *
 * 为什么要它：`backup-db.sh` 是 cron 跑的，失败只体现在退出码和 `backups/backup.log` 里，
 * 而没有任何人读日志 —— 备份静默中断是最典型的"坏得很安静"的事。把脚本每次的结果落成
 * 一个状态文件，健康端点读它，"没人盯"就变成了"任何一次探活都能发现"。
 *
 * 关键约束：**这个状态不参与 HTTP 状态码**。`deploy/docker-compose.deploy.yml` 里
 * caddy 是 `depends_on: app: condition: service_healthy`，一旦备份过期让 /api/health 返
 * 503，app 容器转 unhealthy，之后任何一次 `compose up` 都会因为等不到 healthy 而把静态站
 * 整个卡住 —— 备份坏了反而让站点起不来，比原问题更糟。所以这里只出结论，判定成 stale
 * 时状态码仍是 200，由消费方自己看 `backup` 字段（监控/人工 curl 都一样）。
 */

export type BackupState =
  /** 未配置状态文件路径（开发期默认）：不判定，也不报警 */
  | 'disabled'
  /** 配了路径但读不到文件：备份从未按新脚本跑过 */
  | 'missing'
  /** 文件存在但不是合法 JSON / 缺字段：脚本被改坏或写坏了 */
  | 'invalid'
  /** 距上次成功备份在阈值内 */
  | 'fresh'
  /** 超过阈值（含"从未成功过一次"） */
  | 'stale'

export interface BackupStatusFileShape {
  /** 最近一次尝试是否成功（与 lastSuccessAt 分开记：连续失败时 lastSuccessAt 仍是旧值） */
  ok: boolean
  lastAttemptAt: string
  lastSuccessAt: string | null
  file?: string
  bytes?: number
  error?: string | null
}

export interface BackupVerdict {
  state: BackupState
  /** 距上次成功备份的小时数；算不出时为 null */
  ageHours: number | null
  /** 一句话诊断，供排查用；不含路径与凭据 */
  detail?: string
}

const HOUR_MS = 3600_000

/** ISO 8601 且偏移必须是 `Z` 或 `±HH:MM`（`+0800` 这种无冒号形式一律不收） */
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

export function evaluateBackupStatus(input: {
  configured: boolean
  /** 状态文件内容；读不到传 null */
  raw: string | null
  nowMs: number
  maxAgeHours: number
}): BackupVerdict {
  if (!input.configured) return { state: 'disabled', ageHours: null }
  if (input.raw === null) {
    return { state: 'missing', ageHours: null, detail: '状态文件不存在或不可读，备份任务未按新脚本跑过' }
  }

  let parsed: Partial<BackupStatusFileShape>
  try {
    const json: unknown = JSON.parse(input.raw)
    // `null` / `"abc"` / `[]` 都能 parse 成功但不是对象，读字段会抛 TypeError，
    // 而健康端点每 20s 被容器探活打一次 —— 报错会一直刷
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return { state: 'invalid', ageHours: null, detail: '状态文件不是一个 JSON 对象' }
    }
    parsed = json as Partial<BackupStatusFileShape>
  } catch (err) {
    return {
      state: 'invalid',
      ageHours: null,
      detail: `状态文件解析失败：${err instanceof Error ? err.message : 'bad json'}`
    }
  }

  if (typeof parsed.ok !== 'boolean' || typeof parsed.lastAttemptAt !== 'string') {
    return { state: 'invalid', ageHours: null, detail: '状态文件缺少 ok / lastAttemptAt 字段' }
  }

  if (!parsed.lastSuccessAt) {
    return { state: 'stale', ageHours: null, detail: '从未成功完成过一次备份' }
  }

  const successMs = Date.parse(parsed.lastSuccessAt)
  // 只接受 ISO 8601 的 Z 或 ±HH:MM 形式。`+0800`（无冒号，date +%z 出来的就是这种）
  // 会被 Date.parse 按读方本地时区解释 —— 同一个字符串在不同机器上算出不同时刻，
  // 静默算错年龄比直接报错危险得多，所以宁可判 invalid。
  if (!Number.isFinite(successMs) || !ISO_8601_RE.test(parsed.lastSuccessAt)) {
    return {
      state: 'invalid',
      ageHours: null,
      detail: 'lastSuccessAt 不是可解析的 ISO 8601 时间（需 Z 或 ±HH:MM 偏移）'
    }
  }

  const ageHours = (input.nowMs - successMs) / HOUR_MS
  const max = Number.isFinite(input.maxAgeHours) && input.maxAgeHours > 0 ? input.maxAgeHours : 30

  if (ageHours > max) {
    const failNote = parsed.ok ? '' : `；最近一次尝试失败：${parsed.error || '未记录原因'}`
    return {
      state: 'stale',
      ageHours: round1(ageHours),
      detail: `距上次成功备份 ${round1(ageHours)} 小时，超过阈值 ${max} 小时${failNote}`
    }
  }

  // 新鲜但最近一次尝试失败：小时数还没超阈值就仍算 fresh，
  // 但把失败原因带出来，免得"今天成功了、昨天起一直失败"被读成完全正常
  if (!parsed.ok) {
    return {
      state: 'fresh',
      ageHours: round1(ageHours),
      detail: `最近一次尝试失败：${parsed.error || '未记录原因'}（新备份仍在上次成功的阈值内）`
    }
  }

  return { state: 'fresh', ageHours: round1(ageHours) }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
