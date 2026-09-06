# 设计：存档管理与历史事件语义去重

## Goals

- 存档列表接口先行落地（`GET /api/game/saves`），为多存档槽 UI 提供数据源
- 明确 pgvector 语义去重的落地方案与成本边界，避免实现时临时拍板

## Non-Goals

- 不引入账号系统（deviceId 归属模型维持现状，登录系统为独立提案）
- 本期不做 `game_events` 向量表（待 embedding 成本决策后单独实施）
- 不改变存档结构（GameSave schema 不动，多存档 = 多个 saveId）

## Decisions

### D1：存档列表只返回摘要，不返回 saveData 全量
列表页只需展示「身份/势力/回合/结局状态」，完整 saveData 可能含上千条 events。按摘要返回把响应体积从 ~100KB/条 压到 <1KB/条，limit 上限 50 双保险。拉取完整存档仍走既有 `GET /api/game/sync-save`。

### D2：归属模型复用 deviceId（与 sync-save 一致）
`deviceId` 是当前信任边界（自报 UUID），随存档跨设备传播（拉取后继承原 deviceId）。列表接口按 deviceId 过滤与 sync-save 的属主校验同构，无新增信任假设。账号体系落地后统一替换。

### D3：语义去重用「生成前检索」而非「生成后判重」
在 `generate-event` 调 LLM 前检索当前 saveId 最近 N 条事件的 embedding：相似度 > 阈值（初版 0.9）时在 prompt 中注入"避免与以下事件重复"清单，或直接改走 fallback 池。生成后判重需要"生成→向量化→丢弃→再生成"两轮 LLM 调用，成本翻倍且延迟不可接受。
- embedding 模型：SiliconFlow `BAAI/bge-m8-zh`（¥0.065/1M tokens，单事件 ~50 tokens，成本可忽略）
- 相似历史事件列表随事件落库时异步向量化（`advisor-briefing` 同款 fire-and-forget），不阻塞回合主流程
- 失败降级：embedding/检索任一失败直接跳过去重逻辑（不阻断 generate-event，X-Dedup-Skip: true）

### D4：多存档槽 UI 触摸目标
存档列表项 min-height 88rpx（≥44px），删除按钮独立触摸区 ≥36px 并走 ConfirmDialog 守卫（与设置页清除存档同款）。手机端单列，平板端（sm:）双列网格。

## 风险

- embedding 调用引入新的外部依赖： SiliconFlow embeddings 端点可用性——已按 D3 降级兜底
- 多存档槽放大本地存储用量（单存档峰值 ~10MB）：列表页做容量提示，导出导入作为用户侧自救手段
