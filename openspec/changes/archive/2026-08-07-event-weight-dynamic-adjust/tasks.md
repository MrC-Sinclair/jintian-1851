# 任务清单：事件权重动态调整

## T1：客户端短板计算纯函数
- 新增 `game-web/src/utils/attribute-shortfall.ts`：
  - `calcAttributeShortfall(attrs, threshold=CRISIS_THRESHOLD): AttributeShortfall[]`
  - `SHORTFALL_BONUS=20` 入 `utils/constants.ts`；**短板阈值复用** `CRISIS_THRESHOLD`（`goal-hint.ts:19`），不新建 `SHORTFALL_THRESHOLD`
- 单测覆盖：<30 命中、≥30 过滤、空对象、边界值 30。

## T2：请求契约扩展
- `GenerateEventRequest`（前端 api 类型 + server zod schema）新增可选 `attributeShortfall`。

## T3：startTurn 注入短板信号
- `useTurn.startTurn` 组装请求时调用 `calcAttributeShortfall(s.state.attributes)` 并入参。

## T4：server 提示词增强
- `prompts/generate-event.ts` 新增短板导向指令段，仅当 `attributeShortfall` 非空时拼接。
- `generate-event.ts` 透传入参到 prompt builder。

## T5：spec 同步 + 文档回标
- `ai-event-engine/spec.md` 新增 Requirement「事件短板导向生成」+ 2 Scenario。
- `game-design.md:569` 标注已落地并关联本提案。

## T6：验证
- `pnpm lint` + `pnpm typecheck`（game-web、server 各自）；
- `pnpm test:unit`（game-web 短板函数单测）；
- 成本对照：对比 +20% 偏好前后单次事件生成 token（参照 `docs/ai-cost.md`）；
- 缓存：确认 `attributeShortfall` 未入 `computeCacheKey`（由 stateSnapshot 派生）；
- 跨提案联合校验：与 resource-per-turn-yield / weighted-overall-power 全部落地后，跑标准通关路径对比胜利回合数（见 C1）。
- ✅ **C1 已落地（2026-08-07）**：由 `game-web/tests/unit/balance-regression.test.ts`（纯函数底盘 `tests/sim/balance-sim.ts`，兜底事件池 mock LLM）满足。200 种子 × 50 回合：胜率 99.5%、avgTurns≈36（median 35）、仅 1 局超时未通关、无属性崩溃/异常；外交开关对比恒等，证明次级操作不拖慢主平衡。（注：event-weight 的 LLM 短板偏置无法被静态池忠实还原，基线采用均匀池＝LLM 全不可用最坏情况，其胜率为可通关下界。）
