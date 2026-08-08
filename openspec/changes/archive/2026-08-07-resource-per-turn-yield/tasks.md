# 任务清单：资源产出机制

## T1：产出纯函数
- 新增 `game-web/src/utils/turn-yield.ts`：`calcTurnYield()` + `TURN_YIELD = { silver: 50 }` 常量（入 constants）。
- 单测：返回固定值、返回副本（外部修改不影响常量）。

## T2：endTurn 注入产出
- `useTurn.endTurn` 在 NPC 应用后、`turn+1` 前：
  - `store.applyEffects(calcTurnYield())`
  - `store.appendEvent`（**非 `addHistory`**）系统事件：`eventType:'系统'`、`playerChoice:''`、`effects:{silver:50}`（文案来自 copywriting）。

## T3：文案 + EventType 扩展
- `copywriting.ts` 新增 `SYSTEM_EVENT.turnYield`（如「本月赋税入库，银两 +50」）。
- `types/game.ts:11` `EventType` 枚举新增 `'系统'`；`copywriting.ts` `EVENT_TYPE_LABELS` 新增 `系统:'系统'`。
- 确认 `TurnTimeline` 渲染分支处理 `'系统'` 类型（不报错/不漏显）。

## T4：spec 同步 + 文档回标
- `turn-engine/spec.md` 新增 Requirement「回合资源自动产出」+ Scenario。
- `game-design.md:572` 标注已落地并关联本提案。

## T5：验证
- `pnpm lint` + `pnpm typecheck`（game-web）；
- `pnpm test:unit`（turn-yield 单测 + endTurn 集成：silver+50、末条 history 为 `eventType:'系统'` 产出）；
- 渲染：TurnTimeline 正确显示 `'系统'` 类型事件；
- 平衡校验：连推 20 回合资源可玩；
- 跨提案联合校验：与 event-weight / weighted-overall-power 全部落地后跑标准通关路径（见 C1）。
- ✅ **C1 已落地（2026-08-07）**：由 `game-web/tests/unit/balance-regression.test.ts`（纯函数底盘 `tests/sim/balance-sim.ts`，兜底事件池 mock LLM）满足。200 种子 × 50 回合：胜率 99.5%、avgTurns≈36（median 35）、仅 1 局超时未通关、无属性崩溃/异常；外交开关对比恒等，证明次级操作不拖慢主平衡。
