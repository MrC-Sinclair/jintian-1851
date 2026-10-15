/**
 * @file [auth-event] 聚合逻辑单元测试
 *
 * 覆盖：脏行容忍 / 兼容占比口径 / 三态收紧判据 / 报告文案
 *
 * 这个聚合结果是「能不能置 DEVICE_AUTH_ENFORCED=true」的唯一依据，
 * 所以「没样本」必须区别于「已归零」——两者混成一个 0 就会误收紧，把老玩家挡在门外。
 */
import { describe, expect, it } from 'vitest'
import {
  compatVerdict,
  formatReport,
  KNOWN_AUTH_KINDS,
  parseAuthLines,
  summarize,
  type AuthEvent
} from '../../server/scripts/lib/auth-report'
import { AUTH_EVENT_KINDS } from '../../server/utils/auth-event'

function event(kind: string, device = 'aaaaaaaa', ts = '2026-10-14T00:00:00.000Z'): AuthEvent {
  return { kind, device, ts }
}

describe('parseAuthLines', () => {
  it('抽出 [auth-event] 行，docker 日志的时间戳前缀不影响解析', () => {
    const lines = [
      '2026-10-14T00:00:01.000000000Z 2026-10-14T00:00:01.000Z [auth-event] {"ts":"2026-10-14T00:00:01.000Z","kind":"owner_by_token","device":"aaaaaaaa"}',
      '2026-10-14T00:00:02.000000000Z Nitro 的访问日志一堆字',
      '2026-10-14T00:00:03.000000000Z [auth-event] {"ts":"2026-10-14T00:00:03.000Z","kind":"owner_by_compat","device":"bbbbbbbb"}'
    ]
    const out = parseAuthLines(lines)
    expect(out).toHaveLength(2)
    expect(out.map((e) => e.kind)).toEqual(['owner_by_token', 'owner_by_compat'])
    expect(out[1].device).toBe('bbbbbbbb')
  })

  it('JSON 不合法 / kind 不在白名单 / 缺字段都跳过，不抛错', () => {
    const lines = [
      '[auth-event] {坏 JSON',
      '[auth-event] null',
      '[auth-event] {"kind":"not_a_kind","device":"x"}',
      '[auth-event] {"device":"x"}',
      '[auth-event] {"kind":"invalid_token"}'
    ]
    const out = parseAuthLines(lines)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ ts: '', kind: 'invalid_token', device: '' })
  })

  // 首绑落在已有存档的设备上 = 收紧期间唯一能区分「合法自愈」与「冒领」的信号，
  // 一旦漏出白名单就会被当成脏行静默跳过，报警也就永远不响
  it('enroll_over_existing_saves 在白名单内，不被当脏行丢掉', () => {
    const out = parseAuthLines([
      '[auth-event] {"ts":"2026-10-15T00:00:00.000Z","kind":"enroll_over_existing_saves","device":"2b545cbc"}'
    ])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('enroll_over_existing_saves')
    expect(out[0].device).toBe('2b545cbc')
  })

  // 持有证明闸门的三个判定同理：翻开 REQUIRE_POSSESSION 之前，
  // 全靠这三条的分布判断"合法属主能不能出示证明"，被静默丢掉就会误开开关
  it('enroll_proof_absent / _mismatch / _ok 都在白名单内', () => {
    const out = parseAuthLines([
      '[auth-event] {"kind":"enroll_proof_absent","device":"aaaaaaaa"}',
      '[auth-event] {"kind":"enroll_proof_mismatch","device":"bbbbbbbb"}',
      '[auth-event] {"kind":"enroll_proof_ok","device":"cccccccc"}'
    ])
    expect(out).toHaveLength(3)
    expect(out.map((e) => e.kind)).toEqual([
      'enroll_proof_absent',
      'enroll_proof_mismatch',
      'enroll_proof_ok'
    ])
  })
})

describe('summarize', () => {
  it('兼容占比只按成功裁决算（401/注册事件不进分母）', () => {
    const s = summarize([
      event('owner_by_token'),
      event('owner_by_token'),
      event('owner_by_compat'),
      event('invalid_token'),
      event('enroll_exists'),
      event('missing_identity')
    ])
    expect(s.total).toBe(6)
    expect(s.compatShare).toBeCloseTo(1 / 3)
    expect(s.byKind.invalid_token).toBe(1)
    expect(s.byKind.owner_by_token).toBe(2)
  })

  it('没有成功裁决时占比是 null 而不是 0', () => {
    const s = summarize([event('invalid_token'), event('enrolled')])
    expect(s.compatShare).toBeNull()
  })

  it('设备前缀去重计数，空 device 不计入', () => {
    const s = summarize([
      event('owner_by_token', 'aaaaaaaa'),
      event('owner_by_compat', 'bbbbbbbb'),
      event('owner_by_token', 'aaaaaaaa'),
      event('invalid_token', '')
    ])
    expect(s.distinctDevicePrefixes).toBe(2)
    expect(s.firstTs).toBe('2026-10-14T00:00:00.000Z')
    expect(s.lastTs).toBe('2026-10-14T00:00:00.000Z')
  })
})

// 两份 kind 表（事件侧定义、聚合侧白名单）必须一致：
// 漏一个的话那条日志会被 parseAuthLines 当脏行静默丢掉，报警永远不响，
// 而且没有任何报错——所以用一致性断言兜住，而不是靠人记得补用例
describe('kind 表一致性', () => {
  it('AUTH_EVENT_KINDS 与 KNOWN_AUTH_KINDS 完全相同', () => {
    expect([...AUTH_EVENT_KINDS].sort()).toEqual([...KNOWN_AUTH_KINDS].sort())
  })
})

describe('compatVerdict（收紧闸门）', () => {
  it('兼容为 0 且有成功裁决 → resolved', () => {
    expect(compatVerdict(summarize([event('owner_by_token'), event('owner_by_token')]))).toEqual({
      status: 'resolved',
      compatCount: 0
    })
  })

  it('仍有兼容流量 → pending，并给出条数', () => {
    expect(
      compatVerdict(summarize([event('owner_by_token'), event('owner_by_compat', 'bbbbbbbb')]))
    ).toEqual({ status: 'pending', compatCount: 1 })
  })

  it('窗口内全是失败/注册事件 → no_data（不能当归零）', () => {
    expect(compatVerdict(summarize([event('invalid_token')]))).toEqual({
      status: 'no_data',
      compatCount: 0
    })
    expect(compatVerdict(summarize([]))).toEqual({ status: 'no_data', compatCount: 0 })
  })
})

describe('formatReport', () => {
  it('兼容计数为 0 也照样列出来（归零是要看的数，不是要藏的数）', () => {
    const out = formatReport(summarize([event('owner_by_token')]))
    expect(out).toMatch(/owner_by_compat\s+0/)
    expect(out).toContain('兼容通道占比 0.00%')
  })

  it('无成功裁决时明写"无法判断"', () => {
    const out = formatReport(summarize([event('token_required')]))
    expect(out).toContain('无法判断')
  })
})
