# ai-npc-faction Specification

## Purpose
`POST /api/game/npc-actions` 为每个活跃 NPC 势力构造独立 Agent 并行决策（多 Agent + 工具上下文 + `maxSteps`），返回本回合行动列表与决策失败的势力。是"天下动静"面板与 NPC effects 应用的数据来源。
## Requirements
### Requirement: NPC 决策结构化接口

`POST /api/game/npc-actions` MUST 返回每个活跃 NPC 势力本回合的行动列表，采用多 Agent 并行决策。

#### Scenario: 多 Agent 并行决策

WHEN 前端发送 `POST /api/game/npc-actions` body 含 `{ saveId, turn, factions, stateSnapshot, character }`
THEN 服务端过滤 `status === 'active'` 的 NPC 势力（既有）
AND 所有 NPC Agent 共享同一个 `ToolContext`（含全部 activeFactions、`recentEvents: []`）
AND 通过 `Promise.all(activeFactions.map(faction => runNpcAgent(faction, ctx)))` 并行调用
AND 每个 NPC Agent 调用 `streamText({ model, system: npcSystemPrompt, tools, maxSteps: 3, stopWhen: stepCountIs(3) })`
AND 每个 NPC Agent 注册 4 个工具：`get-faction-info`/`get-all-factions`/`get-relationship`/`get-character-status`（不含 `get-current-date`）
AND 返回结构：
  ```typescript
  {
    actions: Array<{
      factionId: string
      factionName: string
      action: '扩张' | '结盟' | '备战' | '休养' | '挑衅' | '外交'
      target?: string
      description: string
      effects: { ... }
    }>,
    failedFactionIds?: string[]  // 新增：失败的 NPC 势力 ID
  }
  ```

#### Scenario: 单个 NPC Agent 失败不影响其他

WHEN 某 NPC Agent 调用失败（LLM 超时或工具异常）
THEN 该 NPC 加入 `failedFactionIds` 数组
AND 其他 NPC Agent 决策正常返回
AND `actions` 数组仅含成功的 NPC 决策
AND 响应 header `X-Partial-Failure: true` 标识部分失败

#### Scenario: 全部 NPC Agent 失败

WHEN 所有 NPC Agent 均失败
THEN 服务端返回 `{ actions: [], failedFactionIds: [...all], fallback: true }` + 顶层 `fallback: true` 字段
AND 响应 header `X-Fallback: true`（既有降级逻辑）
AND 前端 `NpcActionList` 显示"本回合各势力按兵不动"（既有）

#### Scenario: 参数校验失败（既有，不变）

WHEN body 缺少必填字段 或 `factions` 为空数组 或 `stateSnapshot` 结构不正确
THEN 返回 HTTP 400 + `{ "ok": false, "error": { "code": "INVALID_PARAMS", "message": "..." } }`

### Requirement: 仅活跃势力参与决策

只有 `status === 'active'` 的 NPC 势力 MUST 参与本回合决策。

#### Scenario: 已消灭或结盟的势力不决策（既有）

WHEN `factions` 中含 `status === 'destroyed'` 或 `status === 'allied'` 的势力
THEN 服务端在调用 LLM 前过滤掉
AND 仅 `active` 势力传给 LLM（每个活跃势力独立 Agent）
AND 返回的 `actions` 数组只含 active 势力的行动

### Requirement: 势力摘要压缩

每个 NPC Agent MUST 拥有独立 system prompt，基于势力人格 + 目标 + 与玩家关系。

#### Scenario: NPC system prompt 构造

WHEN 服务端为某 NPC 势力构造 system prompt 时
THEN prompt 包含：
  - 角色设定：「你是 {NPC 势力名} 的决策者，{NPC 势力 summary}」
  - 当前实力：`本势力当前实力 {power}，与玩家势力关系 {relationship}（负数=敌对，正数=友好）`
  - 决策目标：基于 `relationship` 动态生成：
    - `relationship < -30`（敌对）：「你的目标是削弱玩家势力，可挑衅/备战/扩张针对玩家」
    - `relationship > 30`（友好）：「你的目标是与玩家势力维持盟约，可外交/休养/结盟」
    - 其他（中立）：「你的目标是发展自身实力，可休养/扩张/备战」
  - 行动选项：「可选行动：扩张/结盟/备战/休养/挑衅/外交」
  - 工具使用指引：「需要查询其他势力或玩家状态时可调用工具」
  - 输出格式：「返回 JSON：{ action, target, description, effects }」

#### Scenario: NPC 决策差异化

WHEN 两个不同 NPC 势力（如湘军 relationship=20、太平天国 relationship=-50）作为独立 Agent 决策
THEN 湘军 Agent 倾向于"休养/外交"（友好关系）
AND 太平天国 Agent 倾向于"挑衅/备战"（敌对关系）
AND 两 Agent 决策风格不同，体现独立人格

### Requirement: 失败降级

LLM 失败时 MUST 跳过本回合该 NPC 行动，不影响其他 NPC。

#### Scenario: 单 NPC Agent 失败降级

WHEN 某 NPC Agent 的 `streamText` 调用超时或抛出异常
THEN 该 NPC 加入 `failedFactionIds`
AND 该 NPC 不在 `actions` 数组中
AND 其他 NPC Agent 决策正常返回
AND 前端 `NpcActionList` 显示失败 NPC 卡片为"决策失败"角标

#### Scenario: 全部 NPC Agent 失败降级（既有，扩展）

WHEN 所有 NPC Agent 均失败
THEN 服务端返回 `{ actions: [], failedFactionIds: [...], fallback: true }` + `X-Fallback: true` header（返回结构已含顶层 `fallback: true`，见上方"全部 NPC Agent 失败" Scenario）
AND 前端 `NpcActionList` 显示「本回合各势力按兵不动」（既有）

### Requirement: NPC 行动对玩家的影响

NPC 行动 MAY 对玩家势力产生正面或负面影响，前端 MUST 按影响方向呈现视觉差异。

#### Scenario: NPC 扩张影响玩家（既有）

WHEN 某 NPC 势力的 `action === '扩张'` 且 `target === 玩家势力名`
THEN 该 action 的 `effects` 含玩家势力属性变化（如 `military: -5, people: -3`）
AND 前端 `NpcActionList` 中该项标红显示「敌对势力扩张，波及我方」

### Requirement: NPC 行动历史记录

每个 NPC 行动 MUST 记录在存档，供下回合参考。

#### Scenario: 行动记录到存档（既有）

WHEN NPC 行动响应后
THEN 前端将本回合 actions 追加到 `save.events` 数组作为 NPC 行动事件（NPC 行动不写入 `factions[i].lastAction`，该字段仅玩家外交/谈判时更新）
AND `save.events` 超过 50 条时截断

### Requirement: 并发锁防重复

同一 `saveId` 同时 MUST 只能有一个 npc-actions 请求进行中，但锁内允许多 NPC Agent 并行。

#### Scenario: 同存档并发请求被拒绝（既有）

WHEN 同一 `saveId` 已有进行中的 npc-actions 请求
THEN 返回 HTTP 429 + `{ "ok": false, "error": { "code": "CONCURRENT_REQUEST", "message": "该存档有进行中的请求，请稍后" } }`
AND 不调用 LLM

#### Scenario: 锁内多 NPC Agent 并行

WHEN 服务端获取 `saveId` 锁后
THEN 锁内通过 `Promise.all` 并行执行所有 NPC Agent
AND 单个 NPC Agent 不单独占锁（共享 `saveId` 锁）
AND 所有 NPC Agent 完成后释放锁

### Requirement: 玩家主动外交影响 relationship

玩家可通过外交面板主动改变与 NPC 势力的 `relationship`/`status`/`power`（前端确定性规则，每回合上限 1 次，来源提案 `2026-08-07-player-active-diplomacy`）。NPC 下回合决策 MUST 基于玩家修改后的 `relationship` 做出反应，无需新增后端逻辑。

#### Scenario: 玩家结盟后 NPC 退出活跃决策

WHEN 玩家对某势力执行 `结盟` 动作（relationship ≥ 50、支付银两名望成本）
THEN 该势力 `relationship` 提升并被标记为 `status: 'allied'`
AND 下回合 `npc-actions` 依「仅活跃势力参与决策」将其过滤出活跃决策
AND 若势力仍 active 且关系友好（>30），其 Agent 倾向「外交/休养/结盟」

#### Scenario: 玩家宣战触发 NPC 敌对反应

WHEN 玩家对某势力执行 `宣战` 动作（relationship 设为 -100）
THEN 该势力 `relationship = -100`
AND 下回合其 NPC Agent 因 `relationship < -30` 倾向「挑衅/备战/扩张」针对玩家

