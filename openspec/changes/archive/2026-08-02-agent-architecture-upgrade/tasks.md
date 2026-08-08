# 任务拆分 — Agent 架构升级（agent-architecture-upgrade）

任务按依赖关系排序，分六阶段独立落地。每阶段完成后必须通过对应验证命令才能进入下一阶段。所有代码任务结束前必须运行 `pnpm lint` + `pnpm typecheck`，多端兼容任务必须 H5+小程序双端验证。

> 工作目录约定：前端任务在 `d:\code\codeWork\GAME\game-web\`，后端任务在 `d:\code\codeWork\GAME\server\`。下方命令默认在对应工作目录执行。
>
> 本提案**不涉及数据库 schema 变更**（工具查询内存数据），无需 `pnpm db:push`。
>
> 本提案与 [expand-event-engine](../expand-event-engine/tasks.md) 提案修改同一 `ai-event-engine` 能力，实施时合并 `generate-event.ts` 改动。

## 阶段 1：工具系统基础设施（无副作用，可独立验证）

### T1.1 创建 ToolContext 类型与工厂函数

- 创建 `server/server/utils/tool-context.ts`：
  ```typescript
  import type { StateSnapshot, Character, Faction, HistoryEvent } from '../../types/game'

  export interface ToolContext {
    saveId: string
    turn: number
    stateSnapshot: StateSnapshot
    character: Character
    factions: Faction[]
    recentEvents: HistoryEvent[]
  }

  /**
   * 基于 ToolContext 创建工具集
   * 所有工具通过闭包访问 ToolContext，不查数据库
   */
  export function createTools(ctx: ToolContext) {
    return {
      'get-faction-info': createGetFactionInfoTool(ctx),
      'get-all-factions': createGetAllFactionsTool(ctx),
      'get-character-status': createGetCharacterStatusTool(ctx),
      'get-recent-events': createGetRecentEventsTool(ctx),
      'get-relationship': createGetRelationshipTool(ctx),
      'get-current-date': createGetCurrentDateTool(ctx)
    }
  }
  ```
- 工具创建函数从对应工具文件 import
- **验证**：`pnpm typecheck` 通过；`pnpm lint` 通过

### T1.2 实现 get-faction-info 工具

- 创建 `server/server/tools/get-faction-info.ts`：
  ```typescript
  import { tool } from 'ai'
  import { z } from 'zod'
  import type { ToolContext } from '../utils/tool-context'

  export function createGetFactionInfoTool(ctx: ToolContext) {
    return tool({
      description: '查询单个势力详情（id/name/summary/power/relationship/status/lastAction）。何时调用：玩家询问某势力情况、NPC 决策需要了解对手时。何时不用：已知势力全部信息时。',
      parameters: z.object({
        factionId: z.string().min(1).describe('势力 ID，如 "xiang-jun"')
      }),
      execute: async ({ factionId }) => {
        try {
          const faction = ctx.factions.find(f => f.id === factionId)
          if (!faction) {
            return { error: 'FACTION_NOT_FOUND', detail: `势力 ID ${factionId} 不存在` }
          }
          return { faction }
        } catch (err) {
          return { error: 'INTERNAL_ERROR', detail: String(err) }
        }
      }
    })
  }
  ```
- **验证**：`pnpm typecheck` 通过；`pnpm lint` 通过

### T1.3 实现 get-all-factions 工具

- 创建 `server/server/tools/get-all-factions.ts`：
  - 用 `tool()` 定义，无 parameters
  - `execute` 返回 `{ factions: Array<{ id, name, power, relationship, status }> }`（不传 summary，控制 token）
  - 失败返回 `{ error: 'INTERNAL_ERROR', detail }` 不 throw
- **验证**：`pnpm typecheck` 通过

### T1.4 实现 get-character-status 工具

- 创建 `server/server/tools/get-character-status.ts`：
  - 无 parameters
  - 返回 `{ character: { background, factionId, factionName, attributes, resources, turn, date } }`
  - 数据来源 `ctx.character` + `ctx.stateSnapshot`
- **验证**：`pnpm typecheck` 通过

### T1.5 实现 get-recent-events 工具

- 创建 `server/server/tools/get-recent-events.ts`：
  - parameters: `{ limit: z.number().int().min(1).max(20).default(5) }`
  - 返回 `{ events: HistoryEvent[] }` 或 `{ events: [], note: '尚无历史事件' }`（空数组时）
  - limit 上限 20，下限 1，超出范围按边界处理
- **验证**：`pnpm typecheck` 通过

### T1.6 实现 get-relationship 工具

- 创建 `server/server/tools/get-relationship.ts`：
  - parameters: `{ factionIdA: string, factionIdB: string }`
  - 返回 `{ relationship: number, factionA: string, factionB: string }`
  - 取两势力 relationship 字段平均值（因 relationship 是相对玩家的）
  - 某势力不存在时返回 `{ error: 'FACTION_NOT_FOUND', detail }`
- **验证**：`pnpm typecheck` 通过

### T1.7 实现 get-current-date 工具

- 创建 `server/server/tools/get-current-date.ts`：
  - 无 parameters
  - 返回 `{ date: { year, month }, turn, note: '咸丰元年六月' }`（年份转年号）
  - 年号映射：1851-1861 咸丰、1862-1874 同治、1875-1908 光绪、1909-1911 宣统、1912 民国元年
- **验证**：`pnpm typecheck` 通过

### T1.8 单元测试 6 个工具

- 创建 `server/tests/unit/tools.test.ts`，覆盖每个工具：
  - 正常调用返回正确结构
  - 失败场景（如 factionId 不存在）返回 `{ error, detail }` 不 throw
  - 参数校验失败（如缺 factionId）
  - 边界值（如 limit 超出范围）
- **验证**：`pnpm test:unit` 通过；`pnpm lint` 通过

## 阶段 2：advisor-chat Agent 化（依赖阶段 1）

### T2.1 修改 advisor-chat.ts 注册工具 + maxSteps=5

- 修改 [server/server/api/game/advisor-chat.ts](../../server/server/api/game/advisor-chat.ts)：
  - 在 `streamText()` 调用前构造 `ToolContext`（从 body 中提取）
  - 调用 `createTools(ctx)` 创建工具集
  - `streamText({ model, system, messages, tools, maxSteps: 5, stopWhen: stepCountIs(5), ... })`
  - 处理 `fullStream` 中的 `tool-call`/`tool-result` 事件，写入 SSE 流
- **验证**：`pnpm typecheck` 通过；`pnpm lint` 通过

### T2.2 SSE 新增 tool-call/tool-result 事件

- 修改 `advisor-chat.ts` 的 SSE 流写入逻辑：
  - `tool-call` 事件：`data: {"type":"tool-call","toolName":"...","args":{...}}\n\n`
  - `tool-result` 事件：`data: {"type":"tool-result","toolName":"...","result":{...}}\n\n`
  - 既有 `text-delta` 与 `[DONE]` 不变
- **验证**：扩展 `server/tests/api/advisor-chat.test.ts` 验证新事件类型；`pnpm test:unit` 通过

### T2.3 修改 advisor-chat system prompt

- 修改 [server/server/utils/prompts/advisor-chat.ts](../../server/server/utils/prompts/advisor-chat.ts)：
  - **移除** prompt 中的"最近 3 条历史事件标题"（改为 LLM 自主调用 `get-recent-events`）
  - **新增** 工具使用指引："你可以调用以下工具查询信息：get-faction-info / get-all-factions / get-character-status / get-recent-events / get-relationship / get-current-date。需要时调用，不需要时直接回答。"
  - **新增** 禁止编造约束："未通过工具查询的数据不可凭空编造，如不确定请调用工具或坦诚告知玩家"
  - 既有"角色设定 / 玩家身份 / 当前局势 / 风格约束"保留
- **验证**：扩展 `server/tests/unit/prompts.test.ts` 验证新 prompt 内容；`pnpm test:unit` 通过

### T2.4 useSSE.ts 扩展支持新事件类型

- 修改 [game-web/src/composables/useSSE.ts](../../game-web/src/composables/useSSE.ts)：
  - SSE 解析逻辑新增 `tool-call`/`tool-result` 事件类型分支
  - 触发 `onToolCall(toolName, args)` 与 `onToolResult(toolName, result)` 回调
  - 既有 `onChunk(text)` / `onDone` / `onError` 不变
- 修改 [game-web/src/composables/useAdvisor.ts](../../game-web/src/composables/useAdvisor.ts)：
  - 新增 `toolCalls` ref 数组，记录工具调用过程
  - 注册 `onToolCall`/`onToolResult` 回调，更新 `toolCalls`
  - 工具调用记录不持久化（仅本回合展示）
- **验证**：扩展 `tests/unit/use-sse.test.ts` + `tests/unit/use-advisor.test.ts` 验证新事件类型；`pnpm test:unit` 通过

### T2.5 AdvisorDrawer 工具调用气泡 UI

- 修改 [game-web/src/components/AdvisorDrawer.vue](../../game-web/src/components/AdvisorDrawer.vue)：
  - 对话区上方显示工具调用气泡列表（来自 `useAdvisor.toolCalls`）
  - 气泡样式：
    - 调用中：浅灰背景 `#F5F5F5`，文案"🔍 查询 XXX…"
    - 完成：浅绿背景 `#E8F5E9`，添加 ✓ 图标
    - 失败：浅红背景 `#FFEBEE`，添加 ✗ 图标
  - 气泡纵向堆叠，最大高度 `300rpx` 可滚动
  - 气泡可点击展开详情（工具名 + 参数 + 完整结果 JSON），触摸目标 ≥44px
  - 折叠/展开用 `max-height` + `overflow:hidden` + `transition`（AGENTS.md 规范）
- **验证**：扩展 `tests/component/AdvisorDrawer.test.ts` 验证气泡显隐 + 展开/收起；`pnpm test:unit` 通过；`pnpm lint` 通过

### T2.6 集成测试 advisor-chat Agent 化

- 扩展 `server/tests/api/advisor-chat.test.ts`：
  - 多步工具调用场景（maxSteps=5）
  - 工具失败容错场景（LLM 收到 error 后继续生成）
  - maxSteps 超限自动停止场景
  - SSE 流含 tool-call/tool-result 事件验证
- **验证**：`pnpm test:unit` 通过；`pnpm lint` + `pnpm typecheck` 通过

## 阶段 3：npc-actions 多 Agent 改造（依赖阶段 1）

### T3.1 创建 npc-agent.ts system prompt 模板

- 创建 `server/server/utils/prompts/npc-agent.ts`：
  ```typescript
  export function buildNpcAgentPrompt(faction: Faction, ctx: ToolContext): string {
    const relationship = faction.relationship
    let goal: string
    if (relationship < -30) {
      goal = '你的目标是削弱玩家势力，可挑衅/备战/扩张针对玩家'
    } else if (relationship > 30) {
      goal = '你的目标是与玩家势力维持盟约，可外交/休养/结盟'
    } else {
      goal = '你的目标是发展自身实力，可休养/扩张/备战'
    }
    return [
      `你是 ${faction.name} 的决策者，${faction.summary}`,
      `本势力当前实力 ${faction.power}，与玩家势力关系 ${relationship}（负数=敌对，正数=友好）`,
      `决策目标：${goal}`,
      '可选行动：扩张/结盟/备战/休养/挑衅/外交',
      '需要查询其他势力或玩家状态时可调用工具',
      '返回 JSON：{ action, target, description, effects }'
    ].join('\n')
  }
  ```
- **验证**：`pnpm typecheck` 通过；新增 `server/tests/unit/npc-agent-prompt.test.ts` 验证不同 relationship 下的 prompt 差异

### T3.2 修改 npc-actions.ts 多 Agent 并行

- 修改 [server/server/api/game/npc-actions.ts](../../server/server/api/game/npc-actions.ts)：
  - 移除既有 `generateObject` 单次调用逻辑
  - 新增 `runNpcAgent(faction, ctx)` 函数：
    ```typescript
    async function runNpcAgent(faction: Faction, ctx: ToolContext): Promise<NpcAction | { failed: true }> {
      const tools = createNpcTools(ctx)  // 仅注册 4 个核心工具
      const system = buildNpcAgentPrompt(faction, ctx)
      try {
        const result = await streamText({
          model,
          system,
          tools,
          maxSteps: 3,
          stopWhen: stepCountIs(3),
          prompt: '请决策本回合行动',
          abortSignal: AbortSignal.timeout(30_000)
        })
        // 解析 LLM 输出为 NpcAction 结构（用 onFinish 或 generateObject 兜底）
        return parseNpcAction(result, faction)
      } catch (err) {
        console.warn(`[npc-actions] NPC ${faction.name} Agent 失败:`, err)
        return { failed: true }
      }
    }
    ```
  - 主流程改为 `Promise.all(activeFactions.map(f => runNpcAgent(f, ctx)))`
  - 失败的 NPC 加入 `failedFactionIds`
- **验证**：`pnpm typecheck` 通过；`pnpm lint` 通过

### T3.3 单 NPC 失败容错处理

- 修改 `npc-actions.ts` 的响应结构：
  - 成功：`{ ok: true, data: { actions: [...], failedFactionIds?: [...] } }`
  - 部分失败：`X-Partial-Failure: true` header
  - 全部失败：`{ ok: true, data: { actions: [], failedFactionIds: [...all], fallback: true } }` + `X-Fallback: true` header
- **验证**：扩展 `server/tests/api/npc-actions.test.ts` 覆盖失败容错；`pnpm test:unit` 通过

### T3.4 NpcActionList 失败标识 UI

- 修改 [game-web/src/components/NpcActionList.vue](../../game-web/src/components/NpcActionList.vue)：
  - 接收 `failedFactionIds` prop
  - 失败 NPC 卡片显示"决策失败"角标（红色边框 `#EF4444`）
  - 平板端可显示决策耗时（如"决策耗时 1.2s"）
- 修改 [game-web/src/composables/useTurn.ts](../../game-web/src/composables/useTurn.ts)：
  - 接收 `failedFactionIds` 并传给 `NpcActionList`
- **验证**：扩展 `tests/component/NpcActionList.test.ts` 验证失败标识；`pnpm test:unit` 通过

### T3.5 集成测试 npc-actions 多 Agent

- 扩展 `server/tests/api/npc-actions.test.ts`：
  - 多 NPC 并行决策场景
  - 单 NPC 失败不影响其他
  - 全部失败降级
  - NPC 决策差异化（不同 relationship 产生不同行动）
- **验证**：`pnpm test:unit` 通过；`pnpm lint` + `pnpm typecheck` 通过

## 阶段 4：generate-event 工具结果注入（依赖阶段 1）

### T4.1 修改 generate-event.ts LLM 路径前调用工具

- 修改 [server/server/api/game/generate-event.ts](../../server/server/api/game/generate-event.ts)：
  - 在 LLM 自主生成路径前（挂起节点与时间窗口都不满足时）：
    ```typescript
    // 构造 ToolContext
    const ctx = { saveId, turn, stateSnapshot, character, factions, recentEvents }
    // 调用 get-recent-events 工具获取更多上下文
    const tools = createTools(ctx)
    const toolResult = await tools['get-recent-events'].execute({ limit: 10 }, {})
    const enrichedRecentEvents = toolResult.events ?? recentEvents
    ```
  - 用 `enrichedRecentEvents` 替换 prompt 中的 `recentEvents`
  - 然后按既有逻辑调用 `generateObject()`
- **验证**：`pnpm typecheck` 通过；`pnpm lint` 通过

### T4.2 工具失败降级处理

- 修改 `generate-event.ts`：
  - 工具调用 try/catch，失败时 `console.warn` + 使用 body 中的 `recentEvents`（5 条）
  - 响应 header `X-Tool-Fallback: true` 标识工具降级
- **验证**：扩展 `server/tests/api/generate-event.test.ts` 验证工具失败降级；`pnpm test:unit` 通过

### T4.3 集成测试 generate-event 工具注入

- 扩展 `server/tests/api/generate-event.test.ts`：
  - LLM 路径前调用 `get-recent-events` 工具
  - 工具结果注入 prompt
  - 工具失败降级到 body 中的 recentEvents
- **验证**：`pnpm test:unit` 通过

## 阶段 5：测试与文档（依赖阶段 4）

### T5.1 端到端测试

- 新增 `game-web/tests/e2e/agent-flow.spec.ts`：
  - 场景 1：玩家问军师"上次选了什么"→ 军师调用 `get-recent-events` → 返回历史事件
  - 场景 2：NPC 决策差异化（不同势力产生不同行动）
  - 场景 3：工具调用气泡 UI 展示
  - 场景 4：NPC 失败标识展示
- **验证**：`pnpm test:e2e` 通过（H5 端）

### T5.2 文档同步

- 更新 [docs/API.md](../../docs/API.md)：
  - `POST /api/game/advisor-chat` 新增工具调用说明 + SSE 新事件类型（`tool-call`/`tool-result`）
  - `POST /api/game/npc-actions` 新增多 Agent 并行说明 + `failedFactionIds` 字段
  - `POST /api/game/generate-event` 新增工具结果注入说明 + `X-Tool-Fallback` header
- 更新 [docs/ai-cost.md](../../docs/ai-cost.md)：
  - 新增 token 成本上涨分析表（design.md 中的表格）
  - 单局总成本上涨 40-60% 的详细计算
- **验证**：人工 review 文档完整性

## 阶段 6：多端验证（依赖阶段 5）

### T6.1 H5 浏览器验证

- `pnpm dev`（在 `game-web/` 目录）启动 H5 开发服务器
- 浏览器手动验证：
  - 玩家问军师"上次选了什么" → 看到工具调用气泡"🔍 查询历史事件…" → 军师回复含历史事件
  - NPC 决策差异化（湘军与太平天国决策不同）
  - 单 NPC 失败时 `NpcActionList` 显示失败角标
- **验证**：浏览器手动验证 + 控制台无报错

### T6.2 微信小程序真机验证

- `pnpm dev:mp-weixin`（在 `game-web/` 目录）构建小程序
- 微信开发者工具 + 真机（iOS + Android）验证：
  - 同 T6.1 流程
  - 验证 SSE 流式含 `tool-call`/`tool-result` 事件三端兼容
  - iOS 微信 chunked 降级场景下 `toolCalls` 字段返回
- **验证**：iOS + Android 真机各 1 次完整流程

### T6.3 全量验证

- 在 `game-web/` 目录执行：`pnpm lint` + `pnpm typecheck` + `pnpm test:all`
- 在 `server/` 目录执行：`pnpm lint` + `pnpm typecheck` + `pnpm test:all`
- **验证**：全部通过，无报错；`pnpm build` 成功（H5 + 小程序双端构建）

## 完成标准

- 6 个工具实现完整，单元测试覆盖
- `advisor-chat` Agent 化（maxSteps=5 + 6 工具），SSE 含 tool-call/tool-result 事件
- `npc-actions` 多 Agent 并行（maxSteps=3 + 4 工具/Agent），单 NPC 失败容错
- `generate-event` LLM 路径前调用 `get-recent-events` 工具丰富上下文
- `AdvisorDrawer` 工具调用气泡 UI 三端一致
- `NpcActionList` 失败标识 UI 三端一致
- 单元 + API + 组件 + E2E 测试全部通过
- 文档（API.md / ai-cost.md）同步更新
- H5 + 小程序双端完整流程验证通过
- token 成本上涨控制在 40-60% 范围内（实测验证）
