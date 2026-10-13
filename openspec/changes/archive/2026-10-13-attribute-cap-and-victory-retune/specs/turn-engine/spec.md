# turn-engine 规格变更（五维属性封顶与胜利阈值标定）

## ADDED Requirements

### Requirement: 五维属性封顶 0-100 且与胜利阈值一起标定
`applyEffects` MUST 把五维属性（`military` / `economy` / `politics` / `people` / `diplomacy`）
的**上限**夹在 `ATTRIBUTE_MAX = 100`；下限 MUST NOT 夹（保留负值作为崩溃判定依据）。
`VICTORY_THRESHOLD` 与封顶是同一架天平的两端：**改其中之一必须重新测量另一个**，
不能只改一处。

#### Scenario: 单维溢出被夹住
- **WHEN** 某维属性经事件与决策累加到 129
- **THEN** 结算后该维为 100，进度条不溢出
- **AND** 理由：不封顶时单维堆叠就能把加权平均抬过胜利线，实测军事到过 129

#### Scenario: 下限留负供崩溃判定
- **WHEN** 某维被扣到 -12
- **THEN** 值保持 -12（不夹为 0），`checkEndConditions` 判该维崩溃结局
- **AND** 该行为由 `game-store.test.ts` 的用例锁定，防止有人"顺手"上下限一起夹
      —— 那会让 7 种结局里的 5 种崩溃永不触发

#### Scenario: 改封顶必须重新标定阈值
- **WHEN** 引入或修改属性封顶
- **THEN** MUST 以通关模拟重新测量胜率分布后再定阈值，而非沿用旧值
- **AND** 实测依据：封顶后若阈值仍取 90，200 局最优策略 bot 胜率从 99.5% 塌到 48.5%、
      `avgPower` 仅 88.2（大量对局卡在 89 撞回合上限）—— 说明封顶前的"几乎必胜"
      是越界 bug 撑起来的；重标定到 85 后回到 95.5%

#### Scenario: 阈值不得在展示层硬编码
- **WHEN** UI 或文案需要呈现胜利线（帮助页、开局引导、GoalPanel 胜利条件、
      FocusPanel 刻度标签与建议文案、进度条刻度位置）
- **THEN** MUST 引用 `VICTORY_THRESHOLD`，MUST NOT 写死数字或 CSS 百分比
- **AND** 理由：阈值改动时这些位置会集体对玩家说谎；`FocusPanel` 的刻度此前就写死过
      `left: 90%`
