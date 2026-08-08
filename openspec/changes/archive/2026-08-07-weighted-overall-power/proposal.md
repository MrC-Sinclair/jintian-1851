# 变更提案：加权综合实力

> **状态：已归档（代码已落地，2026-08-07；提案评审后实现）**
> 关联设计规则：`docs/game-design.md:573`
> 关联 spec：`openspec/specs/turn-engine/spec.md`（结局判定）/ `goal-system`（度量展示）

## 背景

`docs/game-design.md:573` 规定：

> **加权综合实力**：引入 `politics` 与 `people` 权重更高（治世之要），引导玩家注重内政

当前现状（已查证）：
- `game-web/src/utils/end-conditions.ts:31` 的 `calcOverallPower` **等权平均** 5 维：
  `(military + economy + politics + people + diplomacy) / 5`；
  函数头注释明确写「MVP 阶段不引入加权，design.md 未明确权重时取等权平均」。
- 该设计规则正是为填补「权重未明确」而设，现需落地。
- `overallPower` 被 **3 个 UI 组件 + help 页 + copywriting** 复用，且文案多处写死"等权平均"
  （`copywriting.ts:149`、`help/index.vue` 4 处、`StatusPanel/GoalPanel/FocusPanel` 的 InfoHint 内容）。
- 改动会同时影响**结局判定阈值语义**（≥90 胜利）与**玩家对实力的认知**，需全链路文案同步。

这是一条**前端确定性度量**规则（纯函数改权重），可完整单测，但**文案同步面宽**，需逐点更新避免误导玩家。

## 改动

1. **权重化计算**（`end-conditions.ts`）：
   - 新增 `POWER_WEIGHTS: Record<keyof Attributes, number>`（如 `politics: 1.3, people: 1.3, military: 1, economy: 1, diplomacy: 1`，权重和归一化）；
   - `calcOverallPower` 改为加权平均：Σ(attr×w) / Σ(w)，结果 clamp 0-100。
   - 权重常量入 `utils/constants.ts`，便于平衡微调。
2. **全链路文案同步**（消除"等权平均"误导）：
   - `copywriting.ts:149` 的 `overallPower` 说明改为"加权综合（内政权重更高）"；
   - `help/index.vue` **2 处**（`:55`、`:288`）"五维属性等权平均"→"加权综合，政治/民心权重更高"（原误记 4 处，实为 2 处）；
   - `StatusPanel.vue:97` 注释"五维属性等权平均"同步更新（T6 grep 清零会抓到，须纳入修订范围）；
   - `TERM_EXPLANATIONS.overallPower` 引用集中在 `copywriting.ts`，改一处即 StatusPanel/GoalPanel/FocusPanel 的 InfoHint 全链路生效（需确认无组件内联文案）。
3. **结局阈值复核 + 常量去重**：加权平均可能改变"≥90 胜利"的达成难度，需在 design D 中评估并保持阈值 90 合理（必要时调整，但初版保持 90）。**`VICTORY_THRESHOLD=90` 当前在 `end-conditions.ts:23` 与 `goal-hint.ts:22` 各定义一份**，本提案应将其收口到 `utils/constants.ts`，两处改 import，避免后续调阈值漏改（见跨提案 C2）。
4. **spec 同步**：`turn-engine` 结局判定 Requirement + `goal-system` 度量展示 Requirement 各补 Scenario。

## 影响面

- **核心**：`end-conditions.ts`（结局判定）、`goal-hint.ts`（复用）、3 组件、`copywriting.ts`、`help/index.vue`。
- **平衡**：实力分布整体右移（内政权重高→高内政玩家更易达标），影响胜利/失败节奏。
- **不改动**：属性崩溃判定（任一 ≤0 仍失败）、时光尽头、NPC、事件。

## 残余不确定性

- `[不确定]` 具体权重值（politics/people 1.3 vs 1.2）需平衡验证——初版取 1.3，
  建议以"正常通关路径下胜利回合数与等权版接近"为校验口径。
- `[不确定]` 加权后 90 阈值是否仍合适（加权可能抬升均值），保留 `VICTORY_THRESHOLD=90` 但标注需实测。
- `[不确定]` `help/index.vue` 是否有组件内联"等权"文案未经过 `copywriting`，需 T4 全量 grep 复核。
- `[已核实]` 全仓 grep "等权平均"实得 6 处：`copywriting.ts:149`、`help/index.vue:55/288`（2 处非 4）、`StatusPanel.vue:97`（注释）、`end-conditions.ts:11/29`（注释）。T4 修订 help 2 处 + StatusPanel 注释；T6 grep 清零须含 end-conditions 注释（函数注释）。
- `[跨提案]` 本提案使内政型玩家更快达 90，与 event-weight（补短板）、resource-yield（免费资源）联合降低难度。三者全部落地后须联合平衡校验（见 C1）。
