# ai-npc-faction — NPC 势力 AI 决策

## ADDED Requirements

### Requirement: NPC 决策结构化接口

`POST /api/game/npc-actions` MUST 返回每个活跃 NPC 势力本回合的行动列表。

#### Scenario: 正常生成 NPC 行动

WHEN 前端发送 `POST /api/game/npc-actions` body 含 `{ saveId, turn, factions, stateSnapshot }`
THEN 服务端使用 `Qwen/Qwen3-8B` 模型调用 `generateObject()` + zod schema
AND 提示词包含：玩家势力摘要、所有活跃 NPC 势力摘要（name + power + relationship + status，不传 summary 控 token）
AND 要求 LLM 扮演每个 NPC 势力的决策者，基于自身目标返回 1 个行动
AND 返回结构：
  ```typescript
  {
    actions: Array<{
      factionId: string
      factionName: string
      action: '扩张' | '结盟' | '备战' | '休养' | '挑衅' | '外交'
      target?: string      // 行动目标（如扩张目标地、结盟对象）
      description: string  // 50-150 字描述
      effects: {            // 对玩家势力的影响（可选）
        military?, economy?, politics?, people?, diplomacy?, silver?, troops?, food?, reputation?
      }
    }>
  }
  ```

#### Scenario: 参数校验失败

WHEN body 缺少必填字段 或 `factions` 为空数组 或 `stateSnapshot` 结构不正确
THEN 返回 HTTP 400 + `{ "ok": false, "error": { "code": "INVALID_PARAMS", "message": "..." } }`

### Requirement: 仅活跃势力参与决策

只有 `status === 'active'` 的 NPC 势力 MUST 参与本回合决策。

#### Scenario: 已消灭或结盟的势力不决策

WHEN `factions` 中含 `status === 'destroyed'` 或 `status === 'allied'` 的势力
THEN 服务端在调用 LLM 前过滤掉
AND 仅 `active` 势力传给 LLM
AND 返回的 `actions` 数组只含 active 势力的行动

### Requirement: 势力摘要压缩

传给 LLM 的 NPC 势力信息 MUST 压缩为 4 字段以控制 token 成本。

#### Scenario: 势力信息压缩

WHEN 服务端构造 LLM 输入时
THEN 每个 NPC 势力仅传 `{ id, name, power, relationship, status }`
AND 不传 `summary` 字段
AND 5 个势力约 250 tokens 输入

### Requirement: 失败降级

LLM 失败时 MUST 跳过本回合 NPC 行动，不阻断流程。

#### Scenario: LLM 调用失败跳过 NPC

WHEN `generateObject()` 重试 1 次后仍失败
THEN 服务端返回 `{ "actions": [], "fallback": true }`
AND 前端 `NpcActionList` 显示「本回合各势力按兵不动」
AND 不影响回合推进

### Requirement: NPC 行动对玩家的影响

NPC 行动 MAY 对玩家势力产生正面或负面影响，前端 MUST 按影响方向呈现视觉差异。

#### Scenario: NPC 扩张影响玩家

WHEN 某 NPC 势力的 `action === '扩张'` 且 `target === 玩家势力名`
THEN 该 action 的 `effects` 含玩家势力属性变化（如 `military: -5, people: -3`）
AND 前端 `NpcActionList` 中该项标红显示「敌对势力扩张，波及我方」

#### Scenario: NPC 结盟影响玩家

WHEN 某 NPC 势力的 `action === '结盟'` 且 `target === 玩家势力名`
THEN 该 action 的 `effects` 含正面影响（如 `diplomacy: +5, reputation: +3`）
AND 前端该项标绿显示「势力示好结盟」

#### Scenario: NPC 行动不针对玩家

WHEN NPC 行动 `target` 不为玩家势力名 或 `action === '休养'`
THEN 该 action 的 `effects` 对玩家为空对象 `{}`
AND 前端显示中性颜色

### Requirement: NPC 行动历史记录

每个 NPC 行动 MUST 记录在存档，供下回合参考。

#### Scenario: 行动记录到存档

WHEN NPC 行动响应后
THEN 前端将本回合 actions 追加到 `save.factions[i].lastAction` 字段（仅保留最新 1 条）
AND 同时追加到 `save.events` 数组作为一条 NPC 行动事件（type='npc'）
AND `save.events` 超过 50 条时截断保留最新 50

### Requirement: 并发锁防重复

同一 `saveId` 同时 MUST 只能有一个 npc-actions 请求进行中。

#### Scenario: 同存档并发请求被拒绝

WHEN 同一 `saveId` 已有进行中的 npc-actions 请求
THEN 返回 HTTP 429 + `{ "ok": false, "error": { "code": "CONCURRENT_REQUEST", "message": "本回合 NPC 决策正在处理中" } }`
AND 不调用 LLM
