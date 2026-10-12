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

当前含 4 张表：

| 表 | 用途 | 引入 |
|---|---|---|
| `game_saves` | 云端存档同步 | MVP |
| `device_credentials` | 设备凭据（存档归属鉴权，替代「deviceId 自声明即凭证」） | 存档归属鉴权提案 |
| `game_events` | 情景记忆（本局事件向量，供语义去重） | AI 长期记忆提案 |
| `faction_memories` | 关系记忆（各势力对玩家印象，供 NPC 决策注入 / 军师检索） | AI 长期记忆提案 |

---

## game_saves — 云端存档同步

源码：[server/server/db/schema.ts](file:///d:/code/codeWork/jintian-1851/server/server/db/schema.ts)

### 字段说明

| 列名 | 类型 | 约束 | 默认值 | 说明 |
|---|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY` | `gen_random_uuid()` | 数据库自动生成的主键，不暴露给客户端 |
| `save_id` | `uuid` | `NOT NULL UNIQUE` | — | 客户端生成的存档唯一标识，云端同步主键 |
| `device_id` | `text` | `NOT NULL` | — | 存档属主设备标识。收紧后其值一律来自 `device_credentials` 凭据反查，不再采信客户端自声明；`save_data` blob 内的同名字段只是客户端快照 |
| `save_data` | `jsonb` | `NOT NULL` | — | 完整 GameSave JSON 数据（含 character/state/factions/events/advisorMessages 等） |
| `save_version` | `integer` | `NOT NULL` | `1` | 存档结构版本号（默认 1；当前客户端已支持 v2，新增 pendingChainNodes/completedChainIds/activeChainIds 三字段） |
| `ended_at` | `timestamptz` | `NULL` | `NULL` | 游戏结局时间（`NULL` 表示进行中） |
| `ended_reason` | `text` | `NULL` | `NULL` | 结局原因（如 `military_collapse`、`victory`、`time_up`） |
| `created_at` | `timestamptz` | `NOT NULL` | `NOW()` | 首次创建时间（服务端生成，不接受客户端值） |
| `updated_at` | `timestamptz` | `NOT NULL` | `NOW()` | 最近更新时间（**服务端权威**，不接受客户端值） |

### 索引

| 索引名 | 字段 | 类型 | 说明 |
|---|---|---|---|
| `game_saves_pkey` | `id` | PRIMARY KEY | 主键索引（自动） |
| `game_saves_save_id_unique` | `save_id` | UNIQUE | 唯一约束索引（自动） |
| `idx_game_saves_device_id` | `device_id` | INDEX | 普通索引，按设备查存档列表（`GET /api/game/saves` 命中） |

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
WHERE game_saves.device_id = $2  -- 属主校验（原子，无竞态窗口）
RETURNING save_id, updated_at, ended_at, ended_reason;
```

- `WHERE device_id = $2`（Drizzle `setWhere`）：`saveId` 已存在但属于其他设备时 0 行更新 → 接口返回 403 `SAVE_FORBIDDEN`
- 首次上传（无冲突）直接插入成功，不受 WHERE 影响

#### GET /api/game/sync-save?saveId=xxx&deviceId=yyy（拉取）

```sql
SELECT save_data, updated_at
FROM game_saves
WHERE save_id = $1 AND device_id = $2
LIMIT 1;
```

未找到**或 deviceId 不匹配**统一返回 404 + `SAVE_NOT_FOUND`（不泄漏他人存档存在性）。

---

## device_credentials — 设备凭据（存档归属鉴权）

源码：[server/server/db/schema.ts](file:///d:/code/codeWork/jintian-1851/server/server/db/schema.ts)
实现：[server/server/utils/device-auth.ts](file:///d:/code/codeWork/jintian-1851/server/server/utils/device-auth.ts)

> 存档归属提案新增。此前 `game_saves.device_id` 是「客户端自声明即凭证」——
> 报上别人的 deviceId 就能列出/读取/删除其全部存档。本表把 deviceId 从
> 「自声明字符串」升格为「注册过的标识」。

### 字段说明

| 列名 | 类型 | 约束 | 默认值 | 说明 |
|---|---|---|---|---|
| `device_id` | `text` | `PRIMARY KEY` | — | 与 `game_saves.device_id` 同值；主键即「一个 deviceId 只能绑定一次」的约束载体 |
| `secret_hash` | `text` | `NOT NULL UNIQUE` | — | `sha256(明文凭据)` 十六进制。**库里不存明文**：凭据只在注册响应里下发一次 |
| `revoked_at` | `timestamptz` | `NULL` | `NULL` | 非空即已吊销（拉黑单设备），凭据校验与注册都按「未吊销」过滤 |
| `created_at` | `timestamptz` | `NOT NULL` | `NOW()` | 首绑时间 |

### 索引

| 索引名 | 字段 | 类型 | 说明 |
|---|---|---|---|
| `device_credentials_pkey` | `device_id` | PRIMARY KEY | 首绑即锁的约束来源，兼作重复注册裁决（`ON CONFLICT DO NOTHING`） |
| `uq_device_credentials_secret_hash` | `secret_hash` | UNIQUE | 每次带凭据的请求都按此列等值反查属主 |

### 关键约束

#### 首绑即锁（防事后冒领）

- 注册走 `INSERT ... ON CONFLICT DO NOTHING RETURNING`，返回 0 行即「该 deviceId 已绑定」→ 409
- **不读后写**：并发注册由主键约束裁决，无 Read-Modify-Write 竞态窗口
- 已绑定的 deviceId 再注册一律被拒 → 事后获知他人 deviceId 的人换不到凭据，也就无法访问其存档
- 边界（诚实标注）：本表防不住「首个声明者」——双轨兼容期任何人都能替**未注册**的 deviceId 抢下绑定。
  这是「不要求老玩家重装、存量存档无损归属」的对价，靠 `DEVICE_AUTH_ALLOW_FIRST_BIND=false` 关注册来收窄

#### 不建外键

`device_credentials.device_id` 与 `game_saves.device_id` 之间**不建 FK**：
存档行允许在凭据被吊销后继续留存（吊销是封禁访问，不是删数据），
且 2C2G 单实例下 FK 带来的迁移/删除顺序约束不值得。

#### 存量存档无需迁移

`game_saves.device_id` 的既有值一个都不改——本方案只是让「写入这个值」必须先通过凭据校验。
`save_data` JSONB blob 内的 `deviceId` 退化为客户端快照，服务端不采信、不回填。

### Drizzle Schema 定义

```ts
// server/server/db/schema.ts
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const deviceCredentials = pgTable(
  'device_credentials',
  {
    deviceId: text('device_id').primaryKey(),
    secretHash: text('secret_hash').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    secretHashIdx: uniqueIndex('uq_device_credentials_secret_hash').on(table.secretHash)
  })
)

export type InsertDeviceCredential = typeof deviceCredentials.$inferInsert
export type SelectDeviceCredential = typeof deviceCredentials.$inferSelect
```

---

## game_events — 情景记忆（本局事件向量）

源码：[server/server/db/schema.ts](file:///d:/code/codeWork/jintian-1851/server/server/db/schema.ts)

> 本表为「AI 长期记忆」提案（openspec/changes/2026-09-06-ai-long-term-memory）新增。存储本局每回合 `generate-event` 产出的事件向量化结果，供**事件语义去重**检索。详见 design.md D2/D3/D6。

### 字段说明

| 列名 | 类型 | 约束 | 默认值 | 说明 |
|---|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY` | `gen_random_uuid()` | 主键 |
| `save_id` | `uuid` | `NOT NULL` | — | 存档唯一标识（检索作用域：跨回合全局去重） |
| `turn` | `integer` | `NOT NULL` | — | 事件发生回合 |
| `event_id` | `text` | `NOT NULL` | — | 事件标识（与 generate-event 产出对齐） |
| `event_type` | `text` | `NOT NULL` | — | 事件类型 |
| `content` | `text` | `NOT NULL` | — | 事件标题 + 描述（向量化原文，写入前截断到 750 字符，见 design.md D3） |
| `embedding` | `vector(1024)` | `NOT NULL` | — | `BAAI/bge-large-zh-v1.5` 向量（512 token 硬上限，超长调前截断） |
| `created_at` | `timestamptz` | `NOT NULL` | `NOW()` | 写入时间（服务端生成） |

### 索引

| 索引名 | 字段 | 类型 | 说明 |
|---|---|---|---|
| `game_events_pkey` | `id` | PRIMARY KEY | 主键索引（自动） |
| `idx_game_events_save_turn` | `save_id`, `turn` | btree | 按存档 + 回合检索（调试 / 审计） |
| `idx_game_events_embedding` | `embedding` | HNSW (`vector_cosine_ops`) | 余弦相似度向量检索（design.md D6） |

### 关键约束

#### embedding 列不回 select（D6）

`postgres@^3.4` 未注册 pgvector 的 `vector` 类型 parser，SELECT 出该列会退化为字符串。所有检索查询**只 select 相似度标量**（`1 - cosineDistance(...)`），不 select `embedding` 列，规避类型解析坑。插入侧无坑：Drizzle `vector` 列会自动 `JSON.stringify` 成 pgvector 字面量。

#### 写入方式（D4/D5）

由 `generate-event` 的 LLM 路径在事件生成成功后 **fire-and-forget** 异步写入（仅 `X-Event-Source: llm` 路径；缓存命中 / 剧情链 / fallback 不写入），失败静默跳过，不阻塞回合主流程。

#### 去重阈值（D9）

`generate-event` 生成前检索同 `saveId` 历史事件，相似度 **> 0.76**（topK 5）时注入避重清单。阈值沉淀为常量 `DEDUP_THRESHOLD = 0.76`。

### Drizzle Schema 定义

```ts
export const gameEvents = pgTable(
  'game_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    saveId: uuid('save_id').notNull(),
    turn: integer('turn').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    saveTurnIdx: index('idx_game_events_save_turn').on(table.saveId, table.turn),
    embeddingIdx: index('idx_game_events_embedding').using('hnsw', table.embedding.op('vector_cosine_ops'))
  })
)

export type InsertGameEvent = typeof gameEvents.$inferInsert
export type SelectGameEvent = typeof gameEvents.$inferSelect
```

---

## faction_memories — 关系记忆（势力对玩家印象）

源码：[server/server/db/schema.ts](file:///d:/code/codeWork/jintian-1851/server/server/db/schema.ts)

> 本表为「AI 长期记忆」提案新增。存储每个 NPC 势力对玩家的印象条目（NPC 自述行动 / 玩家对势力的作为），供 **NPC 决策注入**与**军师检索**。详见 design.md D2/D7/D8。

### 字段说明

| 列名 | 类型 | 约束 | 默认值 | 说明 |
|---|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY` | `gen_random_uuid()` | 主键 |
| `save_id` | `uuid` | `NOT NULL` | — | 存档唯一标识 |
| `faction_id` | `text` | `NOT NULL` | — | 势力标识（检索作用域第二维，硬隔离，design.md D7） |
| `turn` | `integer` | `NOT NULL` | — | 发生回合 |
| `source` | `text` | `NOT NULL` | — | 来源：`npc_action`（NPC 自述行动）/ `player_action`（玩家自由决策） |
| `sentiment` | `text` | `NOT NULL` | — | 情绪：`positive` / `negative` / `neutral` |
| `content` | `text` | `NOT NULL` | — | 记忆正文（行动类型+描述 / 玩家输入原文+关系变化，截断到 750 字符） |
| `embedding` | `vector(1024)` | `NOT NULL` | — | `BAAI/bge-large-zh-v1.5` 向量 |
| `created_at` | `timestamptz` | `NOT NULL` | `NOW()` | 写入时间（服务端生成） |

### 索引

| 索引名 | 字段 | 类型 | 说明 |
|---|---|---|---|
| `faction_memories_pkey` | `id` | PRIMARY KEY | 主键索引（自动） |
| `idx_faction_memories_save_faction` | `save_id`, `faction_id` | btree | 按存档 + 势力硬隔离检索（D7） |
| `idx_faction_memories_embedding` | `embedding` | HNSW (`vector_cosine_ops`) | 余弦相似度向量检索 |

### 关键约束

#### 作用域双隔离（D7）

`faction_memories` 查询**必须**同时满足 `save_id = ?` **且** `faction_id = ?`，在表结构层面保证「某势力只能看到自己的记忆」，防止跨势力记忆泄漏与决策同质化。

#### 正负混合召回（D8）

`sentiment` 字段标记情绪。检索时 topK 内尽量正负混合，prompt 同时呈现恩怨两面；记忆**不参与** `relationship` 等数值结算，只影响叙事与意图偏置。

#### 写入方式（D4/D5）

由 `npc-actions`（source=`npc_action`）与 `resolve-decision`（source=`player_action`）在决策 / 判定成功后 **fire-and-forget** 写入（关系升/降对应 `positive`/`negative`），失败静默跳过，不阻塞主流程。

### Drizzle Schema 定义

```ts
export const factionMemories = pgTable(
  'faction_memories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    saveId: uuid('save_id').notNull(),
    factionId: text('faction_id').notNull(),
    turn: integer('turn').notNull(),
    source: text('source').notNull(),
    sentiment: text('sentiment').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    saveFactionIdx: index('idx_faction_memories_save_faction').on(table.saveId, table.factionId),
    embeddingIdx: index('idx_faction_memories_embedding').using('hnsw', table.embedding.op('vector_cosine_ops'))
  })
)

export type InsertFactionMemory = typeof factionMemories.$inferInsert
export type SelectFactionMemory = typeof factionMemories.$inferSelect
```

---

## 维护命令

| 命令 | 作用 |
|---|---|
| `pnpm db:push` | 同步 schema.ts 到数据库（修改 schema 后必须执行）。**前置步骤** `ensure-extensions.ts` 会幂等执行 `CREATE EXTENSION IF NOT EXISTS vector`（Drizzle 不会自动建扩展，design.md D1） |
| `pnpm db:studio` | 启动 Drizzle Studio 可视化数据库（http://localhost:4983） |
| `docker compose ps` | 检查 PostgreSQL 容器状态 |
| `psql -h localhost -p 5534 -U sw_game -d sw_game` | 命令行连接数据库 |

## 排查

| 问题 | 排查步骤 |
|---|---|
| 数据库连接失败 | `docker compose ps` → 端口 5534 是否占用 → `.env` 中 `DATABASE_URL` 是否正确 |
| PostgreSQL 容器启动即退出（exit 1） | `docker compose logs postgres` 报 `old databases` / `unused mount/volume`：卷挂载点写错，或卷内残留 PG17 及更早的数据目录。PG18 必须挂 `/var/lib/postgresql`（**禁止** `/var/lib/postgresql/data`，理由见 `docker-compose.yml` 注释）；确认卷可丢弃后 `docker compose down -v` 清卷重建，再 `pnpm db:push` 建表 |
| `pnpm db:push` 失败 | 检查 schema.ts 语法 → 检查 drizzle.config.ts 配置 → 检查数据库连通性 |
| `pnpm db:push` 报 `42P16 column "id" is in a primary key` | **既有 `game_saves` 表的 pre-existing 工具链问题**（与记忆表无关）：PostgreSQL 18 将 `NOT NULL` 实现为命名约束，drizzle-kit 0.29 尝试 DROP 主键列的 NOT NULL 约束导致中止。记忆表本身的建表与索引已落地；彻底修复需将 drizzle-kit 升级到兼容 PG18 的版本。 |
| 同步 POST 返回 500 | 检查 saveId 是否为合法 UUID → 检查 saveData 是否符合 zod schema → 查看服务端日志 `[sync-save POST] DB error` |
