## MODIFIED Requirements:

### Requirement: 自由输入决策判定接口
当前事件存在时，玩家除事件选项外，可通过"自由行动"输入自然语言决策（最多 200 字）。后端 `resolve-decision` 调 LLM 将文本解析为结构化 `effects`（属性/资源变更）。

本变更扩展该接口：请求体可携带 `factions`（6 势力精简信息），LLM 可额外返回 `factionEffects`，使自然语言决策能对各势力产生「软性关系/实力微调」（`relationshipDelta` 限 ±20、`powerDelta` 限 ±30，**不改 `status`**）。`factionId` 必须为传入 factions 之一，后端 sanitize 丢弃无效 id（防幻觉）。降级（X-Fallback）或旧客户端未传 `factions` 时，`factionEffects` 返回空数组 `[]`，仅应用普通 `effects`，游戏照常进行。

#### Scenario: 自由输入触发普通事件生效
- **WHEN** 玩家在存在事件的回合，于"自由行动"输入"我要开仓赈灾"，提交 `playerDecision`
- **THEN** 后端 LLM 解析为 `effects`（如 `people:+10, silver:-50`），不返回 `factionEffects`，前端 `applyEffects` 应用，回合进入 `decided` 态

#### Scenario: 自由输入触发势力关系变化
- **WHEN** 玩家输入"我想暗中资助湘军"，且请求体携带 `factions`（含 `xiang-jun` 当前 `relationship`）
- **THEN** 后端返回 `factionEffects:[{factionId:'xiang-jun', relationshipDelta:>0}]` 与 `effects`（如 `silver:-50`），前端分别经 `applyFreeFactionEffects` 与 `applyEffects` 应用，湘军 `relationship` 上升且最终 clamp(-100,100)

#### Scenario: 仅软性微调，禁止改 status
- **WHEN** 玩家自由输入"与湘军结盟"
- **THEN** LLM 仅可在 `factionEffects` 返回 `relationshipDelta`（受 ±20 约束），**不得**返回 `status` 变更；正式结盟仍须走确定性外交按钮（relationship≥50 且 setStatus='allied'）

#### Scenario: 参数校验与幻觉防护
- **WHEN** LLM 返回 `factionEffects` 含不在 `factions` 列表中的 `factionId`
- **THEN** 后端 sanitize 丢弃该条，仅保留有效 `factionId` 的变更，不抛出错误

#### Scenario: 降级与向后兼容
- **WHEN** LLM 不可用（X-Fallback），或请求体未携带 `factions`（旧客户端）
- **THEN** `factionEffects` 返回空数组 `[]`，仅应用普通 `effects`，游戏照常进行

#### Scenario: 疑问句判为犹豫（保留原行为）
- **WHEN** 玩家以"怎么/如何/为什么/帮帮我/我想X"开头仅表达诉求无具体行动
- **THEN** 返回极小代价 effects（如 5 维各 -3）且不返回 factionEffects，并提示应去问军师
