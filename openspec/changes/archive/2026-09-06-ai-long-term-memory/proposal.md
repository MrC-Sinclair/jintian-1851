# 提案：AI 长期记忆（事件语义去重 + 势力关系记忆）

## 为什么 / Why

1. **游戏世界没有记忆，AI 不可替代性存疑**：当前 6 个 NPC 势力 Agent 每回合独立决策，只看到请求体 `factions` 里的四个数值（`power`/`relationship`/`status`/`summary`），看不到玩家做过什么。玩家第 12 回合背叛湘军，第 35 回合湘军的反应与从未交恶时完全一致。评审视角下这是致命的可替代性质疑——用预置事件池 + 决策树可复现七成体验。
2. **军师看不到 20 回合以外的历史**：`get-recent-events` 工具只从请求体 `recentEvents` 做 `slice(-limit)`，上限 20 条，且不按语义相关性排序。玩家问"我上次和淮军谈了什么"、"我什么时候得罪过湘军"，工具无能为力。
3. **长局同质事件反复出现**：`generate-event` 的 LLM 路径无语义层面去重，50 回合长局中"漕运贪腐""盐税之争"类同质事件重复生成，消耗 token 且损伤体验。
4. **pgvector 空转**：`docker/initdb/01-vector.sql` 已执行 `CREATE EXTENSION IF NOT EXISTS vector`，但 `schema.ts` 零使用——README 宣称的"向量能力预留"至今未兑现（2026-09-05 提案已自述此点）。

> 目标定位：本提案是项目从 **L3（AI Agent）跃迁到 L4（AI 原生）** 的关键一步。补记忆后，核心叙事从"AI 生成一串漂亮但无积累的片段"变为"世界状态随记忆演化，无法用脚本预置"。

## 改什么 / What Changes

- **新增记忆底座**：`game_events`（情景记忆：本局事件向量）+ `faction_memories`（关系记忆：每个 NPC 势力对玩家的印象条目）两张表，HNSW 向量索引。
- **新增 embedding 封装**：`server/server/utils/embeddings.ts`，SiliconFlow `BAAI/bge-large-zh-v1.5`（1024 维，**免费档 ¥0/M tokens**，512 token 硬上限需调前截断到 750 字符，失败静默降级）。
- **事件消费**：`generate-event` 的 LLM 路径在生成前做相似度检索，超阈值时注入避重指令。
- **NPC 消费**：`npc-actions` 中每个势力 Agent 决策前检索**自己**的 `faction_memories`，将"旧怨/旧恩"注入 `buildNpcAgentPrompt`，使其行动描述可翻旧账。
- **军师消费**：`advisor-chat` 新增 `search-memory` 工具，按语义检索历史事件，回答跨回合问题。
- **记忆写入**：由后端在既有 AI 端点内 fire-and-forget 异步向量化，**前端零改动**（详见 design.md D4）。

## 影响 / Impact

| 影响面 | 改动 |
|---|---|
| 前端 `game-web` | **零改动**（记忆写入与检索全部后端自足，见 design.md D4） |
| 后端 `server` | 新增 `embeddings.ts` / `memory.ts`；改造 `generate-event.ts` / `npc-actions.ts` / `advisor-chat.ts` / `resolve-decision.ts`（写入侧） |
| 数据库 | 新增 `game_events`、`faction_memories` 两表（含 vector(1024) 列 + HNSW 索引，需 `pnpm db:push`） |
| API | 无新增 HTTP 端点；3 个既有端点行为增强，新增 `X-Memory-Skip` 降级响应头 |
| 文档 | `docs/db-schema.md`（新增两表）、`docs/ai-cost.md`（embedding 成本）、`docs/API.md`（降级头说明） |
| AI 成本 | 单局 +15K~20K tokens → 免费档 **¥0** / Pro 档 ≈ ¥0.0014，相对现有 ¥0.11/局 增幅 **< 2%** |

## 能力 / Capabilities

### New Capabilities
- `ai-long-term-memory` - 记忆底座：双表存储、bge-large-zh-v1.5 向量化、异步写入、全链路降级
- `faction-relationship-memory` - 势力关系记忆：NPC Agent 检索自身记忆做决策，军师按语义检索历史

### Modified Capabilities
- `ai-event-engine` - 事件生成接入语义去重
- `ai-npc-faction` - NPC Agent 决策上下文注入历史记忆
- `ai-advisor` - 军师新增 `search-memory` 工具

> 注：`event-semantic-dedup` 原为 2026-09-05 提案声明的 New Capability（标记"待做"），本提案承接并实施，归入 `ai-long-term-memory` 统一设计，避免两张向量表重复建设。

---

## 状态：已实现并归档（2026-09-06）

- **实现**：任务 1-9 全部完成（任务 1 spike 实测修正模型为 `bge-large-zh-v1.5`、阈值校准为去重 0.76 / 召回 0.45）。
- **验证**：`server` 全量回归 lint / typecheck / test:unit（164）/ test:api（109）全绿。
- **端到端实测**（dev + 真实 LLM/embedding + `game-postgres`）：
  - `generate-event` LLM 路径 ✅，fire-and-forget 写入 `game_events` 落库（含 1024 维向量）；
  - `resolve-decision` factionEffects ✅，写入 `player_action` 记忆（+15 → positive 映射正确）；
  - `npc-actions` ✅，写入 `npc_action` 记忆（扩张 → neutral），D7 双隔离实测通过（湘军召回自身记忆相似度 0.739，淮军检索为空）；
  - `advisor-chat` ✅，军师自主调用 `search-memory` 并准确引用库中记忆，未编造历史；
  - 降级路径 ✅：embedding 置坏后事件照常生成、NPC 照常决策、军师照常回答，`X-Memory-Skip: true` 正确出现，写入静默跳过。
- **实测修正**：①检索函数改为错误上抛、由调用方降级（原吞错返回空导致 `X-Memory-Skip` 在真实链路永不触发）；②`generate-event` 去重检索失败补设 `X-Memory-Skip`；③`扩张` sentiment 映射为 `neutral`；④`embeddings.ts` 模型懒初始化（消除顶层副作用对测试 mock 的破坏）。
- **环境补齐**：测试库 `game-postgres-test`（端口 5533）已补建 `vector 0.8.5` 扩展（D1 遗留项）；3 个 Modified Capabilities（`ai-event-engine` / `ai-npc-faction` / `ai-advisor`）的增量 Requirements 已合并入对应 master spec。
- **灰度期观察项**：dedup query（势力名+回合上下文）与历史事件的真实相似度 0.51~0.57（B 类区间），0.76 阈值下事件去重命中率偏低——宁漏勿误杀符合设计取向，若监控显示同质事件仍高频，可考虑将 `recentEvents` 标题纳入 query 或回调阈值（D9 已预留调优空间）。
- spec 已合并至 `openspec/specs/ai-long-term-memory/spec.md` 与 `openspec/specs/faction-relationship-memory/spec.md`，本目录移入 `archive/`。
