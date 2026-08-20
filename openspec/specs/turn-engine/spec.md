# turn-engine Specification

## Purpose
编排单回合五段强制流程（局势展示 → AI 事件生成 → 玩家决策 → 状态演化 → NPC 势力行动）与游戏内时间按月推进（1851-01 至 1912-12）。它是连接事件引擎、决策应用、NPC 行动、结局判定的中枢，确保每回合步骤有序、可审计、不跳漏。此外，回合开始时 `startTurn` 会并行调用 `advisor-briefing` 获取军师局势简报（与事件生成 `Promise.all` 并行，失败降级不阻塞）。
## Requirements
### Requirement: 回合流程编排

每回合 MUST 按顺序执行五段：局势展示 → AI 事件生成（含选项）→ 玩家决策（选选项 或 自由输入）→ 状态演化 → NPC 势力行动。军师对话为穿插在决策前后的可选功能，不计入强制步骤；但 `startTurn` 开头会并行调用 `advisor-briefing`（军师局势简报，与事件生成并行，构成回合开始的固定环节）。

#### Scenario: 玩家进入回合主界面看到当前局势

WHEN 玩家进入 `pages/game-main/index.vue` 或点击「下一回合」后
THEN 顶部显示当前回合数与游戏内日期（如「第 5 回合 · 1912 年 12 月」，当前按公元年-月渲染，未实现清代年号映射）
AND `StatusPanel` 组件显示 5 维属性（军事/经济/政治/民心/外交）与 4 资源（银两/兵力/粮草/声望）
AND `TurnTimeline` 组件显示最近 5 条历史事件标题

#### Scenario: 回合开始时 AI 生成事件

WHEN 玩家进入回合主界面 或 点击「下一回合」
THEN 前端发送 `POST /api/game/generate-event` body 含 `{ saveId, turn, stateSnapshot }`（不传玩家决策）
AND 显示 spinner「事件生成中...」
AND 服务端响应后渲染 `EventCard` 显示事件标题、描述、2-4 个选项
AND 每个选项含预定义的 `effects`（属性变化值）

#### Scenario: 玩家选择事件选项后前端本地应用效果

WHEN 玩家点击事件选项中的某一项
AND 点击「确认决策」
THEN 前端直接应用该选项的 `effects` 到 `state.attributes` 与 `state.resources`
AND **除下方「NPC 势力行动」调用 npc-actions 外不调用额外 API**
AND `StatusPanel` 中受影响属性数字滚动到新值

#### Scenario: 玩家自由输入时调用 resolve-decision

WHEN 玩家点击「自由行动」按钮
AND 输入 1-200 字的行动描述
AND 点击「提交」
THEN 前端发送 `POST /api/game/resolve-decision` body 含 `{ saveId, turn, playerDecision, stateSnapshot, event }`
AND 显示 spinner「判定中...」
AND 服务端返回 `{ effects }` 后前端应用效果

#### Scenario: 状态演化后属性变化可见

WHEN AI 返回事件 effects
THEN `StatusPanel` 中受影响属性数字滚动到新值
AND 属性条颜色短暂闪烁（绿色↑、红色↓）
AND 闪烁时长 300ms 后恢复

#### Scenario: NPC 行动展示

WHEN AI 事件生成完成后
THEN 前端自动调用 `POST /api/game/npc-actions`
AND 响应后渲染 `NpcActionList` 显示每个 NPC 势力本回合的行动
AND 玩家可点击某行动查看详情

### Requirement: 时间推进

游戏内时间 MUST 按月推进，起始 1851 年 1 月，结束 1912 年 12 月。每回合 +1 月。

#### Scenario: 每回合时间自动推进

WHEN 玩家完成一回合决策并进入下一回合
THEN `state.date.month` +1
AND 若 month > 12 则 month = 1 且 year +1
AND 顶部日期显示更新为「{year} 年 {month} 月」格式（如「1912 年 12 月」；当前未做清代年号映射，保持公元年-月）

#### Scenario: 达到 1912 年触发结局

WHEN `state.date.year > 1912`（时光尽头判定仅看年份，`month > 12` 分支因月份溢出后 year 已 +1、逻辑上不可达，实际触发点为走到 1913 年）
THEN 前端检测到时间超出
AND 触发「时光尽头」结局画面显示：「大清已亡，你的势力在历史中存活了 N 年」
AND 显示最终状态快照
AND 提供按钮「返回首页」与「重新开始」

### Requirement: 失败条件检测

任一属性 ≤ 0 时 MUST 触发「势力崩溃」结局。

#### Scenario: 任一属性归零触发崩溃

WHEN 状态演化后任一 `attributes` 字段 ≤ 0
THEN 立即跳转到结局画面
AND 显示对应崩溃原因（军事崩溃=「军队哗变溃散」、经济=「库银耗尽，财政崩盘」等）
AND 存档标记为 `ended: true`，禁止继续操作

### Requirement: 胜利条件检测

综合实力 ≥ 90 MUST 触发胜利结局。「存活至 1912 年」并非胜利，而是独立的「时光尽头」结局（见"达到 1912 年触发结局"）。

#### Scenario: 综合实力达到 90 触发胜利

WHEN 状态演化后 `calcOverallPower(attributes)`（Power_WEIGHTS 加权平均，政治/民心权重更高）≥ 90
THEN 跳转胜利结局画面「你的势力已雄踞天下」
AND 存档标记为 `ended: true`

### Requirement: 回合数与存档联动

每回合状态变更 MUST 立即写入本地存档，防止刷新丢失。

#### Scenario: 回合结束后立即持久化

WHEN 任一回合流程完成（含 NPC 行动展示）
THEN 前端调用 `useGameState().save(save)` 写入 `uni.setStorage`（经 `utils/storage.ts` 的 `saveSave` 异步封装）
AND `save.updatedAt` 更新为当前时间戳
AND `save.state.turn` +1 准备下一回合

#### Scenario: 玩家刷新页面后从最近回合继续

WHEN 玩家在回合中途刷新页面或重新打开
THEN 前端读取本地存档
AND 跳转到 `pages/game-main/index.vue` 显示当前回合局势
AND 不重复执行已完成的 AI 调用（已写入 events 数组的不再请求）

### Requirement: 玩家主动外交（次级操作）

玩家可在回合内随时通过外交面板对 NPC 势力发起主动操作（结盟/宣战/行贿/通商/离间/质子），作为不占事件决策机会的「次级操作」（来源提案 `2026-08-07-player-active-diplomacy`）。外交 MUST 受每回合上限（1 次）与资源/关系门槛约束，且回合处理中禁用。

#### Scenario: 玩家面板发起外交行动

WHEN 玩家点击底部「外交」按钮打开面板
AND 选择一个势力与一个动作（如「行贿」）
AND 满足门槛（关系/资源）且本回合未用尽上限
THEN 前端 `applyDiplomacyAction` 扣减资源并修改该势力 `relationship`/`status`/`power`
AND 追加一条 `eventType: '外交'` 的历史事件（复用 TurnTimeline 的「外交」badge）
AND 置 `diplomacyUsedThisTurn = true` 封锁本回合后续外交

#### Scenario: 新回合解锁外交上限

WHEN 玩家点击「下一回合」触发 `useTurn.startTurn`
THEN `startTurn` 开头调用 `resetDiplomacy()` 重置 `diplomacyUsedThisTurn = false`
AND 玩家可在新回合再次发起 1 次外交行动

### Requirement: 决策输入方式

玩家决策 MUST 支持「选项选择」（前端本地应用 effects）与「自由输入」（调用 resolve-decision API）两种方式。

#### Scenario: AI 提供事件选项时玩家选择

WHEN 服务端 `generate-event` 返回的事件含 `options: [{ id, label, effects }]` 数组
THEN 前端渲染为 `DecisionButton` 列表
AND 玩家点击某选项后高亮 + 显示「已选择」
AND 玩家点击「确认决策」按钮后前端直接应用该选项的 `effects`
AND 不调用任何额外 API

#### Scenario: 玩家自由输入行动

WHEN 玩家不想选择事件选项，想自由描述行动
THEN 玩家可点击「自由行动」按钮展开 textarea
AND 输入 1-200 字的行动描述
AND 点击「提交」后调用 `POST /api/game/resolve-decision`
AND 服务端返回 `{ effects }` 后前端应用效果

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

#### Scenario: 本回合累计影响汇总（2026-08-06-npc-action-cumulative-impact）

`NpcActionList` MUST 在「天下动静」面板顶部（列表项上方）展示"本回合累计影响"汇总卡，落实 `docs/game-design.md:571` 的"NPC 行动 effects 累计影响玩家属性"设计规则。

WHEN 本回合存在成功生成的 NPC 行动（`actions.length > 0`）
THEN 顶部渲染"本回合累计影响"卡片
AND 遍历所有 `actions`，按维度（Attributes & Resources 键）累加 `effects` 数值得到累计值
AND 按绝对值降序展示各维度 chips，复用 `EFFECT_LABELS` 完整词与负红/正绿着色（与逐条"对你影响"行视觉一致）
AND 决策失败项（`failedFactionIds`）不计入累计（其无 `effects`）

WHEN 所有 `effects` 为空或全部为 0（或仅含非数字值）
THEN 卡片内显示"本回合各方按兵不动，暂无累计影响"

WHEN `actions` 为空（本回合无成功生成的 NPC 行动，含全部决策失败场景）
THEN 不渲染累计汇总卡（避免与整面板空态"本回合各方暂无行动"及失败卡片语义冲突）

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

### Requirement: 回合资源自动产出（2026-08-07-resource-per-turn-yield）

每回合结算时游戏 MUST 自动产出少量资源（初版 `silver +50`），避免长期消耗后无解；产出须以系统历史事件形式记录于 timeline，可追溯。

WHEN `useTurn.endTurn()` 完成 NPC 行动应用、追加玩家决策历史事件后、`turn+1` 之前
THEN 调用 `store.applyEffects(calcTurnYield())` 注入固定资源增量（`TURN_YIELD` 常量，`utils/constants.ts`）
AND `store.appendEvent` 追加一条 `eventType: '系统'`、`playerChoice: ''`、`effects: { silver: 50 }` 的历史事件（文案来自 `copywriting.SYSTEM_EVENT.turnYield`）
AND 该产出发生在 `isProcessingTurn` 守卫内（防重复提交）

#### Scenario: 产出计入 timeline 且不破环结构

WHEN 回合结束
THEN `GameSave.events` 末条为 `eventType: '系统'` 的产出事件
AND `TurnTimeline` 正确渲染该事件（`typeClass` 含 `'系统'` 分支，文本显示"系统"），不报错/不漏显

