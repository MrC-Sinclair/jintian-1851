# turn-engine — 回合制核心循环

## ADDED Requirements

### Requirement: 回合流程编排

每回合 MUST 按顺序执行五段：局势展示 → AI 事件生成（含选项）→ 玩家决策（选选项 或 自由输入）→ 状态演化 → NPC 势力行动。军师对话为穿插在决策前后的可选功能，不计入强制步骤。

#### Scenario: 玩家进入回合主界面看到当前局势

WHEN 玩家进入 `pages/game-main/index.vue` 或点击「下一回合」后
THEN 顶部显示当前回合数与游戏内日期（如「第 5 回合 · 同治元年三月」）
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
AND 顶部日期显示更新为对应清代年号（咸丰元年、同治元年、光绪元年、宣统元年等）

#### Scenario: 达到 1912 年触发结局

WHEN `state.date.year > 1912` 或 `state.date.year == 1912 AND state.date.month > 12`
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

综合实力 ≥ 90 或存活至 1912 年 MUST 触发胜利结局。

#### Scenario: 综合实力达到 90 触发胜利

WHEN 状态演化后 5 维属性均值 ≥ 90
THEN 跳转胜利结局画面「你的势力已雄踞天下」
AND 存档标记为 `ended: true`

### Requirement: 回合数与存档联动

每回合状态变更 MUST 立即写入本地存档，防止刷新丢失。

#### Scenario: 回合结束后立即持久化

WHEN 任一回合流程完成（含 NPC 行动展示）
THEN 前端调用 `useSaveSync().save(save)` 写入 `uni.setStorage`
AND `save.updatedAt` 更新为当前时间戳
AND `save.state.turn` +1 准备下一回合

#### Scenario: 玩家刷新页面后从最近回合继续

WHEN 玩家在回合中途刷新页面或重新打开
THEN 前端读取本地存档
AND 跳转到 `pages/game-main/index.vue` 显示当前回合局势
AND 不重复执行已完成的 AI 调用（已写入 events 数组的不再请求）

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
