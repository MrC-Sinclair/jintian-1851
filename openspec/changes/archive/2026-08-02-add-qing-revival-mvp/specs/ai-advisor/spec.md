# ai-advisor — 军师对话（可选功能）

军师对话为穿插在回合流程中的**可选功能**，玩家可在决策前、决策后随时咨询，不计入回合强制步骤。对话通过 SSE 流式响应实现逐字渲染。

## ADDED Requirements

### Requirement: 军师对话 SSE 流式接口

`POST /api/game/advisor-chat` MUST 以 SSE 流式响应返回军师回复，前端逐字渲染。

#### Scenario: 正常流式对话

WHEN 前端发送 `POST /api/game/advisor-chat` body 含 `{ saveId, turn, messages, stateSnapshot }`
THEN 服务端使用 `Qwen/Qwen3-8B` 模型调用 `streamText()`
AND 系统提示词注入：玩家身份、势力、当前局势、当前回合数
AND 响应 `Content-Type: text/event-stream`
AND 每个 chunk 以 `data: ` 前缀 + JSON 字符串 + `\n\n` 结尾
AND 完成后发送 `data: [DONE]\n\n`

#### Scenario: 历史对话上下文限制

WHEN `messages` 数组长度超过 20
THEN 服务端只保留最后 20 条作为 LLM 上下文
AND 截断行为记录在响应 header `X-Truncated-Messages: true`

#### Scenario: 参数校验失败

WHEN body 缺少 `saveId` 或 `messages` 为空数组 或 最后一条 message role ≠ 'user'
THEN 返回 HTTP 400 + `{ "ok": false, "error": { "code": "INVALID_PARAMS", "message": "..." } }`

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

WHEN 服务端 `streamText()` 抛出异常 或 响应超时（30 秒）
THEN 服务端发送 SSE 错误事件 `data: {"error":"AI_CALL_FAILED"}\n\n`
AND 关闭流
AND 前端在对话区显示「军师沉默，请自行决断」
AND 不影响后续回合流程（事件生成、NPC 行动正常进行）

### Requirement: 军师提示词约束

军师回复 MUST 符合近代背景与玩家身份，禁止出戏。

#### Scenario: 军师回复符合角色设定

WHEN 系统提示词构造时
THEN 提示词包含：
  - 角色设定：「你是 {玩家势力} 的军师/幕僚，清朝末年背景」
  - 玩家身份与势力背景
  - 当前局势摘要（5 维属性 + 资源 + 时间）
  - 最近 3 条历史事件标题
  - 风格约束：「用文言或半文言回复，不超过 200 字，给具体策略建议，不要长篇大论」

#### Scenario: 军师回复长度限制

WHEN LLM 输出超过 300 字
THEN 服务端在 `onFinish` 中检测长度
AND 超长时记录 warning 日志（不强制截断，保持完整性）

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

军师对话流式响应 MUST 兼容 H5、微信小程序、App 三端。

#### Scenario: H5 端使用 fetch + ReadableStream

WHEN 在 H5 环境调用 advisor-chat
THEN `useSSE` composable 使用 `fetch` + `ReadableStream` 读取响应
AND 逐 chunk 解析 SSE 格式
AND 触发 `onChunk(text)` 回调更新 UI

#### Scenario: 微信小程序使用 uni.request + onChunkReceived

WHEN 在微信小程序环境调用 advisor-chat
AND `uni.getStorageSync('sse_chunked_available')` 未探测过
THEN `useSSE` 先发探测请求（2 秒内未收到首个 chunk → `requestTask.abort()`，标记 `_chunkedAvailable = false` 写入 storage）
AND 探测成功或已缓存 chunked 可用 → 走流式：`uni.request({ enableChunked: true })` + `RequestTask.onChunkReceived`
AND 每个 chunk 为 ArrayBuffer，需 `TextDecoder` 转字符串
AND 拼接跨 chunk 的 SSE 数据后解析（**最后一段 JSON.parse 失败时保留到下次拼接**）
AND 触发 `onChunk(text)` 回调更新 UI
AND 首 chunk 超时 3000ms 触发 `onError('TIMEOUT')`

> 注：微信 8.0.56+（2025.02.18 稳定版）已修复 iOS `onChunkReceived` 回调丢失问题，探测大概率成功。但为兼容低版本微信用户，自动探测降级仍保留。

#### Scenario: iOS 微信探测失败自动降级

WHEN 探测请求在 2 秒内未收到首个 chunk
THEN `useSSE` 自动在 URL 追加 `?stream=false` 改走非流式
AND 服务端返回完整 JSON `{ delta: <full text>, done: true }`
AND UI 用一次性 `onChunk(fullText)` 渲染

#### Scenario: App 端行为与小程序一致

WHEN 在 App 环境调用 advisor-chat
THEN 行为与微信小程序场景一致
AND 使用 `uni.request` + chunked
