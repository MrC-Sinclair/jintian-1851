# 提案：存档管理与历史事件语义去重

## 为什么 / Why

1. **存档管理能力缺口**：本地仅单 key 存档（`game_save`），玩家无多存档槽、无存档列表、无导出导入；换设备/重开即丢弃整局进度。数据库侧 `idx_game_saves_device_id` 索引自 MVP 起预留却无任何对应查询。
2. **AI 事件重复生成**：`generate-event` 的 LLM 路径没有语义层面的去重手段，长局玩法下同质事件（如"漕运贪腐""盐税之争"）可能反复出现，消耗 token 且损伤体验。docker 中 pgvector 扩展已启用（`docker/initdb/01-vector.sql`）但 schema 零使用，README 宣称的"向量能力预留"尚未兑现。

## 改什么 / What Changes

- **后端（已交付）**：新增 `GET /api/game/saves?deviceId=&limit=` 存档摘要列表接口（命中预留索引，只返回摘要不含 saveData blob），详见 `docs/API.md`。
- **前端（待做）**：多存档槽 UI（存档列表页/弹层：查看、切换、删除、上传）；存档导出/导入（JSON 文件）。
- **后端（待做）**：pgvector 语义去重——`game_saves` 外新增 `game_events` 向量表（事件标题+描述 embedding，HNSW 索引），`generate-event` LLM 生成前做相似度检索，相似度超阈值时改为"换角度重生成"指令或直接走 fallback 池。
- **文档**：`docs/API.md`、`docs/db-schema.md`（新增表时）、`docs/ai-cost.md`（embedding 成本）随实现同步。

## 影响 / Impact

| 影响面 | 改动 |
|---|---|
| 前端 `game-web` | 存档列表/切换/删除 UI（新增）；导出导入（新增） |
| 后端 `server` | `saves.get.ts`（已交付）；`game_events` 向量表 + embedding 调用链（待做） |
| 数据库 | 无新增表（本期）；后续 `game_events`（含 vector 列 + HNSW 索引，需 `pnpm db:push`） |
| API | 新增 `GET /api/game/saves`（已交付，见 docs/API.md） |
| 文档 | `docs/API.md` 已更新；`docs/db-schema.md`、`docs/ai-cost.md` 待向量表落地时更新 |

## 能力 / Capabilities

### New Capabilities
- `save-management` - 多存档管理：按设备列表、摘要展示、多槽切换与删除、导出导入
- `event-semantic-dedup` - 基于 pgvector 的历史事件语义去重（降本 + 防重复体验损伤）
  - ⚠️ **已被 `2026-09-06-ai-long-term-memory` 提案承接**（2026-09-06 更新）：该能力与本提案无关的「势力关系记忆」合并设计，共用 `game_events` 向量表与 embedding 封装。实施以新提案 tasks.md 为准，本提案 tasks.md 第 3 节不再单独执行。

---

## 状态：拆分归档（2026-09-06）

- **语义去重部分：已完成**。由 `2026-09-06-ai-long-term-memory` 提案以超集实现承接并已上线：模型实测改为 `BAAI/bge-large-zh-v1.5`（本提案原计划的 `bge-m8-zh` 在 SiliconFlow 不存在、`bge-m3` 为备选），去重阈值实测校准 0.9 → **0.76**，dev 环境端到端实测通过（写入/检索/降级全链路）。master spec 见 `openspec/specs/ai-long-term-memory/spec.md`。
- **存档管理部分：迁出**。按 openspec「一个提案一个主题」惯例拆分至新提案 `openspec/changes/2026-09-06-save-management/`（后端 `GET /api/game/saves` 已交付；前端多存档槽 UI 待做），后续在该提案下执行。
- 本提案随之归档，不再单独执行任何任务。
