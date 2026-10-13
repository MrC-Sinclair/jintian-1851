# 势力覆灭判定补记（power 归零 → destroyed）

## Why

`game-design.md` 的 `FactionStatus` 早就写了 `destroyed`，UI 里也备好了覆灭角标、
禁用外交、禁用谈判信三个分支，但**全链路没有任何地方把势力判成 destroyed**：
势力 power 早已被 `Math.max(0, …)` 夹到零，之后照样进下一回合的 NPC 决策列表、
UI 仍显示活跃 —— 等于「把一支势力打掉」这件事在数值上发生了、在状态机上不存在，
那三个 UI 分支是死代码。

落地在 `1b9a92d`（`store.applyFactionSurvival()`），此前没有对应提案，本 change 是补记。

## What Changes

- 新增收口判定：`useTurn.endTurn` 结算末尾统一跑一遍势力存亡，把 `power ≤ 0` 的
  **active** 势力转为 `destroyed` 并写入「势力覆灭」时间线事件。
- 覆盖本回合内所有 power 来源（外交按钮、离间、自由行动的软性微调），
  而不是只跟某一处行动绑定。
- 服务端不改：`npc-actions` 本就按 `status === 'active'` 过滤，状态一改自然退出决策。
- 只处理 active：结盟势力即便实力归零也不单方面判灭（盟约解除是另一件事）。

## Impact

| 层级 | 影响 |
|---|---|
| 前端 | `stores/game.ts` 新增 `applyFactionSurvival()`；`composables/useTurn.ts` 在 endTurn 末尾调用 |
| 后端 | 无改动（既有 active 过滤即生效） |
| 数据库 | 无（势力状态随存档 `saveData` 整体往返） |
| 文档 | `docs/game-design.md` 的 destroyed 触发方式已按实际改写并注明差异 |

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `ai-npc-faction`：新增「势力覆灭判定在回合结算末尾收口」，并把既有的
  「仅活跃势力参与决策」补上覆灭来源与 allied 例外两个场景。

## 被排除的方案

- **由 NPC 行动结果触发覆灭**（设计文档原写法）：NPC 行动的 `effects` 只作用于玩家
  五维与资源，全链路没有任何地方修改其它势力的 power，这条路径根本无法落地 —— 已把
  文档改成与实际一致。
- **在各 power 来源处就近判定**（外交按钮里判一次、离间里再判一次）：会漏掉自由行动等
  软性微调，且同一规则散落多处必然漂移；故收口在结算末尾一次判定。
- **服务端判定**：需要把势力状态变成服务端权威，牵动存档同步模型，收益不及成本。
