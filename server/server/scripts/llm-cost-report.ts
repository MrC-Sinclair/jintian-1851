/**
 * @file [llm-usage] 成本聚合 CLI（cron 可直接用退出码报警）
 *
 * 用法（**在本机跑**：宿主机没有 node/pnpm，也没有仓库检出，所以用 ssh 把 journal 拉过来）：
 *   journalctl CONTAINER_NAME=jintian-api -o short-iso --no-pager --since "24 hours ago" \
 *     | pnpm tsx server/scripts/llm-cost-report.ts --daily-limit 30
 *
 * 为什么用 journalctl 而不是 docker logs：本机容器日志驱动是 journald，`docker logs` 只给
 * 当前容器的输出，每次 recreate 就截一段；journalctl 按容器名查能拿到跨重建的完整历史。
 * `-o short-iso` 保留行首时间戳，聚合侧据此按天分桶（用 `-o cat` 时按端点/单局照算，
 * 但"按天"那张表会整块消失）。
 *
 * 为什么走 stdin 而不是自己连 docker daemon / 写库：
 *   与 deploy/backup-db.sh 同一个取向——2C2G 的机器上不新增常驻服务、不引外部依赖，
 *   日志是既有的唯一数据源，脚本无状态、可随时删。接了监控系统后本脚本仍可用于人工核算。
 *
 * 退出码：
 *   - 0：正常
 *   - 1：用法错误 / 没有任何输入（避免 cron 把「日志抓取失败」当成「零成本」）
 *   - 2：有一天成本超过 --daily-limit（cron 侧据此发通知）
 *
 * 口径来源见 lib/llm-cost.ts 头注释与 docs/ai-cost.md。
 */

import {
  exceedsDailyLimit,
  formatReport,
  parseUsageLines,
  summarize,
  type CostSummary
} from './lib/llm-cost'

interface Args {
  pricePerMTok: number
  dailyLimitCny?: number
  json: boolean
}

function parseArgs(argv: string[]): Args | null {
  const out: Args = { pricePerMTok: 0.35, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') {
      out.json = true
    } else if (a === '--price-per-mtok') {
      const v = Number(argv[++i])
      if (!Number.isFinite(v) || v <= 0) return null
      out.pricePerMTok = v
    } else if (a === '--daily-limit') {
      const v = Number(argv[++i])
      if (!Number.isFinite(v) || v <= 0) return null
      out.dailyLimitCny = v
    } else if (a === '--help' || a === '-h') {
      return null
    } else {
      return null
    }
  }
  return out
}

function usage(): string {
  return [
    '用法：ssh … \'journalctl CONTAINER_NAME=jintian-api -o short-iso --no-pager\' | npx tsx server/scripts/llm-cost-report.ts [选项]（在本机跑，宿主机没有 node）',
    '',
    '选项：',
    '  --price-per-mtok <数>   每百万 token 单价（人民币），默认 0.35（Qwen3-8B）',
    '  --daily-limit <数>      日成本阈值（人民币），超出退 2，供 cron 报警',
    '  --json                  输出机器可读的聚合结果',
    '  -h, --help              显示本帮助',
    '',
    '退出码：0 正常 / 1 用法或输入错误 / 2 超日阈值'
  ].join('\n')
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  if (!args) {
    console.error(usage())
    return 1
  }

  const raw = await readStdin()
  if (!raw.trim()) {
    // 空输入多半是取日志那步失败，不是「今天没花钱」
    console.error('stdin 为空：请确认取日志那步有输出（未加管道时本脚本没有数据源）')
    return 1
  }

  const { records, unparsed } = parseUsageLines(raw)
  const summary: CostSummary = summarize(records, args.pricePerMTok, unparsed)

  if (args.json) {
    const over = args.dailyLimitCny !== undefined ? exceedsDailyLimit(summary, args.dailyLimitCny) : []
    console.log(JSON.stringify({ ...summary, overDailyLimit: over }, null, 2))
    return over.length > 0 ? 2 : 0
  }

  console.log(formatReport(summary, { dailyLimitCny: args.dailyLimitCny }))
  if (summary.records === 0) {
    console.error('\n没有解析到任何 [llm-usage] 记录：确认日志窗口内确有 AI 调用')
    return 1
  }
  if (unparsed > 0) console.error(`\n提示：${unparsed} 行命中 [llm-usage] 但解析失败，未计入`)

  const over = args.dailyLimitCny !== undefined ? exceedsDailyLimit(summary, args.dailyLimitCny) : []
  if (over.length > 0) {
    console.error(
      `\n⚠️ ${over.length} 天成本超过阈值 ¥${args.dailyLimitCny}：` +
        over.map((d) => `${d.date} ¥${d.costCny}`).join('、')
    )
    return 2
  }
  return 0
}

process.exitCode = await main()
