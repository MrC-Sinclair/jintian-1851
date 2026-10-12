# turn-engine 规格变更（名望封顶、衰减与史评档位）

## ADDED Requirements

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
- **THEN** 依次落入 天下归心 / 朝野称望 / 朝野称望 / 声名平平 / 声名平平 / 物议沸然 / 物议沸然 / 身败名裂 / 身败名裂 / 身败名裂

#### Scenario: 每档三字段齐全
- **WHEN** 取任意档
- **THEN** `label`、`remark`、`npcStance` 均非空（结局页与 prompt 分别直接渲染后两者）

## MODIFIED Requirements

### Requirement: 回合资源自动产出（2026-08-07-resource-per-turn-yield）
`endTurn` 结算时 SHALL 按 `TURN_YIELD = { silver: 50, troops: 15, reputation: -3 }`
经 `applyEffects` 入账，并以 `eventType: '系统'` 记录进历史时间线。
名望的负产出表达「人走茶凉」：名望需持续经营，不是只涨不跌的计数器。

#### Scenario: 每回合产出与衰减同时入账
- **WHEN** 玩家结束一个回合
- **THEN** 银两 +50、兵员 +15、名望 −3，且历史事件 `effects` 完整记录这三项（含负值）

#### Scenario: 衰减叠加事件收入后的实测分布
- **WHEN** 200 局模拟（事件毛收入约 +4.4/回合）跑完
- **THEN** 终局名望 min=0 / p10=23 / 中位=59 / p75=74 / p90=88 / max=100，约 4% 撞顶；
      五档占比 ≈ 12% / 28% / 35% / 15% / 10%
- **AND** 胜率与通关回合数**不因本次改动移动**（baseline 95.5%、simple-npc 40.5% 均与改动前一致）

#### Scenario: 名望不参与胜负判定（不变量）
- **WHEN** 两组属性完全相同、名望分别为 0 与 100 的状态分别做结局判定
- **THEN** `checkEndConditions` 返回**同一个**结局，`calcOverallPower` 结果不变
- **AND** 理由：实测把名望计入综合实力会把 200 局胜率从 95.5% 抬到 100%，
      因为名望量级远高于属性 0-100 刻度。这条不变量由用例锁定，防止日后"顺手"塞进判定

### Requirement: 结局页展示史评
结局页 SHALL 在 7 种结局之上叠加「史评」区块，显示名望档位的称号与评语；
存档尚未加载时 MUST NOT 渲染该区块（否则会闪一下最低档）。

#### Scenario: 胜利局显示称号与评语
- **WHEN** 玩家以名望 90 达成 `victory`
- **THEN** hero 区依次显示结局标签、标题、文案，以及「史评 / 天下归心 / 口碑载道，四方望风而归。」

#### Scenario: 存档未加载不渲染
- **WHEN** `onMounted` 的 `load()` 尚未返回、`save` 为空
- **THEN** 史评区块不出现在 DOM 中（`v-if="save"`）
