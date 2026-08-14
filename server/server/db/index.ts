/**
 * @file 数据库连接
 *
 * 使用 postgres-js (postgres) + Drizzle ORM 连接 PostgreSQL 18。
 * 连接字符串从环境变量 DATABASE_URL 读取（Nuxt runtimeConfig 自动注入）。
 *
 * ⚠️ 在 Nuxt 上下文外运行脚本（如 check-models.ts、db:push）时，
 *    需通过 --env-file=.env 加载环境变量
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { gameSaves } from './schema'

const connectionString =
  process.env.DATABASE_URL || 'postgresql://sw_game:CHANGE_ME@localhost:5534/sw_game'

// postgres-js 客户端，max=1 避免开发期连接池过度创建
const client = postgres(connectionString, { max: 1 })

export const db = drizzle(client, { schema: { gameSaves } })

export { gameSaves }
