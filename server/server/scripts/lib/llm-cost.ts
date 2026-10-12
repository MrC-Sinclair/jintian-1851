/**
 * @file [llm-usage] 日志的成本聚合（纯函数，供 CLI 与单测共用）
 *
 * 数据源是 `server/utils/llm-usage.ts` 输出的单行 JSON 日志：
 *   [llm-usage] {"endpoint":"generate-event","inputTokens":1500,"outputTokens":600,"totalTokens":2100,"saveId":"…","turn":3,"attempt":1}
 * `docker logs --timestamps jintian-api` 会在行首加 RFC3339 时间戳，本模块能自动识别并按天分桶。
 *
 * 成本口径与 docs/ai-cost.md 对齐：
 *   - 单价默认 ¥0.35 / 1M tokens（Qwen3-8B 输入输出统一价），可用 --price-per-mtok 覆盖
 *   - 「单局成本」用带 saveId 的记录折算（docs 里的 ¥0.111/局 就是这个口径），
 *     不带 saveId 的端点（init-factions、advisor-briefing）计入总量但不计入单局，
 *     所以报告里同时给出「可归因占比」，避免把归因缺口当成省钱
 */

/** 一条 [llm-usage] 记录 */
export interface UsageRecord {
  endpoint: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** 缺 saveId 时无法归因到某一局 */
  saveId?: string
  turn?: number
  /** 有时间戳才参与按天分桶 */
  date?: string
  [key: string]: unknown
}

export interface EndpointSummary {
  endpoint: string
  calls: number
  totalTokens: number
  costCny: number
}

export interface DaySummary {
  date: string
  calls: number
  totalTokens: number
  costCny: number
}

export interface CostSummary {
  /** 成功解析的记录数 */
  records: number
  /** 含 [llm-usage] 但 JSON 解析失败或缺 totalTokens 的行数 */
  unparsed: number
  /** 是否识别到行首时间戳（决定按天表是否有意义） */
  hasTimestamps: boolean
  totalTokens: number
  totalCostCny: number
  pricePerMTok: number
  byEndpoint: EndpointSummary[]
  byDay: DaySummary[]
  /** 带 saveId 的成本合计与涉及的存档数 */
  attributableCostCny: number
  games: number
  costPerGameCny: number
  /** 有 saveId 的记录占总记录的比例，提醒归因缺口 */
  attributableShare: number
  /** tokens=0 的记录数：多为 provider 未返回 usage */
  emptyUsage: number
}

const USAGE_MARKER = '[llm-usage] '
/** 行首 docker 时间戳：RFC3339（带或不带毫秒/时区） */
const TS_PREFIX = /^(\d{4}-\d{2}-\d{2})T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?\s+/

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * 从整段日志文本里解析用量记录
 * @returns records 解析成功的记录；unparsed 命中标志但解析失败的行数
 */
export function parseUsageLines(text: string): { records: UsageRecord[]; unparsed: number } {
  const records: UsageRecord[] = []
  let unparsed = 0

  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(USAGE_MARKER)
    if (idx === -1) continue

    // 时间戳只在该标志出现在行首时才是 docker 加的（否则是日志正文里的引用）
    const dateMatch = TS_PREFIX.exec(line)
    const payload = line.slice(idx + USAGE_MARKER.length).trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      unparsed++
      continue
    }
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as UsageRecord).endpoint !== 'string') {
      unparsed++
      continue
    }
    const rec = parsed as UsageRecord
    const inputTokens = num(rec.inputTokens)
    const outputTokens = num(rec.outputTokens)
    const totalTokens = num(rec.totalTokens) || inputTokens + outputTokens
    if (totalTokens <= 0) {
      // provider 没回 usage：保留该条，成本记 0，由 emptyUsage 把「成本被低估」暴露出来
      records.push({
        ...rec,
        inputTokens,
        outputTokens,
        totalTokens: 0,
        date: dateMatch?.[1]
      })
      continue
    }
    records.push({
      ...rec,
      inputTokens,
      outputTokens,
      totalTokens,
      date: dateMatch?.[1]
    })
  }

  return { records, unparsed }
}

/**
 * 聚合成本
 * @param pricePerMTok 每百万 token 单价（人民币元）
 * @param unparsed parseUsageLines 报告的行数（解析失败），原样带回好让 CLI 只读一个对象
 */
export function summarize(records: UsageRecord[], pricePerMTok = 0.35, unparsed = 0): CostSummary {
  const byEndpoint = new Map<string, EndpointSummary>()
  const byDay = new Map<string, DaySummary>()
  const games = new Set<string>()

  let totalTokens = 0
  let attributableTokens = 0
  let emptyUsage = 0
  let dated = 0

  for (const r of records) {
    totalTokens += r.totalTokens
    if (r.totalTokens === 0) emptyUsage++

    const ep = byEndpoint.get(r.endpoint) ?? {
      endpoint: r.endpoint,
      calls: 0,
      totalTokens: 0,
      costCny: 0
    }
    ep.calls++
    ep.totalTokens += r.totalTokens
    byEndpoint.set(r.endpoint, ep)

    if (typeof r.saveId === 'string' && r.saveId) {
      attributableTokens += r.totalTokens
      games.add(r.saveId)
    }

    if (r.date) {
      dated++
      const d = byDay.get(r.date) ?? { date: r.date, calls: 0, totalTokens: 0, costCny: 0 }
      d.calls++
      d.totalTokens += r.totalTokens
      byDay.set(r.date, d)
    }
  }

  const cost = (tokens: number) => (tokens / 1_000_000) * pricePerMTok
  const round = (v: number) => Math.round(v * 10000) / 10000

  for (const e of byEndpoint.values()) e.costCny = round(cost(e.totalTokens))
  for (const d of byDay.values()) d.costCny = round(cost(d.totalTokens))

  const totalCostCny = round(cost(totalTokens))
  const attributableCostCny = round(cost(attributableTokens))

  return {
    records: records.length,
    unparsed,
    hasTimestamps: dated > 0 && dated === records.length,
    totalTokens,
    totalCostCny,
    pricePerMTok,
    byEndpoint: [...byEndpoint.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    byDay: [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    attributableCostCny,
    games: games.size,
    costPerGameCny: games.size > 0 ? round(attributableCostCny / games.size) : 0,
    attributableShare: totalTokens > 0 ? Math.round((attributableTokens / totalTokens) * 100) / 100 : 0,
    emptyUsage
  }
}

/** 生成人读报告（供终端与 cron 邮件正文直接复用） */
export function formatReport(s: CostSummary, opts: { dailyLimitCny?: number } = {}): string {
  const lines: string[] = []
  lines.push(`LLM 成本聚合：${s.records} 条用量记录，共 ${s.totalTokens.toLocaleString()} tokens`)
  lines.push(`单价 ¥${s.pricePerMTok} / 1M tokens → 总成本 ¥${s.totalCostCny.toFixed(4)}`)
  lines.push('')
  lines.push('按端点（token 降序）')
  lines.push('  端点                          调用      tokens        成本¥')
  for (const e of s.byEndpoint) {
    lines.push(
      `  ${e.endpoint.padEnd(28)}${String(e.calls).padStart(6)} ${String(e.totalTokens).padStart(12)} ${e.costCny.toFixed(4).padStart(10)}`
    )
  }

  lines.push('')
  lines.push(
    `单局口径：可归因成本 ¥${s.attributableCostCny.toFixed(4)} / ${s.games} 个存档 = ¥${s.costPerGameCny.toFixed(4)} 每局`
  )
  lines.push(
    `  可归因占比 ${(s.attributableShare * 100).toFixed(1)}%（init-factions / advisor-briefing 无 saveId，不计入单局）`
  )
  if (s.emptyUsage > 0) lines.push(`  ⚠️ ${s.emptyUsage} 条 totalTokens 为 0：provider 未回 usage，成本被低估`)

  if (s.hasTimestamps && s.byDay.length > 0) {
    lines.push('')
    lines.push('按天')
    for (const d of s.byDay) {
      const over = opts.dailyLimitCny !== undefined && d.costCny > opts.dailyLimitCny
      lines.push(
        `  ${d.date}  ${String(d.calls).padStart(5)} 次 ${d.costCny.toFixed(4).padStart(9)} ¥${over ? '   ← 超阈值' : ''}`
      )
    }
  }

  return lines.join('\n')
}

/** 超阈值判定：任一日成本超过 dailyLimitCny */
export function exceedsDailyLimit(s: CostSummary, dailyLimitCny: number): DaySummary[] {
  return s.byDay.filter((d) => d.costCny > dailyLimitCny)
}
