# 提案：Agent 架构升级 — 工具调用 + 多 Agent + 自主决策

> **状态：待审批**
> 创建：2026-07-27
> 关联：[add-qing-revival-mvp](../add-qing-revival-mvp/proposal.md)（已归档，本提案修改 `ai-advisor`/`ai-npc-faction`/`ai-event-engine` 三项能力）
> 依据：[AGENTS.md](../../AGENTS.md)「Agent 架构设计规范」章节

## Why

MVP + UX 已交付，但 AI 架构层面**仍是 Workflow 而非 Agent**，与 AGENTS.md「新功能默认走 Agent 路径」原则存在系统性偏离：

1. **零工具调用**：5 个 AI 端点（`generate-event`/`npc-actions`/`advisor-chat`/`advisor-briefing`/`resolve-decision`）全部是单次 LLM 调用，无任何 `tool()` 注册。LLM 无法主动查询局势、势力、历史事件等上下文，全靠 prompt 一次性注入。当上下文复杂时（如多势力关系、长历史事件链），prompt 膨胀导致 token 成本上涨 + LLM 注意力分散。
2. **军师对话无记忆工具**：[advisor-chat.ts](../../server/server/api/game/advisor-chat.ts) 用 `streamText()` 但无工具，玩家问"我上次选了什么？"军师无法主动查询历史事件，只能依赖 prompt 中预注入的 `recentEvents`（最近 5 条标题）。深度对话能力受限。
3. **NPC 势力决策是"批量生成"而非"多 Agent"**：[npc-actions.ts](../../server/server/api/game/npc-actions.ts) 单次 `generateObject()` 让一个 LLM 同时扮演所有活跃 NPC，导致：①NPC 之间无独立人格、决策同质化；②单次 token 上限限制 NPC 数量；③无 NPC 之间的博弈/谈判能力。
4. **控制流代码预编排**：[npc-actions.ts L100-105](../../server/server/api/game/npc-actions.ts) `if (activeFactions.length === 0)` 是代码硬编码判断；现有所有 LLM 调用都是"调用一次返回"，无 `maxSteps` 多步循环，LLM 无法自主决定"是否需要更多信息再决策"。

本提案**不引入新数据库表**（工具查询的是现有 `game_saves` JSONB 字段或内存数据），通过新增 `server/tools/` 工具集 + 改造 `advisor-chat`/`npc-actions` 为 `streamText + tools + maxSteps=5`，将 AI 架构从 Workflow 升级为 Agent，符合 AGENTS.md「LLM 自主决策 = Agent」判定标准。

## What Changes

### 1. 新增 `server/tools/` 工具系统（核心新增）

- 新建 `server/server/tools/` 目录，每个工具一个文件，用 `tool()` 定义
- **6 个核心工具**（一个工具只做一件事，遵循 AGENTS.md 工具系统设计原则）：

| 工具文件 | 工具名 | 用途 | 何时调用 | 何时不用 |
|---|---|---|---|---|
| `get-faction-info.ts` | `get-faction-info` | 查询单个势力详情（id/name/summary/power/relationship/status/lastAction） | 玩家询问某势力情况、NPC 决策需要了解对手 | 已知势力全部信息时 |
| `get-all-factions.ts` | `get-all-factions` | 查询所有势力列表（压缩为 4 字段） | 需要全局势力格局 | 只需单个势力时 |
| `get-character-status.ts` | `get-character-status` | 查询玩家属性/资源详情 | 军师需要分析玩家状态 | 玩家状态已在 prompt 中 |
| `get-recent-events.ts` | `get-recent-events` | 查询最近 N 回合事件历史（默认 5） | 玩家询问历史、军师需要上下文 | 只关心当前回合时 |
| `get-relationship.ts` | `get-relationship` | 查询两势力关系值 | NPC 决策结盟/挑衅前 | 不涉及势力关系时 |
| `get-current-date.ts` | `get-current-date` | 查询当前游戏内日期（年月） | NPC 决策需要时间感知 | 已知当前时间时 |

- **工具实现规范**（每个工具必须遵循）：
  - 用 Vercel AI SDK 的 `tool()` 定义，`description` 说明"何时调用"和"何时不调用"
  - `parameters` 用 zod schema 严格校验
  - `execute` 函数从传入的 `toolContext`（saveId/stateSnapshot/factions 等）取数据，不查数据库（避免延迟）
  - 失败返回 `{ error: 'ERROR_CODE', detail: '...' }` 不 throw（AGENTS.md 规范）
  - 大对象通过 ID 传递（如 `get-faction-info` 接受 `factionId` 而非整个 faction 对象）

### 2. `advisor-chat` Agent 化改造（MODIFIED）

- 修改 [advisor-chat.ts](../../server/server/api/game/advisor-chat.ts)：
  - 在 `streamText()` 调用中注册 6 个工具：`get-faction-info`/`get-all-factions`/`get-character-status`/`get-recent-events`/`get-relationship`/`get-current-date`
  - 增加 `maxSteps: 5` + `stopWhen(stepCountIs(5))` 硬上限（AGENTS.md 执行循环规范）
  - 工具上下文通过 `prepareStep` 或 `messages` 上下文注入（saveId/stateSnapshot/factions 等）
  - SSE 流式输出保留（text-delta + tool-call + tool-result 事件透传给前端）
  - 前端 `AdvisorDrawer` 新增工具调用过程展示（"军师正在查询势力信息…"）

### 3. `npc-actions` 多 Agent 改造（MODIFIED）

- 修改 [npc-actions.ts](../../server/server/api/game/npc-actions.ts)：
  - **架构变更**：从"1 个 LLM 批量生成所有 NPC 行动"改为"每个活跃 NPC 势力一个独立 Agent 并行调用"
  - 每个 NPC Agent：
    - 独立 system prompt（基于势力人格 + 目标 + 与玩家关系）
    - 独立工具集（`get-faction-info`/`get-relationship`/`get-character-status`/`get-current-date`）
    - `streamText + tools + maxSteps: 3`（NPC 决策不需要太长链路）
    - 返回结构：`{ action, target, description, effects }`（用 `generateObject` 兜底或 streamText + structured output）
  - 并行执行：`Promise.all(activeFactions.map(faction => runNpcAgent(faction)))`
  - 失败降级：单个 NPC Agent 失败不影响其他 NPC，返回 `{ actions: [...successfulActions], failedFactionIds: [...] }`
- **新增 `server/server/utils/prompts/npc-agent.ts`**：每个 NPC 势力的独立 system prompt 模板

### 4. `generate-event` 工具结果注入（MODIFIED，轻量）

- 修改 [generate-event.ts](../../server/server/api/game/generate-event.ts)：
  - **不改为 Agent**（保留 `generateObject` 结构化输出，保证事件 schema 严格）
  - 但在 LLM 自主生成路径前，可选调用 `get-recent-events` 工具获取更丰富上下文（如最近 10 条而非 prompt 中的 5 条）
  - 工具调用结果注入到 prompt 中（不暴露给 LLM 自主调用，避免 maxSteps 复杂度）
  - 提案1 的剧情链触发路径不受影响（仍优先挂起节点 > 时间窗口）

### 5. 工具上下文注入机制

- 新增 `server/server/utils/tool-context.ts`：
  - 定义 `ToolContext` 类型：`{ saveId, turn, stateSnapshot, character, factions, recentEvents }`
  - 工具的 `execute` 函数通过闭包或 `tool` 第二参数访问 `ToolContext`
  - 每次请求时构造 `ToolContext` 一次，所有工具共享

## Capabilities

### New Capabilities

- `agent-tool-system`：Agent 工具系统——`server/tools/` 目录 + 6 个核心工具 + `ToolContext` 注入机制；工具失败返回 `{ error, detail }` 不 throw；一个工具只做一件事

### Modified Capabilities

- `ai-advisor`（Agent 化）：`advisor-chat` 注册 6 个工具 + `maxSteps=5` + `stopWhen(stepCountIs(5))`；SSE 流式保留并新增 tool-call/tool-result 事件；前端展示工具调用过程
- `ai-npc-faction`（多 Agent）：每个活跃 NPC 势力独立 Agent + 并行调用 + `maxSteps=3`；单 NPC 失败不阻断其他 NPC；新增 `npc-agent.ts` system prompt 模板
- `ai-event-engine`（轻量增强）：`generate-event` LLM 路径前可选调用 `get-recent-events` 工具丰富上下文；剧情链触发路径不变（提案1 已修改）

## Impact

| 层级 | 影响 |
| --- | --- |
| 后端目录 | 新增 `server/server/tools/` 目录（6 个工具文件）+ `server/server/utils/tool-context.ts` + `server/server/utils/prompts/npc-agent.ts` |
| 后端 API | [advisor-chat.ts](../../server/server/api/game/advisor-chat.ts) 注册工具 + maxSteps=5；[npc-actions.ts](../../server/server/api/game/npc-actions.ts) 多 Agent 并行改造；[generate-event.ts](../../server/server/api/game/generate-event.ts) 工具结果注入 |
| 后端类型 | `server/types/game.ts` 新增 `ToolContext` 类型 + 工具结果类型；`NpcAction` 接口扩展 `failedFactionIds` 可选字段 |
| 前端组件 | [AdvisorDrawer.vue](../../game-web/src/components/AdvisorDrawer.vue) 新增工具调用过程展示（"军师正在查询 XXX…"）；[NpcActionList.vue](../../game-web/src/components/NpcActionList.vue) 显示 NPC 决策耗时/失败标识 |
| 前端 SSE | [useSSE.ts](../../game-web/src/composables/useSSE.ts) 扩展支持 `tool-call`/`tool-result` 事件类型，转发给 `useAdvisor` |
| 前端状态 | [useAdvisor.ts](../../game-web/src/composables/useAdvisor.ts) 新增 `toolCalls` ref 数组，记录工具调用过程；前端不持久化工具调用记录（仅本回合展示） |
| 数据库 | **无变更**（工具查询的是请求 body 中的内存数据，不查数据库；`game_saves` schema 不变） |
| AI 调用次数 | `advisor-chat`：单次 → 最多 5 步（maxSteps=5），但单步可能不调工具；`npc-actions`：1 次 → N 次（N=活跃 NPC 数量，通常 3-5）；`generate-event`：LLM 路径前 +1 次工具调用（不调 LLM） |
| Token 成本 | `advisor-chat` 单次成本上涨 30-50%（多步工具调用 + 工具结果上下文），但单次对话价值更高；`npc-actions` 总成本上涨 50-100%（N 个独立 Agent），但 NPC 决策质量提升显著；粗估单局总成本上涨 40-60% |
| 并发锁 | `npc-actions` 多 Agent 并行时，每个 NPC Agent 不单独占锁（共享 `saveId` 锁，锁内并行执行）；`advisor-chat` 锁不变 |
| 多端兼容 | 工具调用过程展示需三端验证；SSE 新事件类型（tool-call/tool-result）三端兼容 |
| 测试 | 单元测试覆盖 6 个工具的 execute 函数（成功/失败/参数校验）；API 测试覆盖 advisor-chat 多步工具调用 + npc-actions 多 Agent 并行；E2E 覆盖"玩家问军师上次选了什么 → 军师调用 get-recent-events → 返回历史" |
| 文档 | 同步更新 [docs/API.md](../../docs/API.md)（advisor-chat/npc-actions 新增工具调用说明）、[docs/ai-cost.md](../../docs/ai-cost.md)（token 成本上涨分析） |
