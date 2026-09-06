# 任务：AI 长期记忆（事件语义去重 + 势力关系记忆）

> 验证纪律：每个代码任务完成后，在对应子项目目录运行 `pnpm lint`；涉及类型变更额外 `pnpm typecheck`；核心逻辑变更额外 `pnpm test:unit`。命令必须在 `game-web/` 或 `server/` 各自目录执行。
>
> **前端零改动**：本提案全部改动在 `server/` 子项目，`game-web/` 无需修改、无需双端走查（design.md D4）。

## 1. 技术验证 spike（高风险前置，建议最先做）

> 目的：在投入正式开发前，验证 pgvector + postgres-js + SiliconFlow BAAI/bge-large-zh-v1.5 三个不确定项，避免设计返工。

- [x] 本地 `docker compose up -d` 确认 PostgreSQL 容器 healthy 且 `vector` 扩展存在（`psql` 执行 `\dx` 应看到 `vector`）
- [x] 写一次性脚本：建测试表（含 `vector(1024)` + HNSW 索引）→ 调 `embed()` 拿 `BAAI/bge-large-zh-v1.5` 向量 → 插入 → 用 `cosineDistance` 检索
- [x] 验证项 ①：`embed()` 返回维度是否为 1024（否则调整 schema dimensions）
- [x] 验证项 ②：插入是否成功（Drizzle vector 列序列化是否被 pgvector 接受）
- [x] 验证项 ③：**不 select embedding 列**时检索是否正常返回 similarity（验证 D6 规避方案有效）
- [x] 验证项 ④：免费档 `BAAI/bge-large-zh-v1.5` 是否可调用、有无速率限制
- 完成标准：四个验证项全部通过，测试表与脚本删除；任一失败则回退修改 design.md 对应决策

## 2. 数据库 schema 与文档同步

- [x] `server/server/db/schema.ts` 新增 `gameEvents` 表（`id`/`saveId`/`turn`/`eventId`/`eventType`/`content`/`embedding vector(1024)`/`createdAt`，`(saveId, turn)` 复合索引 + HNSW 索引）
- [x] `server/server/db/schema.ts` 新增 `factionMemories` 表（`id`/`saveId`/`factionId`/`turn`/`source`/`sentiment`/`content`/`embedding vector(1024)`/`createdAt`，`(saveId, factionId)` 复合索引 + HNSW 索引）
- [x] `server/server/db/index.ts` 的 `drizzle(client, { schema })` 注册两张新表
- [x] 执行 `cd server && pnpm db:push` 并确认成功
- [x] 同步 `docs/db-schema.md`：新增两表章节（字段表 + 索引表 + Drizzle 定义 + 维护命令说明）
- 验证：`cd server && pnpm lint && pnpm typecheck`；`pnpm db:studio` 目视确认两表与索引存在

## 3. embedding 封装

- [x] `server/server/utils/embeddings.ts` 新建：`embedText(text)`（空文本返回 `null`、10s 超时、失败抛可捕获错误）、`EMBEDDING_DIMENSIONS = 1024`、模型 ID 沉淀到 `server/server/config/models.ts`
- [x] `server/tests/unit/embeddings.test.ts`（正常返回 1024 维 / 空文本返回 null / API 失败抛错 / 超时抛错，用 mock 隔离外部调用）
- 验证：`cd server && pnpm lint && pnpm typecheck && pnpm test:unit`

## 4. 记忆读写模块

- [x] `server/server/utils/memory.ts` 新建：
  - `writeEventMemory(...)` / `writeFactionMemory(...)`（fire-and-forget，内部 try/catch 静默失败）
  - `searchEventMemories(saveId, query, { threshold, topK })` / `searchFactionMemories(saveId, factionId, query, { threshold, topK })`
  - 检索**不 select embedding 列**，只返回 `content`/`turn`/`similarity`（design.md D6）
  - 检索失败返回空数组，调用方写 `X-Memory-Skip: true`
- [x] `server/tests/unit/memory.test.ts`（写入成功 / 写入失败静默 / 检索排序 / 空结果 / 检索失败返回空 / 作用域隔离：factionA 检索不到 factionB 记忆，用内存 mock 或测试库）
- 验证：`cd server && pnpm lint && pnpm typecheck && pnpm test:unit`

## 5. generate-event 接入（去重 + 写入）

- [x] LLM 路径生成**前**检索同 `saveId` 历史事件（阈值 0.76，topK 5），命中时在 prompt 注入避重清单并设 `X-Dedup-Applied: true`
- [x] 生成成功后 fire-and-forget 写入 `game_events`（仅 `X-Event-Source: llm` 路径）
- [x] 缓存命中 / 剧情链 / fallback 路径不检索不写入
- [x] `server/tests/api/generate-event.test.ts` 补用例（去重命中注入 / 未命中不注入 / 检索失败跳过不阻断 / llm 路径触发写入）
- 验证：`cd server && pnpm lint && pnpm typecheck && pnpm test:api`

## 6. npc-actions 接入（记忆注入 + 写入）

- [x] `runNpcAgent` 决策前检索该势力自身记忆（阈值 0.45，topK 3），注入 `buildNpcAgentPrompt` 的「你记得的事」段落
- [x] 正负混合召回：结果中尽量包含 `positive` 与 `negative` 各至少 1 条
- [x] Agent 决策成功后 fire-and-forget 写入 `faction_memories`（`source='npc_action'`，`sentiment` 按行动类型推导）
- [x] `server/tests/unit/npc-agent-prompt.test.ts` 补用例（含记忆注入 / 无记忆时不注入段落 / 内容格式正确）
- [x] `server/tests/api/npc-actions.test.ts` 补用例（检索失败仍正常决策 / 记忆不改变 effects 数值）
- 验证：`cd server && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:api`

## 7. resolve-decision 接入（写入）

- [x] 判定结果含非空 `factionEffects` 时，对每个受影响势力 fire-and-forget 写入 `faction_memories`（`source='player_action'`，关系升/降对应 `positive`/`negative`）
- [x] `server/tests/api/resolve-decision.test.ts` 补用例（含 factionEffects 触发写入 / 无 factionEffects 不写入 / 写入失败不影响判定结果）
- 验证：`cd server && pnpm lint && pnpm typecheck && pnpm test:api`

## 8. advisor-chat 接入（search-memory 工具）

- [x] `server/server/tools/search-memory.ts` 新建：`query`（1-200 字符，空或超长返回 `INVALID_PARAMS`）、`limit`（1-10，默认 5，越界钳制），失败返回 `MEMORY_UNAVAILABLE`
- [x] `server/server/utils/tool-context.ts` 的 `createTools` 注册 `search-memory`（advisor-chat 专用，NPC 工具集不注册）
- [x] `server/server/utils/prompts/advisor-chat.ts` 的工具清单补充 `search-memory` 说明，并加「涉及过往事件时优先调用，不要凭空编造历史」约束
- [x] `server/tests/unit/tools.test.ts` 补用例（参数校验 / 正常返回 / 检索失败降级 / 空结果）
- 验证：`cd server && pnpm lint && pnpm typecheck && pnpm test:unit`

## 9. 文档同步

- [x] `docs/ai-cost.md`：新增 embedding 成本章节（模型分配表补 `BAAI/bge-large-zh-v1.5`、单局 ~26K tokens、免费档 ¥0 / Pro 档 ≈¥0.0018、增幅 < 2% 结论）
- [x] `docs/API.md`：新增 `X-Dedup-Applied` / `X-Memory-Skip` 降级标识说明（归入既有「降级标识」章节，注明非错误、仍 200 OK）
- [x] `docs/db-schema.md`：随任务 2 同步（此处确认无遗漏）
- 完成标准：三份文档与实现一致，`AGENTS.md` 的「代码与文档不脱节」要求满足

## 10. 集成验证与归档

- [x] 端到端手工验证：开新局 → 第 5 回合自由输入"暗中资助湘军" → 连续推进至第 15 回合 → 确认湘军 Agent 行动描述中出现对往事的引用
- [x] 端到端手工验证：问军师"我早期对湘军做过什么" → 确认其调用 `search-memory` 并正确引用早期回合事件
- [x] 降级验证：临时置空 `OPENAI_API_KEY` 的 embedding 调用路径 → 确认游戏正常可玩（事件照生成、NPC 照决策、军师照回答），响应头出现 `X-Memory-Skip: true`
- [x] 全量回归：`cd server && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:api`（709+ 用例全绿）
- [x] spec 合并入 `openspec/specs/ai-long-term-memory/spec.md` 与 `openspec/specs/faction-relationship-memory/spec.md`（新建 master），proposal.md 追加状态块，目录移入 `archive/`

## 依赖关系

```
任务 1 (spike) ──> 任务 2 (schema) ──> 任务 4 (memory 模块) ──┬─> 任务 5 (generate-event)
                                            任务 3 (embedding) ─┤─> 任务 6 (npc-actions)
                                                                 ├─> 任务 7 (resolve-decision)
                                                                 └─> 任务 8 (advisor-chat)
                                                                        │
                                                          任务 9 (文档) <┘
                                                                        │
                                                          任务 10 (集成验证与归档)
```
