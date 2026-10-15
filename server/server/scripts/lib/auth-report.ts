/**
 * @file [auth-event] 鉴权日志聚合（纯函数，供 auth-report CLI 与单测共用）
 *
 * 口径：
 *   - `compatShare` = owner_by_compat / (owner_by_token + owner_by_compat)
 *     —— 即"属主裁决里有多少还靠客户端自声明"。这是收紧（DEVICE_AUTH_ENFORCED=true）
 *     的判断依据，**分母只算成功裁决**，401/400/409 不参与（它们不是"在读存档"）。
 *   - `byKind` 保留全部事件类型计数，401 分布看 invalid_token / token_required。
 *   - `enroll_over_existing_saves` 只在计数 >0 时才列出来（formatReport 的既有规则）：
 *     它是报警线而不是归零线——出现就该去翻那台掩码设备，不出现是正常状态。
 *   - 解析容错：非 `[auth-event]` 前缀、JSON 不合法、kind 不在白名单的行一律跳过
 *     （日志里混着 http 访问日志、其它模块日志是常态，不能因此报错）。
 */

/** 与 utils/auth-event.ts 的 AUTH_EVENT_KINDS 对齐（白名单外视为脏行） */
export const KNOWN_AUTH_KINDS = [
  'owner_by_token',
  'owner_by_compat',
  'invalid_token',
  'token_required',
  'missing_identity',
  'enrolled',
  'enroll_over_existing_saves',
  'enroll_exists',
  'enroll_closed'
] as const

const PREFIX = '[auth-event] '

export interface AuthEvent {
  ts: string
  kind: string
  device: string
}

export interface AuthSummary {
  /** 参与统计的事件行数（不含跳过的脏行） */
  total: number
  byKind: Record<string, number>
  /** 成功裁决里兼容通道占比；无成功裁决时为 null（不给 0，避免读成"已归零"） */
  compatShare: number | null
  /** 出现过的（掩码）设备数前缀，只能做量级参考：8 位前缀理论上可撞 */
  distinctDevicePrefixes: number
  firstTs: string | null
  lastTs: string | null
}

/** 从任意文本行里挑出鉴权事件；脏行跳过 */
export function parseAuthLines(lines: string[]): AuthEvent[] {
  const out: AuthEvent[] = []
  for (const line of lines) {
    const idx = line.indexOf(PREFIX)
    if (idx === -1) continue
    const raw = line.slice(idx + PREFIX.length).trim()
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const e = parsed as Record<string, unknown>
    if (typeof e.kind !== 'string' || !KNOWN_AUTH_KINDS.includes(e.kind as never)) continue
    out.push({
      ts: typeof e.ts === 'string' ? e.ts : '',
      kind: e.kind,
      device: typeof e.device === 'string' ? e.device : ''
    })
  }
  return out
}

export function summarize(events: AuthEvent[]): AuthSummary {
  const byKind: Record<string, number> = {}
  const devices = new Set<string>()
  let firstTs: string | null = null
  let lastTs: string | null = null

  for (const e of events) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1
    if (e.device) devices.add(e.device)
    if (e.ts) {
      if (!firstTs || e.ts < firstTs) firstTs = e.ts
      if (!lastTs || e.ts > lastTs) lastTs = e.ts
    }
  }

  const byToken = byKind.owner_by_token ?? 0
  const byCompat = byKind.owner_by_compat ?? 0
  const decided = byToken + byCompat

  return {
    total: events.length,
    byKind,
    compatShare: decided === 0 ? null : byCompat / decided,
    distinctDevicePrefixes: devices.size,
    firstTs,
    lastTs
  }
}

/**
 * 收紧判据（三态，别把"没样本"读成"已归零"）：
 *   - resolved：有成功裁决且兼容通道为 0 → 可以收紧
 *   - pending：兼容通道仍有流量 → 还不能收紧
 *   - no_data：窗口内没有任何成功裁决（全是 401/400/注册）→ 无从判断，同样不能收紧
 */
export function compatVerdict(s: AuthSummary): {
  status: 'resolved' | 'pending' | 'no_data'
  compatCount: number
} {
  const compatCount = s.byKind.owner_by_compat ?? 0
  if (s.compatShare === null) return { status: 'no_data', compatCount }
  if (s.compatShare === 0) return { status: 'resolved', compatCount: 0 }
  return { status: 'pending', compatCount }
}

/** 人读报告 */
export function formatReport(s: AuthSummary): string {
  const lines: string[] = []
  lines.push(`[auth-report] 事件 ${s.total} 条` + (s.firstTs ? ` 区间 ${s.firstTs} → ${s.lastTs}` : ''))
  for (const kind of KNOWN_AUTH_KINDS) {
    const n = s.byKind[kind] ?? 0
    if (n > 0 || kind === 'owner_by_compat') lines.push(`  ${kind.padEnd(18)} ${n}`)
  }
  if (s.compatShare === null) {
    lines.push('  兼容通道占比：无成功裁决样本，无法判断（别当成已归零）')
  } else {
    lines.push(`  兼容通道占比 ${(s.compatShare * 100).toFixed(2)}%`)
  }
  lines.push(`  涉及设备前缀数 ${s.distinctDevicePrefixes}（8 位掩码，仅作量级参考）`)
  return lines.join('\n')
}
