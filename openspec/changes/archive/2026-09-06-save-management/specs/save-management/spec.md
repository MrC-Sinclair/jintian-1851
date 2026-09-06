# save-management 规格

## ADDED Requirements

### Requirement: 按设备拉取存档列表
系统 SHALL 提供 `GET /api/game/saves` 接口，按 `deviceId` 返回存档摘要列表（不含完整 saveData），按 `updated_at` 倒序排列。

#### Scenario: 正常拉取列表
- **WHEN** 客户端携带有效 `deviceId` 请求 `GET /api/game/saves?deviceId=device-1&limit=20`
- **THEN** 返回 `{ ok: true, data: { saves: [...] } }`，每条含 `saveId`/`saveVersion`/`updatedAt`/`endedAt`/`endedReason`/`summary`（background/factionName/turn/ended）

#### Scenario: 参数校验
- **WHEN** 请求缺失 `deviceId` 或 `limit` 不在 1-50 范围
- **THEN** 返回 400 + `INVALID_PARAMS`

#### Scenario: saveData 结构异常容错
- **WHEN** 某行 `saveData` 缺少 `character`/`state` 字段
- **THEN** 该条 `summary` 相应字段以空值兜底返回，不返回 500

### Requirement: 存档归属一致性
存档列表 SHALL 与 sync-save 属主模型一致：仅返回归属该 `deviceId`（含跨设备继承）的存档。

#### Scenario: 归属过滤
- **WHEN** `deviceId=A` 的存档被设备 B 拉取继承后继续上传
- **THEN** 该存档仍归属 deviceId=A，出现在 A 的列表中、不出现在 B 的列表中

### Requirement: 多存档槽 UI（前端，已实现 2026-09-06）
前端 SHALL 提供存档列表入口（设置页「云端存档」区块），支持查看摘要、切换、删除（ConfirmDialog 守卫）与导出导入；列表项触摸目标 ≥88rpx。

#### Scenario: 切换存档
- **WHEN** 玩家在列表中选择另一存档并确认
- **THEN** 前端经 `GET /api/game/sync-save` 拉取完整存档写入本地并进入游戏页

#### Scenario: 删除存档
- **WHEN** 玩家对列表中某存档执行删除并经 ConfirmDialog 确认
- **THEN** 前端调用 `DELETE /api/game/saves`；若删除的是当前本地存档，同步清除本地与内存态（防幽灵存档）

#### Scenario: 导出与导入
- **WHEN** 玩家对某存档执行导出
- **THEN** 生成 JSON 文件（H5 走浏览器下载；微信小程序走剪贴板兜底），导入时校验结构（与本地读取同口径 `isValidSaveShape`）后写入本地并进入游戏页

### Requirement: 删除云端存档
系统 SHALL 提供 `DELETE /api/game/saves` 接口，按 `saveId + deviceId` 双条件原子删除，属主模型与 sync-save 一致。

#### Scenario: 正常删除
- **WHEN** 存档归属该 `deviceId`
- **THEN** 删除该存档并返回 `{ ok: true, data: { saveId, deleted: true } }`，同时 best-effort 清理该 `saveId` 的 `game_events` / `faction_memories` 记忆行（失败不阻断）

#### Scenario: 归属不符或不存在
- **WHEN** `saveId` 不存在或归属其他 `deviceId`
- **THEN** 返回 404 + `SAVE_NOT_FOUND`（同响应，防存在性泄漏）
