/**
 * @file 存档鉴权事件日志（收紧决策的数据源）
 *
 * 收紧到 `DEVICE_AUTH_ENFORCED=true` 之前必须回答两个问题：旧通道还剩多少流量、
 * 401 集中在哪一类。此前只有 `[auth-compat]` 一条人读的日志，没有分母
 * （带凭据成功的请求不记录），算不出占比；401/409/403 也完全无痕。
 *
 * 取向与 `[llm-usage]` 一致：**单行 JSON、不落库、不引常驻服务**（2C2G 机器上
 * 日志是既有的唯一数据源），离线由 `server/scripts/auth-report.ts` 聚合。
 *
 * 隐私：只记 deviceId 前 8 位。完整标识既不落盘也不进 URL —— 与 `[auth-compat]`
 * 同一条纪律（见 device-auth.ts）。
 */

/** 事件类型（新增取值时同步 auth-report 的口径说明） */
export const AUTH_EVENT_KINDS = [
  /** 带有效凭据，属主由凭据反查（收紧后要留存的唯一通道） */
  'owner_by_token',
  /** 无凭据、按客户端自声明的 deviceId 放行（兼容期残余流量） */
  'owner_by_compat',
  /** 带了凭据但库里查不到或已吊销 → 401，不降级 */
  'invalid_token',
  /** 收紧后无凭据的请求 → 401 */
  'token_required',
  /** 既无凭据也无 deviceId → 400 */
  'missing_identity',
  /** 首次绑定成功，下发凭据 */
  'enrolled',
  /**
   * 首绑落在「已经有云端存档、但此前没有凭据」的设备上
   *
   * 收紧第二步（ALLOW_FIRST_BIND=false）等的是这种设备的合法属主自己回来注册；
   * 但在协议层，合法自愈与「已知他人 deviceId 的冒领者」完全不可区分，所以服务端
   * **不因此拒绝**（拒绝等于把那个玩家永久挡在门外），只把它单独记一条，
   * 让运维能按设备前缀报警而不是事后翻存档。
   */
  'enroll_over_existing_saves',
  /** 重复注册被拒 → 409（含冒领尝试与已吊销设备） */
  'enroll_exists',
  /** 注册已关闭（allowFirstBind=false）→ 403 */
  'enroll_closed'
] as const

export type AuthEventKind = (typeof AUTH_EVENT_KINDS)[number]

/** deviceId → 前 8 位掩码（空值给空串，便于聚合侧区分「无标识」） */
export function maskDeviceId(deviceId: string | undefined | null): string {
  return deviceId ? deviceId.slice(0, 8) : ''
}

/**
 * 打一条鉴权事件日志
 * @param kind 事件类型
 * @param deviceIdHint 本次请求涉及的 deviceId（凭据反查出的权威值优先，没有则客户端声明值）
 */
export function logAuthEvent(kind: AuthEventKind, deviceIdHint?: string | null): void {
  console.log(
    `[auth-event] ${JSON.stringify({
      ts: new Date().toISOString(),
      kind,
      device: maskDeviceId(deviceIdHint)
    })}`
  )
}
