# ai-advisor — 军师对话（Agent 化版）

> 本 spec 在 [add-qing-revival-mvp/ai-advisor spec](../../../add-qing-revival-mvp/specs/ai-advisor/spec.md) 基础上修改。
> 章节标注 `## MODIFIED Requirements` 的为既有 Requirement 的修改版。

## MODIFIED Requirements

### Requirement: 军师对话 SSE 流式接口

`POST /api/game/advisor-chat` MUST 以 SSE 流式响应返回军师回复，本提案扩展支持工具调用与多步推理。

#### Scenario: 正常流式对话 + 工具调用

WHEN 前端发送 `POST /api/game/advisor-chat` body 含 `{ saveId, turn, messages, stateSnapshot, character, factions, recentEvents }`
THEN 服务端构造 `ToolContext` 并通过 `createTools(ctx)` 创建 6 个工具
AND 调用 `streamText({ model, system, messages, tools, maxSteps: 5, stopWhen: stepCountIs(5) })`
AND SSE 流可能包含以下事件类型：
  - `data: {"type":"tool-call","toolName":"get-faction-info","args":{"factionId":"xiang-jun"}}\n\n`
  - `data: {"type":"tool-result","toolName":"get-faction-info","result":{"faction":{...}}}\n\n`
  - `data: {"delta":"湘军当前实力..."}\n\n`（既有 text-delta）
  - `data: [DONE]\n\n`（既有完成事件）
AND 工具调用次数 ≤ 5（maxSteps 硬上限）
AND LLM 可自主提前停止（如 1 步即足够回答时）

#### Scenario: 历史对话上下文限制（既有，不变）

WHEN `messages` 数组长度超过 20
THEN 服务端只保留最后 20 条作为 LLM 上下文
AND 截断行为记录在响应 header `X-Truncated-Messages: true`

#### Scenario: 参数校验失败（既有，不变）

WHEN body 缺少 `saveId` 或 `messages` 为空数组 或 最后一条 message role ≠ 'user'
THEN 返回 HTTP 400 + `{ "ok": false, "error": { "code": "INVALID_PARAMS", "message": "..." } }`

#### Scenario: 工具调用过程透传

WHEN `streamText` 的 `fullStream` 产生 `tool-call` 或 `tool-result` 事件
THEN 服务端 MUST 透传给前端 SSE 流
AND 事件格式 `data: {"type":"tool-call","toolName":"...","args":{...}}\n\n` 或 `data: {"type":"tool-result","toolName":"...","result":{...}}\n\n`
AND 前端 `useSSE` 解析新事件类型并转发给 `useAdvisor`

#### Scenario: maxSteps 超限自动停止

WHEN LLM 调用工具达到 5 次（maxSteps 上限）
THEN `stopWhen(stepCountIs(5))` 自动停止工具调用
AND LLM 基于已有信息生成最终回复
AND SSE 流正常完成（发送 `[DONE]`）

### Requirement: 军师提示词约束

军师回复 MUST 符合近代背景与玩家身份，本提案调整提示词以适配 Agent 工具调用模式。

#### Scenario: 军师 system prompt 调整

WHEN 系统提示词构造时
THEN 提示词包含：
  - 角色设定：「你是 {玩家势力} 的军师/幕僚，清朝末年背景」（既有）
  - 玩家身份与势力背景（既有）
  - 当前局势摘要（5 维属性 + 资源 + 时间）（既有）
  - **移除**：最近 3 条历史事件标题（改为通过 `get-recent-events` 工具按需查询）
  - **新增**：工具使用指引："你可以调用以下工具查询信息：get-faction-info（查询势力）、get-all-factions（查询所有势力）、get-character-status（查询玩家状态）、get-recent-events（查询历史事件）、get-relationship（查询势力关系）、get-current-date（查询当前日期）。需要时调用，不需要时直接回答。"
  - **新增**：禁止编造约束："未通过工具查询的数据不可凭空编造，如不确定请调用工具或坦诚告知玩家"
  - 风格约束：「用文言或半文言回复，不超过 200 字」（既有）

#### Scenario: 军师回复长度限制（既有，不变）

WHEN LLM 输出超过 300 字
THEN 服务端在流结束后检测长度
AND 超长时记录 warning 日志（不强制截断）

### Requirement: 三端流式兼容

军师对话流式响应 MUST 兼容 H5、微信小程序、App 三端，本提案扩展支持工具调用事件。

#### Scenario: H5 端使用 fetch + ReadableStream（扩展）

WHEN 在 H5 环境调用 advisor-chat
THEN `useSSE` composable 使用 `fetch` + `ReadableStream` 读取响应（既有）
AND 逐 chunk 解析 SSE 格式（既有）
AND **新增**：解析 `tool-call`/`tool-result` 事件类型，触发 `onToolCall`/`onToolResult` 回调
AND `onChunk(text)` 回调更新对话文本（既有）

#### Scenario: 微信小程序使用 uni.request + onChunkReceived（扩展）

WHEN 在微信小程序环境调用 advisor-chat
THEN 既有逻辑保留（chunked 探测 + `enableChunked: true` + `RequestTask.onChunkReceived`）
AND **新增**：解析 `tool-call`/`tool-result` 事件类型，触发 `onToolCall`/`onToolResult` 回调
AND 跨 chunk SSE 数据拼接逻辑不变（既有）

#### Scenario: iOS 微信探测失败自动降级（既有，不变）

WHEN 探测请求在 2 秒内未收到首个 chunk
THEN `useSSE` 自动在 URL 追加 `?stream=false` 改走非流式（既有）
AND 服务端返回完整 JSON `{ delta: <full text>, done: true, toolCalls: [...] }`（**新增** `toolCalls` 字段记录工具调用过程）

## ADDED Requirements

### Requirement: 前端工具调用过程展示

前端 `AdvisorDrawer` MUST 实时展示军师工具调用过程。

#### Scenario: 工具调用气泡展示

WHEN `useSSE` 触发 `onToolCall(toolName, args)` 回调
THEN `AdvisorDrawer` 在对话区上方显示工具调用气泡
AND 气泡内容根据 `toolName` 动态生成：
  - `get-faction-info` → "🔍 查询势力信息…"
  - `get-all-factions` → "🔍 查询所有势力…"
  - `get-character-status` → "🔍 查询玩家状态…"
  - `get-recent-events` → "🔍 查询历史事件…"
  - `get-relationship` → "🔍 查询势力关系…"
  - `get-current-date` → "🔍 查询当前日期…"
AND 气泡样式：浅灰背景 `#F5F5F5`，圆角 `8rpx`，padding `12rpx 16rpx`，字号 `24rpx`

#### Scenario: 工具调用完成更新

WHEN `useSSE` 触发 `onToolResult(toolName, result)` 回调
THEN 对应工具调用气泡更新为"已完成"状态
AND 气泡背景变浅绿 `#E8F5E9`，添加 ✓ 图标
AND 若 `result` 含 `error` 字段，气泡变浅红 `#FFEBEE`，添加 ✗ 图标

#### Scenario: 多个工具调用堆叠

WHEN 单次对话中 LLM 调用多个工具
THEN 工具调用气泡纵向堆叠展示
AND 最大高度 `300rpx`，超出可滚动
AND 气泡顺序与工具调用顺序一致

#### Scenario: 工具调用气泡可点击展开

WHEN 玩家点击工具调用气泡
THEN 气泡展开显示详情：工具名 + 参数 + 完整结果（JSON 格式）
AND 再次点击收起
AND 触摸目标 ≥ 44px（符合 AGENTS.md 规范）
