/**
 * @file 凭据吊销的纯逻辑（参数解析 + 决策 + 文案），供 revoke-credential CLI 与单测共用
 *
 * 拆出来的理由与 lib/llm-cost.ts 一样：真正会写库的那几行不值得测，
 * 值得测的是「给一个行状态该做什么」和「操作后到底封住了什么」——
 * 后者容易被误读成"按下去就断访问"，必须把兼容通道那个坑明写在输出里。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface RevokeArgs {
  deviceId: string
  dryRun: boolean
}

/** 解析 argv；非法输入返回 null（CLI 侧据此打 usage 并退 1） */
export function parseRevokeArgs(argv: string[]): RevokeArgs | null {
  const flags = argv.filter((a) => a.startsWith('--'))
  const positional = argv.filter((a) => !a.startsWith('--'))

  if (positional.length !== 1) return null
  if (flags.some((f) => f !== '--dry-run')) return null
  const deviceId = positional[0]
  if (!UUID_RE.test(deviceId)) return null

  return { deviceId, dryRun: flags.includes('--dry-run') }
}

/** 库里查出的行（只取决策需要的列） */
export interface CredentialRowState {
  deviceId: string
  secretHash: string
  createdAt: Date
  revokedAt: Date | null
}

export type RevokeAction =
  /** 没有该设备的凭据行 */
  | { kind: 'missing' }
  /** 已是吊销态，幂等退出 */
  | { kind: 'already' }
  /** 需要写 revoked_at */
  | { kind: 'revoke' }

export function decideAction(row: CredentialRowState | undefined): RevokeAction {
  if (!row) return { kind: 'missing' }
  return row.revokedAt ? { kind: 'already' } : { kind: 'revoke' }
}

/** 掩码：设备与凭据都只留前 8 位，完整值不进日志/终端历史 */
export function mask(value: string): string {
  return `${value.slice(0, 8)}***`
}

/** 当前凭据状态一行（dry-run 与执行前都用它） */
export function describeRow(row: CredentialRowState): string {
  const state = row.revokedAt ? `已吊销（${row.revokedAt.toISOString()}）` : '有效'
  return (
    `设备 ${mask(row.deviceId)} 凭据 ${mask(row.secretHash)} ` +
    `注册于 ${row.createdAt.toISOString()} 当前=${state}`
  )
}

/**
 * 吊销后的实际效果说明
 *
 * enforced 未开时，客户端拿旧凭据会 401 → 自愈清缓存 → 重注册被 409 拒 →
 * 回落 `deviceId` 自声明通道，**仍能读写自己的存档**。这点必须明写，
 * 否则运营会以为按下去就把人封住了。
 */
export function describeEffect(enforced: boolean): string {
  if (enforced) {
    return '效果：该设备凭据已失效，且旧通道已收紧（enforced=true）→ 无法再读写云端存档'
  }
  return (
    '效果：凭据已失效，但当前未收紧（NUXT_DEVICE_AUTH_ENFORCED≠true）→ ' +
    '该设备会退回 deviceId 自声明通道，仍能读写自己的存档。' +
    '要真阻断访问需先置 enforced=true，或另行删除其存档行'
  )
}

export function revokeUsage(): string {
  return [
    '用法：pnpm auth:revoke <deviceId> [--dry-run]',
    '',
    '  deviceId   要吊销的设备标识（UUID；只按 deviceId 吊销，不接受凭据原文）',
    '  --dry-run  只报当前状态，不写库',
    '',
    '环境变量：DATABASE_URL（必填，缺失即退 1，不回落开发默认串）',
    '',
    '注意：吊销只让凭据失效，game_saves 的行按设计留存；',
    '      兼容期内该设备仍可退回 deviceId 自声明通道读自己的存档。'
  ].join('\n')
}
