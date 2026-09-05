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

### Requirement: 多存档槽 UI（前端，待实现）
前端 SHALL 提供存档列表入口，支持查看摘要、切换、删除（ConfirmDialog 守卫）与导出导入；列表项触摸目标 ≥88rpx。

#### Scenario: 切换存档
- **WHEN** 玩家在列表中选择另一存档并确认
- **THEN** 前端经 `GET /api/game/sync-save` 拉取完整存档写入本地并进入游戏页
