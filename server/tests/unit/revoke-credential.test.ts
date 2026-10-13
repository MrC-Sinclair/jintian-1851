/**
 * @file 吊销脚本纯逻辑单元测试
 *
 * 覆盖：参数校验 / 三种行状态的决策 / 掩码 / 「吊销到底封住了什么」的两种文案
 *
 * 写库那几行不在测试范围（需要真库），但"吊销≠断访问"这个语义是本脚本最容易
 * 被误读的地方，所以文案的两个分支也要测住。
 */
import { describe, expect, it } from 'vitest'
import {
  decideAction,
  describeEffect,
  describeRow,
  mask,
  parseRevokeArgs,
  type CredentialRowState
} from '../../server/scripts/lib/revoke'

const ID = '11111111-2222-4333-8444-555555555555'

function row(overrides: Partial<CredentialRowState> = {}): CredentialRowState {
  return {
    deviceId: ID,
    secretHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    createdAt: new Date('2026-10-13T08:00:00.000Z'),
    revokedAt: null,
    ...overrides
  }
}

describe('parseRevokeArgs', () => {
  it('接受 deviceId，可选 --dry-run', () => {
    expect(parseRevokeArgs([ID])).toEqual({ deviceId: ID, dryRun: false })
    expect(parseRevokeArgs([ID, '--dry-run'])).toEqual({ deviceId: ID, dryRun: true })
    expect(parseRevokeArgs(['--dry-run', ID])).toEqual({ deviceId: ID, dryRun: true })
  })

  it('缺参 / 多参 / 非 UUID / 未知开关一律拒绝（拒绝比猜意图好，这是写库操作）', () => {
    expect(parseRevokeArgs([])).toBeNull()
    expect(parseRevokeArgs([ID, ID])).toBeNull()
    expect(parseRevokeArgs(['not-a-uuid'])).toBeNull()
    expect(parseRevokeArgs(['11111111-2222-4333-8444-55555555555'])).toBeNull()
    expect(parseRevokeArgs([ID, '--force'])).toBeNull()
  })
})

describe('decideAction', () => {
  it('无行 → missing；已吊销 → already（幂等）；有效 → revoke', () => {
    expect(decideAction(undefined).kind).toBe('missing')
    expect(decideAction(row({ revokedAt: new Date('2026-10-14T00:00:00Z') })).kind).toBe('already')
    expect(decideAction(row()).kind).toBe('revoke')
  })
})

describe('mask / describeRow', () => {
  it('设备与凭据都只留前 8 位，完整值不外泄', () => {
    expect(mask(ID)).toBe('11111111***')
    const line = describeRow(row())
    expect(line).toContain('11111111***')
    expect(line).toContain('deadbeef***')
    expect(line).not.toContain(ID)
    expect(line).not.toContain('deadbeefdeadbeef')
    expect(line).toContain('当前=有效')
  })

  it('已吊销状态把时间一起报出来（避免误以为还能用）', () => {
    const line = describeRow(row({ revokedAt: new Date('2026-10-14T09:30:00.000Z') }))
    expect(line).toContain('已吊销（2026-10-14T09:30:00.000Z）')
  })
})

describe('describeEffect（吊销到底封住了什么）', () => {
  it('未收紧时明说仍会退回 deviceId 自声明通道', () => {
    const t = describeEffect(false)
    expect(t).toContain('仍能读写自己的存档')
    expect(t).toContain('deviceId')
    expect(t).toContain('NUXT_DEVICE_AUTH_ENFORCED')
  })

  it('已收紧时才可以说"无法再读写云端存档"', () => {
    const t = describeEffect(true)
    expect(t).toContain('无法再读写云端存档')
    expect(t).not.toContain('仍能读写自己的存档')
  })
})
