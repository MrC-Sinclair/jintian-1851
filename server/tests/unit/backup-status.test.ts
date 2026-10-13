/**
 * @file 备份新鲜度判定单元测试
 *
 * 覆盖：五种状态 / 阈值边界 / 失败时保住上次成功时间 / 时间不可解析 / 时区偏移
 *
 * 这个判定决定"备份静默中断"能不能被人看见，所以两类易错点要钉住：
 *   1) 连续失败不能让 lastSuccessAt 退化成 null（排查方向完全不同）
 *   2) 「从未成功」与"很久没成功"都算 stale，但 detail 必须能区分
 */
import { describe, expect, it } from 'vitest'
import { evaluateBackupStatus } from '../../server/utils/backup-status'

const NOW = Date.parse('2026-10-14T12:00:00.000Z')

function status(fields: Partial<Parameters<typeof jsonOf>[0]> = {}) {
  return JSON.stringify(jsonOf(fields))
}

function jsonOf(o: {
  ok?: boolean
  lastAttemptAt?: string
  lastSuccessAt?: string | null
  file?: string
  bytes?: number
  error?: string | null
}) {
  return {
    ok: o.ok ?? true,
    lastAttemptAt: o.lastAttemptAt ?? '2026-10-14T11:00:00.000Z',
    lastSuccessAt: 'lastSuccessAt' in o ? o.lastSuccessAt : '2026-10-14T11:00:00.000Z',
    file: o.file ?? 'jintian-2026-10-14-110000.sql.gz',
    bytes: o.bytes ?? 4096,
    error: 'error' in o ? o.error : null
  }
}

describe('evaluateBackupStatus 的五种状态', () => {
  it('未配置路径 → disabled（开发期默认，不报警）', () => {
    expect(evaluateBackupStatus({ configured: false, raw: null, nowMs: NOW, maxAgeHours: 30 })).toEqual({
      state: 'disabled',
      ageHours: null
    })
  })

  it('配了但读不到文件 → missing，并说明是"备份任务没按新脚本跑过"', () => {
    const v = evaluateBackupStatus({ configured: true, raw: null, nowMs: NOW, maxAgeHours: 30 })
    expect(v.state).toBe('missing')
    expect(v.detail).toContain('备份任务')
  })

  it('坏 JSON / 缺字段 / 非对象 → invalid（脚本被改坏要能看出来）', () => {
    const bad = [
      '{坏 JSON',
      'null',
      '"一个字符串"',
      '[]',
      '{}',
      // 缺 ok：状态机无法判断成败
      '{"lastAttemptAt":"2026-10-14T11:00:00Z","lastSuccessAt":"2026-10-14T11:00:00Z"}',
      // 缺 lastAttemptAt
      '{"ok":true,"lastSuccessAt":"2026-10-14T11:00:00Z"}'
    ]
    for (const raw of bad) {
      expect(evaluateBackupStatus({ configured: true, raw, nowMs: NOW, maxAgeHours: 30 }).state).toBe(
        'invalid'
      )
    }
  })

  it('阈值内 → fresh', () => {
    const v = evaluateBackupStatus({
      configured: true,
      raw: status({ lastSuccessAt: '2026-10-14T05:00:00.000Z' }),
      nowMs: NOW,
      maxAgeHours: 30
    })
    expect(v.state).toBe('fresh')
    expect(v.ageHours).toBe(7)
  })

  it('超阈值 → stale，detail 里带上超了多少', () => {
    const v = evaluateBackupStatus({
      configured: true,
      raw: status({ lastSuccessAt: '2026-10-12T05:00:00.000Z' }),
      nowMs: NOW,
      maxAgeHours: 30
    })
    expect(v.state).toBe('stale')
    expect(v.ageHours).toBeCloseTo(55)
    expect(v.detail).toContain('超过阈值 30 小时')
  })
})

describe('失败与边界', () => {
  it('从未成功过一次 → stale 且 ageHours 为 null（不是"0 小时"）', () => {
    const v = evaluateBackupStatus({
      configured: true,
      raw: status({ ok: false, lastSuccessAt: null, error: 'pg_dump 失败' }),
      nowMs: NOW,
      maxAgeHours: 30
    })
    expect(v.state).toBe('stale')
    expect(v.ageHours).toBeNull()
    expect(v.detail).toContain('从未成功')
  })

  it('最近一次失败但上次成功仍在阈值内 → 仍 fresh，但把失败原因带出来', () => {
    const v = evaluateBackupStatus({
      configured: true,
      raw: status({ ok: false, lastSuccessAt: '2026-10-14T09:00:00.000Z', error: '容器未运行' }),
      nowMs: NOW,
      maxAgeHours: 30
    })
    expect(v.state).toBe('fresh')
    expect(v.detail).toContain('容器未运行')
  })

  it('边界按"超过才算 stale"：正好等于阈值仍 fresh（cron 每日跑，别在最后 1 分钟误报）', () => {
    const v = evaluateBackupStatus({
      configured: true,
      raw: status({ lastSuccessAt: new Date(NOW - 30 * 3600_000).toISOString() }),
      nowMs: NOW,
      maxAgeHours: 30
    })
    expect(v.state).toBe('fresh')
  })

  it('阈值非法（0 / NaN）时回落到 30 小时，不是"任何备份都 stale"', () => {
    // 24 小时前：按 30 小时算 fresh；若非法阈值被当成 0，这里会被误判成 stale
    const raw = status({ lastSuccessAt: '2026-10-13T12:00:00.000Z' })
    expect(evaluateBackupStatus({ configured: true, raw, nowMs: NOW, maxAgeHours: 0 }).state).toBe('fresh')
    expect(
      evaluateBackupStatus({ configured: true, raw, nowMs: NOW, maxAgeHours: Number.NaN }).state
    ).toBe('fresh')
  })

  it('时间不可解析 → invalid，不拿 NaN 去比阈值', () => {
    const v = evaluateBackupStatus({
      configured: true,
      raw: status({ lastSuccessAt: '不是时间' }),
      nowMs: NOW,
      maxAgeHours: 30
    })
    expect(v.state).toBe('invalid')
    expect(v.detail).toContain('lastSuccessAt')
  })

  it('标准 ISO（Z 或带冒号偏移）都能正确算年龄', () => {
    // 脚本落的是 date -u 的 Z 形式；这里同时钉住带冒号偏移的写法
    const z = evaluateBackupStatus({
      configured: true,
      raw: status({ lastSuccessAt: '2026-10-14T11:00:00Z' }),
      nowMs: NOW,
      maxAgeHours: 30
    })
    expect(z.state).toBe('fresh')
    expect(z.ageHours).toBe(1)

    const offset = evaluateBackupStatus({
      configured: true,
      raw: status({ lastSuccessAt: '2026-10-14T19:00:00+08:00' }),
      nowMs: NOW,
      maxAgeHours: 30
    })
    expect(offset.ageHours).toBe(1)
  })

  it('完全不可解析的时间判为 invalid，不拿 NaN 去比阈值', () => {
    const v = evaluateBackupStatus({
      configured: true,
      raw: status({ lastSuccessAt: '昨天下午' }),
      nowMs: NOW,
      maxAgeHours: 30
    })
    expect(v.state).toBe('invalid')
    expect(v.detail).toContain('lastSuccessAt')
  })

  it('无冒号偏移（date +%z 的 +0800）判 invalid：Date.parse 会按读方本地时区猜', () => {
    const v = evaluateBackupStatus({
      configured: true,
      raw: status({ lastSuccessAt: '2026-10-14T02:00:00+0800' }),
      nowMs: NOW,
      maxAgeHours: 30
    })
    expect(v.state).toBe('invalid')
    expect(v.detail).toContain('ISO 8601')
  })

  it('完全没有时间部分（只有日期）也判 invalid', () => {
    const v = evaluateBackupStatus({
      configured: true,
      raw: status({ lastSuccessAt: '2026-10-14' }),
      nowMs: NOW,
      maxAgeHours: 30
    })
    expect(v.state).toBe('invalid')
  })

  it('未来时间（时钟跳变/NTP 回拨）算出负年龄时仍算 fresh，不误报成 stale', () => {
    const v = evaluateBackupStatus({
      configured: true,
      raw: status({ lastSuccessAt: new Date(NOW + 5 * 3600_000).toISOString() }),
      nowMs: NOW,
      maxAgeHours: 30
    })
    expect(v.state).toBe('fresh')
    expect(v.ageHours).toBe(-5)
  })
})
