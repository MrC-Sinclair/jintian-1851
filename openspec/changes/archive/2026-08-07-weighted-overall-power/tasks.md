# 任务清单：加权综合实力

## T1：权重化计算 + 阈值常量去重
- `utils/constants.ts` 新增 `POWER_WEIGHTS`（politics/people 1.3，其余 1.0）。
- **常量去重（C2）**：把 `VICTORY_THRESHOLD=90`（现 `end-conditions.ts:23`+`goal-hint.ts:22` 两份）、`CRISIS_THRESHOLD=30`（`goal-hint.ts:19`）收口到 `utils/constants.ts`，两文件改 import。
- `end-conditions.ts` 的 `calcOverallPower` 改为加权平均 + clamp 0-100；更新函数注释（去掉"MVP 不加权"）。
- 单测：权重退化（全 1=等权）、内政倾斜、clamp 边界。

## T2：goal-hint 收敛
- `goal-hint.ts` re-export 同步（入参类型收敛为 `Attributes`），确认无调用方破坏。

## T3：文案单一来源更新
- `copywriting.ts:149` `overallPower` 说明改为"加权综合，政治/民心权重更高"。

## T4：help 页 + StatusPanel 内联文案同步
- `help/index.vue` grep"等权平均"（实为 `:55`、`:288` **2 处**），改为"加权综合（内政权重更高）"。
- `StatusPanel.vue:97` 注释"五维属性等权平均"同步更新。

## T5：spec 同步 + 文档回标
- `turn-engine/spec.md` 结局判定 Requirement 补「加权综合」Scenario；
  `goal-system` spec 度量展示 Requirement 补 Scenario。
- `game-design.md:573` 标注已落地并关联本提案。

## T6：验证
- `pnpm lint` + `pnpm typecheck`（game-web）；
- `pnpm test:unit`（calcOverallPower 单测）；
- 全仓 grep "等权平均" 清零（含 `StatusPanel.vue:97`、`end-conditions.ts` 注释；本提案说明除外）；
- 平衡校验：标准通关路径加权前后胜利回合对比；
- 跨提案联合校验：与 event-weight / resource-yield 全部落地后跑标准通关路径（见 C1）。
- ✅ **C1 已落地（2026-08-07）**：由 `game-web/tests/unit/balance-regression.test.ts`（纯函数底盘 `tests/sim/balance-sim.ts`，兜底事件池 mock LLM）满足。200 种子 × 50 回合：胜率 99.5%、avgTurns≈36（median 35）、仅 1 局超时未通关、无属性崩溃/异常；外交开关对比恒等，证明次级操作不拖慢主平衡。
