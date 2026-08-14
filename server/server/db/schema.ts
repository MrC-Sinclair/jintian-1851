/**
 * @file Drizzle 数据库 Schema
 *
 * 当前仅含 game_saves 表（云端存档同步）。
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
 */

import { jsonb, pgTable, text, timestamp, uuid, integer, index } from 'drizzle-orm/pg-core'

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
