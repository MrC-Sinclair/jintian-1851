# 任务：存档管理与历史事件语义去重

> 验证纪律：每个代码任务完成后，在对应子项目目录运行 `pnpm lint`；涉及类型变更额外 `pnpm typecheck`；核心逻辑变更额外 `pnpm test:unit`。命令必须在 `game-web/` 或 `server/` 各自目录执行。

## 1. 后端：存档列表接口（已交付，2026-09-05）
- [x] `server/server/api/game/saves.get.ts` 新建：`GET /api/game/saves?deviceId=&limit=`（zod 校验 deviceId 必填 / limit 1-50 默认 20；摘要提取含 saveData 结构异常兜底；按 updated_at 倒序）
- [x] 测试 `server/tests/api/saves.test.ts`（7 用例：摘要提取/ended 语义/结构异常兜底/limit 透传/400×2/500）
- [x] `docs/API.md` 新增 GET /api/game/saves 章节 + 目录/通用约定口径
- 验证：`cd server && pnpm lint && pnpm typecheck && pnpm test:api` ✅（98 passed）

## 2. 前端：多存档槽 UI（待做）
- [ ] `game-web/src/composables/` 增 `useSaveList`（调 GET /api/game/saves，含防重复提交守卫）
- [ ] 存档列表入口（settings 页或首页）：列表项展示 摘要/updatedAt/ended 徽标，触摸目标 ≥88rpx
- [ ] 切换存档：拉取完整存档（GET sync-save）→ 写入本地 → 进游戏页；删除走 ConfirmDialog
- [ ] 存档导出/导入（JSON 文件，H5 下载 + 小程序文件消息兼容方案）
- 验证：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit`，H5 + 微信开发者工具双端走查

## 3. 后端：pgvector 语义去重（待做，依赖 embedding 成本决策）
- [ ] `server/server/db/schema.ts` 新增 `game_events` 表（saveId/eventId/title+description embedding vector(1024)，HNSW 索引）→ `pnpm db:push` + 同步 `docs/db-schema.md`
- [ ] `server/server/utils/embeddings.ts`：SiliconFlow embeddings 封装（失败降级，enable_thinking 不适用）
- [ ] 事件落库/结束回合时异步向量化（fire-and-forget，不阻塞回合）
- [ ] `generate-event` LLM 路径生成前相似度检索（阈值 0.9），命中时注入避重指令或走 fallback 池；`docs/ai-cost.md` 补 embedding 成本行
- [ ] 单元/集成测试（降级路径全覆盖：embedding 失败/检索失败/表空）
- 验证：`cd server && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:api`

## 4. 归档
- [ ] spec 合并入 `openspec/specs/save-management/spec.md` master（新建），proposal.md 追加状态块，目录移入 `archive/`
