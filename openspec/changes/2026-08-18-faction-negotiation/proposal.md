# 提案：与 NPC 势力自然语言谈判（写信/游说）

> **状态：提案中（待评审，未开发）**
> 关联设计：`docs/game-design.md` 玩家主动外交（L580-598）、关系刻度 -100~100（L164-172）
> 关联 spec：`openspec/specs/ai-npc-faction/spec.md`（复用其 Agent 架构）、`openspec/specs/ai-advisor/spec.md`（对话交互参照）

## 为什么 / Why

当前外交是 6 个确定性按钮（结盟/宣战/行贿/通商/离间/质子，`DiplomacyPanel.vue` + `DIPLOMACY_RULES`），玩家与势力之间没有"语言"，只有规则表。而 `ai-npc-faction` 已具备势力人格 Agent（`npc-agent.ts` 人格提示词按 relationship 分支 + `createNpcTools` 4 个查询工具 + 并行决策），但该能力只服务于 NPC 回合决策，未向玩家侧对话开放。

玩家无法"讲条件"：想结盟只能先刷 relationship≥50 再点按钮，没有议价过程；被宣战后没有语言求和渠道。把势力 Agent 开放给玩家侧对话（写信/游说），复用现有 Agent 基建即可补齐"谈判"这一核心外交体验。

## 改什么 / What Changes

- **新端点 `POST /api/game/faction-negotiate`**：单势力谈判 Agent，两阶段（`letter` 写信 / `settle` 还价裁定），单次谈判最多 2 次 AI 调用，复用 npc-actions 的工具上下文、saveId 并发锁、降级模式与 10 次/分钟限流
- **条件兑换表 `NEGOTIATION_DEALS`**：预定义 4 条"议价版"交易（馈赠通好/互市通商/破财止战/歃血为盟）。Agent 只能从表中选条件并在价格区间内定价，效果随价格线性缩放；玩家支付后由前端按表**确定性执行**（LLM 不产出最终数值，防幻觉破坏平衡）
- **信件软性影响**：回信附 `relationshipDelta`（clamp ±10，弱于行贿 +15），作为按钮之外的"话术"通道
- **独立配额 `negotiationUsedThisTurn`**：每回合 1 次谈判（发起 `letter` 计 1 次，`settle` 追答不重复计），与按钮外交配额 `diplomacyUsedThisTurn` 互不占用；降级（X-Fallback）时退还配额允许重试
- **新组件 `NegotiationDialog.vue`**：`DiplomacyPanel` 每势力卡片加"写信"入口，弹窗内完成 写信→回信→接受条件/还价/放弃 全流程
- **历史与文档**：谈判结果追加 `save.events`（复用 eventType `外交`）；同步 `docs/API.md`、`docs/game-design.md`、`docs/ai-cost.md`

## 影响 / Impact

| 影响面 | 改动 |
|---|---|
| 前端 game-web | 新组件 `NegotiationDialog.vue`；`DiplomacyPanel.vue` 加写信入口；`stores/game.ts` 加 `negotiationUsedThisTurn` / `applyNegotiationDeal`；`utils/constants.ts` 加 `NEGOTIATION_DEALS` |
| 后端 server | 新端点 `server/server/api/game/faction-negotiate.ts`；新提示词 `server/server/utils/prompts/negotiation-agent.ts`；复用 `createNpcTools` / 并发锁 / 限流 / E2E 测试模式 |
| 数据库 | 无（谈判状态存 `save_data` JSONB，与外交按钮一致） |
| API | 新增 `POST /api/game/faction-negotiate`（纳入现有 6 个 AI 端点的 10 次/分钟限流与 saveId 粒度并发锁） |
| 文档 | `docs/API.md` 新增接口章节；`docs/game-design.md` 外交节补谈判玩法；`docs/ai-cost.md` 补成本行 |

## 能力 / Capabilities

### New Capabilities
- ai-faction-negotiation - 玩家与 NPC 势力 Agent 的自然语言谈判（信件+一次还价，条件兑换制，独立配额）
