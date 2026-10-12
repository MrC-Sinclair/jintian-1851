# turn-engine 规格变更（时钟：1 回合 = 1 年）

> 本 delta 只写**已决定的部分**（时钟本身与其不变量）。
> 胜利何时可触发、老存档兼容策略仍是开放决策（见 `proposal.md` 第 5 节），
> 刻意不写成规格 —— 把未定的规则写进 spec 比不写更糟。

## MODIFIED Requirements

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

## ADDED Requirements

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
