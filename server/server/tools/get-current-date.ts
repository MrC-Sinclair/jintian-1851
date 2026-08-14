/**
 * @file get-current-date — 查询当前游戏内日期
 *
 * 何时调用：NPC 决策需要时间感知、玩家询问当前时间时。
 * 何时不用：已知当前时间时。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { ToolContext } from '../utils/tool-context'

/** 年号映射：1851-1861 咸丰、1862-1874 同治、1875-1908 光绪、1909-1911 宣统、1912 民国元年 */
const ERA_MAP: Array<{ start: number; end: number; name: string }> = [
  { start: 1851, end: 1861, name: '咸丰' },
  { start: 1862, end: 1874, name: '同治' },
  { start: 1875, end: 1908, name: '光绪' },
  { start: 1909, end: 1911, name: '宣统' }
]

/** 数字转中文（1-99），用于年号纪年的「第 N 年」与月份 */
function toChineseInt(n: number): string {
  const d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (n <= 0) return '零'
  if (n < 10) return d[n]
  if (n === 10) return '十'
  if (n < 20) return '十' + d[n - 10]
  if (n < 100) {
    const tens = Math.floor(n / 10)
    const ones = n % 10
    return d[tens] + '十' + (ones ? d[ones] : '')
  }
  return String(n)
}

/** 月份转中文（正月/二月/…/腊月） */
function toChineseMonth(m: number): string {
  const map = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '腊月']
  return map[m - 1] ?? `${m}月`
}

/**
 * 将公元年份转为年号纪年（如 1851 → 咸丰元年六月，1865 → 同治四年三月，1912 → 民国元年正月）
 * 元年用「元」，其余年份与月份均用中文数字（设计文档 D7 / spec agent-tool-system）。
 */
export function toEraName(year: number, month?: number): string {
  let reignYearStr: string
  if (year === 1912) {
    reignYearStr = '民国元年'
  } else {
    const era = ERA_MAP.find((e) => year >= e.start && year <= e.end)
    if (!era) return `${year}年`
    const reignYear = year - era.start + 1
    reignYearStr = `${era.name}${reignYear === 1 ? '元' : toChineseInt(reignYear)}年`
  }
  const monthStr = month !== undefined ? toChineseMonth(month) : ''
  return `${reignYearStr}${monthStr}`
}

export function createGetCurrentDateTool(ctx: ToolContext) {
  return tool({
    description:
      '查询当前游戏内日期（年/月）与回合数。' +
      '何时调用：NPC 决策需要时间感知、玩家询问当前时间时。' +
      '何时不用：已知当前时间时。',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const { year, month } = ctx.stateSnapshot.date
        return {
          date: { year, month },
          turn: ctx.turn,
          note: toEraName(year, month)
        }
      } catch (err) {
        return { error: 'INTERNAL_ERROR', detail: String(err) }
      }
    }
  })
}
