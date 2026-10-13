/**
 * @file 设备凭据吊销 CLI（`revoked_at` 的唯一写入路径）
 *
 * 用法：
 *   pnpm auth:revoke <deviceId> [--dry-run]
 *   # 服务器上（DB 只绑宿主机 127.0.0.1:5544，脚本在宿主机跑并显式给 DATABASE_URL）：
 *   cd /root/jintian && DATABASE_URL=postgresql://<user>:<pw>@127.0.0.1:5544/<db> \
 *     npx tsx server/server/scripts/revoke-credential.ts <deviceId> --dry-run
 *
 * 语义（收紧前必须知道）：吊销只封「凭据」，存档行按设计留存（docs/db-schema.md），
 * 兼容期被吊销的设备会退回 deviceId 自声明通道，仍能读写自己的存档 ——
 * 输出里会把这一点写清楚，别把"按下去了"读成"封住了"。
 *
 * 退出码：
 *   - 0：吊销成功 / 本来就是吊销态（幂等）/ --dry-run 成功
 *   - 1：用法错误、缺 DATABASE_URL、deviceId 不存在、数据库失败
 *
 * 纯逻辑（参数、决策、文案）在 lib/revoke.ts，有单测；这里只留连库与写的那几行。
 */

import { and, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { deviceCredentials } from '../db/schema'
import {
  decideAction,
  describeEffect,
  describeRow,
  mask,
  parseRevokeArgs,
  revokeUsage,
  type CredentialRowState,
  type RevokeArgs
} from './lib/revoke'

const parsed = parseRevokeArgs(process.argv.slice(2))
if (!parsed) {
  console.error(revokeUsage())
  process.exit(1)
}
const args: RevokeArgs = parsed

// 不做兜底连接串：拿默认值去写线上库，比失败更糟
const rawUrl = process.env.DATABASE_URL
if (!rawUrl) {
  console.error('[revoke-credential] ❌ 缺少 DATABASE_URL（请显式指定要操作哪个库）')
  process.exit(1)
}
const connectionString: string = rawUrl

const client = postgres(connectionString, { max: 1 })
const db = drizzle(client, { schema: { deviceCredentials } })

async function main(): Promise<number> {
  const [row] = await db
    .select({
      deviceId: deviceCredentials.deviceId,
      secretHash: deviceCredentials.secretHash,
      revokedAt: deviceCredentials.revokedAt,
      createdAt: deviceCredentials.createdAt
    })
    .from(deviceCredentials)
    .where(eq(deviceCredentials.deviceId, args.deviceId))
    .limit(1)

  const action = decideAction(row)
  if (action.kind === 'missing') {
    console.error(`[revoke-credential] 未找到设备 ${mask(args.deviceId)}（该设备从未注册过凭据）`)
    return 1
  }
  const found = row as CredentialRowState
  console.log(`[revoke-credential] ${describeRow(found)}`)

  if (args.dryRun) {
    console.log(
      `[revoke-credential] --dry-run：${action.kind === 'revoke' ? '本次将写入吊销' : '无需变更'}，未写库`
    )
    return 0
  }
  if (action.kind === 'already') {
    console.log('[revoke-credential] 无需操作（幂等退出）')
    return 0
  }

  // 条件更新而非「先查后改」：两个终端同时吊销同一设备，只有一个真正写入
  const updated = await db
    .update(deviceCredentials)
    .set({ revokedAt: new Date() })
    .where(and(eq(deviceCredentials.deviceId, args.deviceId), isNull(deviceCredentials.revokedAt)))
    .returning({ deviceId: deviceCredentials.deviceId })

  if (updated.length === 0) {
    console.log('[revoke-credential] 本次未写入：该行已被并发请求吊销')
    return 0
  }

  console.log(`[revoke-credential] ✓ 已吊销 ${mask(args.deviceId)}`)
  console.warn(
    `[revoke-credential] ${describeEffect(process.env.NUXT_DEVICE_AUTH_ENFORCED === 'true')}`
  )
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err) => {
    console.error('[revoke-credential] ❌ 失败：', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => client.end())
