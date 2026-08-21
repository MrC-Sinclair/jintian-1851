# ai-advisor Specification

## Purpose
`POST /api/game/advisor-chat` 以 SSE 流式返回军师回复，支持工具调用与多步推理（`maxSteps` 5）。历史对话截断保留最近 20 条，是玩家主动咨询局势/策略的 AI 交互通道。
## Requirements
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

### Requirement: 并发锁防重复

同一 `saveId` 同时 MUST 只能有一个 advisor-chat 请求进行中。

#### Scenario: 同存档并发请求被拒绝

WHEN 同一 `saveId` 已有进行中的 advisor-chat 请求
AND 新请求到达
THEN 服务端返回 HTTP 429 + `{ "ok": false, "error": { "code": "CONCURRENT_REQUEST", "message": "本存档正在处理中" } }`
AND 前端 toast 提示「军师正在思考中，请稍候」
AND 不调用 LLM

#### Scenario: 请求完成后锁释放

WHEN 进行中的请求完成（成功或失败）
THEN 锁自动释放
AND 同 `saveId` 的新请求可正常处理

### Requirement: AI 调用失败降级

LLM 调用失败时 MUST 不阻断流程，前端显示「军师沉默」占位。

#### Scenario: LLM 调用失败

WHEN 服务端 `streamText()` 抛出异常 或 响应超时（60 秒）
THEN 服务端发送 SSE 错误事件 `data: {"error":"AI_CALL_FAILED"}\n\n`
AND 关闭流
AND 前端在对话区显示「军师沉默，请自行决断」
AND 不影响后续回合流程（事件生成、NPC 行动正常进行）

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

### Requirement: 对话历史本地存储

军师对话历史 MUST 保存在本地存档 `advisorMessages` 字段，每回合自动截断保留最近 20 条。

#### Scenario: 对话保存到存档

WHEN 玩家发送一条消息并收到军师回复
THEN 前端将 user message 与 assistant message 都追加到 `save.advisorMessages`
AND 每条消息含 `role, content, turn, timestamp`
AND 立即调用 `uni.setStorage('game_save', save)` 持久化

#### Scenario: 超过 20 条自动截断

WHEN `advisorMessages.length > 20`
THEN 截断保留最后 20 条
AND 截断后数组长度 = 20

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
AND 服务端返回完整 JSON `{ delta: <full text>, done: true }`（非流式降级当前不携带工具调用过程字段，前端按 `delta`/`done` 渲染）

### Requirement: 前端工具调用过程展示

前端 `AdvisorDrawer` MUST 实时展示军师工具调用过程。

#### Scenario: 工具调用气泡展示

WHEN `useSSE` 触发 `onToolCall(toolName, args)` 回调
THEN `AdvisorDrawer` 在对话区上方显示工具调用气泡
AND 气泡内容根据 `toolName` 动态生成：
  - `get-faction-info` → "查询势力详情…"
  - `get-all-factions` → "查询所有势力…"
  - `get-character-status` → "查询玩家状态…"
  - `get-recent-events` → "查询历史事件…"
  - `get-relationship` → "查询势力关系…"
  - `get-current-date` → "查询当前日期…"
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

### Requirement: 新回合军师主动局势简报

每回合开始时，游戏 MUST 调用 `POST /api/game/advisor-briefing` 获取军师主动生成的局势简报（60 字内），在 `FocusPanel` 与 `AdvisorDrawer` 中展示，让玩家无需主动提问即可获得当前局势分析与建议。

#### Scenario: 回合开始触发简报

WHEN `useTurn.startTurn()` 执行（与 `generate-event` 并行）
THEN 调用 `POST /api/game/advisor-briefing`，body 为 `{ saveId, turn, stateSnapshot }`
AND 简报与事件生成并行（`Promise.all` + `catch` 降级），不串行阻塞
AND 简报返回 `{ summary, suggestion }` 传给 `FocusPanel`

#### Scenario: 简报展示在 FocusPanel

WHEN 简报返回非空 `suggestion`
THEN `FocusPanel` 建议行显示"💡 {suggestion}"
AND 覆盖规则生成的建议

WHEN 简报返回非空 `summary`
THEN `FocusPanel` 可选展示 `summary`（如危机行下方）

#### Scenario: 简报展示在 AdvisorDrawer

WHEN 玩家打开 `AdvisorDrawer` 且本回合简报未展示过
THEN 消息列表顶部自动插入一条 assistant 消息（标签"局势简报"）
AND 简报消息样式与普通军师回复区分（浅色背景 + "局势简报"角标）
AND 标记本回合已展示（避免重复插入）

#### Scenario: 简报作为军师对话上下文

WHEN 玩家在 `AdvisorDrawer` 追问
THEN 简报内容作为 `advisor-chat` 的上下文传入（`messages` 数组含简报消息）
AND 军师可基于简报继续深入分析

#### Scenario: 简报失败降级

WHEN `advisor-briefing` 调用失败或超时（10s）
THEN 降级返回空简报 `{ summary: '', suggestion: '' }` + header `X-Fallback: true`
AND `FocusPanel` 使用规则生成的建议
AND 不触发 toast 错误（失败不阻断游戏）
AND `console.error` 记录错误

#### Scenario: 简报开关

WHEN `runtimeConfig.enableBriefing === false`
THEN `advisor-briefing` 路由直接返回空简报，不调用 LLM
AND `FocusPanel` 使用规则建议
AND 可全局关闭省成本

### Requirement: 新玩家提示词引导加强

`advisor-chat` 的提示词 MUST 对新玩家（前 3 回合）加强引导，多用白话、主动解释术语、给具体可执行建议、语气鼓励。

#### Scenario: 前 3 回合提示词分支

WHEN `advisor-chat` 接收 `turn <= 3`
THEN 提示词注入新玩家引导段落：
  - 多用白话，少用文言
  - 主动解释专业术语（如提到"军事"时补充"即军队战力"）
  - 给出具体可执行建议（如"建议本回合选择提升军事的选项"）
  - 语气鼓励，降低新玩家挫败感
AND 引导段落基于 `turn` 参数条件注入

#### Scenario: 第 4 回合及以后恢复正常

WHEN `advisor-chat` 接收 `turn > 3`
THEN 提示词不注入新玩家引导段落
AND 军师按正常风格回复（保留古风点缀）

#### Scenario: 不改变流式协议

WHEN 提示词调整
THEN 仍用 `streamText()` + SSE 流式输出
AND 不改变 SSE 协议（`data: {delta}` + `[DONE]`）
AND 不改变 token 预算（提示词增加约 50 tokens，可忽略）

### Requirement: 军师空状态引导文案

`AdvisorDrawer` 空状态 MUST 显示引导性文案，提示玩家可以问什么，降低使用门槛。

#### Scenario: 空状态展示引导

WHEN `AdvisorDrawer` 打开且无消息（`advisorMessages` 为空）
THEN 空状态显示引导文案"有问题可问我，比如"我该优先发展什么？""当前局势如何？""（纯文本，当前未实现可点击示例）

#### Scenario: 有消息不显示空状态

WHEN `advisorMessages` 非空（含历史对话或局势简报）
THEN 不显示空状态引导
AND 直接展示消息列表

### Requirement: 局势简报 API 规格

`POST /api/game/advisor-briefing` MUST 接受局势快照，返回结构化的局势简报与建议，遵循统一响应格式与错误处理。

#### Scenario: 正常请求

WHEN 客户端 POST `{ saveId, turn, stateSnapshot }` 且参数合法
THEN 服务端调用 `Qwen/Qwen3-8B` + `generateObject()` + `createSiliconFlowFetch(false)`（`enable_thinking:false`）
AND zod schema `{ summary: z.string().max(60), suggestion: z.string().max(60) }` 约束输出
AND 返回 200 `{ ok: true, data: { summary, suggestion } }`

#### Scenario: 参数校验失败

WHEN body 缺失字段或类型错误（如 `saveId` 非 UUID、`turn` 非正整数）
THEN 返回 400 `{ ok: false, error: { code: 'INVALID_PARAMS', message: '参数错误' } }`
AND 不调用 LLM

#### Scenario: LLM 调用失败降级

WHEN LLM 调用抛异常或返回非法 JSON
THEN 返回 200 `{ ok: true, data: { summary: '', suggestion: '' }, fallback: true }` + header `X-Fallback: true`
AND 不 throw `createError`（避免阻断游戏）
AND `console.error` 记录错误

#### Scenario: 超时降级

WHEN LLM 调用超过 10s 未返回
THEN 中断调用，降级返回空简报（同 LLM 失败降级）

#### Scenario: 频率限制

WHEN 同一 `deviceId` 每分钟 AI 调用超过 10 次（复用 `rate-limit` 中间件）
THEN 返回 429 `{ ok: false, error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } }`

#### Scenario: 开关关闭

WHEN `runtimeConfig.enableBriefing === false`
THEN 直接返回 200 `{ ok: true, data: { summary: '', suggestion: '' }, fallback: true, reason: 'disabled' }`
AND 不调用 LLM

