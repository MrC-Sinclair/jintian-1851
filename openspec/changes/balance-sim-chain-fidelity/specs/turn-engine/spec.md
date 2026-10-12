# turn-engine 规格变更（模拟底盘建模剧情链）

## ADDED Requirements

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
