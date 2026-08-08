# 金田：1851 — 数据库 Schema 文档

> 本文档是 `server/server/db/schema.ts` 的**唯一文档来源**，禁止代码与文档脱节（参见 `AGENTS.md` → 测试策略）。

## 数据库基础

- **类型**：PostgreSQL 18
- **端口**：5534（开发）/ 5533（测试）
- **用户/密码/库**：`sw_game` / `YOUR_DB_PASSWORD` / `sw_game`
- **驱动**：`postgres@^3.4`
- **ORM**：`drizzle-orm@^0.36`
- **启动**：`docker compose up -d`（见 `docker-compose.yml`）
- **可视化**：`pnpm db:studio`（Drizzle Studio）

## 表清单

MVP 阶段仅含 1 张表 `game_saves`，后续随功能扩展追加。

---

## game_saves — 云端存档同步

源码：[server/server/db/schema.ts](file:///d:/code/codeWork/jintian-1851/server/server/db/schema.ts)

### 字段说明

| 列名 | 类型 | 约束 | 默认值 | 说明 |
|---|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY` | `gen_random_uuid()` | 数据库自动生成的主键，不暴露给客户端 |
| `save_id` | `uuid` | `NOT NULL UNIQUE` | — | 客户端生成的存档唯一标识，云端同步主键 |
| `device_id` | `text` | `NOT NULL` | — | 设备指纹（MVP 占位，后续接登录系统） |
| `save_data` | `jsonb` | `NOT NULL` | — | 完整 GameSave JSON 数据（含 character/state/factions/events/advisorMessages 等） |
| `save_version` | `integer` | `NOT NULL` | `1` | 存档结构版本号（用于后续迁移，当前固定为 1） |
| `ended_at` | `timestamptz` | `NULL` | `NULL` | 游戏结局时间（`NULL` 表示进行中） |
| `ended_reason` | `text` | `NULL` | `NULL` | 结局原因（如 `military_collapse`、`victory`、`time_up`） |
| `created_at` | `timestamptz` | `NOT NULL` | `NOW()` | 首次创建时间（服务端生成，不接受客户端值） |
| `updated_at` | `timestamptz` | `NOT NULL` | `NOW()` | 最近更新时间（**服务端权威**，不接受客户端值） |

### 索引

| 索引名 | 字段 | 类型 | 说明 |
|---|---|---|---|
| `game_saves_pkey` | `id` | PRIMARY KEY | 主键索引（自动） |
| `game_saves_save_id_unique` | `save_id` | UNIQUE | 唯一约束索引（自动） |
| `idx_game_saves_device_id` | `device_id` | INDEX | 普通索引，便于按设备查列表（MVP 暂不使用，预留） |

### 关键约束

#### `save_id` UNIQUE

- 客户端首次 POST 上传时，DB 执行 `INSERT ... ON CONFLICT (save_id) DO UPDATE`
- 同 `saveId` 二次上传直接覆盖（update_data + updated_at + ended_at + ended_reason）
- **不返回 409**：服务端权威方案保证无 race，POST 永远 200 OK

#### `updated_at` 服务端权威

- DB 列定义 `defaultNow()`，POST 端**不接收**客户端 `updatedAt` 字段
- zod schema 用 `.strict()` 模式，传入 `updatedAt` 会返回 400 + `updatedAt is not allowed (server-authoritative)`
- `ON CONFLICT DO UPDATE` 时强制 `set: { updatedAt: new Date() }`，覆盖客户端可能携带的值
- **设计理由**：消除两设备同 saveId 间隔 < 100ms 同时 POST 的 Read-Modify-Write race（参见 [design.md D7](file:///d:/code/codeWork/jintian-1851/openspec/changes/add-qing-revival-mvp/design.md)）

#### `ended` 字段不入 DB

- `GameSave` 客户端类型含 `ended: boolean` 冗余字段，便于前端 `v-if="!save.ended"` 守卫
- DB **不设 `ended` 列**，由 `ended_at IS NOT NULL` 推断
- 写入时 `ended=true` + `endedAt=Date.now()` + `endedReason=...` 三者同步设置

### Drizzle Schema 定义

```ts
// server/server/db/schema.ts
import { jsonb, pgTable, text, timestamp, uuid, integer, index } from 'drizzle-orm/pg-core'

export const gameSaves = pgTable(
  'game_saves',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    saveId: uuid('save_id').notNull().unique(),
    deviceId: text('device_id').notNull(),
    saveData: jsonb('save_data').notNull(),
    saveVersion: integer('save_version').notNull().default(1),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedReason: text('ended_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    deviceIdIdx: index('idx_game_saves_device_id').on(table.deviceId)
  })
)

export type InsertGameSave = typeof gameSaves.$inferInsert
export type SelectGameSave = typeof gameSaves.$inferSelect
```

### 同步流程

#### POST /api/game/sync-save（上传/覆盖）

```sql
INSERT INTO game_saves (save_id, device_id, save_data, save_version, ended_at, ended_reason)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (save_id) DO UPDATE
SET save_data = EXCLUDED.save_data,
    save_version = EXCLUDED.save_version,
    updated_at = NOW(),
    ended_at = EXCLUDED.ended_at,
    ended_reason = EXCLUDED.ended_reason
RETURNING save_id, updated_at, ended_at, ended_reason;
```

#### GET /api/game/sync-save?saveId=xxx（拉取）

```sql
SELECT save_data, updated_at
FROM game_saves
WHERE save_id = $1
LIMIT 1;
```

未找到返回 404 + `SAVE_NOT_FOUND`。

### 维护命令

| 命令 | 作用 |
|---|---|
| `pnpm db:push` | 同步 schema.ts 到数据库（修改 schema 后必须执行） |
| `pnpm db:studio` | 启动 Drizzle Studio 可视化数据库（http://localhost:4983） |
| `docker compose ps` | 检查 PostgreSQL 容器状态 |
| `psql -h localhost -p 5534 -U sw_game -d sw_game` | 命令行连接数据库 |

### 排查

| 问题 | 排查步骤 |
|---|---|
| 数据库连接失败 | `docker compose ps` → 端口 5534 是否占用 → `.env` 中 `DATABASE_URL` 是否正确 |
| `pnpm db:push` 失败 | 检查 schema.ts 语法 → 检查 drizzle.config.ts 配置 → 检查数据库连通性 |
| 同步 POST 返回 500 | 检查 saveId 是否为合法 UUID → 检查 saveData 是否符合 zod schema → 查看服务端日志 `[sync-save POST] DB error` |
