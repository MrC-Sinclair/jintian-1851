# 任务：存档管理与历史事件语义去重

> 验证纪律：每个代码任务完成后，在对应子项目目录运行 `pnpm lint`；涉及类型变更额外 `pnpm typecheck`；核心逻辑变更额外 `pnpm test:unit`。命令必须在 `game-web/` 或 `server/` 各自目录执行。

## 1. 后端：存档列表接口（已交付，2026-09-05）
- [x] `server/server/api/game/saves.get.ts` 新建：`GET /api/game/saves?deviceId=&limit=`（zod 校验 deviceId 必填 / limit 1-50 默认 20；摘要提取含 saveData 结构异常兜底；按 updated_at 倒序）
- [x] 测试 `server/tests/api/saves.test.ts`（7 用例：摘要提取/ended 语义/结构异常兜底/limit 透传/400×2/500）
- [x] `docs/API.md` 新增 GET /api/game/saves 章节 + 目录/通用约定口径
- 验证：`cd server && pnpm lint && pnpm typecheck && pnpm test:api` ✅（98 passed）

## 2. 前端：多存档槽 UI（已迁出至 2026-09-06-save-management 提案）
- [ ]（已迁出）`game-web/src/composables/` 增 `useSaveList`（调 GET /api/game/saves，含防重复提交守卫）
- [ ] 存档列表入口（settings 页或首页）：列表项展示 摘要/updatedAt/ended 徽标，触摸目标 ≥88rpx
- [ ] 切换存档：拉取完整存档（GET sync-save）→ 写入本地 → 进游戏页；删除走 ConfirmDialog
- [ ] 存档导出/导入（JSON 文件，H5 下载 + 小程序文件消息兼容方案）
- 验证：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit`，H5 + 微信开发者工具双端走查

## 3. 后端：pgvector 语义去重（待做，依赖 embedding 成本决策）

> ⚠️ **本节已由 `2026-09-06-ai-long-term-memory` 提案承接**（2026-09-06 更新）。
>
> 该提案将 `event-semantic-dedup` 与本提案未涉及的「势力关系记忆」合并设计，共用 `game_events` 向量表与 embedding 封装，避免两张向量表重复建设。embedding 成本决策已在该提案 design.md D3 落地（改用免费档 `BAAI/bge-m3`，原 D3 的 `BAAI/bge-m8-zh` 模型名在 SiliconFlow 未检索到，疑为笔误）。
>
> **实施时请以 `2026-09-06-ai-long-term-memory/tasks.md` 为准，本节不再单独执行。**

- [ ] `server/server/db/schema.ts` 新增 `game_events` 表（saveId/eventId/title+description embedding vector(1024)，HNSW 索引）→ `pnpm db:push` + 同步 `docs/db-schema.md`
- [ ] `server/server/utils/embeddings.ts`：SiliconFlow embeddings 封装（失败降级，enable_thinking 不适用）
- [ ] 事件落库/结束回合时异步向量化（fire-and-forget，不阻塞回合）
- [ ] `generate-event` LLM 路径生成前相似度检索（阈值 0.9），命中时注入避重指令或走 fallback 池；`docs/ai-cost.md` 补 embedding 成本行
- [ ] 单元/集成测试（降级路径全覆盖：embedding 失败/检索失败/表空）
- 验证：`cd server && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:api`

## 4. 归档（随拆分完成）
- [x] spec 合并入 master、状态块、归档（2026-09-06）：语义去重随 `2026-09-06-ai-long-term-memory` 归档；存档管理 spec 迁至新提案 `2026-09-06-save-management`
