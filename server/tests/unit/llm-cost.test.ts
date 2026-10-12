/**
 * @file [llm-usage] 成本聚合单元测试（scripts/lib/llm-cost.ts）
 *
 * 覆盖：日志解析容错 / 端点与按天聚合 / 单局归因口径 / 阈值判定 / 报告文本
 */
import { describe, expect, it } from 'vitest'

import {
  exceedsDailyLimit,
  formatReport,
  parseUsageLines,
  summarize,
  type UsageRecord
} from '../../server/scripts/lib/llm-cost'

function usageLine(payload: Record<string, unknown>): string {
  return `[llm-usage] ${JSON.stringify(payload)}`
}

/** 构造一条用量记录：token 字段默认 0，只填关心的维度 */
function rec(p: Partial<UsageRecord> & { endpoint: string }): UsageRecord {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, ...p }
}

describe('parseUsageLines', () => {
  it('解析标准行并补齐 totalTokens', () => {
    const text = [
      'some unrelated log',
      usageLine({ endpoint: 'generate-event', inputTokens: 1500, outputTokens: 600, totalTokens: 2100 }),
      usageLine({ endpoint: 'npc-actions', inputTokens: 1200, outputTokens: 500 }),
      '[resolve-decision] LLM 返回: {"effects":{}}'
    ].join('\n')

    const { records, unparsed } = parseUsageLines(text)
    expect(records).toHaveLength(2)
    expect(unparsed).toBe(0)
    expect(records[0].endpoint).toBe('generate-event')
    // 第二条缺 totalTokens，由 input+output 推出
    expect(records[1].totalTokens).toBe(1700)
  })

  it('识别 docker 行首时间戳（无时间戳时为 undefined）', () => {
    const text = [
      '2026-10-11T02:03:04.567890123Z [llm-usage] {"endpoint":"advisor-chat","totalTokens":2500,"saveId":"s1","turn":3}',
      '2026-10-11T02:04:00Z [llm-usage] {"endpoint":"advisor-chat","totalTokens":2500,"saveId":"s1","turn":4}',
      '[llm-usage] {"endpoint":"advisor-chat","totalTokens":100}'
    ].join('\n')

    const { records } = parseUsageLines(text)
    expect(records[0].date).toBe('2026-10-11')
    expect(records[0].saveId).toBe('s1')
    expect(records[0].turn).toBe(3)
    expect(records[2].date).toBeUndefined()
  })

  it('坏 JSON / 缺 endpoint 计入 unparsed，不抛错', () => {
    const text = [
      '[llm-usage] {not json',
      '[llm-usage] {"inputTokens":10}',
      usageLine({ endpoint: 'ok', totalTokens: 10 })
    ].join('\n')

    const { records, unparsed } = parseUsageLines(text)
    expect(records).toHaveLength(1)
    expect(unparsed).toBe(2)
  })

  it('全零 token 的记录保留但计为 emptyUsage（provider 没回 usage）', () => {
    const { records, unparsed } = parseUsageLines(usageLine({ endpoint: 'init-factions' }))
    expect(unparsed).toBe(0)
    expect(records[0].totalTokens).toBe(0)
  })

  it('CRLF 与行内多处标志都安全', () => {
    const text = `${usageLine({ endpoint: 'a', totalTokens: 10 })}\r\nxx ${usageLine({ endpoint: 'b', totalTokens: 20 })}`
    const { records } = parseUsageLines(text)
    expect(records.map((r) => r.endpoint)).toEqual(['a', 'b'])
  })
})

describe('summarize', () => {
  it('按端点聚合并按 token 降序、成本按单价折算', () => {
    // 用单价 1.0 让折算没有舍入边界：1000 tokens = ¥0.001
    const s = summarize(
      [
        rec({ endpoint: 'npc-actions', totalTokens: 4000, saveId: 's1' }),
        rec({ endpoint: 'generate-event', totalTokens: 9000, saveId: 's1' }),
        rec({ endpoint: 'init-factions', totalTokens: 1000 })
      ],
      1
    )

    expect(s.totalTokens).toBe(14000)
    expect(s.totalCostCny).toBe(0.014)
    expect(s.byEndpoint[0].endpoint).toBe('generate-event')
    expect(s.byEndpoint[0].costCny).toBe(0.009)
    expect(s.byEndpoint[1].calls).toBe(1)
  })

  it('默认单价 0.35（与 docs/ai-cost.md 一致），1M tokens = ¥0.35', () => {
    const s = summarize([rec({ endpoint: 'a', totalTokens: 1_000_000 })])
    expect(s.pricePerMTok).toBe(0.35)
    expect(s.totalCostCny).toBe(0.35)
  })

  it('单局口径只算带 saveId 的部分，并给出可归因占比', () => {
    const s = summarize([
      rec({ endpoint: 'generate-event', totalTokens: 8000, saveId: 's1' }),
      rec({ endpoint: 'generate-event', totalTokens: 8000, saveId: 's2' }),
      rec({ endpoint: 'init-factions', totalTokens: 4000 })
    ])

    expect(s.games).toBe(2)
    // 可归因 16000 tokens → ¥0.0056 → 每局 ¥0.0028
    expect(s.attributableCostCny).toBe(0.0056)
    expect(s.costPerGameCny).toBe(0.0028)
    expect(s.attributableShare).toBe(0.8)
  })

  it('有时间戳时按天分桶；混合缺时间戳则 hasTimestamps=false', () => {
    const s = summarize([
      rec({ endpoint: 'a', totalTokens: 1000, date: '2026-10-10' }),
      rec({ endpoint: 'a', totalTokens: 2000, date: '2026-10-11' })
    ])
    expect(s.hasTimestamps).toBe(true)
    expect(s.byDay.map((d) => d.date)).toEqual(['2026-10-10', '2026-10-11'])
    expect(s.byDay[1].costCny).toBe(0.0007)

    const mixed = summarize([
      rec({ endpoint: 'a', totalTokens: 1000, date: '2026-10-10' }),
      rec({ endpoint: 'a', totalTokens: 1000 })
    ])
    expect(mixed.hasTimestamps).toBe(false)
  })

  it('空输入不炸，各项归零', () => {
    const s = summarize([])
    expect(s.records).toBe(0)
    expect(s.totalCostCny).toBe(0)
    expect(s.costPerGameCny).toBe(0)
    expect(s.attributableShare).toBe(0)
    expect(s.unparsed).toBe(0)
  })

  it('unparsed 计数原样带回', () => {
    expect(summarize([], 0.35, 7).unparsed).toBe(7)
  })
})

describe('阈值与报告', () => {
  it('exceedsDailyLimit 只挑出超阈值的日', () => {
    const s = summarize([
      rec({ endpoint: 'a', totalTokens: 1_000_000, date: '2026-10-10' }),
      rec({ endpoint: 'a', totalTokens: 10_000, date: '2026-10-11' })
    ])
    // 1M tokens = ¥0.35
    const over = exceedsDailyLimit(s, 0.2)
    expect(over.map((d) => d.date)).toEqual(['2026-10-10'])
    expect(exceedsDailyLimit(s, 10)).toEqual([])
  })

  it('报告文本含总量、单局口径、按天与超阈值标记', () => {
    const parsed = parseUsageLines(
      [
        '2026-10-10T00:00:01Z ' + usageLine({ endpoint: 'generate-event', totalTokens: 3_000_000, saveId: 's1' }),
        '2026-10-10T00:00:02Z ' + usageLine({ endpoint: 'init-factions', totalTokens: 1000 })
      ].join('\n')
    )
    const s = summarize(parsed.records, 0.35, parsed.unparsed)
    const text = formatReport(s, { dailyLimitCny: 0.5 })

    expect(text).toContain('3,001,000')
    expect(text).toContain('generate-event')
    expect(text).toContain('每局')
    expect(text).toContain('2026-10-10')
    expect(text).toContain('超阈值')
  })

  it('emptyUsage 会被显式提示（成本被低估的信号不能静默）', () => {
    const text = formatReport(summarize([rec({ endpoint: 'a' })]))
    expect(text).toContain('provider 未回 usage')
  })
})
