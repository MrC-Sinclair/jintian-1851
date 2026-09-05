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
