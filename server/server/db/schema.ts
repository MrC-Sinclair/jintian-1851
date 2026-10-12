/**
 * @file Drizzle 数据库 Schema
 *
 * 当前含：
 *   - game_saves：云端存档同步（既有）
 *   - device_credentials：设备凭据（存档归属鉴权新增，替代「deviceId 自声明即凭证」）
 *   - game_events：情景记忆（本局发生了什么，AI 长期记忆提案新增）
 *   - faction_memories：关系记忆（某势力对玩家的印象，AI 长期记忆提案新增）
 *
 * 字段说明（与 specs/cloud-sync/spec.md 一致）：
 *   - id: UUID PK，数据库自动生成（defaultRandom）
 *   - saveId: UUID UNIQUE NOT NULL，前端生成的存档唯一标识
 *   - deviceId: TEXT NOT NULL，存档属主设备标识。双轨期仍可能来自客户端声明；
 *     鉴权收紧后一律由 device_credentials 校验过的凭据反查得出，客户端无法自声明
 *   - saveData: JSONB NOT NULL，完整存档数据
 *   - saveVersion: INT NOT NULL DEFAULT 1，存档结构版本号（用于后续迁移）
 *   - endedAt: TIMESTAMP NULL，游戏结局时间（NULL 表示进行中）
 *   - endedReason: TEXT NULL，结局原因
 *   - createdAt: TIMESTAMP NOT NULL DEFAULT NOW()，首次创建时间
 *   - updatedAt: TIMESTAMP NOT NULL DEFAULT NOW()，最近更新时间（服务端权威）
 *
 * ⚠️ updated_at 由数据库 defaultNow() 生成，API 不接收客户端 updatedAt 字段
 *    （zod .strict() 模式拒绝），从源头消除两设备并发 race
 *
 * 记忆表索引约定（design.md D2/D6/D7）：
 *   - game_events：按 (saveId, turn) 复合索引 + embedding 列 HNSW 余弦索引
 *   - faction_memories：按 (saveId, factionId) 复合索引 + embedding 列 HNSW 余弦索引
 *   - 检索一律不 select embedding 列（规避 postgres-js 未注册 vector parser 的坑）
 */

import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  index,
  uniqueIndex,
  vector
} from 'drizzle-orm/pg-core'

/**
 * game_saves 表：云端存档同步
 */
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
    // device_id 上的普通索引（便于按设备查列表，MVP 暂不使用但预留）
    deviceIdIdx: index('idx_game_saves_device_id').on(table.deviceId)
  })
)

/** game_saves 表的 TypeScript 类型（插入用，自动生成 id/createdAt/updatedAt） */
export type InsertGameSave = typeof gameSaves.$inferInsert
/** game_saves 表的 TypeScript 类型（查询返回） */
export type SelectGameSave = typeof gameSaves.$inferSelect

/**
 * device_credentials 表：设备凭据（存档归属鉴权）
 *
 * 为什么需要这张表：此前 `game_saves.device_id` 是「客户端自声明即凭证」——
 * 任何人报上别人的 deviceId 就能列出/读取/删除其全部存档。本表把 deviceId 从
 * 「自声明字符串」升格为「注册过的标识」：首绑时由服务端生成高熵凭据，
 * 之后访问只认凭据，**已绑定的 deviceId 拒绝重复注册**，冒领方换不到凭据即无法访问。
 *
 * 字段说明：
 *   - deviceId: 主键，与 game_saves.device_id 同值（不建 FK：存档行允许在凭据被吊销后留存，
 *     且 2C2G 单实例下 FK 带来的迁移/删除顺序约束不值得）
 *   - secretHash: sha256(明文凭据) 十六进制。库里**不存明文**——凭据只在注册响应里下发一次，
 *     此后仅用于等值比对；库被拖走也无法反推可用凭据（256bit 随机，不可暴破）
 *   - revokedAt: 非空即已吊销（拉黑单设备），凭据校验与注册都按「未吊销」过滤
 *
 * ⚠️ 明文凭据不落库意味着「用户清缓存后找回」在本方案内无解：
 *    那需要真实身份（微信 openid），属后续 account linking 范畴，不在本次改动。
 */
export const deviceCredentials = pgTable(
  'device_credentials',
  {
    deviceId: text('device_id').primaryKey(),
    secretHash: text('secret_hash').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    // 每次带凭据的请求都要按 secret_hash 等值查一次，必须是唯一索引
    secretHashIdx: uniqueIndex('uq_device_credentials_secret_hash').on(table.secretHash)
  })
)

/** device_credentials 表的 TypeScript 类型（插入用） */
export type InsertDeviceCredential = typeof deviceCredentials.$inferInsert
/** device_credentials 表的 TypeScript 类型（查询返回） */
export type SelectDeviceCredential = typeof deviceCredentials.$inferSelect

/**
 * game_events 表：情景记忆（本局发生了什么）
 *
 * 每条记录 = 一次 generate-event 产出的事件向量化结果。
 * 检索作用域按 `saveId` 全局（跨回合去重视野），embedding 列不回 select（D6 规避 postgres-js 解析坑）。
 */
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
    // 按存档 + 回合检索（调试 / 审计常用）
    saveTurnIdx: index('idx_game_events_save_turn').on(table.saveId, table.turn),
    // HNSW 余弦索引，供 cosineDistance 向量检索（D6）
    embeddingIdx: index('idx_game_events_embedding').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops')
    )
  })
)

/** game_events 表的 TypeScript 类型（插入用） */
export type InsertGameEvent = typeof gameEvents.$inferInsert
/** game_events 表的 TypeScript 类型（查询返回） */
export type SelectGameEvent = typeof gameEvents.$inferSelect

/**
 * faction_memories 表：关系记忆（某势力对玩家的印象）
 *
 * 每条记录 = NPC 自述行动（source='npc_action'）或玩家对势力的作为（source='player_action'）。
 * 检索作用域按 `saveId` + `factionId` 双重隔离（D7 硬隔离：NPC 只能看到自己的记忆）。
 */
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
    // 按存档 + 势力检索（NPC 只读自己记忆的硬约束）
    saveFactionIdx: index('idx_faction_memories_save_faction').on(table.saveId, table.factionId),
    // HNSW 余弦索引，供 cosineDistance 向量检索（D6）
    embeddingIdx: index('idx_faction_memories_embedding').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops')
    )
  })
)

/** faction_memories 表的 TypeScript 类型（插入用） */
export type InsertFactionMemory = typeof factionMemories.$inferInsert
/** faction_memories 表的 TypeScript 类型（查询返回） */
export type SelectFactionMemory = typeof factionMemories.$inferSelect
