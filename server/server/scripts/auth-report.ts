/**
 * @file [auth-event] 鉴权聚合 CLI（收紧决策的数据源，cron 可直接用退出码报警）
 *
 * 用法（容器名见 deploy/docker-compose.deploy.yml）：
 *   docker logs --since 24h jintian-api 2>&1 \
 *     | pnpm tsx server/scripts/auth-report.ts
 *   docker logs --since 24h jintian-api 2>&1 \
 *     | pnpm tsx server/scripts/auth-report.ts --fail-if-compat   # 兼容通道未归零则退 2
 *
 * 与 llm-cost-report 同一取向：脚本无状态、不连库、不引常驻服务，日志是唯一数据源。
 *
 * 退出码：
 *   - 0：正常
 *   - 1：用法错误 / stdin 为空 / 一行 [auth-event] 都没解析到（免得把"日志抓取失败"读成"零流量"）
 *   - 2：仅在 --fail-if-compat 下，兼容通道仍有流量（cron 据此提醒"还不能收紧"）
 */

import { compatVerdict, formatReport, parseAuthLines, summarize } from './lib/auth-report'

interface Args {
  json: boolean
  failIfCompat: boolean
}

function parseArgs(argv: string[]): Args | null {
  const out: Args = { json: false, failIfCompat: false }
  for (const a of argv) {
    if (a === '--json') out.json = true
    else if (a === '--fail-if-compat') out.failIfCompat = true
    else if (a === '-h' || a === '--help') return null
    else return null
  }
  return out
}

function usage(): string {
  return [
    '用法：docker logs --since 24h jintian-api 2>&1 | pnpm tsx server/scripts/auth-report.ts [选项]',
    '',
    '选项：',
    '  --json              输出机器可读的聚合结果',
    '  --fail-if-compat    兼容通道仍有流量时退 2（收紧前的闸门）',
    '  -h, --help          显示本帮助',
    '',
    '退出码：0 正常 / 1 用法或输入错误 / 2 兼容通道未归零（需 --fail-if-compat）'
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
    console.error('stdin 为空：请确认 docker logs 有输出（未加管道时本脚本没有数据源）')
    return 1
  }

  const events = parseAuthLines(raw.split(/\r?\n/))
  if (events.length === 0) {
    console.error('没有解析到任何 [auth-event] 记录：日志窗口内无存档鉴权请求，或服务端还是旧版本')
    return 1
  }
  const summary = summarize(events)

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    console.log(formatReport(summary))
  }

  if (args.failIfCompat) {
    const { status, compatCount } = compatVerdict(summary)
    if (status === 'pending') {
      console.error(
        `⚠ 兼容通道仍有 ${compatCount} 次成功裁决（占比 ${(summary.compatShare ?? 0) * 100}%），还不能收紧`
      )
      return 2
    }
    if (status === 'no_data') {
      console.error('⚠ 窗口内没有任何成功裁决样本，无法判断是否可收紧（不当作已归零）')
      return 2
    }
  }
  return 0
}

process.exitCode = await main()
