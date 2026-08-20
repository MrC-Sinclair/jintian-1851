# goal-system Specification

## Purpose
在 `game-main` 显著位置展示综合实力进度（5 维加权平均，政治/民心权重更高）与危机预警（属性 < 30），让玩家随时知晓距离胜利（综合实力 ≥ 90）与崩溃的差距，引导注重内政与短板应对。
## Requirements
### Requirement: 综合实力进度展示

游戏 MUST 在 `game-main` 显著位置展示玩家当前综合实力进度，让玩家随时知晓距离胜利（综合实力≥90）的差距。综合实力 = 5 维属性（军事+经济+政治+民心+外交）加权平均（政治/民心权重更高，见 `utils/constants.ts` 的 `POWER_WEIGHTS`），取值 0-100。

#### Scenario: FocusPanel 置顶展示综合实力

WHEN 玩家进入 `game-main` 且当前回合未结束
THEN `FocusPanel` 组件渲染在事件区上方（始终展开，置顶）
AND 显示综合实力进度条：高度 `16rpx`，背景 `#E5D5B7`，填充 `#8B1A1A`，宽度按 `overallPower/100` 比例
AND 进度条 90 阈值处标记竖线（胜利线）
AND 进度条右侧显示数值"72/100"
AND `overallPower` 由 `utils/goal-hint.ts` 的 `calcOverallPower(attributes)` 计算（加权平均，政治/民心权重 1.3，其余 1.0）

#### Scenario: 综合实力加权平均（2026-08-07-weighted-overall-power）

WHEN 计算 `calcOverallPower(attributes)`
THEN 结果为 Σ(attr × POWER_WEIGHTS[attr]) / Σ(POWER_WEIGHTS)，clamp 到 0-100
AND 政治/民心权重高于军事/经济/外交，体现"治世之要"
AND `TERM_EXPLANATIONS.overallPower` 文案说明加权语义（非"等权平均"）

#### Scenario: GoalPanel 可折叠详细展示

WHEN 玩家点击 `GoalPanel` 标题栏
THEN `GoalPanel` 展开/折叠（`max-height` transition 300ms）
AND 展开态显示：长期目标"成就霸业（1851-1912）"+ 胜利条件"综合实力 ≥ 90"+ 失败条件"任一属性 ≤ 0"+ 综合实力进度条（标注 90 阈值刻度）+ InfoHint 解释"综合实力"含义
AND 折叠态仅显示标题"游戏目标"+ 缩略进度值

#### Scenario: 综合实力达标提示

WHEN 玩家综合实力 ≥ 90
THEN 进度条填充变为绿色
AND `FocusPanel` 显示"综合实力已达 90，再坚持数回合即可成就霸业"（带"本回合建议："前缀，无 emoji）

### Requirement: 危机属性预警

游戏 MUST 在回合开始时检查玩家 5 维属性，任一属性 < 30 时通过 `toast.warning` 主动预警，避免玩家"不知不觉输掉"。

#### Scenario: 单一属性低于阈值预警

WHEN `useTurn.startTurn()` 执行且某属性 < 30（如 military=15）
THEN `getCrisis(attributes)` 返回 `{ attr: 'military', name: '军事', value: 15 }`（取 <30 中最低者）
AND `toast.warning` 显示"军事 15（濒临崩溃，建议优先应对）"
AND `FocusPanel` 危机行显示红色"军事 15（濒临崩溃）"（警告图标由 CSS 绘制，非 Unicode ⚠ 字符）+ InfoHint 解释

#### Scenario: 多个属性低于阈值取最低

WHEN 多个属性 < 30（如 military=15, economy=20）
THEN `getCrisis` 返回最低者 `{ attr: 'military', name: '军事', value: 15 }`
AND toast 仅提示一次（不刷屏）

#### Scenario: 无危机不预警

WHEN 所有属性 ≥ 30
THEN `getCrisis` 返回 `null`
AND 不触发 toast
AND `FocusPanel` 危机行不渲染

### Requirement: 带目标的阶段提示

`phaseHint` MUST 从单纯描述当前阶段升级为带目标的阶段提示，让玩家知道"现在该做什么"以及"为什么"。

#### Scenario: 等待决策时提示目标

WHEN 玩家有当前事件且未决策（`hasDecided === false`）
THEN `phaseHint` 显示"选择一个应对方案，或自己描述想做的事"
AND 若存在危机（属性<30），追加"军事濒临崩溃，建议优先应对"

#### Scenario: 决策完成后提示下一回合

WHEN 玩家已决策（`hasDecided === true`）
THEN `phaseHint` 显示"决策已定，进入下一回合"

#### Scenario: 推演中提示

WHEN 正在生成事件或 NPC 行动
THEN `phaseHint` 显示"局势推演中…"

### Requirement: 焦点建议生成

`FocusPanel` MUST 展示本回合建议，建议来源为规则生成 + AI 局势简报（若可用），AI 简报优先级高于规则。

#### Scenario: 规则生成建议

WHEN 无 AI 简报或简报为空
THEN `generateFocusHint(attributes)` 返回 `suggestion`：
  - 有危机时"优先应对{crisis.name}危机"
  - 无危机时"稳步发展各项实力"

#### Scenario: AI 简报覆盖规则建议

WHEN `advisor-briefing` 返回 `{ suggestion: '本回合建议结盟淮军以稳固经济' }`
THEN `FocusPanel` 建议行显示 AI 简报内容"💡 本回合建议结盟淮军以稳固经济"
AND 不显示规则建议

#### Scenario: AI 简报失败降级

WHEN `advisor-briefing` 调用失败或超时
THEN 降级使用规则生成的 `suggestion`
AND 不显示错误（失败不阻断游戏）
AND `console.error` 记录错误详情便于排查

