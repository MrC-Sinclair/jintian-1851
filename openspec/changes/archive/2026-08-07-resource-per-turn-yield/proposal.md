# 变更提案：资源产出机制

> **状态：已归档（代码已落地，2026-08-07；提案评审后实现）**
> 关联设计规则：`docs/game-design.md:572`
> 关联 spec：`openspec/specs/turn-engine/spec.md`

## 背景

`docs/game-design.md:572` 规定：

> **资源产出机制**：每回合自动产出少量资源（如 silver +50/turn），避免长期消耗后无解

当前现状（已查证）：
- `game-web/src/composables/useTurn.ts` 的 `startTurn` / `endTurn` 中，**资源增减完全由事件 resolve 驱动**
  （`store.applyEffects(option.effects)`），无任何"回合开始/结束自动产出"逻辑。
- `stores/game.ts` 的 `applyEffects` 仅处理单条决策 effects，无批量/定时产出概念。
- 长期纯消耗型玩法（事件多为扣资源）确实存在"后期无解"风险，符合设计规则的动机。

这是一条**前端确定性逻辑**规则：在回合推进节点注入固定资源增量，可完整单测，风险可控。

## 改动

1. **新增回合产出纯函数**（`game-web/src/utils/turn-yield.ts`）：
   - `calcTurnYield(): Partial<Resources>` 返回固定产出（初版 `silver: 50`，阈值常量 `TURN_YIELD` 入常量文件）。
   - 设计为可扩展结构（未来可按势力/政策调整），初版保持简单常量映射。
2. **回合节点注入**（`useTurn.ts`）：
   - 在 `endTurn` 完成 NPC 应用、追加历史后、`turn+1` 之前，调用 `store.applyEffects(calcTurnYield())`；
   - 同时 `store.appendEvent`（**非 `addHistory`，store 实际方法名为 `appendEvent`，见 `stores/game.ts:172`）一条系统历史事件（如「本月赋税入库，银两 +50」），保证 timeline 可见、可审计（避免"凭空加钱"不可解释）。
   - **HistoryEvent 字段**：`eventType` 扩展新增 `'系统'`（见 `types/game.ts:11` EventType 枚举），同步加入 `copywriting.ts` 的 `EVENT_TYPE_LABELS`；`playerChoice` 用空串 `''`（系统事件无玩家选择，但 `HistoryEvent.playerChoice: string` 必填，见 `game.ts:113`）；`effects` 记录 `{ silver: 50 }`（非空，区别于玩家决策事件的 `effects:{}`）。
3. **防重复提交**：沿用 `store.isProcessingTurn` 守卫，`endTurn` 已存在该守卫，无需新增。
4. **文案 + EventType 扩展**：产出事件描述入 `copywriting.ts`；`EVENT_TYPE_LABELS` 新增 `系统: '系统'`；确认 `TurnTimeline` 渲染分支能处理新类型（不报错/不漏显）。
5. **spec 同步**：`turn-engine` spec 新增 Requirement「回合资源自动产出」。

## 影响面

- **前端**：`useTurn.endTurn`、`stores/game.ts`（applyEffects 已支持，无需改）、新增 `turn-yield.ts`。
- **数据**：每回合 Resources 自动 +固定值，影响经济平衡与结局判定阈值。
- **不改动**：后端、事件 resolve、NPC、UI 展示（产出以系统历史事件出现在 timeline）。

## 残余不确定性

- `[不确定]` 固定 `silver +50` 是否平衡（可能与部分事件产出叠加导致通胀）。需在 `test:unit` 外以
  "正常推进 20 回合后资源是否仍处于可玩区间"做一耳目力校验，必要时回调常量。
- `[不确定]` 产出是否应随势力政策/难度变化——初版固定，设计规则未要求动态，留作后续。
- `[不确定]` 系统历史事件是否计入"玩家主动行为"统计（如成就/结局触发计数），建议不计入，仅 timeline 展示。
- `[跨提案]` 本提案与 `event-weight-dynamic-adjust`、`weighted-overall-power` 联合降低难度（补短板 + 免费资源 + 内政加速达 90）。三者全部落地后须联合平衡校验，避免单看合理、合看失序（见 C1）。
