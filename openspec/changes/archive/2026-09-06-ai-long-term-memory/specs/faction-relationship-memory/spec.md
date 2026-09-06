# faction-relationship-memory 规格

> 势力关系记忆：NPC Agent 检索自身记忆做决策，军师按语义检索历史。对应 design.md D7-D9。

## ADDED Requirements

### Requirement: NPC 决策注入自身记忆

`npc-actions` 中每个势力 Agent 在决策前 SHALL 检索**本势力**的 `faction_memories`，并注入其 system prompt。

#### Scenario: 命中历史记忆
- **WHEN** 湘军 Agent 在 `saveId=S` 下有 3 条相似度 > 0.45 的记忆（如"玩家曾暗中资助湘军，关系 +8"）
- **THEN** `buildNpcAgentPrompt` 在「决策目标」之后追加「你记得的事」段落，列出最多 3 条记忆内容及其发生回合

#### Scenario: 记忆作用域隔离
- **WHEN** 淮军 Agent 执行决策
- **THEN** 其检索条件 SHALL 为 `saveId = S AND factionId = 淮军ID`，不得召回其他势力的记忆

#### Scenario: 检索失败不阻断决策
- **WHEN** `faction_memories` 检索抛出异常
- **THEN** 跳过记忆注入，Agent 按既有逻辑决策，响应头标记 `X-Memory-Skip: true`

#### Scenario: 记忆不改变数值结算
- **WHEN** NPC Agent 基于记忆产出 `NpcAction`
- **THEN** 其 `effects` 仍由既有 `normalizeNpcAction` 白名单过滤后交给前端结算，记忆**不参与**任何数值计算，仅影响 `description` 文案与行动倾向

### Requirement: 记忆正负平衡

系统 SHALL 保证 NPC 记忆召回时正负情绪混合呈现，避免负面记忆单向累积导致难度失控。

#### Scenario: 正负混合召回
- **WHEN** 某势力同时存在 `positive` 与 `negative` 记忆且均超阈值
- **THEN** topK 结果中 SHALL 至少各含 1 条（在空间允许时），system prompt 同时呈现恩怨两面

#### Scenario: 单向负面记忆不放大敌意
- **WHEN** 某势力仅有负面记忆
- **THEN** `relationship` 数值不因记忆发生变化，NPC 行动类型仍由 `relationship` 分档（±30 阈值）主导，记忆仅作为叙事素材

### Requirement: 军师语义检索历史

`advisor-chat` SHALL 新增 `search-memory` 工具，使军师能回答跨回合的历史问题。

#### Scenario: 玩家追问旧事
- **WHEN** 玩家问"我上次和淮军谈了什么"，军师自主调用 `search-memory({ query: '与淮军谈判' })`
- **THEN** 工具返回按相似度倒序的历史记忆条目（含 `content` 与 `turn`），军师据此组织回答

#### Scenario: 参数校验
- **WHEN** LLM 传入 `query` 为空字符串或长度 > 200
- **THEN** 工具返回 `{ error: 'INVALID_PARAMS', detail: 'query 长度须在 1-200 之间' }`；`limit` 不在 1-10 范围时钳制到边界值

#### Scenario: 检索失败降级
- **WHEN** embedding 调用或数据库查询失败
- **THEN** 工具返回 `{ error: 'MEMORY_UNAVAILABLE', detail: '...' }`，军师可转向其他工具或坦诚告知无法确认，对话不中断

#### Scenario: 前端无感知
- **WHEN** 军师触发 `search-memory` 工具
- **THEN** 前端经既有 SSE `tool-call` 事件展示"军师正在查询…"气泡，**无需任何前端改动**

### Requirement: 事件语义去重

`generate-event` 的 LLM 路径 SHALL 在生成前检索同 `saveId` 的历史事件，避免同质事件重复生成。

#### Scenario: 命中高度相似事件
- **WHEN** 检索到相似度 > 0.76 的历史事件
- **THEN** 在 prompt 中注入「请避免与以下事件重复」清单（最多 5 条），响应头标记 `X-Dedup-Applied: true`

#### Scenario: 未命中相似事件
- **WHEN** 无相似度 > 0.76 的历史事件
- **THEN** 走既有 prompt 逻辑，不注入避重指令

#### Scenario: 去重不阻断生成
- **WHEN** 检索过程失败
- **THEN** 跳过去重直接生成，响应头标记 `X-Memory-Skip: true`，事件照常返回（不降级到 fallback 池）

#### Scenario: 去重与既有优先级的关系
- **WHEN** 当前回合命中剧情链（`pending-chain` / `time-window`）
- **THEN** 不执行去重检索（脚本化事件优先级高于 LLM 生成，无需去重）
