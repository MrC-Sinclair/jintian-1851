# agent-tool-system — Agent 工具系统

> 本 spec 为本提案新增能力，定义 `server/server/tools/` 目录与 6 个核心工具的接口规范。

## ADDED Requirements

### Requirement: 工具系统目录结构

服务端 MUST 在 `server/server/tools/` 目录维护所有工具定义，每个工具一个文件。

#### Scenario: 工具文件组织

WHEN 检查 `server/server/tools/` 目录
THEN 包含以下文件：
  - `get-faction-info.ts`
  - `get-all-factions.ts`
  - `get-character-status.ts`
  - `get-recent-events.ts`
  - `get-relationship.ts`
  - `get-current-date.ts`
AND 每个文件用 `tool()` 函数定义并默认导出工具对象
AND 每个工具的 `description` 字段说明"何时调用"和"何时不调用"

#### Scenario: 工具上下文注入

WHEN 工具被注册到 `streamText` 调用前
THEN 服务端 MUST 通过工厂函数 `createTools(ctx: ToolContext)` 创建工具集
AND `ToolContext` 类型含 `{ saveId, turn, stateSnapshot, character, factions, recentEvents }`
AND 所有工具的 `execute` 函数通过闭包访问 `ToolContext`，不查数据库
AND 单次请求构造一次 `ToolContext`，所有工具共享

### Requirement: get-faction-info 工具

`get-faction-info` 工具 MUST 返回单个势力的详情。

#### Scenario: 正常查询势力

WHEN LLM 调用 `get-faction-info` 工具，参数 `{ factionId: "xiang-jun" }`
AND `ToolContext.factions` 中存在 `id === "xiang-jun"` 的势力
THEN 工具返回 `{ faction: { id, name, summary, power, relationship, status, lastAction } }`
AND 不调用 LLM、不查数据库

#### Scenario: 势力 ID 不存在

WHEN LLM 调用 `get-faction-info` 工具，参数 `{ factionId: "unknown" }`
AND `ToolContext.factions` 中无匹配势力
THEN 工具返回 `{ error: 'FACTION_NOT_FOUND', detail: '势力 ID unknown 不存在' }`
AND 不 throw 异常
AND LLM 可基于错误信息调整策略（如换 ID 或调用 `get-all-factions`）

#### Scenario: 参数校验失败

WHEN LLM 调用 `get-faction-info` 工具，参数缺 `factionId` 或为空字符串
THEN zod schema 校验失败
AND 工具返回 `{ error: 'INVALID_PARAMS', detail: 'factionId 必填' }`

### Requirement: get-all-factions 工具

`get-all-factions` 工具 MUST 返回所有势力列表（压缩为 4 字段）。

#### Scenario: 正常查询所有势力

WHEN LLM 调用 `get-all-factions` 工具，无参数
THEN 工具返回 `{ factions: Array<{ id, name, power, relationship, status }> }`
AND 不传 `summary` 字段（控制 token 成本）
AND 不调用 LLM、不查数据库

### Requirement: get-character-status 工具

`get-character-status` 工具 MUST 返回玩家当前状态详情。

#### Scenario: 正常查询玩家状态

WHEN LLM 调用 `get-character-status` 工具，无参数
THEN 工具返回 `{ character: { background, factionId, factionName, attributes, resources, turn, date } }`
AND 数据来源 `ToolContext.character` + `ToolContext.stateSnapshot`
AND 不调用 LLM、不查数据库

### Requirement: get-recent-events 工具

`get-recent-events` 工具 MUST 返回最近 N 回合事件历史。

#### Scenario: 默认查询最近 5 条

WHEN LLM 调用 `get-recent-events` 工具，无参数或 `{ limit: 5 }`
THEN 工具返回 `{ events: HistoryEvent[] }`，最多 5 条
AND 数据来源 `ToolContext.recentEvents`
AND 不调用 LLM、不查数据库

#### Scenario: 自定义查询数量

WHEN LLM 调用 `get-recent-events` 工具，参数 `{ limit: 10 }`
THEN 工具返回最多 10 条事件
AND `limit` 上限 20（防止 token 膨胀），超过时按 20 处理
AND `limit` 下限 1，小于 1 时按 1 处理

#### Scenario: 无历史事件

WHEN `ToolContext.recentEvents` 为空数组（首回合）
THEN 工具返回 `{ events: [], note: '尚无历史事件' }`

### Requirement: get-relationship 工具

`get-relationship` 工具 MUST 返回两势力之间的关系值。

#### Scenario: 正常查询关系

WHEN LLM 调用 `get-relationship` 工具，参数 `{ factionIdA: "xiang-jun", factionIdB: "huai-jun" }`
AND 两个 factionId 均存在
THEN 工具返回 `{ relationship: 30, factionA: "湘军", factionB: "淮军" }`
AND 数据来源 `ToolContext.factions` 中两势力的 `relationship` 字段（取平均值，因 relationship 是相对玩家的）

#### Scenario: 势力 ID 不存在

WHEN LLM 调用 `get-relationship` 工具，参数中某 factionId 不存在
THEN 工具返回 `{ error: 'FACTION_NOT_FOUND', detail: '势力 ID xxx 不存在' }`
AND 不 throw 异常

### Requirement: get-current-date 工具

`get-current-date` 工具 MUST 返回当前游戏内日期。

#### Scenario: 正常查询日期

WHEN LLM 调用 `get-current-date` 工具，无参数
THEN 工具返回 `{ date: { year: 1851, month: 6 }, turn: 6, note: '咸丰元年六月' }`
AND 数据来源 `ToolContext.stateSnapshot.date` + `ToolContext.turn`
AND 不调用 LLM、不查数据库

### Requirement: 工具失败容错

所有工具 MUST 在执行失败时返回 `{ error, detail }` 不 throw。

#### Scenario: 工具内部异常

WHEN 工具 `execute` 函数内部抛出异常（如类型错误、空指针等）
THEN 工具 MUST 用 try/catch 捕获
AND 返回 `{ error: 'INTERNAL_ERROR', detail: String(err) }`
AND 不向上抛出异常
AND `streamText` 流不中断
AND LLM 收到错误对象后自主决定重试/换工具/继续生成

#### Scenario: LLM 收到工具错误后自主决策

WHEN LLM 调用 `get-faction-info` 收到 `{ error: 'FACTION_NOT_FOUND' }`
THEN LLM 可选择：
  - 调用 `get-all-factions` 获取所有势力列表再选 ID
  - 直接基于已有信息生成回复
  - 向玩家询问势力 ID
AND 服务端不强制 LLM 的决策策略
