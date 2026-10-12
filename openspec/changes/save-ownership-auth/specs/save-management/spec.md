# save-management 规格变更（存档归属鉴权）

## ADDED Requirements

### Requirement: 前端凭据换取与兼容回落
前端 SHALL 在执行任何云端存档操作前 `await ensureCredential()`：本地已有凭据直接用，
没有则用 `deviceId` 注册换取并持久化；换取失败**不阻断**操作，回落到兼容通道。

#### Scenario: 首次换取
- **WHEN** 本地存储无 `game_device_token`
- **THEN** 调用 `POST /api/game/device-credential`，成功后把凭据写入存储（H5 `localStorage` / 小程序 `uni.setStorageSync`）
- **AND** 此后 `utils/api.ts` 对每个请求自动注入 `x-device-token` 头

#### Scenario: 并发去重
- **WHEN** 两处同时触发 `ensureCredential()`
- **THEN** 只发出一个注册请求（模块级 in-flight 复用），异步完成后重置

#### Scenario: 被拒后停止重试
- **WHEN** 服务端返回 409 `CREDENTIAL_EXISTS` 或 403 `ENROLLMENT_CLOSED`
- **THEN** 标记 blocked，本次会话不再重试；网络失败与 429 **不**标记（下次仍试）

#### Scenario: 有凭据时不再在 URL 声明 deviceId
- **WHEN** `ensureCredential()` 返回非空
- **THEN** 存档请求的 URL 不含 `deviceId` 参数（属主由请求头证明，不再进浏览器历史）
- **AND** 返回空时才回落成 `&deviceId=...`，以兼容尚未收紧的服务端

## MODIFIED Requirements

### Requirement: 按设备拉取存档列表
系统 SHALL 提供 `GET /api/game/saves` 接口，按**凭据反查出的属主**返回存档摘要列表
（不含完整 saveData），按 `updated_at` 倒序排列；`deviceId` query 参数降级为兼容期兜底。

#### Scenario: 正常拉取列表
- **WHEN** 客户端携带有效 `x-device-token` 请求 `GET /api/game/saves?limit=20`（不带 `deviceId`）
- **THEN** 返回 `{ ok: true, data: { saves: [...] } }`，每条含 `saveId`/`saveVersion`/`updatedAt`/`endedAt`/`endedReason`/`summary`

#### Scenario: 凭据无效
- **WHEN** `x-device-token` 反查不到未吊销的凭据
- **THEN** 返回 401 + `INVALID_DEVICE_TOKEN`，不因请求另带了 `deviceId` 而放行

### Requirement: 存档归属一致性
存档列表 SHALL 与 sync-save 属主模型一致：仅返回归属**凭据反查属主**的存档。
原「跨设备继承」语义（导入他人存档后继承其 deviceId）已废弃——deviceId 不再构成权限，
导入的存档在首次上传时以**导入者的凭据属主**入库。

#### Scenario: 归属过滤
- **WHEN** 凭据 A 与凭据 B 分别请求列表
- **THEN** 各自只看到自己 `device_id` 名下的存档

#### Scenario: 导入他人存档
- **WHEN** 设备 B 导入设备 A 导出的 JSON 并同步
- **THEN** 该 `saveId` 未被占用时归属 B；已归属 A 时 POST 返回 403 `SAVE_FORBIDDEN`（不覆盖 A 的档）

### Requirement: 删除云端存档
系统 SHALL 提供 `DELETE /api/game/saves` 接口，按 `saveId + 凭据反查属主` 双条件原子删除，
且记忆行清理 SHALL 发生在属主证明之后。

#### Scenario: 正常删除
- **WHEN** 存档归属该凭据的 `deviceId`
- **THEN** 删除存档并返回 `{ ok: true, data: { saveId, deleted: true } }`，随后 best-effort 清理该 `saveId`
      的 `game_events` / `faction_memories`（失败仅告警，不影响已成功的删除）

#### Scenario: 归属不符或不存在时不得触碰记忆行
- **WHEN** `saveId` 不存在或归属其他属主（主删除命中 0 行）
- **THEN** 返回 404 + `SAVE_NOT_FOUND`，且**不执行任何记忆行删除**
- **AND** 理由：`game_events` / `faction_memories` 无 `device_id` 列，
      属主只能由存档主删除的返回行数证明；先清记忆会让知道他人 `saveId` 的人擦掉对方的记忆行
