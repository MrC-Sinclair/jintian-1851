# turn-engine 规格变更（剧情链完成度进结局展示）

## ADDED Requirements

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
