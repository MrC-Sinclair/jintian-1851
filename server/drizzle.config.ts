import { defineConfig } from 'drizzle-kit'

// Drizzle Kit 配置：连接 PostgreSQL 18（端口 5534 避开 my-chat 的 5434）
// 文档：https://orm.drizzle.team/docs/drizzle-kit-configuration
export default defineConfig({
  schema: './server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://sw_game:CHANGE_ME@localhost:5534/sw_game'
  },
  verbose: true,
  strict: false
})
