# ai-advisor — 军师主动引导（MODIFIED）

## ADDED Requirements

### Requirement: 新回合军师主动局势简报

每回合开始时，游戏 MUST 调用 `POST /api/game/advisor-briefing` 获取军师主动生成的局势简报（50 字内），在 `FocusPanel` 与 `AdvisorDrawer` 中展示，让玩家无需主动提问即可获得当前局势分析与建议。

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
THEN 空状态显示引导文案"有问题可问我，比如"
AND 下方显示 2-3 个示例问题（可点击直接发送）：
  - "我该优先发展什么？"
  - "当前局势如何？"
  - "这个事件该怎么应对？"
AND 示例问题点击后填入输入框并自动发送

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
THEN 返回 429 `{ ok: false, error: { code: 'RATE_LIMITD', message: '请求过于频繁，请稍后再试' } }`

#### Scenario: 开关关闭

WHEN `runtimeConfig.enableBriefing === false`
THEN 直接返回 200 `{ ok: true, data: { summary: '', suggestion: '' }, fallback: true, reason: 'disabled' }`
AND 不调用 LLM
