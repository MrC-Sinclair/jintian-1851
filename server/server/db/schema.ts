/**
 * @file Drizzle 数据库 Schema
 *
 * 当前含：
 *   - game_saves：云端存档同步（既有）
 *   - game_events：情景记忆（本局发生了什么，AI 长期记忆提案新增）
 *   - faction_memories：关系记忆（某势力对玩家的印象，AI 长期记忆提案新增）
 *
 * 字段说明（与 specs/cloud-sync/spec.md 一致）：
 *   - id: UUID PK，数据库自动生成（defaultRandom）
 *   - saveId: UUID UNIQUE NOT NULL，前端生成的存档唯一标识
 *   - deviceId: TEXT NOT NULL，设备指纹（MVP 占位，后续接登录系统）
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
