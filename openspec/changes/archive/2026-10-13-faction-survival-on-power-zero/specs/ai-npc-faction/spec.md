# ai-npc-faction 规格变更（势力覆灭判定补记）

## ADDED Requirements

### Requirement: 势力覆灭判定必须在回合结算末尾收口
系统 SHALL 在 `useTurn.endTurn` 的结算末尾统一判定势力存亡：`power ≤ 0` 且 `status === 'active'`
的势力 MUST 转为 `destroyed`，并向历史时间线追加一条「势力覆灭」事件
（文案取 `SYSTEM_EVENT.factionDestroyed`）。判定 MUST NOT 绑定在某个单一行动分支上，
否则本回合内来自其它路径的 power 损耗会漏判。

#### Scenario: 本回合内被打到零的势力下回合起不再行动
- **WHEN** 玩家本回合通过外交按钮 / 离间 / 自由行动软性微调把某活跃势力 power 压到 ≤ 0
- **THEN** 结算末尾该势力 `status` 变为 `destroyed`，时间线出现「势力覆灭」事件
- **AND** 下一回合 `npc-actions` 不再为它生成行动（服务端按 `active` 过滤，无需额外改动）

#### Scenario: 结盟势力不单方面判灭
- **WHEN** 某势力 `status === 'allied'` 且其 power 归零
- **THEN** **不**转为 destroyed（盟约解除是另一件事，不由实力归零自动触发）

#### Scenario: 覆灭势力在外交与 UI 上不可选
- **WHEN** 势力为 destroyed
- **THEN** `DiplomacyPanel` 显示覆灭角标、禁用外交按钮、禁用谈判信入口
- **AND** 该势力不出现在可选目标里

## MODIFIED Requirements

### Requirement: 仅活跃势力参与决策

只有 `status === 'active'` 的 NPC 势力 MUST 参与本回合决策。

#### Scenario: 已消灭或结盟的势力不决策（既有）

WHEN `factions` 中含 `status === 'destroyed'` 或 `status === 'allied'` 的势力
THEN 服务端在调用 LLM 前过滤掉
AND 仅 `active` 势力传给 LLM（每个活跃势力独立 Agent）
AND 返回的 `actions` 数组只含 active 势力的行动

#### Scenario: destroyed 的产生地点唯一

WHEN 需要把某势力置为 destroyed
THEN **只能**由前端 `store.applyFactionSurvival()` 在回合结算末尾产生（见「势力覆灭判定
必须在回合结算末尾收口」），服务端与各行动分支 MUST NOT 自行改写该状态
AND 理由：势力状态随存档 `saveData` 整体往返，多处写入会形成 read-modify-write 竞态
