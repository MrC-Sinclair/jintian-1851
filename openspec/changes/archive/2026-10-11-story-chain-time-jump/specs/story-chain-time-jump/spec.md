# story-chain-time-jump 规格

## MODIFIED Requirements

### Requirement: 剧情链按年份锚点触发
系统 SHALL 取 `startYear` **不早于**当前游戏年份的第一条可触发剧情链（未 `completed`、未 `active`、前置链均已 `completed`），
多条候选按 `startYear` 升序 + `chainId` 字典序取第一条。原「`startYear` 严格等于当前年」的判定已废弃——
日历一旦跨过那一年该链即永久丢失，且时光跳跃无法成立。

#### Scenario: 锚点晚于当前年
- **WHEN** 游戏日历为 1853-06，太平天国与捻军链均已完成
- **THEN** 返回第二次鸦片战争（`startYear=1856`）首节点，**不调 LLM**，响应头 `X-Event-Source: time-window`

#### Scenario: 锚点恰为当年
- **WHEN** 游戏日历为 1861-03，洋务运动链可触发
- **THEN** 返回洋务运动首节点，且事件**不含** `eventDate`、描述**不含**过场前缀

#### Scenario: 前置链未完成时改取后一条
- **WHEN** 日历 1894，甲午战争因前置「洋务运动」未完成而被过滤
- **THEN** 返回下一条无前置的链（戊戌变法 1898）并跳跃至 1898-01，而非直接落到 LLM 路径

### Requirement: 时光跳跃随事件下发目标年月
当被触发链的 `startYear` 晚于当前游戏年份时，服务端 SHALL 在事件上携带
`eventDate: { year: startYear, month: 1 }`，并把描述改写为
`【{当前年}—{锚点年} 年间】{链概述} {节点描述}`，以交代这段被跳过的时间。

#### Scenario: 跳跃事件形态
- **WHEN** 日历 1851-12 触发捻军之乱（1853）
- **THEN** `event.eventDate` 为 `{year:1853, month:1}`，`event.description` 以 `【1851—1853 年间】` 开头

#### Scenario: 只在链首判定
- **WHEN** 事件走 `pending-chain` 路径（链内第 2~N 个节点）
- **THEN** 即使该链 `startYear` 晚于当前日历，也**不下发** `eventDate`
- **AND** 理由：一条 5 节点链若每节点都跳一次，会把日历往前推 5 次

### Requirement: 前端按事件时间推进游戏日历
`useTurn.startTurn` SHALL 在写入事件后比较 `event.eventDate` 与当前 `state.date`，
仅当 `eventDate` **晚于**当前日期时把日历更新为 `eventDate`；等于或早于时保持不变（不回拨）。

#### Scenario: 应用跳跃
- **WHEN** 当前日历 1851-01，收到 `eventDate: {1853,1}` 的事件
- **THEN** `state.date` 变为 `{year:1853, month:1}`

#### Scenario: 不回拨
- **WHEN** 当前日历 1851-01，收到 `eventDate: {1850,6}` 的事件
- **THEN** `state.date` 仍为 `{year:1851, month:1}`

#### Scenario: 普通事件不影响日历
- **WHEN** 事件不含 `eventDate`（LLM 生成路径）
- **THEN** 日历保持由 `endTurn` 逐月推进的原有行为
