# 提案：让自由行动（自然语言决策）打通势力关系与实力

## 为什么 / Why
当前「自由行动」已支持玩家用自然语言（如"我想暗中资助湘军"）代替事件选项，但 AI 解析结果 `effects` 仅含玩家五维属性与资源，**完全无法影响 6 势力的 `relationship`/`power`**。这导致自由行动在外交语境下"说了等于没说"——玩家付出资源却改变不了与势力的关系，玩法大打折扣。

后端 `resolve-decision` 请求体甚至未携带 `factions`，AI 解析时无势力上下文，连"湘军"指谁都不知道。`player-active-diplomacy` 已落地确定性外交按钮（可改 relationship/status/power，且 D5 证实 NPC Agent 会读取新 relationship 自动反应），但自由行动仍被挡在外交系统之外。

## 改什么 / What Changes
- **后端 `resolve-decision`**：请求体新增 `factions`，prompt 注入势力上下文；`effectsSchema` 新增 `factionEffects`，使 AI 可返回对指定势力的「软性关系/实力微调」（仅 `relationshipDelta`/`powerDelta`，不直接改 `status`）。
- **后端 sanitize**：`factionEffects` 的 `factionId` 必须为传入 factions 之一，无效 id 直接丢弃（防幻觉）。降级时返回空数组。
- **前端 `makeDecision`**：传入 `factions: s.factions`；拿到 `factionEffects` 后调用新增 store 方法 `applyFreeFactionEffects` 应用（复用 `applyDiplomacyAction` 的不可变更新范式 + clamp + 刷 updatedAt），与 `applyEffects` 叠加。
- **前端反馈**：决策应用后，在反馈区展示势力关系/实力变化（复用现有反馈组件，无新增交互）。
- **API 文档**：同步更新 `docs/API.md` 的 resolve-decision 段。

## 影响 / Impact
| 影响面 | 改动 |
|---|---|
| 前端 `game-web` | `useTurn.makeDecision` 传 factions + 应用 factionEffects；新增 `applyFreeFactionEffects`；决策反馈 UI 增加势力变化提示 |
| 后端 `server` | `resolve-decision.ts` bodySchema 增 factions、`effectsSchema` 增 factionEffects、prompt 注入、sanitize 逻辑 |
| 数据库 | 无 |
| API | `resolve-decision` 入参/出参扩展（向后兼容：旧客户端不传 factions 时不报错，仅不出 factionEffects） |
| 文档 | `docs/API.md` 更新 |

## 能力 / Capabilities
### Modified Capabilities
- `ai-event-engine` - 扩展「自由输入决策判定接口」：新增 `factions` 入参与 `factionEffects` 出参，支持自然语言决策产生势力关系/实力影响（仅软性微调，不改 status）。
