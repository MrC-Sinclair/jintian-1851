# ai-npc-faction 规格变更（名望档位注入 NPC 决策）

## ADDED Requirements

### Requirement: NPC 决策 prompt 注入玩家名望档位
`buildNpcAgentPrompt` SHALL 在关系值之后、决策目标之前注入一行
「玩家如今的朝野名望：{档位称号}。{态度倾向}」，倾向文案取自
`server/server/utils/reputation-bands.ts`（前端 `HISTORY_RATINGS` 的镜像）。
注入**只偏置意图与文案，不改变任何数值结算**——与势力记忆（D8）同一处理方式。

#### Scenario: 高档名望促使 NPC 收敛
- **WHEN** 玩家 `stateSnapshot.resources.reputation = 90`
- **THEN** prompt 含「玩家如今的朝野名望：天下归心」与「宜先示好或观望」
- **AND** 不含低档文案「毫不顾忌地进逼吞并」

#### Scenario: 低档名望促使 NPC 进逼
- **WHEN** 名望为 5
- **THEN** prompt 含「玩家如今的朝野名望：身败名裂」与「毫不顾忌地进逼吞并」

#### Scenario: 缺字段按最低档处理，不炸整回合
- **WHEN** 客户端传来的 `resources` 里没有 `reputation`
- **THEN** 按 0 处理，注入「身败名裂」档，prompt 正常构建

#### Scenario: 不改变 relationship 派生的决策目标
- **WHEN** `relationship = -60` 的敌对势力，分别在名望 90 与名望 5 下构建 prompt
- **THEN** 两者都含同一条决策目标「你的目标是削弱玩家势力，可挑衅/备战/扩张针对玩家」
- **AND** 名望只改变语气与顾忌程度，不翻转由关系值决定的目标

#### Scenario: 注入位置不污染输出格式要求
- **WHEN** 构建任意 prompt
- **THEN** 名望行位于「只输出一个 JSON 对象」之前，输出格式约束始终是最后一段

### Requirement: 注入的 token 成本已计入成本口径
名望注入 SHALL 只增加一次输入开销并在 `docs/ai-cost.md` 中同步体现，
MUST NOT 引入额外 LLM 调用。

#### Scenario: 单次调用输入增加约 50 tokens
- **WHEN** `npc-actions` 构建一个势力的 system prompt
- **THEN** 输入约 1200 → 1250 tokens（+4%），单次成本 ¥0.000595 → ¥0.000612
- **AND** 典型回合 ¥0.002222、单局 ¥0.112、MVP 月度 < ¥336（文档已同步）
