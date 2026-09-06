# 提案：存档管理（多存档槽 / 切换 / 删除 / 导出导入）

> 本提案自 `2026-09-05-save-management-and-semantic-dedup` 拆分而来（2026-09-06）：原提案「语义去重」部分已由 `2026-09-06-ai-long-term-memory` 提案承接完成并归档，存档管理部分按 openspec「一个提案一个主题」惯例独立成篇继续执行。

## 为什么 / Why

**存档管理能力缺口**：本地仅单 key 存档（`game_save`），玩家无多存档槽、无存档列表、无导出导入；换设备/重开即丢弃整局进度。数据库侧 `idx_game_saves_device_id` 索引自 MVP 起预留却无任何对应查询（后端 `GET /api/game/saves` 已于 2026-09-05 交付，前端入口缺失）。

## 改什么 / What Changes

- **后端（已交付）**：`GET /api/game/saves?deviceId=&limit=` 存档摘要列表接口（2026-09-05，命中预留索引，只返回摘要不含 saveData blob）；`DELETE /api/game/saves?saveId=&deviceId=` 存档删除接口（2026-09-06 补充，双条件原子删除 + 记忆行清理，删除能力闭环必需）。均见 `docs/API.md`。
- **前端（已交付，2026-09-06）**：`useSaveList` composable + 设置页「云端存档」区块（摘要/徽标/当前档标记、切换、删除走 ConfirmDialog）；存档导出/导入（JSON，H5 下载 / 小程序剪贴板兜底 + chooseMessageFile 导入）。
- **文档**：`docs/API.md` 已同步（含 DELETE 章节）。

## 影响 / Impact

| 影响面 | 改动 |
|---|---|
| 前端 `game-web` | `useSaveList` composable + 设置页存档列表/切换/删除 UI + 导出导入（均新增） |
| 后端 `server` | `saves.delete.ts` 新增（2026-09-06）；`saves.get.ts` 无改动 |
| 数据库 | 无新增表 |
| API | 新增 `DELETE /api/game/saves`；复用既有 `GET /api/game/saves` 与 `GET /api/game/sync-save` |
| 文档 | `docs/API.md` 已含存档列表与删除章节 |

## 能力 / Capabilities

### New Capabilities
- `save-management` - 多存档管理：按设备列表、摘要展示、多槽切换与删除、导出导入

---

## 状态 / Status

**状态：已实现并验证（2026-09-06），spec 已合并入 `openspec/specs/save-management/spec.md`。**

### 交付清单
- 后端：`GET /api/game/saves`（2026-09-05）+ `DELETE /api/game/saves`（2026-09-06，实现期补充——spec 要求删除能力而原 proposal 误写「无新增端点」，按多方案确认模式经用户拍板新增）
- 前端：`useSaveList`（fetchList/switchSave/deleteSave/exportSave/importSave，双防重复守卫）+ 设置页「云端存档」区块（摘要/徽标/当前档标记/≥88rpx 触摸目标）+ 导出导入跨端方案
- 测试：server `saves-delete.test.ts` 6 用例；game-web `use-save-list.test.ts` 13 用例
- 文档：`docs/API.md` GET/DELETE 两章节 + 错误码表更新

### 实现要点与偏差
- 平台判断用运行时 `uni.getSystemInfoSync().uniPlatform`（同 device-id.ts / AppIcon 惯例），不用条件编译——vitest 无编译步骤，运行时判断行为可预期
- 删除当前本地档时同步清本地 + store 置空（防幽灵存档）
- 删除接口顺带 best-effort 清理该 saveId 的记忆行（game_events / faction_memories），防孤儿数据
- H5 + 微信开发者工具双端走查待用户实机执行（本机仅有 H5 可自动化验证）
