# turn-engine Specification

## Purpose
编排单回合五段强制流程（局势展示 → AI 事件生成 → 玩家决策 → 状态演化 → NPC 势力行动）与游戏内时间按年推进（1851—1912，1 回合 = 1 年）。它是连接事件引擎、决策应用、NPC 行动、结局判定的中枢，确保每回合步骤有序、可审计、不跳漏。此外，回合开始时 `startTurn` 会并行调用 `advisor-briefing` 获取军师局势简报（与事件生成 `Promise.all` 并行，失败降级不阻塞）。
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

游戏内时间 MUST 按年推进，起始 1851 年，结束 1912 年。每回合 +1 年。

#### Scenario: 每回合时间自动推进

WHEN 玩家完成一回合决策并进入下一回合
THEN `state.date.year` +1
AND `state.date.month` 恒为 1（字段保留但停用，见下方"契约不变"要求）
AND 顶部日期显示为「{year} 年」格式

#### Scenario: 六十年第一次真的能走完

WHEN 玩家从 1851 年开局且不提前触发任何结局
THEN 约 61 回合后到达 1912 年
AND 再下一回合 `state.date.year > 1912` 成立
AND 触发「时光尽头」结局
AND 该结局**必须可被模拟底盘复现**（`maxTurns` 上界须 ≥ 62，否则测不到）

> 变更理由：月钟下 61 年需要 732 回合，而实测中位局长只有 37 回合 ——
> **没有任何胜利存档走到过 1872 年**（关链 p90=1854、开链 p90=1865、最好的一组 p90=1872），
> `time_up` 因此是死代码。这与 #3 之前 `economy_collapse` 从未触发是同一类缺陷。

### Requirement: 失败条件检测

任一属性 ≤ 0 时 MUST 触发「势力崩溃」结局，且该判定**不受时钟改造影响**：
崩溃仍是立即结束，不因"还没走到 1912 年"而被救回。

#### Scenario: 任一属性归零触发崩溃

WHEN 状态演化后任一 `attributes` 字段 ≤ 0
THEN 立即跳转到结局画面
AND 显示对应崩溃原因（军事崩溃=「军队哗变溃散」、经济=「库银耗尽，财政崩盘」等）
AND 存档标记为 `ended: true`，禁止继续操作

### Requirement: 胜利条件检测

胜利 MUST 在 1912 年结算时判定，而不是在中途 power 达线时立即触发。
`endedReason` 取值集合 MUST 保持现有的 7 种不变（不新增枚举值）。

#### Scenario: 走到 1912 年且实力达标判中兴

WHEN `state.date.year > 1912` 且 `calcOverallPower(attributes) >= VICTORY_THRESHOLD`（当前 85）
THEN 返回 `victory`
AND 结局页按「实力 × 名望史评 × 链完成度」三层给出等级

#### Scenario: 走到 1912 年但实力未达标

WHEN `state.date.year > 1912` 且综合实力未达阈值
THEN 返回 `time_up`（岁月如梭，未成中兴）
AND 该结局**必须可达**——这是时钟改造的验收标准之一（月钟下实测无任何存档走到过 1872 年）

#### Scenario: 中途达标只锁定评价，不结束游戏

WHEN 玩家在 1873 年就把综合实力推到阈值之上
THEN 游戏**不**立即结束，改为在历史时间线记一条"中兴已定"系统事件并锁定该评价
AND 玩家继续推进至 1912 年结算
AND 理由：现规则下实测 200 局全部恰好在第 22 回合必胜、终局 1865 年，
      「1851—1912」这个跨度根本走不完；把胜利改到年代终点结算才让六十年成为被玩的对象

#### Scenario: 为什么不新增结局枚举值

WHEN 有人想为"提前锁定中兴"新增 `endedReason`
THEN 不予采纳 —— `ended_reason` 虽为自由 TEXT 可塞新值，但会牵动前端两张
      `Record<EndedReason, string>` 文案表、`isFailureEnd` 配色、既有存档可读性；
      用「1912 结算时 power 是否达标」映射到既有 `victory` / `time_up` 即可表达全部语义

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
`endTurn` SHALL 按「毛产出 − 养饷」的净额经 `applyEffects` 入账，
并以 `eventType: '系统'` 记录；文案 MUST NOT 写死数额（净额随兵员变化）。

#### Scenario: 结算顺序
- **WHEN** 玩家结束回合
- **THEN** 顺序为 破产判定（产出前）→ 净产出入账 → 断粮/兵溃判定（产出后）→ 势力存亡 → turn+1

#### Scenario: 名望衰减同批入账
- **WHEN** 净产出入账
- **THEN** 同一批 effects 含 `reputation: -3`（名望封顶 0-100），系统事件记录完整净额

#### Scenario: 产出计入历史时间线且时间线可渲染
- **WHEN** 回合结束、净产出入账
- **THEN** `GameSave.events` 末条为 `eventType: '系统'` 的产出事件，`effects` 记完整净额（不写死数额）
- **AND** `TurnTimeline` 有 `'系统'` 分支，把它渲染成「系统」而不报错/不漏显

### Requirement: 名望封顶 0-100
`applyEffects` SHALL 把 `resources.reputation` 夹在 0-100 区间（上限 `REPUTATION_MAX = 100`，
下限沿用资源托底 0），而银两/兵员/粮草 MUST NOT 封顶——它们是存量计数，没有刻度语义。

#### Scenario: 正向溢出被夹住
- **WHEN** `applyEffects({ reputation: 200, silver: 5000 })` 作用于起始名望 10 / 银两 1000 的存档
- **THEN** 名望为 **100**，银两为 6000（不封顶）

#### Scenario: 扣到负数仍触底 0
- **WHEN** `applyEffects({ reputation: -50 })`
- **THEN** 名望为 0，不出现负数

### Requirement: 名望档位表是单一真值来源
系统 SHALL 用一张按 `min` 降序、末档 `min = -Infinity` 兜底的五档表同时驱动结局史评与 NPC 态度文案；
前后端各持一份镜像，由深比较测试防漂移。

#### Scenario: 边界入档
- **WHEN** 名望为 85 / 84 / 65 / 64 / 40 / 39 / 20 / 19 / 0 / -30
- **THEN** 依次落入 天下归心 / 天下归心 / 朝野称望 / 朝野称望 / 声名平平 / 物议沸然 / 物议沸然 / 身败名裂 / 身败名裂 / 身败名裂
- **AND** 划线取年钟重标定后的 78 / 60 / 42 / 22；旧的月钟划线 85 / 65 / 40 / 20 在 63 回合局长下会把五档压成两档

#### Scenario: 每档三字段齐全
- **WHEN** 取任意档
- **THEN** `label`、`remark`、`npcStance` 均非空（结局页与 prompt 分别直接渲染后两者）

### Requirement: 结局页展示史评
结局页 SHALL 在 7 种结局之上叠加「史评」区块，显示名望档位的称号与评语；
存档尚未加载时 MUST NOT 渲染该区块（否则会闪一下最低档）。

#### Scenario: 胜利局显示称号与评语
- **WHEN** 玩家以名望 90 达成 `victory`
- **THEN** hero 区依次显示结局标签、标题、文案，以及「史评 / 天下归心 / 口碑载道，四方望风而归。」

#### Scenario: 存档未加载不渲染
- **WHEN** `onMounted` 的 `load()` 尚未返回、`save` 为空
- **THEN** 史评区块不出现在 DOM 中（`v-if="save"`）

### Requirement: 银两按在编兵员发饷
回合结算 SHALL 按 `ceil(troops / 100) × TROOP_UPKEEP_SILVER_PER_100` 从银两中扣除养饷，
`calcTurnYield(troops)` MUST 返回**净额**；兵员为 0 或非正数时养饷为 0。

#### Scenario: 中等规模军队仍有净收入
- **WHEN** 兵员 500、产出 +50、K=4
- **THEN** 净银两为 **+30**，历史事件的 `effects.silver` 记 30（不是毛值 50）

#### Scenario: 大军压垮财政
- **WHEN** 兵员 1300
- **THEN** 养饷 52 > 产出 50，净银两为 **−2**

#### Scenario: 漏传兵员不得静默退化为不扣饷
- **WHEN** 调用处未提供兵员数
- **THEN** 类型层面即不可编译（`troops` 是必填参数），
      并有 `use-turn` 用例锁住三档兵员对应的净银两，防止回归成固定值

### Requirement: 财政破产惩罚在回合产出之前判定
`silver ≤ 0` 时 SHALL 每回合造成 经济 −3 / 民心 −2，并在历史时间线记一条系统事件；
该判定 MUST 发生在回合产出**之前**（与断粮/兵溃的时点刻意相反）。

#### Scenario: 月初空库即触发
- **WHEN** 进入回合结算时银两为 0（或负）
- **THEN** 扣经济 −3、民心 −2，理由文案「府库耗尽，加赋失民心」

#### Scenario: 赋税入库不能倒推抹掉本月的横征暴敛
- **WHEN** 银两为 0 而本回合净产出为 +30
- **THEN** 破产惩罚**仍然触发**（先判破产，再入库）
- **AND** 理由：若放在产出之后判定，只要净产出为正就永远触发不了；
      实测那样 K=4 胜率仍是 95.5%，而 K 只能调到 6 才有反应，一步跳到 59.0%（阶跃而非梯度）

#### Scenario: 破产可通向经济崩溃结局
- **WHEN** 经济属性被持续扣至 ≤ 0
- **THEN** `checkEndConditions` 返回 `economy_collapse`
- **AND** 该结局此前 200 局从未触发（设计承诺的 7 种结局里有 2 种是死代码）

### Requirement: 通关模拟底盘与真实回合循环对齐
`tests/sim/balance-sim.ts` MUST 建模资源枯竭惩罚（含破产），
否则回归会报出与真实游戏相反的结论。

#### Scenario: 不建模惩罚会掩盖难度回收
- **WHEN** 底盘不跑破产惩罚
- **THEN** 养饷 K=4 的胜率仍报 95.5%（与真实 86.0% 矛盾）
- **AND** 因此底盘按真实时点跑三条惩罚；「剧情链与时光跳跃」的缺口由后续
      `balance-sim-chain-fidelity` 变更以 `useStoryChains` 开关补上（默认关闭以保持本条基线可复现）

#### Scenario: 可通关基线随钟改写
- **WHEN** 200 局严格基线（LLM 不可用、含外交、均匀事件池）
- **THEN** 胜率 ≥ 0.8，无 `crash`
- **AND** 阈值由 0.9 下调是本轮有意回收难度的结果，不是回归
- **AND** 回合数断言随时钟改写：月钟下实测 86.0% / `avgTurns` 落在 5~50；
      年钟（1 回合 = 1 年、结局在 1912 之后结算）下实测关链 97.5% / `avgTurns` 恒为 63.0，
      因为结算点固定在 1913 年，方差为 0 是设计使然而非巧合

#### Scenario: 外交有财政代价但降幅有界
- **WHEN** 对比开启与关闭玩家主动外交
- **THEN** 开启方胜率可低于关闭方（外交花银两 → 触发破产），但降幅 ≤ 15pt
- **AND** 两条路径胜率均 ≥ 0.8，且开启方外交次数 > 0、关闭方为 0
- **AND** 原不变量「开启外交不应降低胜率」已随本轮改写：外交从无成本增益变成财政权衡是设计意图

### Requirement: 「中兴已定」是存档级可选字段且必须进 sync-save 白名单
`GameSave.zenithYear?: number` SHALL 作为存档级可选字段持久化，并 MUST 在
`sync-save.ts` 的 `saveDataSchema`（**strictObject**）中显式声明。

#### Scenario: 不声明就会整条存档被拒
- **WHEN** 客户端上传带 `zenithYear` 的存档而 schema 未声明该字段
- **THEN** strict 模式返回 400 INVALID_PARAMS —— 不是忽略未知字段，而是**拒绝整个存档**
- **AND** 因此 API.md 的存档字段表与 `saveDataSchema` 必须同步更新（两处已有用例守着）

#### Scenario: 旧存档无需迁移
- **WHEN** 加载一个不含 `zenithYear` 的旧存档
- **THEN** 视为"从未锁定"，结算时只看当时的综合实力
- **AND** `lockZenith()` 在已锁定时直接返回，不覆盖首次锁定的年份

### Requirement: 老存档按新时钟继续，不做双时钟
时钟切换 MUST 以"直接生效"的方式落地：既有存档的 `date` 与 `turn` 原样保留，
之后每回合 +1 年。MUST NOT 按 `saveVersion` 分叉出月钟与年钟两套推进逻辑。

#### Scenario: 接受老档年代加速

WHEN 玩家打开一个 1853 年的进行中存档
THEN 之后每回合推进 1 年（而非 1 个月），该局会比新开局更快走完年代
AND 这是**已知且接受**的代价：换来的是判定、文案、测试、模拟底盘只有一套时钟

#### Scenario: 明确排除双时钟

WHEN 有人提议按 `saveVersion` 让老档继续走月钟
THEN 不予采纳 —— 结局判定、危机提示、链触发、prompt 日期语义、e2e 断言全都要分叉，
      长期维护成本远高于"少数老档加速"这一一次性影响

### Requirement: 结局等级由三层派生合成
1912 结算时的结局叙述 SHALL 由三层独立派生值合成，
且这三层 MUST NOT 互相进入胜负判定（各自只读自己的输入）。

#### Scenario: 三层各自独立
- **WHEN** 渲染结局页
- **THEN** 第一层是结局类型本身（`victory` / `time_up` / 五类崩溃，由 power 与属性归零决定）
- **AND** 第二层是名望史评档位（#2 的 `getHistoryRating`，封顶 0-100、每回合衰减）
- **AND** 第三层是剧情链完成度与档位（#4 的 `getChainCompletion` / `getChainTier`，
      分母为终局年份前可达链数）
- **AND** 三层互不改写：完成度再高也不能把 `time_up` 变成 `victory`，反之亦然

#### Scenario: 年钟后完成度分母第一次真正有意义
- **WHEN** 存档走到 1912 年结算
- **THEN** 可达链数等于链全集（23 条），完成度分母不再被"早停"截断
- **AND** 月钟下该层几乎恒为 6/6 这类小样本（实测终局年份 p90 ≤ 1872），档位区分度极低

### Requirement: 改时钟不得触碰对外契约
本变更 MUST NOT 修改 HTTP 接口入参/返回结构、DB schema，或 `state.date` 的字段组成。
`date.month` 以"保留且恒为 1"的方式停用，而不是删除。

#### Scenario: zod 校验仍然全部通过
- **WHEN** 前端提交 `date: { year: 1873, month: 1 }`
- **THEN** 6 处 `z.object({ year, month: min(1).max(12) })` 全部照旧通过
- **AND** `eventDate` 结构（`{ year, month: 1 }`）无需调整

#### Scenario: 为什么不干脆删掉 month
- **WHEN** 有人提议删字段以"保持数据干净"
- **THEN** 不予采纳 —— 删除会牵动 6 处 schema、4 个 prompt、DB 中已存 JSON 与存档迁移，
      把一个玩法决策升级成一次数据迁移

### Requirement: 数值重标定必须先测量后调整
时钟切换后 MUST 先跑 200 局实测终局年份分布、胜率、链完成数与每局 LLM 调用次数，
再决定各常量取值；MUST NOT 在切换前预先调整数值。

#### Scenario: 率量与存量的区分
- **WHEN** 重标定某一常量
- **THEN** 先判断它是「每回合发生的率」（产出 +50 银、养饷 K=4、外交配额 1 次/回合）
      还是「跨回合累加的存量」（名望 −3/回合、事件属性增益、NPC 每回合压力）
- **AND** 率量默认保持不变；存量按局长变化比例（37 → 61 回合，约 1.65×）重推
- **AND** 反例：单独把 `TURN_YIELD.silver` 放大 12 倍会让养饷 K=4 的净余量标定失效，
      破产后果（#3 才刚让它真的咬人）再次变成空转 —— 产出与养饷必须成对调

#### Scenario: 22 回合必胜的解药在数值不在节奏
- **WHEN** 年钟切完、数值未重标
- **THEN** 胜率仍会接近 100%（时钟本身不减属性通胀）
- **AND** 此时应压的是**每回合属性增益总量**（兜底事件与链节点的 effects 量级），
      而不是链首密度 —— 后者已被 `chainHeadInterval` 的 K 扫描实测否掉：
      K=2…10 胜率恒为 100%，而链完成数与终局年份随 K **双双下降**

### Requirement: 无人消费的数据字段必须处置
`triggerTurnOffset` 与 `endYear` MUST 被接上消费路径或删除，二者取一。
现状：两者**无任何消费者**（前端入队写死 `currentTurn + 1`，服务端只取 `pendingChainNodes[0]`）。

#### Scenario: 不允许留第三份假数据
- **WHEN** 有人只把 23 条链的 `triggerTurnOffset` 从 0,1,2,3,4 改成真实年距而不接消费路径
- **THEN** 不予采纳 —— 数值变了而行为不变，比不改更糟（读代码的人会以为年距已生效）
- **AND** 若选择接上（入队用 `currentTurn + node.triggerTurnOffset`），则一条 5 节链
      从"占满 5 个回合"变为"跨 13 回合、中间夹 8 个普通事件"，这是**行为变更**，
      必须单独重跑平衡，不能算在改时钟的账里顺手做掉

### Requirement: 剧情链完成度进入结局叙述但不参与胜负判定
结局页 SHALL 展示玩家的剧情链完成度与派生称号（`getChainCompletion` / `getChainTier`），
该值 MUST 为**纯派生**（读 `save.completedChainIds` / `activeChainIds`），
不得写入 `endedReason`、不得新增结局枚举、不得进入 `checkEndConditions`。

#### Scenario: 结局页展示
- **WHEN** 玩家存档终局并打开结局页
- **THEN** 在「史评」之下渲染「历史进程」：`亲历 N/M 段史事（至 X 年）`、称号、已完成链名列表、未收束段数
- **AND** 称号三档：ratio ≥ 0.8 亲历全局 / ≥ 0.5 半壁经行 / < 0.5 未竟之局

#### Scenario: 关键不变量——完成度不改变判定
- **WHEN** 两份存档属性完全相同、完成度一个为 0 一个为满
- **THEN** `checkEndConditions` 返回同一个结局
- **AND** 单测锁住这条：若有人把完成度塞进胜利条件，模拟里「关链」路径的
      `chainsCompleted` 恒为 0，胜率会一步归零，86.0% 基线整条作废

#### Scenario: 为什么不做成胜利门槛
- **WHEN** 提议「胜利需完成 ≥ N 条链」来治速通
- **THEN** 不予采纳 —— 链节点 effects（±8~12）远大于兜底事件（±3~7），链是**奖励**；
      用"吃了多少奖励"当胜利条件只会逼人拖着不完成链。治速通的正确工具是事件下发侧的链密度闸门

### Requirement: 完成度分母取「终局年份之前可达链数」
`getChainCompletion().reachable` MUST 以**终局年份**为界统计可达链数，
而不是以链的总数为分母；`completed` 只计「可达 且 已完成」的交集。

#### Scenario: 不惩罚通关太快
- **WHEN** 存档在 1865 年通关（当时可达 6 条）
- **THEN** 分母为 6 而不是 23，否则"越早赢显得越失败"
- **AND** 反向验证：1912 年终局的存档分母等于链总数

#### Scenario: 未来年份的链不计入
- **WHEN** 终局年份为 1852 而 `completedChainIds` 里含有 1911 年的链
- **THEN** 该链不计入 `completed`（防口径污染），`completedTitles` 亦不含它

#### Scenario: 样本过小不给称号
- **WHEN** `reachable < 3`（例如开局没几回合就结束）
- **THEN** `getChainTier` 返回 null，结局页只展示原始数字
- **AND** 理由：1/1 = 100% 这种"满级"毫无信息量，只会把早期存档吹成完人
- **AND** `completed === 0` 同样返回 null

#### Scenario: 存档尚未加载
- **WHEN** `getChainCompletion(null)`
- **THEN** 返回全零结构而不是抛错（结局页的 `save` 是 `onMounted` 才载入的，模板要能直接取值）

### Requirement: 旧存档无需迁移即可展示完成度
完成度 SHALL 在读取时即时计算，MUST NOT 落库或引入 schema 变更；
`completedChainIds` / `activeChainIds` 缺失时按空数组处理。

#### Scenario: 云存档往返
- **WHEN** 存档经 `sync-save` 上传再下载
- **THEN** 完成度仍正确 —— 两个字段随 `saveData`（jsonb）整体往返，无需服务端改动

### Requirement: 通关模拟底盘可选建模剧情链
`tests/sim/balance-sim.ts` SHALL 提供 `useStoryChains` 开关来建模剧情链触发与时光跳跃，
该开关 MUST 默认为 `false`，使既有严格基线（86.0%）在开启前后仍可逐位复现。
打开后底盘的事件优先级 MUST 与服务端 `generate-event` 一致：
挂起链节点 → 下一条可触发链 → 兜底事件。

#### Scenario: 默认关闭时基线一位都不动
- **WHEN** 不传 `useStoryChains` 跑 200 局严格基线
- **THEN** winRate 86.0%、avgTurns 37.5、median 37、range=[23,51]、
      逐资源下限 银两0/兵员15/粮草160/名望0 —— 与建模链之前完全相同
- **AND** 这不是巧合：开关为假时既不读链表也不消耗额外随机数，故种子序列不变

#### Scenario: 时光跳跃让年份与链完成度第一次可测
- **WHEN** 打开开关跑 200 局
- **THEN** `SimReport.avgChainsCompleted > 0` 且 `maxFinalYear` 明显大于关链时的 1855
- **AND** `SimOutcome.chainsCompleted` / `finalYear` 供结局年份跨度（`time_up`）与 #4 的链完成度分析使用

#### Scenario: 未来锚点这条规则要一起复刻
- **WHEN** 匹配下一条可触发链
- **THEN** 条件为 `startYear >= 当前年`（允许锚点在未来），而非 `startYear === 当前年`
- **AND** 理由同服务端：日历 1 回合只走 1 月，若要求同年则 14 条链里 12 条永不触发，
      且时光跳跃的跳跃目标正是「下一条链的 startYear」

### Requirement: 剧情链镜像必须与服务端真值对账
底盘 SHALL 自存一份 `SIM_CHAINS` 镜像而**不 import** 服务端 `STORY_CHAINS`
（保持「回归基线不随服务端内容漂移」的既有设计意图）；
同时 MUST 有单元测试将镜像与 `STORY_CHAINS` 逐链、逐节点、逐选项深比对，
使漂移表现为测试红而非静默的基线变质。

#### Scenario: 结构漂移即红
- **WHEN** 服务端某条链的 chainId / startYear / 节点数 / 前置链与镜像不符
- **THEN** `sim-chain-mirror.test.ts` 失败，并指出具体是哪条链的哪个字段

#### Scenario: 数值漂移同样即红
- **WHEN** 服务端某节点某选项的 `effects` 与镜像不同（哪怕只差一个维度）
- **THEN** 深比对失败，报错文案含链 id、节点序号与选项 id
- **AND** 此时**必须重标定基线**，不允许只改测试让它变绿

#### Scenario: 近似 effects 比缺值更危险
- **WHEN** 镜像用手写近似数值填充
- **THEN** 量出的结论可以方向相反：近似值下开链胜率 0%，服务端真值下开链胜率 100%
- **AND** 因此镜像只允许从 `STORY_CHAINS` 拼接，禁止臆造数值

### Requirement: 底盘结论中的剧情链挤占效应必须被记录
底盘 SHALL 以对比用例的形式记录「开链 vs 关链」，
断言只锁关系性结论（开链胜率不低于关链、开链平均回合数更短、链完成数大于 0），
**不得**把当前数值下「22 回合定局」这一病症固化为长期成立的要求。

#### Scenario: 挤占效应如实呈现
- **WHEN** 打开开关跑 200 局
- **THEN** 实测 winRate=100.0%、avgTurns=22.0、range=[22,22]、最晚年份 1865
      （链完成均值随链条数变化：14 条时 6.00，补到 23 条后 5.00 —— 见 `story-chain-anchors-and-completion`）
- **AND** 文件头快照记录该组数字并注明：链节点命中时不调 LLM 因而挤占普通事件，
      叠加节点 effects 量级（±8~12）大于兜底事件（±3~7）且 bot 恒选最强项，导致提前撞线

#### Scenario: NPC 压力档位下链的增益被抵消
- **WHEN** 在 `npcModel='simple'` 下对比开关
- **THEN** 开链 100% / 42.6 回合 / 链完成 13.47 / 走到 1911 年（14 条链时），
      关链 7.0% / 47.4 回合 / 走到 1855 年
- **AND** 难度主要由 NPC 供给；链一开即抵消，该事实供剧情链密度设计参考

### Requirement: 资源枯竭惩罚在底盘中无条件生效
底盘 MUST 按真实时点跑三条惩罚（破产在回合产出**之前**、断粮与兵溃在产出**之后**），
且该建模**不设开关**：既有基线本身就是含惩罚的数字。

#### Scenario: 不为惩罚增设第二档位
- **WHEN** 提议为 `calcResourcePenalty` / `calcBankruptcyPenalty` 加模拟开关
- **THEN** 不予采纳 —— 86.0% 基线已含惩罚，再开「关惩罚」分支只会维护一条没人跑的代码路径，
      并会让人误以为存在另一组「旧基线」

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

