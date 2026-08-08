# turn-engine — 回合主界面信息架构与交互（MODIFIED）

## ADDED Requirements

### Requirement: game-main 信息分区重构

`game-main` MUST 将原有 7 个平铺区块重构为"核心置顶 + 可折叠次要"结构，降低一屏信息密度。核心区块（FocusPanel + 事件区）始终展开置顶，次要区块（状态/近况/天下动静）用 `CollapsibleSection` 包裹按需展开。

#### Scenario: 默认展示核心区块

WHEN 玩家进入 `game-main` 且引导已完成
THEN `FocusPanel`（综合实力+危机+建议）渲染在最顶部，始终展开
AND 事件区（`EventCard` + `DecisionButton` + 自由行动）渲染在 `FocusPanel` 下方，始终展开
AND 状态区（`StatusPanel` + `FactionCard` 列表）用 `CollapsibleSection` 包裹，`defaultExpanded: true`
AND 近况时间线（`TurnTimeline`）用 `CollapsibleSection` 包裹，`defaultExpanded: false`
AND 天下动静（`NpcActionList`）用 `CollapsibleSection` 包裹，`defaultExpanded: false`
AND `GoalPanel` 在最底部，可折叠，默认折叠

#### Scenario: 折叠展开动画

WHEN 玩家点击 `CollapsibleSection` 标题栏
THEN 内容区高度平滑过渡：展开 `max-height: 2000rpx; opacity: 1`，折叠 `max-height: 0; opacity: 0; overflow: hidden`
AND transition `max-height 300ms ease, opacity 200ms ease`
AND 右侧 chevron 图标旋转 180°（transition 300ms）
AND 标题栏触摸目标 `min-h: 88rpx`，按压 `active:scale-0.98`

#### Scenario: 首次进入不立即开始回合

WHEN 玩家首次进入 `game-main`（`onboarding_done` 为 false）
THEN `onMounted` 不调用 `useTurn.startTurn()`
AND 先挂载 `OnboardingOverlay` 完成引导
AND 引导完成（`markDone` 或 `skip`）后才触发 `startTurn()`

WHEN 玩家非首次进入（`onboarding_done` 为 true）
THEN `onMounted` 直接调用 `useTurn.startTurn()`

### Requirement: 选项两步交互（先选中后确认）

玩家选择事件选项 MUST 改为"先选中后确认"两步交互，避免误点直接生效。选中态可切换，确认前不应用任何 effects。

#### Scenario: 点击选项进入选中态

WHEN 玩家点击 `DecisionButton`（未选中态）
THEN 该按钮进入选中态：`border: 4rpx solid #8B1A1A` + `bg: #FFF8E7`
AND `selectedOptionId` 设为该选项 id
AND 底部"确认决策"按钮变为可用（`disabled = false`）
AND emit `select` 事件，不应用 effects

#### Scenario: 切换选中项

WHEN 玩家已选中选项 A，再点击选项 B
THEN 选项 A 恢复未选中态（`border: 2rpx solid #D4C5A0`）
AND 选项 B 进入选中态
AND `selectedOptionId` 更新为选项 B 的 id

#### Scenario: 取消选中

WHEN 玩家点击已选中的选项
THEN 该选项恢复未选中态
AND `selectedOptionId` 设为 `null`
AND 底部"确认决策"按钮变为禁用（若无自由输入）

#### Scenario: 确认决策应用 effects

WHEN 玩家点击底部"确认决策"按钮（`selectedOptionId` 非空）
THEN `useTurn.makeDecision(selectedOptionId)` 被调用
AND 从事件选项中取对应 effects，前端直接应用
AND `selectedOptionId` 清空
AND 进入"已决策"态，底部按钮变为"下一回合"

#### Scenario: 自由行动确认

WHEN 玩家在 textarea 输入文本且未选中选项
THEN 底部"确认决策"按钮可用（`disabled = false`，因 `freeInputText` 非空）
WHEN 玩家点击"确认决策"
THEN `useTurn.makeDecision({ freeInput: freeInputText })` 调用 `resolve-decision` API
AND AI 返回 effects 后应用

### Requirement: 历史时间线补全选择记录

`TurnTimeline` MUST 在每条历史记录中显示玩家当时的选择与 effects 摘要，提升回顾价值。

#### Scenario: 显示玩家选择

WHEN `TurnTimeline` 渲染历史记录（`save.history` 项含 `playerChoice`）
THEN 每条记录显示：回合数 + 类型标签 + 事件标题 + "你的选择：{playerChoice}" + effects 摘要
AND effects 摘要用 `EFFECT_LABELS` 渲染完整词（如"军事+10, 银两-200"）
AND 正面 effects 绿色，负面 effects 红色
AND 每条记录触摸目标 `min-h: 88rpx`

#### Scenario: 兼容旧存档无选择记录

WHEN 历史记录项无 `playerChoice` 字段（旧存档）
THEN "你的选择"行显示"（无记录）"
AND 不报错，不阻断渲染

### Requirement: NPC 行动突出对玩家影响

`NpcActionList` MUST 在每条 NPC 行动下方显示"对你影响"行，明确告知玩家该行动如何改变自己的属性/资源。

#### Scenario: 显示负面影响

WHEN NPC 行动 effects 含负值属性变化（如 `military: -5`）
THEN "对你影响"行显示红色"军事 -5"
AND effects 用 `EFFECT_LABELS` 完整词

#### Scenario: 显示正面影响

WHEN NPC 行动 effects 含正值（如 `economy: +3`）
THEN "对你影响"行显示绿色"经济 +3"

#### Scenario: 无直接影响

WHEN NPC 行动无 effects 或 effects 为空
THEN "对你影响"行显示灰色"暂无直接影响"

### Requirement: effects 标签完整词展示

所有 effects 标签 MUST 使用完整词（"军事+10"）而非单字缩写（"军+10"），降低理解门槛。

#### Scenario: DecisionButton effects 渲染

WHEN `DecisionButton` 渲染选项 effects
THEN 标签用 `EFFECT_LABELS` 映射：`military`→"军事"、`economy`→"经济"、`politics`→"政治"、`people`→"民心"、`diplomacy`→"外交"、`silver`→"银两"、`troops`→"兵员"、`food`→"粮草"、`reputation`→"名望"
AND 正值绿底（如"军事+10"），负值红底（如"银两-200"）
AND 标签字号 `24rpx`，`flex-wrap: wrap`

#### Scenario: NpcActionList effects 渲染

WHEN `NpcActionList` 渲染 NPC 行动 effects
THEN 同上用 `EFFECT_LABELS` 完整词

### Requirement: 错误文案友好化

所有面向玩家的错误提示 MUST 使用白话文案，技术错误码仅记录到 `console.error` 便于排查。

#### Scenario: 事件生成失败

WHEN `generate-event` API 调用失败
THEN toast 显示"局势推演出错，正在重试…"
AND 自动重试 1 次
AND 重试仍失败则 toast"局势推演失败，请检查网络后重试"
AND `console.error` 记录原始错误码与详情

#### Scenario: 网络异常

WHEN API 请求网络错误（超时/断网）
THEN toast 显示"网络连接失败，请检查网络"
AND `console.error` 记录请求 URL 与错误类型

#### Scenario: 军师对话失败

WHEN `advisor-chat` SSE 流式失败
THEN `AdvisorDrawer` 当前消息显示"军师暂时无法回应，可重新提问"
AND `console.error` 记录错误
