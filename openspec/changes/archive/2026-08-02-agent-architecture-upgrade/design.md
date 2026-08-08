# 设计文档 — Agent 架构升级（agent-architecture-upgrade）

> 关联：[proposal.md](./proposal.md)
> 设计原则遵循 [AGENTS.md](../../AGENTS.md)「Agent 架构设计规范」「工具系统」「执行循环」章节

## Goals

- **G1 工具系统基础设施**：建立 `server/server/tools/` 目录与 `tool()` 定义规范，6 个核心工具各司其职，符合 AGENTS.md「一个工具只做一件事」原则
- **G2 军师 Agent 化**：`advisor-chat` 注册 6 工具 + `maxSteps=5`，军师能自主决定调用哪些工具查询上下文（如玩家问"上次选了什么"时调用 `get-recent-events`），不再依赖 prompt 一次性注入
- **G3 NPC 多 Agent 协作**：每个活跃 NPC 势力作为独立 Agent 并行决策，每个 NPC 有独立人格 prompt + 独立工具调用 + `maxSteps=3`，NPC 决策差异化
- **G4 Agent 自主决策**：调用哪些工具、调用顺序、调用次数全由 LLM 自主决定，代码不预编排 if/else 控制流（符合 AGENTS.md「LLM 自主决策 = Agent」判定）
- **G5 工具失败容错**：工具执行失败返回 `{ error, detail }` 不 throw，LLM 自主决定重试/换工具/继续生成（符合 AGENTS.md 工具系统设计原则）
- **G6 前端工具调用过程可见**：`AdvisorDrawer` 实时展示"军师正在查询 XXX"，让玩家感知 Agent 决策过程，提升信任度
- **G7 token 成本可控**：通过工具 description 明确"何时调用/何时不调用" + `maxSteps` 硬上限，避免 LLM 无意义循环调用工具
- **G8 三端兼容**：H5/小程序/App 三端 SSE 流式 + 工具调用过程展示一致

## Non-Goals

- **NG1 长期记忆系统**：本提案不引入 pgvector 跨会话记忆（AGENTS.md「记忆系统」远期演进方向）。工具查询的是当前请求 body 中的内存数据（短期记忆），不查数据库
- **NG2 generate-event 完全 Agent 化**：`generate-event` 保留 `generateObject` 结构化输出，仅 LLM 路径前可选调用 `get-recent-events` 工具丰富上下文。理由：事件 schema 严格性 > LLM 自主决策灵活性；剧情链触发路径需要确定性
- **NG3 resolve-decision Agent 化**：`resolve-decision` 保留 `generateObject`，不注册工具。理由：单次 effects 判定不需要多步推理
- **NG4 NPC 之间显式通信**：NPC Agent 之间不直接通信（如 A NPC 决策后告诉 B NPC），每个 NPC 独立决策基于同一份初始状态。理由：并行执行无法支持通信，串行执行成本过高
- **NG5 工具调用历史持久化**：工具调用记录不写入 `game_saves`，仅本回合展示。理由：工具调用是 Agent 推理过程，不是游戏状态
- **NG6 工具调用计费**：不引入按工具调用次数计费机制。理由：工具不查数据库/不调 LLM，成本忽略不计
- **NG7 多 Agent 协商**：NPC Agent 之间不协商（如结盟需双方同意），结盟仍由 LLM 单方面决策 + 代码应用 effects。理由：协商机制复杂度过高，留待后续提案
- **NG8 自定义工具**：不开放玩家/前端注册自定义工具的能力
- **NG9 工具调用结果缓存**：工具调用结果不做 5 分钟缓存（与 `generate-event` 缓存不同）。理由：工具调用是 Agent 内部推理，缓存意义不大；且工具查询的是请求 body 数据，每次请求不同

## Decisions

### D1：工具调用 vs prompt 一次性注入

**选择**：在 `advisor-chat`/`npc-actions` 中改用 `tool()` 让 LLM 自主调用查询上下文，而非 prompt 一次性注入所有数据。

**理由**：
- **prompt 膨胀问题**：MVP 中 advisor-chat prompt 已包含 `stateSnapshot` + `recentEvents` + `character` + `factions`，约 1.5K tokens。若注入全部 6 势力详情 + 全部历史事件，prompt 膨胀到 5K+ tokens，单次对话成本翻倍
- **LLM 注意力分散**：prompt 注入所有数据时，LLM 倾向于"参考所有数据"而非"聚焦玩家问题"。如玩家问"上次选了什么"，LLM 仍会读全部势力信息
- **Agent 自主性**：工具调用让 LLM 自主决定"需要哪些信息"，符合 AGENTS.md「LLM 自主决策 = Agent」判定
- **token 成本权衡**：工具调用每次约 200-400 tokens（工具 description + 参数 + 结果），但 LLM 可选择不调用，平均成本反而低于全量注入

**苏格拉底质询**：
- 质疑：LLM 可能不调用工具直接编造答案，如何保证？
- 回应：①system prompt 明确"未查询的工具数据不可凭空编造"；②工具 description 设计"何时调用"提示；③前端展示工具调用过程，玩家可感知军师是否真的查询了
- 质疑：多步工具调用延迟增加，影响流式体验？
- 回应：`maxSteps=5` 硬上限保证最多 5 次工具调用，每次工具执行 <50ms（内存查询），单次对话延迟增加 <1s 可接受

### D2：工具失败返回 `{ error, detail }` 不 throw

**选择**：所有工具 `execute` 函数用 try/catch 包裹，失败返回 `{ error: 'ERROR_CODE', detail: '...' }`，不 throw 异常。

**理由**：
- 符合 AGENTS.md「执行失败返回 `{ error, detail }` 不 throw，由 LLM 决定重试/换工具」规范
- throw 会导致 `streamText` 整个流程中断，玩家收到 AI_CALL_FAILED 错误，体验差
- 返回 error 对象让 LLM 自主决策：①重试同一工具；②换其他工具；③基于已有信息继续生成
- LLM 看到 `{ error: 'FACTION_NOT_FOUND', detail: '势力 ID xxx 不存在' }` 能理解失败原因并调整策略

**实现示例**：
```typescript
execute: async ({ factionId }, { toolContext }) => {
  try {
    const faction = toolContext.factions.find(f => f.id === factionId)
    if (!faction) {
      return { error: 'FACTION_NOT_FOUND', detail: `势力 ID ${factionId} 不存在` }
    }
    return { faction }
  } catch (err) {
    return { error: 'INTERNAL_ERROR', detail: String(err) }
  }
}
```

### D3：`advisor-chat` `maxSteps=5` + `stopWhen(stepCountIs(5))`

**选择**：军师对话 Agent 最多 5 步工具调用循环，硬上限 `stopWhen(stepCountIs(5))`。

**理由**：
- 符合 AGENTS.md「有工具时 `maxSteps=5`」规范
- 5 步覆盖典型场景：①查询玩家状态 ②查询势力 ③查询历史事件 ④查询关系 ⑤生成回复
- `stopWhen(stepCountIs(5))` 是硬上限，LLM 可自主提前停止（如 1 步就足够回答时）
- 避免 LLM 无意义循环调用工具（如反复查询同一势力）

**苏格拉底质询**：
- 质疑：5 步是否太少？复杂问题（如"分析我与所有势力的关系并给建议"）可能不够
- 回应：①单工具可返回批量数据（如 `get-all-factions` 一次返回所有势力）；②5 步是硬上限不是固定值，LLM 可在 2-3 步完成；③超过 5 步的复杂分析可拆分为多次对话
- 质疑：5 步 token 成本上涨 30-50% 是否可接受？
- 回应：单次军师对话成本从约 1.5K tokens 涨到 2-2.5K tokens，按 `Qwen3-8B` 0.35 元/百万 tokens 计，单次成本约 0.001 元，单局 30 回合 × 5 次对话 = 0.15 元，可接受

### D4：`npc-actions` 多 Agent 并行 + `maxSteps=3`

**选择**：每个活跃 NPC 势力作为独立 Agent 并行调用，每个 NPC `maxSteps=3`。

**理由**：
- **并行执行**：`Promise.all(activeFactions.map(runNpcAgent))`，3-5 个 NPC 同时决策，延迟与单 NPC 相同
- **独立人格**：每个 NPC 有独立 system prompt（基于势力 summary + 目标 + 与玩家关系），决策差异化
- **maxSteps=3**：NPC 决策链路较短（查询对手 → 查询关系 → 决策），3 步足够；超过 3 步说明 LLM 在反复查询，应中断
- **失败隔离**：单个 NPC Agent 失败不影响其他 NPC，返回 `failedFactionIds` 标识

**苏格拉底质询**：
- 质疑：N 个 NPC 并行调用，token 成本上涨 N 倍（N=3-5），是否值得？
- 回应：①当前批量调用 token 约 2K（含所有 NPC 上下文），并行后每个 NPC 约 800 tokens（独立上下文），总成本 2.4-4K，上涨 20-100%；②NPC 决策质量提升显著（独立人格 vs 批量同质化），是核心体验升级；③可通过减少 NPC 工具数量（仅 4 个核心工具）控制成本
- 质疑：并行执行时如何避免 NPC 决策冲突（如 A NPC 决定结盟 B NPC，B NPC 决定挑衅 A NPC）？
- 回应：①本提案不处理冲突（NG4/NG7），每个 NPC 独立决策基于同一份初始状态；②冲突在 `apply-effects` 阶段由代码处理（如关系变化取平均值）；③冲突场景可作为后续"NPC 协商"提案的切入点

### D5：`generate-event` 不 Agent 化，保留 `generateObject`

**选择**：`generate-event` 保留 `generateObject` 结构化输出，仅在 LLM 路径前可选调用 `get-recent-events` 工具丰富上下文。

**理由**：
- **schema 严格性**：事件结构（title/description/options/effects）需要 zod schema 严格校验，`generateObject` 是天然选择；`streamText + tools` 难以保证结构化输出
- **剧情链触发路径**：提案1 的"挂起节点 > 时间窗口 > LLM 自主生成"三层优先级中，前两层不调 LLM（预定义数据），第三层才调 LLM；这三层是 Workflow 控制流（NG2 已说明理由）
- **工具结果注入而非 LLM 自主调用**：在 LLM 路径前服务端主动调用 `get-recent-events` 获取更丰富上下文（如最近 10 条而非 prompt 中的 5 条），结果注入到 prompt 中。LLM 不直接调用工具，避免 `maxSteps` 复杂度
- **token 成本**：generate-event 是高频调用（每回合 1 次），Agent 化会让单次成本上涨 50%+，单局总成本上涨 20%+，性价比低

### D6：工具上下文通过闭包注入，不查数据库

**选择**：每次请求时构造 `ToolContext` 对象（含 saveId/stateSnapshot/character/factions/recentEvents），通过闭包传递给所有工具的 `execute` 函数。

**理由**：
- **避免数据库查询延迟**：工具查询数据库会增加 50-100ms 延迟，并行多 Agent 时累积显著；查询内存数据 <1ms
- **数据已在前端 body 中**：advisor-chat/npc-actions 的 request body 已包含所有需要的数据（stateSnapshot/factions 等），无需重复查询
- **符合 AGENTS.md「大对象通过 URL/ID 传递，不进 LLM 上下文」**：工具接受 ID 参数（如 `factionId`），从 `ToolContext.factions` 中查找，不传整个 factions 数组给 LLM
- **实现简洁**：单次请求构造一次 `ToolContext`，所有工具共享，无重复构造

**实现示例**：
```typescript
// server/server/utils/tool-context.ts
export interface ToolContext {
  saveId: string
  turn: number
  stateSnapshot: StateSnapshot
  character: Character
  factions: Faction[]
  recentEvents: HistoryEvent[]
}

// 工厂函数：基于 ToolContext 创建工具集
export function createTools(ctx: ToolContext) {
  return {
    'get-faction-info': tool({...}),
    'get-all-factions': tool({...}),
    // ...
  }
}
```

### D7：SSE 新增 `tool-call`/`tool-result` 事件类型

**选择**：`advisor-chat` SSE 流新增两种事件类型，与既有 `text-delta`/`[DONE]`/`error` 并列。

**事件格式**：
```
data: {"type":"tool-call","toolName":"get-faction-info","args":{"factionId":"xiang-jun"}}\n\n
data: {"type":"tool-result","toolName":"get-faction-info","result":{"faction":{"id":"xiang-jun","name":"湘军",...}}}\n\n
data: {"delta":"湘军当前实力 65..."}\n\n
data: [DONE]\n\n
```

**理由**：
- **前端感知工具调用**：`AdvisorDrawer` 实时展示"军师正在查询湘军信息…"，提升 Agent 透明度
- **调试便利**：开发者可从 SSE 流看到 LLM 调用了哪些工具、传了什么参数、得到什么结果
- **不破坏既有协议**：前端 `useSSE.ts` 既有 `delta`/`[DONE]`/`error` 处理保留，新增 `tool-call`/`tool-result` 分支

## 多端适配方案

### 手机端（默认，<640px）

- **工具调用过程展示**：`AdvisorDrawer` 对话区上方显示工具调用气泡
  - 气泡样式：浅灰背景 `#F5F5F5`，圆角 `8rpx`，padding `12rpx 16rpx`，字号 `24rpx`
  - 内容："🔍 查询湘军信息…"（图标 + 简短文案）
  - 多个工具调用纵向堆叠，最大高度 `300rpx` 滚动
- **NPC 决策失败标识**：`NpcActionList` 失败 NPC 卡片显示"决策失败"角标，红色边框 `#EF4444`

### 平板端（sm: ≥640px）

- 工具调用气泡可显示更详细文案"军师正在查询湘军与淮军的关系…"
- NPC 决策耗时显示（如"决策耗时 1.2s"）

## 触摸目标尺寸

- **工具调用气泡**：非交互元素（仅展示），最小高度 `48rpx` 保证可读
- **NPC 决策失败角标**：非交互，尺寸 `48rpx × 36rpx`
- **AdvisorDrawer 工具调用区域**：整区域可点击展开查看详情（工具参数 + 完整结果），最小高度 `88rpx`（符合 AGENTS.md「输入区按钮 ≥ 44px」规范）

## API 参数校验与错误处理策略

### `advisor-chat` SSE 流式 + 工具调用

**请求 body**：不变（既有 schema），工具上下文从 body 中构造

**响应 SSE 事件**：
| 事件类型 | data 结构 | 处理 |
| --- | --- | --- |
| `tool-call` | `{ type, toolName, args }` | 前端展示工具调用气泡 |
| `tool-result` | `{ type, toolName, result }` | 前端更新气泡为"已完成" |
| `text-delta` | `{ delta }` | 既有逻辑，追加到回复文本 |
| `[DONE]` | — | 既有逻辑，结束流 |
| `error` | `{ error }` | 既有逻辑，展示错误 toast |

**错误处理**：
- 工具 execute 失败：返回 `{ error, detail }` 给 LLM，LLM 自主决策，SSE 流不中断
- LLM 调用失败：写 `error` 事件 + 结束流（既有逻辑）
- `maxSteps` 超限：`stopWhen(stepCountIs(5))` 自动停止，LLM 基于已有信息生成最终回复

### `npc-actions` 多 Agent 并行

**请求 body**：不变（既有 schema）

**响应**：
```typescript
{
  ok: true,
  data: {
    actions: NpcAction[],          // 成功的 NPC 决策
    failedFactionIds: string[]     // 失败的 NPC 势力 ID（可选）
  }
}
```

**错误处理**：
- 单个 NPC Agent 失败：不影响其他 NPC，加入 `failedFactionIds`
- 全部 NPC Agent 失败：返回 `actions: []` + `X-Fallback: true` header（既有降级逻辑）
- 并发锁冲突：返回 429 + CONCURRENT_REQUEST（既有逻辑）

## 多端兼容方案（H5/小程序/App）

### SSE 流式 + 工具调用事件

- **H5**：`fetch` + `ReadableStream` 既有逻辑，新增 `tool-call`/`tool-result` 事件分支
- **微信小程序**：`uni.request` + `RequestTask.onChunkReceived` 既有逻辑，新增事件分支；iOS 微信部分版本 chunked 不回调时降级 `?stream=false`（既有逻辑）
- **App**：`uni.request` 同小程序

### 工具调用过程展示组件

- `AdvisorDrawer` 是 uni-app Vue3 组件，三端渲染一致
- 工具调用气泡用 `view` + `text` 元素，不依赖 HTML 特定标签
- 图标用内联 SVG（如 🔍 放大镜图标），三端通用

## AI 调用策略

### 流式输出

- **`advisor-chat`**：保留 SSE 流式（既有），新增 `tool-call`/`tool-result` 事件类型；`streamText + tools + maxSteps=5` 通过 `result.fullStream` 迭代获取所有事件类型
- **`npc-actions`**：不流式（多 Agent 并行无法流式），用 `Promise.all` 等待所有 NPC 完成；前端 `useTurn` 显示"NPC 决策中…"loading
- **`generate-event`**：不流式（既有 `generateObject`），LLM 路径前可选调用 `get-recent-events` 工具

### 缓存

- **`advisor-chat`**：无缓存（对话上下文每次不同）
- **`npc-actions`**：无缓存（NPC 决策基于动态状态）
- **`generate-event`**：保留 5 分钟缓存（既有逻辑），缓存键扩展含提案1 的剧情链字段

### 并发控制

- **`advisor-chat`**：保留 `acquireLock(saveId)` 串行锁（既有逻辑）
- **`npc-actions`**：保留 `acquireLock(saveId)` 串行锁，锁内 `Promise.all` 并行执行多 NPC Agent；单 NPC Agent 不单独占锁
- **`generate-event`**：保留 `acquireLock(saveId)` 串行锁（既有逻辑）

### Token 成本

| 路径 | 既有成本 | 升级后成本 | 涨幅 | 说明 |
| --- | --- | --- | --- | --- |
| `advisor-chat` 单次对话 | ~1.5K tokens | ~2-2.5K tokens | +30-50% | 多步工具调用 + 工具结果上下文 |
| `npc-actions` 单回合 | ~2K tokens | ~2.4-4K tokens | +20-100% | N 个独立 Agent（N=3-5） |
| `generate-event` LLM 路径 | ~3-8K tokens | ~3-8K tokens | 0% | 工具调用不调 LLM，仅注入结果 |
| `advisor-briefing` | ~200-400 tokens | ~200-400 tokens | 0% | 不变 |
| `resolve-decision` | ~1-2K tokens | ~1-2K tokens | 0% | 不变 |
| **单局总计** | ~150-250K tokens | ~210-400K tokens | +40-60% | 主要来自 npc-actions 多 Agent |

**结论**：单局总成本上涨 40-60%，按 `Qwen3-8B` 0.35 元/百万 tokens 计，单局成本从约 0.07 元涨到 0.11-0.14 元。考虑 Agent 能力质变（军师主动查询 + NPC 独立决策），性价比可接受。
