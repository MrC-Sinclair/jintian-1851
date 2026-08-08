# ai-event-engine — AI 事件生成（工具结果注入版）

> 本 spec 在 [add-qing-revival-mvp/ai-event-engine spec](../../../add-qing-revival-mvp/specs/ai-event-engine/spec.md) 与 [expand-event-engine/ai-event-engine spec](../../expand-event-engine/specs/ai-event-engine/spec.md) 基础上修改。
> 章节标注 `## MODIFIED Requirements` 的为既有 Requirement 的修改版。
>
> 注意：本 spec 与 `expand-event-engine` 提案修改同一能力，实施时合并。

## MODIFIED Requirements

### Requirement: 结构化事件生成接口

`POST /api/game/generate-event` MUST 在 LLM 自主生成路径前可选调用 `get-recent-events` 工具丰富上下文。

#### Scenario: LLM 路径前调用 get-recent-events 工具

WHEN `pendingChainNodes` 为空 且 无剧情链时间窗口匹配（走 LLM 自主生成路径）
THEN 服务端在调用 `generateObject()` 前，先调用 `get-recent-events` 工具
AND 工具参数 `{ limit: 10 }`（获取最近 10 条事件，比 prompt 中的 5 条更丰富）
AND 工具结果（10 条事件标题 + 描述摘要）注入到 prompt 的 `recentEvents` 字段
AND 替换原 prompt 中的 `recentEvents`（5 条）为工具返回的 10 条
AND 然后按既有逻辑调用 `generateObject()` 生成事件

#### Scenario: 工具调用失败降级

WHEN `get-recent-events` 工具执行失败（如内部异常）
THEN 服务端记录 `console.warn` 日志
AND 使用请求 body 中既有的 `recentEvents`（5 条）作为 prompt 上下文
AND 不影响后续 LLM 调用
AND 响应 header `X-Tool-Fallback: true` 标识工具降级

#### Scenario: 剧情链路径不调用工具（既有，不变）

WHEN `pendingChainNodes` 非空 或 时间窗口匹配剧情链
THEN 服务端不调用 `get-recent-events` 工具（剧情链节点是预定义数据，无需丰富上下文）
AND 直接返回剧情链节点 event（与 expand-event-engine spec 一致）

#### Scenario: 缓存键计算（与 expand-event-engine 合并）

WHEN 计算缓存键时
THEN 输入 = `saveId + turn + sha256(stateSnapshot) + sha256(pendingChainNodes + completedChainIds + activeChainIds)`
AND 工具调用结果不参与缓存键计算（因工具查询的是 body 中的内存数据，相同 body 必然产生相同工具结果）
AND 缓存 TTL 仍为 5 分钟

### Requirement: 5 分钟事件缓存

服务端 MUST 缓存 `generate-event` 结果，5 分钟内同输入不重复调 LLM 或重新匹配剧情链。

#### Scenario: 缓存命中（既有）

WHEN 同一缓存键在 5 分钟内再次请求
THEN 服务端直接返回缓存的 event 对象
AND 不调用 LLM、不调用 `get-recent-events` 工具、不重新匹配剧情链
AND 响应 header `X-Cache: HIT`

#### Scenario: 缓存未命中（既有）

WHEN 首次请求 或 TTL 过期 或 输入不同
THEN 服务端按三层触发优先级生成（挂起节点 > 时间窗口 > LLM 自主生成）
AND LLM 路径前调用 `get-recent-events` 工具
AND 响应 header `X-Cache: MISS`
AND 结果写入缓存

## ADDED Requirements

### Requirement: generate-event 工具结果注入

`generate-event` LLM 自主生成路径 MUST 在调用 LLM 前通过 `get-recent-events` 工具丰富上下文。

#### Scenario: 工具结果注入 prompt

WHEN 服务端构造 `generateObject` 的 prompt 时
THEN `recentEvents` 字段使用 `get-recent-events` 工具返回的 10 条事件（而非 body 中的 5 条）
AND prompt 中事件列表格式："最近 10 起事件：1. {title1} - {description1 摘要}\n2. ..."

#### Scenario: 工具结果不传 LLM 上下文

WHEN `get-recent-events` 工具返回结果
THEN 服务端仅将事件列表注入到 prompt 中
AND 不将工具调用过程暴露给 LLM（LLM 不知道有工具调用，只看到 prompt 中的事件列表）
AND 避免引入 `maxSteps` 复杂度（与 ai-advisor 的 Agent 模式不同）

#### Scenario: get-recent-events 工具复用

WHEN `generate-event` 调用 `get-recent-events` 工具
THEN 工具定义复用 `server/server/tools/get-recent-events.ts`（与 ai-advisor 共享）
AND `ToolContext` 从请求 body 构造
AND 工具调用方式为服务端主动调用（非 LLM 自主调用）
AND 工具失败时按"工具调用失败降级" Scenario 处理
