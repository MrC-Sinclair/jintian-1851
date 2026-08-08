# 设计：加权综合实力

## 上下文

`game-design.md:573` 要求 politics/people 权重更高。当前 `calcOverallPower` 等权平均
（`end-conditions.ts:31`），注释声明「MVP 不引入加权」。本提案落地该权重。

## 决策

### D1：加权平均 + 权重归一化
```ts
// utils/constants.ts
export const POWER_WEIGHTS = {
  military: 1, economy: 1, politics: 1.3, people: 1.3, diplomacy: 1
} as const

// end-conditions.ts
export function calcOverallPower(attrs: Attributes): number {
  const keys = Object.keys(POWER_WEIGHTS) as (keyof typeof POWER_WEIGHTS)[]
  const totalW = keys.reduce((s, k) => s + POWER_WEIGHTS[k], 0)
  const weighted = keys.reduce((s, k) => s + (attrs[k] ?? 0) * POWER_WEIGHTS[k], 0)
  return Math.max(0, Math.min(100, weighted / totalW))
}
```
- Σ(w)=5.6，初版政治/民心 1.3 高于其余 1.0，体现"治世之要"。

### D2：保持 VICTORY_THRESHOLD=90，标注待实测 + 常量去重
- 加权可能抬升均值，若实测胜利过早/过晚，再回调权重或阈值；
- 初版不动阈值，避免扩散变更面；
- **去重**：`VICTORY_THRESHOLD=90` 当前在 `end-conditions.ts:23` 与 `goal-hint.ts:22` 各一份，本提案将其收口到 `utils/constants.ts`，两处改 import；`CRISIS_THRESHOLD=30`（`goal-hint.ts:19`）一并收口（跨提案 C2，与 event-weight 复用同源）。

### D3：文案单一来源
- `TERM_EXPLANATIONS.overallPower` 集中在 `copywriting.ts:149`，改此处即同步 3 组件 InfoHint；
- `help/index.vue` 另有 **2 处**（`:55`、`:288`）内联"等权平均"文案，需逐条改为"加权综合"（原误记 4 处）；
- `StatusPanel.vue:97` 注释"五维属性等权平均"同步更新（T6 grep 清零须含）。

### D4：calcOverallPower 签名收敛
- `goal-hint.ts` 仅 re-export `calcOverallPower`，无需改；
- 入参类型由 `StateSnapshot['attributes']` 收敛为 `Attributes`（消除歧义，与 weights key 一致）。

### D5：单元测试覆盖权重语义
- 等权退化：若所有 weights=1，结果等于原等权平均（回归保护）；
- 内政倾斜：politics/people 高时得分高于纯军事高时（同总和点）；
- clamp：负值/超 100 边界正确。

## 数据结构

```ts
type PowerWeights = Record<'military'|'economy'|'politics'|'people'|'diplomacy', number>
```

## 多端兼容

- 纯函数 + 常量 + 文案，无浏览器 API，跨端一致。

## 验证

- 单测 `calcOverallPower`：权重退化、内政倾斜、clamp。
- 文案 grep：全仓"等权平均"清零（含 `StatusPanel.vue:97` 注释、`end-conditions.ts` 注释；本提案 design 说明除外）。
- 平衡校验：脚本连推标准通关路径，对比加权前后胜利回合数。
- 跨提案联合校验：与 event-weight / resource-yield 全部落地后跑标准通关路径（见 C1）。
