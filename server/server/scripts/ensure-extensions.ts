/**
 * @file 数据库扩展预检脚本
 *
 * Drizzle 不会自动创建 extension（design.md D1 经 2026-09-06 spike 实测确认）。
 * 在 `db:push` 前幂等确保 `vector` 扩展存在，否则带 vector 列的 schema 推送会失败。
 *
 * 运行：`tsx --env-file=.env server/scripts/ensure-extensions.ts`（package.json `db:push` 已串联此步）
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'

const connectionString =
  process.env.DATABASE_URL || 'postgresql://sw_game:CHANGE_ME@localhost:5534/sw_game'

const client = postgres(connectionString, { max: 1 })
const db = drizzle(client)

async function main(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`)
  console.log('[ensure-extensions] ✓ vector 扩展已确保存在')
  await client.end()
}

main().catch((err) => {
  console.error('[ensure-extensions] ❌ 创建扩展失败：', err)
  process.exit(1)
})
