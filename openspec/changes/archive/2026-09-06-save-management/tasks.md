# 任务：存档管理（多存档槽 / 切换 / 删除 / 导出导入）

> 验证纪律：每个代码任务完成后，在对应子项目目录运行 `pnpm lint`；涉及类型变更额外 `pnpm typecheck`；核心逻辑变更额外 `pnpm test:unit`。命令必须在 `game-web/` 目录执行。

## 1. 后端：存档列表接口（已交付，2026-09-05）
- [x] `server/server/api/game/saves.get.ts` 新建：`GET /api/game/saves?deviceId=&limit=`（zod 校验 deviceId 必填 / limit 1-50 默认 20；摘要提取含 saveData 结构异常兜底；按 updated_at 倒序）
- [x] 测试 `server/tests/api/saves.test.ts`（7 用例：摘要提取/ended 语义/结构异常兜底/limit 透传/400×2/500）
- [x] `docs/API.md` 新增 GET /api/game/saves 章节 + 目录/通用约定口径
- 验证：`cd server && pnpm lint && pnpm typecheck && pnpm test:api` ✅（98 passed）

## 2. 后端：存档删除接口（2026-09-06 补充）
- [x] `server/server/api/game/saves.delete.ts` 新建：`DELETE /api/game/saves?saveId=&deviceId=`（zod 校验 saveId UUID / deviceId 必填；saveId+deviceId 双条件原子删除，0 行命中 404 同响应防存在性泄漏；顺带 best-effort 清理该 saveId 的 game_events / faction_memories 记忆行）
- [x] 测试 `server/tests/api/saves-delete.test.ts`（6 用例：正常删除/404/400×2/记忆清理失败不阻断/500）
- [x] `docs/API.md` 新增 DELETE /api/game/saves 章节 + 错误码表 SAVE_NOT_FOUND 触发接口更新
- 验证：`cd server && pnpm lint && pnpm typecheck` ✅ + `pnpm exec vitest run saves*.test.ts` 13 用例 ✅

## 3. 前端：多存档槽 UI（2026-09-06 交付）
- [x] `game-web/src/composables/useSaveList.ts` 新建（fetchList / switchSave / deleteSave / exportSave / importSave，isLoading + isMutating 双防重复守卫，finally 重置）
- [x] `game-web/src/utils/storage.ts` 导出 `isValidSaveShape`（导入校验与本地读取同口径）
- [x] 存档列表入口（settings 页「云端存档」区块）：列表项展示 摘要/updatedAt/ended 徽标/当前档标记，触摸目标 ≥88rpx
- [x] 切换存档：确认框 → GET sync-save 拉全量 → 写本地 → reLaunch 进游戏页（ended 存档由 game-main 自动跳结局页）；删除走 ConfirmDialog 二次确认，删除当前档同步清本地
- [x] 存档导出/导入：导出 H5 Blob 下载 / 小程序剪贴板兜底（运行时 uniPlatform 判断，同 device-id.ts 惯例）；导入 H5 动态 file input + FileReader / 小程序 chooseMessageFile + FileSystemManager；导入经 isValidSaveShape 结构校验
- [x] `game-web/src/utils/copywriting.ts` 增 `PAGE_TEXT.saveList` 文案组
- [x] 单测 `tests/unit/use-save-list.test.ts`（13 用例：列表/守卫/切换/删除含幽灵档防护/导出 H5 路径/导入三态）
- 验证：`cd game-web && pnpm lint && pnpm typecheck` ✅ + `pnpm test:unit` 全量 ✅（H5 + 微信开发者工具双端走查由用户执行）

## 4. 归档
- [x] spec 合并入 master、proposal 状态块、归档（2026-09-06）
