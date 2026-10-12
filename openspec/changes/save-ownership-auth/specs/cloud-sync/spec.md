# cloud-sync 规格变更（存档归属鉴权）

## ADDED Requirements

### Requirement: 设备凭据注册
系统 SHALL 提供 `POST /api/game/device-credential`，用客户端 `deviceId` 换取服务端生成的设备凭据；
一个 `deviceId` **只能成功注册一次**（首绑即锁）。凭据为 256bit 随机值，仅在注册响应中返回一次明文，
数据库只存 `sha256`。

#### Scenario: 首次注册
- **WHEN** `deviceId` 在 `device_credentials` 中不存在且注册窗口开启
- **THEN** 以 `INSERT ... ON CONFLICT DO NOTHING RETURNING` 插入 `sha256(凭据)`，返回 `{ ok: true, data: { deviceId, token } }`
- **AND** 响应里的 `token` 是 64 位十六进制，且库里**不含**该明文

#### Scenario: 重复注册被拒（防事后冒领）
- **WHEN** `deviceId` 已绑定（含已吊销的情形）
- **THEN** 返回 409 + `CREDENTIAL_EXISTS`，不下发任何凭据
- **AND** 判定由主键约束裁决，**不采用「先查后插」**，无 Read-Modify-Write 竞态窗口

#### Scenario: 参数校验
- **WHEN** `deviceId` 缺失或非 UUID，或 body 含多余字段（zod `.strict()`）
- **THEN** 返回 400 + `INVALID_PARAMS`，不写库

#### Scenario: 注册窗口关闭
- **WHEN** `DEVICE_AUTH_ALLOW_FIRST_BIND=false`
- **THEN** 返回 403 + `ENROLLMENT_CLOSED`，且完全不触达数据库

#### Scenario: 注册限流
- **WHEN** 同一 `deviceId` 一分钟内注册请求超过 5 次
- **THEN** 返回 429 + `RATE_LIMITED`（独立的 `auth` 桶，不与 `ai`/`save` 桶挤占）

### Requirement: 存档读写的属主由凭据反查
三个存档端点（`GET/DELETE /api/game/saves`、`GET/POST /api/game/sync-save`）SHALL 以
`x-device-token` 反查出的 `deviceId` 作为**唯一属主依据**，不再采信请求自声明的值。

#### Scenario: 带有效凭据
- **WHEN** 请求头 `x-device-token` 能按 `secret_hash` 命中一条未吊销记录
- **THEN** 用该记录的 `deviceId` 作为查询/写入/删除条件里的属主值
- **AND** query/body 里的 `deviceId` 不影响属主判定

#### Scenario: 带无效凭据不降级
- **WHEN** 请求带了 `x-device-token` 但反查不到（伪造或已吊销）
- **THEN** 返回 401 + `INVALID_DEVICE_TOKEN`
- **AND** 即使请求同时声明了一个合法 `deviceId` 也不放行——降级会让冒领尝试既攻不破也排查不到

#### Scenario: POST 首插的归属取自凭据
- **WHEN** 凭据属主为 A，而 body 的 `deviceId` 声明为 B
- **THEN** 新行的 `game_saves.device_id` 写入 **A**
- **AND** 封掉「造出一行归属任意他人存档」的注档口（改造前直接写 body 值）

### Requirement: 双轨兼容期与收紧开关
系统 SHALL 支持两个运行时开关（`NUXT_` 前缀可覆盖，无需重新构建），使存量客户端不被要求重装：
`DEVICE_AUTH_ENFORCED`（默认 false）与 `DEVICE_AUTH_ALLOW_FIRST_BIND`（默认 true）。

#### Scenario: 兼容期无凭据请求
- **WHEN** `DEVICE_AUTH_ENFORCED=false` 且请求无 `x-device-token`、但声明了 `deviceId`
- **THEN** 按声明值放行（与改造前行为一致），并输出一行 `[auth-compat] deviceId=<前8位>***` 日志
- **AND** 日志不得输出完整 `deviceId`

#### Scenario: 收紧后拒绝无凭据
- **WHEN** `DEVICE_AUTH_ENFORCED=true` 且请求无凭据
- **THEN** 返回 401 + `DEVICE_TOKEN_REQUIRED`

#### Scenario: 兼容期两者皆无
- **WHEN** 无凭据且无 `deviceId`
- **THEN** 返回 400 + `INVALID_PARAMS`（保持改造前的缺参语义）

## MODIFIED Requirements

### Requirement: 上传存档接口
`POST /api/game/sync-save` MUST 接收完整 `GameSave` 对象（**不含 `updatedAt` 字段**），按 `saveId`
唯一约束写入或覆盖 PostgreSQL；`device_id` 列与 `setWhere` 条件 SHALL 使用**凭据反查出的属主**。

#### Scenario: 首次上传存档
- **WHEN** 前端携带有效凭据发送完整 `GameSave`（不含 `updatedAt`）
- **THEN** zod `.strict()` 校验结构、`saveId` 为 UUID，写入 `game_saves`，`device_id` 取凭据属主
- **AND** `updated_at` 为服务端 `NOW()`

#### Scenario: 覆盖他人存档被拒
- **WHEN** `saveId` 已存在且属主与凭据反查值不同
- **THEN** `ON CONFLICT DO UPDATE ... setWhere(device_id = 属主)` 命中 0 行，返回 403 + `SAVE_FORBIDDEN`

#### Scenario: 导入他人存档后上传
- **WHEN** 客户端导入他人导出的 JSON（blob 内 `deviceId` 是导出者的），再触发同步
- **THEN** 该 `saveId` 若未被占用，则以**导入者凭据属主**入库；若已属导出者，则 403
- **AND** `save_data` blob 内的 `deviceId` 仅作历史快照保留，服务端不采信

### Requirement: 拉取存档接口
`GET /api/game/sync-save?saveId=xxx` MUST 返回云端最新存档；属主条件 SHALL 来自凭据反查，
`deviceId` query 参数降级为兼容期兜底。

#### Scenario: 拉取存在的存档
- **WHEN** 携带凭据请求，且该 `saveId` 归属该凭据的 `deviceId`
- **THEN** 返回 `{ ok: true, data: { save, updatedAt } }`

#### Scenario: 拉取不存在或不属于自己
- **WHEN** `saveId` 不存在，或归属其他属主
- **THEN** 统一返回 404 + `SAVE_NOT_FOUND`（不泄漏他人存档存在性）

### Requirement: 数据库表结构
`server/server/db/schema.ts` MUST 含 `game_saves` 与新增的 `device_credentials` 两张同步相关表；
`game_saves.device_id` 的语义由「客户端自声明的设备指纹」改为「凭据反查出的属主标识」。

#### Scenario: device_credentials 结构
- **WHEN** 执行 `pnpm db:push`
- **THEN** 生成 `device_credentials(device_id text PRIMARY KEY, secret_hash text NOT NULL UNIQUE, revoked_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT NOW())`
- **AND** `secret_hash` 上有唯一索引（每次带凭据的请求都按它等值反查）
- **AND** 与 `game_saves` **不建外键**：存档行需能在凭据被吊销后留存

#### Scenario: 存量存档无需迁移
- **WHEN** 新表上线
- **THEN** `game_saves` 既有行的 `device_id` 一个都不改
- **AND** 只是写入该值的途径改为必须经凭据校验，因此不构成破坏性变更
