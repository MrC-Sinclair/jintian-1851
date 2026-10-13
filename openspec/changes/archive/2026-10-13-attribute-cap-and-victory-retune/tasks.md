# 任务清单（五维封顶与阈值重标定）

本 change 是对已上线行为的事后补记，落地在 commit `c8f5850`。

## 1. 封顶

- [x] `utils/constants.ts` 暴露 `ATTRIBUTE_MAX = 100`
- [x] `stores/game.ts` 的 `applyEffects` 对五维做 `Math.min(ATTRIBUTE_MAX, …)`
- [x] 下限刻意不夹：保留负值供 `checkEndConditions` 判 ≤ 0 崩溃
- [x] `game-store.test.ts` 断言「上限被夹住 / 负值仍可为负」

## 2. 阈值重标定

- [x] `VICTORY_THRESHOLD` 90 → 85，标定依据为封顶后的 200 局模拟（阈值 90 时胜率塌到 48.5%、
      `avgPower` 88.2 说明大量对局卡在 89）
- [x] C1 的 `winRate ≥ 0.9` 不变量原样通过，未削弱任何断言
- [x] 新基线数值记入 `tests/unit/balance-regression.test.ts` 文件头供后续对比

## 3. 硬编码清理

- [x] 帮助页、开局引导、GoalPanel 胜利条件文案、FocusPanel 刻度标签、即将胜利建议文案
      共 8 处改取常量
- [x] FocusPanel 进度条刻度由 CSS `left: 90%` 改为 `left: thresholdPercent`（绑定常量）

## 4. 验证

- [x] `pnpm lint` / `pnpm typecheck` / `pnpm test:unit` 通过
- [x] `pnpm test:unit`（balance-regression）新基线通过
- [x] `openspec validate --all --strict` 通过

## 5. 遗留

- [ ] 名望封顶与衰减的标定另见已归档的 `reputation-wiring`；本 change 只覆盖五维。
- [ ] 阈值是否随「守成阶段缺目标」的重设计再次调整，待产品决策（不在本 change 范围）。
