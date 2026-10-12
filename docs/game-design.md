# 金田：1851 — 游戏设计文档

> 本文档是游戏**数值平衡、势力列表、事件池、结局判定**的唯一来源，禁止代码与文档脱节。
>
> 所有数值均与以下源码一一对应：
> - [game-web/src/types/game.ts](file:///d:/code/codeWork/jintian-1851/game-web/src/types/game.ts)
> - [game-web/src/composables/useGameState.ts](file:///d:/code/codeWork/jintian-1851/game-web/src/composables/useGameState.ts)
> - [game-web/src/utils/end-conditions.ts](file:///d:/code/codeWork/jintian-1851/game-web/src/utils/end-conditions.ts)
> - [server/runtime/fallback-factions.ts](file:///d:/code/codeWork/jintian-1851/server/server/runtime/fallback-factions.ts)
> - [server/runtime/fallback-events.ts](file:///d:/code/codeWork/jintian-1851/server/server/runtime/fallback-events.ts)

## 目录

- [核心数值体系](#核心数值体系)
- [身份与初始偏移](#身份与初始偏移)
- [起始状态](#起始状态)
- [势力列表与初始关系](#势力列表与初始关系)
- [事件池与权重分布](#事件池与权重分布)
- [历史剧情链（14 条脚本事件）](#历史剧情链14-条脚本事件)
- [结局判定规则](#结局判定规则)
- [综合实力 UI 展示规则](#综合实力-ui-展示规则)
- [危机预警阈值](#危机预警阈值)
- [文案规范](#文案规范)
- [设计原则与平衡说明](#设计原则与平衡说明)

---

## 核心数值体系

### 5 维属性（Attributes）

玩家势力以 5 维属性衡量综合实力，每维取值范围 0-100（崩溃阈值 ≤ 0，胜利阈值平均 ≥ 85）。

> **值域落地**：上限由 `stores/game.ts` 的 `applyEffects` 用 `ATTRIBUTE_MAX = 100` 夹住。
> 此前只加不夹，实测军事涨到 129 超出刻度、进度条溢出，且单维堆叠就能把加权平均抬过胜利线
> ——封顶前 200 局模拟胜率 99.5%，封顶后（阈值仍 90）掉到 48.5%，说明"必胜"其实是这个 bug 撑起来的。
> **下限刻意不夹**：属性允许累加到负数，由 `checkEndConditions` 判 `≤ 0` 崩溃，
> 保留真实赤字（`game-store.test.ts` 有断言锁住此行为）。封顶与阈值下调是同一次重新标定。

| 属性 | 字段 | 含义 | 影响维度 |
|---|---|---|---|
| 军事 | `military` | 军队战力、装备水平、将领素质 | 战斗胜负、叛乱镇压 |
| 经济 | `economy` | 财政收入、商业繁荣、税基厚薄 | 银两支撑、洋务兴办 |
| 政治 | `politics` | 吏治清明、政令通畅、官僚效率 | 决策执行、科举选拔 |
| 民心 | `people` | 百姓拥护、社会稳定 | 兵源补给、叛乱概率 |
| 外交 | `diplomacy` | 与列强、邻省、朝廷关系 | 战争干预、外援争取 |

### 4 项资源（Resources）

资源是属性的"燃料"，属性变化常伴随资源消耗。

| 资源 | 字段 | 含义 | 起始值 |
|---|---|---|---|
| 银两 | `silver` | 货币储备，用于购械、赈灾、行贿；**每回合按在编兵员发饷，归零触发破产惩罚** | 1000 |
| 兵员 | `troops` | 可调动兵力，影响军事行动规模 | 500 |
| 粮草 | `food` | 军粮民食，断粮会触发饥荒事件 | 800 |
| 名望 | `reputation` | 朝野声望，**0-100 封顶**，每回合 −3 衰减（人走茶凉）；影响 NPC 态度与结局史评 | 10 |

### 综合实力（Overall Power）

5 维属性的加权平均（政治/民心权重更高，体现"治世之要"），用于判定胜利结局：

```ts
overallPower = Σ(attr × POWER_WEIGHTS[attr]) / Σ(POWER_WEIGHTS)  // clamp 0-100
// POWER_WEIGHTS = { military: 1, economy: 1, politics: 1.3, people: 1.3, diplomacy: 1 }
```

> 权重定义见 `utils/constants.ts` 的 `POWER_WEIGHTS`（已落地，见 2026-08-07-weighted-overall-power）。等权退化：所有权重为 1 时等价于原等权平均。

---

## 身份与初始偏移

玩家开局从 5 类身份中选择其一，每类身份提供 5 维属性的初始偏移（基线 50）。

### BACKGROUND_PERKS 偏移表

| 身份 | military | economy | politics | people | diplomacy | 推荐势力 |
|---|---|---|---|---|---|---|
| 文官 | -5 | 0 | +10 | 0 | +5 | 清廷 |
| 武将 | +10 | 0 | -5 | +5 | 0 | 湘军 |
| 商贾 | 0 | +15 | -5 | 0 | +5 | 淮军 |
| 士绅 | -5 | 0 | +5 | +10 | 0 | 清廷 |
| 宗室 | -5 | 0 | +5 | 0 | +10 | 清廷 |

> 数据源：`useGameState.ts` 的 `BACKGROUND_PERKS` 常量。未列出的字段表示偏移为 0。

### 偏移设计理由

- **文官**：政治能力强、外交手腕熟，但缺乏军事经验
- **武将**：军事过硬、得军心，但不谙政治
- **商贾**：经济实力雄厚、善外交，但政治根基浅
- **士绅**：政治根基深、得民心，但军事薄弱
- **宗室**：外交与政治双优，但军事是短板（依赖朝廷兵权）

每类身份都有 1 项 +10/+15 强项、1 项 -5 弱项、1 项 +5 次强项，确保身份差异明显但不至于开局即崩盘。

---

## 起始状态

新存档起始状态（来自 `useGameState.initSave()`）：

```ts
state = {
  turn: 1,
  date: { year: 1851, month: 1 },  // 咸丰元年正月
  attributes: {
    military: 50 + perks.military,
    economy: 50 + perks.economy,
    politics: 50 + perks.politics,
    people: 50 + perks.people,
    diplomacy: 50 + perks.diplomacy
  },
  resources: { silver: 1000, troops: 500, food: 800, reputation: 10 }
}
```

- **时间起点**：1851 年（咸丰元年），与历史「金田起义」同年，首回合事件可触发历史剧情
- **回合机制**：**1 回合 = 1 年**，`date.year` 每回合 +1，`date.month` 保留但恒为 1
  （不删字段是为了让 6 处 zod schema、`eventDate` 结构、DB 已存 JSON 全部零变更）。
  剧情链锚点触发时服务端仍会下发 `eventDate` 做**时光跳跃**，但它的角色从"必需"降级为"补漏"——
  用于跨过两个锚点之间的空档年，日历本身每回合自己走 1 年
- **为什么从月改成年**：月钟下 200 局实测**没有任何胜利存档走到过 1872 年**
  （关链终局 p90=1854、开链 1865），因为中位 37 回合只推进 3 年多，年份几乎全靠跳跃前跳；
  `time_up`（year > 1912）因此是死代码。补历史锚点、加链首密度闸门、给胜利加年份门槛
  三个方向都被实测否掉（详见 `balance-regression.test.ts` 文件头），病灶是时钟本身
- **最大回合数**：约 62 回合走完 1851—1912（开链时因时光跳跃约 44 回合），到点即结算结局

---

## 势力列表与初始关系

### 6 个预置势力（FALLBACK_FACTIONS）

当 `init-factions` LLM 调用失败时，从 [fallback-factions.ts](file:///d:/code/codeWork/jintian-1851/server/server/runtime/fallback-factions.ts) 返回以下 6 个近代历史势力：

| 势力 ID | 名称 | 初始实力 (`initialPower`) | 简介 |
|---|---|---|---|
| `qing-ting` | 清廷 | 70 | 大清朝廷，中央集权虽衰，仍有正统之名与天下兵马调遣之权 |
| `xiang-jun` | 湘军 | 65 | 曾国藩创办之湖南团练，书生领兵，以宗族乡谊为纽带，征战十余年 |
| `huai-jun` | 淮军 | 60 | 李鸿章创办之安徽地方军，装备西化较早，掌北洋实权 |
| `tai-ping` | 太平天国 | 80 | 洪秀全领导的农民起义政权，定都天京，控江南半壁 |
| `bei-yang` | 北洋 | 75 | 袁世凯小站练兵所建新军，装备精良，为近代最强新式武装 |
| `ge-ming-dang` | 革命党 | 55 | 孙中山领导的兴中会、同盟会等反清革命力量，主张驱除鞑虏恢复中华 |

### 身份→推荐势力映射（BACKGROUND_RECOMMENDATION）

| 身份 | 推荐势力 | 关系加成 |
|---|---|---|
| 文官 | 清廷 | +30 |
| 武将 | 湘军 | +30 |
| 商贾 | 淮军 | +25 |
| 士绅 | 清廷 | +20 |
| 宗室 | 清廷 | +40 |

> `recommended: true` 字段供前端高亮推荐势力卡片。

### 初始关系矩阵（RELATIONSHIP_BASELINE）

每类身份对 6 个势力的初始关系（负数=敌对，正数=友好）：

| 身份 \ 势力 | 清廷 | 湘军 | 淮军 | 太平天国 | 北洋 | 革命党 |
|---|---|---|---|---|---|---|
| 文官 | 50 | 20 | 15 | -50 | 0 | -30 |
| 武将 | 20 | 50 | 30 | -40 | 25 | -20 |
| 商贾 | 10 | 10 | 50 | -30 | 20 | -10 |
| 士绅 | 40 | 30 | 20 | -60 | -10 | -40 |
| 宗室 | 80 | 30 | 20 | -70 | -20 | -60 |

**设计观察**：
- 太平天国对所有玩家身份均为负数（-30 ~ -70），是天然的敌对势力
- 革命党对所有玩家身份均为负数（-10 ~ -60），但商贾/武将相对温和
- 宗室与清廷关系最深（80），与革命党关系最差（-60）
- 商贾与淮军关系最深（50），与太平天国关系最差（-30，相对最温和）

### 势力状态（FactionStatus）

| 状态 | 含义 | 触发条件 |
|---|---|---|
| `active` | 活跃中，每回合 LLM 决策行动 | 初始状态 |
| `destroyed` | 已被消灭 | `power ≤ 0` 时由 `store.applyFactionSurvival()` 在回合结算末尾判定（`useTurn.endTurn` 3.7 步） |
| `allied` | 已结盟 | 玩家侧确定性外交按钮写入（`DIPLOMACY_RULES.setStatus`）；~~LLM 决策 `action: '结盟'` 且对方接受~~ **未实现** |

> **关于 destroyed 的触发源**：原设计写的是「由 NPC 行动结果触发」，但 NPC 行动的 `effects`
> 只作用于**玩家**的五维与资源，全链路没有任何地方修改其它势力的 `power`，所以那条路径无法落地。
> 现改为对**所有 power 来源**统一收口判定：玩家的外交按钮 / 离间（`powerDelta`，已 `Math.max(0,…)` 夹底）
> 与自由行动软性微调（±30）。此前 power 能被夹到 0 却无人判 destroyed，被打光的势力下一回合
> 照样进 NPC 决策列表、UI 也仍显示活跃——`DiplomacyPanel` 的 destroyed 分支（角标 / 禁用外交 /
> 禁用谈判信）一直是死代码，现在才真正生效。
>
> **只处理 `active`**：`allied` 势力即使实力归零也不判覆灭（结盟关系不应因数值波动单方面瓦解）。
> 服务端 `npc-actions` 按 `status === 'active'` 过滤，故状态一改，该势力自然不再行动，无需改服务端。

> `npc-actions` 接口仅对 `status === 'active'` 的势力生成行动，`destroyed`/`allied` 势力不参与。

---

## 事件池与权重分布

### 事件类型（EventType）

| 类型 | 含义 | 兜底池数量 |
|---|---|---|
| `民生` | 灾荒、瘟疫、水利、科举 | 12 条 |
| `军事` | 兵变、匪患、操练、边警 | 12 条 |
| `外交` | 列强、邻省、朝贡、教案 | 12 条 |
| `随机` | 异象、宝物、故人、奇书 | 12 条 |
| `历史剧情` | 英法联军、洋务、甲午等独立历史插曲 | 12 条 |
| `系统` | 回合结算自动产出（如银两 +50），非 LLM 生成、不入兜底池 | — |
| `npc` | NPC 行动记录（不作为玩家事件出现） | — |

兜底事件池共 **90 条**（5 类型 × 18 条，不含 `系统`/`npc`），数据源 [fallback-events.ts](file:///d:/code/codeWork/jintian-1851/server/server/runtime/fallback-events.ts)。
扩容 30 条时守两条规则：同类内主题不重复；至少 1/3 新事件以粮草/兵员为代价或收益
（否则 `resource-penalty` 的断粮/兵溃惩罚没有触发面，长局也碰不到粮尽）。

### MVP 阶段权重分布

MVP 阶段 `generate-event` 由 LLM 自主决定事件类型（**不预设权重**），但 prompt 引导倾向于「民生/军事/外交」3 类常规事件，历史剧情仅在特定年份触发，随机事件概率较低。

兜底池因每类型 18 条等量分布，类型命中概率均等（1/5，仅计 LLM 生成的 5 类；`系统` 为回合结算产出、`npc` 为势力行动记录，均不计入兜底命中概率）。

### 兜底事件清单

#### 民生类（12 条）

| 标题 | 选项数 | 典型 effects 范围 |
|---|---|---|
| 粮价飞涨 | 3 | people ±10, silver -200, reputation ±8 |
| 瘟疫蔓延 | 3 | people ±8, silver -150, diplomacy -4 |
| 水利失修 | 3 | people ±5, silver -100, economy -10 |
| 科举风波 | 3 | politics ±6, reputation ±8 |

#### 军事类（12 条）

| 标题 | 选项数 | 典型 effects 范围 |
|---|---|---|
| 兵饷拖欠 | 3 | military ±10, silver -300 |
| 匪患骤起 | 3 | military ±6, troops -50, reputation ±7 |
| 新军操练 | 3 | military ±12, silver -400 |
| 边警频传 | 3 | military ±8, troops -80, diplomacy ±8 |

#### 外交类（12 条）

| 标题 | 选项数 | 典型 effects 范围 |
|---|---|---|
| 列强施压 | 3 | diplomacy ±8, economy ±6, people -8 |
| 邻省求援 | 3 | diplomacy ±10, troops -300, food -100 |
| 朝贡使节 | 3 | diplomacy ±10, troops -100, reputation ±7 |
| 教案冲突 | 3 | diplomacy ±10, silver -500, people ±8 |

#### 随机类（12 条）

| 标题 | 选项数 | 典型 effects 范围 |
|---|---|---|
| 异星坠落 | 3 | people ±4, silver -50, reputation ±3 |
| 商人献宝 | 3 | economy ±8, silver +200, reputation -3 |
| 故人相访 | 3 | politics ±5, diplomacy ±3, silver -50 |
| 奇书现世 | 3 | politics ±6, economy ±3, silver -100 |

#### 历史剧情类（12 条，独立兜底事件）

> 与下方 [历史剧情链](#历史剧情链14-条脚本事件) 是两套互补系统：**本类为独立历史插曲（不携带 `chainId`）**，由 LLM 时间窗口/兜底触发；**剧情链为脚本化线性剧情**（携带 `chainId`，见新章节）。两者名称可能呼应同一历史事件，但实现完全独立，不冲突。以下为 12 条中的代表 4 条（其余为独立历史插曲）：

| 标题 | 选项数 | 典型 effects 范围 | 历史背景 |
|---|---|---|---|
| 天津教案 | 3 | diplomacy ±8, people ±6, silver -200 | 1870 天津教案 |
| 英法联军 | 3 | military ±6, troops -300, reputation ±10 | 1860 第二次鸦片战争 |
| 洋务兴起 | 3 | economy ±8, military ±6, silver -400 | 1861-1895 洋务运动 |
| 甲午风云 | 3 | military ±5, troops -400, reputation ±8 | 1894 甲午战争 |

### 事件选项设计原则

- 每事件 **2-4 个选项**（兜底池统一为 3 个）
- 每选项含 `effects: Partial<Attributes & Resources>`（属性与资源的子集）
- effects 数值范围 **±3 ~ ±15**，避免单回合剧烈波动
- 选项设计遵循「**风险-收益权衡**」原则：
  - 高收益选项必伴随资源消耗（如 `military +12` 但 `silver -400`）
  - 低风险选项效果温和（如 `military +2`）
  - 拖延/逃避选项常带负面效果（如 `military -10, people -3`）

---

## 历史剧情链（14 条脚本事件）

> 历史剧情链是扩充事件引擎（expand-event-engine）的核心：**脚本化、线性、零 LLM 成本**的历史剧情。与 [事件池](#事件池与权重分布) 的独立历史插曲互补，由 `generate-event` 的「三层触发优先级」中前两层（挂起节点 > 时间窗口）触发，**完全不消耗 LLM 额度**。
>
> 数据源：[server/runtime/story-chains.ts](file:///d:/code/codeWork/jintian-1851/server/server/runtime/story-chains.ts)（真值来源）；前端元数据镜像 [game-web/src/data/story-chains.ts](file:///d:/code/codeWork/jintian-1851/game-web/src/data/story-chains.ts)（仅 chainId/title/description/节点顺序，不含 effects）。

### 触发机制（三层优先级）

1. **挂起节点优先（pending-chain）**：玩家上一回合选择含 `nextChainNodeId` 的选项后，前端将下一个节点入队 `pendingChainNodes`（`scheduledTurn = 当前回合 +1`）。下一回合 `generate-event` 直接返回该节点事件，**不调 LLM**。
2. **时间窗口匹配（time-window）**：当前年份 `stateSnapshot.date.year` 命中某链 `startYear`，且该链未被 `completed`/`active`、其 `prerequisiteChainIds` 已全部 `completed` → 返回该链首节点，**不调 LLM**。同年份多链按 `startYear` 升序 + `chainId` 字典序选第一条。
3. **LLM 自主生成（llm）**：前两层都不满足时，才调 `generateObject()` 生成普通事件。

> 响应头 `X-Event-Source` 标注来源（`pending-chain` / `time-window` / `llm`），详见 [API 文档](./API.md)。

### 23 条剧情链总览

| # | chainId | 链名 | 触发年份 | 节点数 | 前置依赖 |
|---|---|---|---|---|---|
| 1 | `tai-ping-tian-guo` | 太平天国兴亡 | 1851 | 5 | — |
| 2 | `er-ci-ya-pian` | 第二次鸦片战争 | 1856 | 3 | — |
| 3 | `nian-jun-zhi-luan` | 捻军之乱 | 1853 | 3 | — |
| 4 | `tong-zhi-hui-luan` | 同治回乱 | 1862 | 3 | — |
| 5 | `yang-wu-yun-dong` | 洋务运动 | 1861 | 4 | — |
| 6 | `zuo-zong-tang-xin-jiang` | 左宗棠收复新疆 | 1865 | 4 | — |
| 7 | `liu-qiu-tai-wan` | 琉球台湾事件 | 1871 | 4 | — |
| 8 | `zhong-fa-zhan-zheng` | 中法战争 | 1883 | 3 | — |
| 9 | `jia-wu-zhan-zheng` | 甲午战争 | 1894 | 3 | `yang-wu-yun-dong` |
| 10 | `wu-xu-bian-fa` | 戊戌变法 | 1898 | 2 | — |
| 11 | `yi-he-tuan` | 义和团运动 | 1899 | 3 | `wu-xu-bian-fa` |
| 12 | `ri-e-zhan-zheng` | 日俄战争 | 1904 | 2 | — |
| 13 | `qing-mo-xin-zheng` | 清末新政 | 1901 | 3 | `yi-he-tuan` |
| 14 | `xin-hai-ge-ming` | 辛亥革命 | 1911 | 3 | `qing-mo-xin-zheng` |
| 15 | `min-yong-gong-shang` | 民用工矿与商股 | 1872 | 3 | `yang-wu-yun-dong` |
| 16 | `tong-zhi-guang-xu` | 同光接替 | 1874 | 3 | `tong-zhi-hui-luan` |
| 17 | `yan-tai-tiao-yue` | 滇案与烟台条约 | 1875 | 2 | `er-ci-ya-pian` |
| 18 | `ding-wu-qi-huang` | 丁戊奇荒 | 1876 | 3 | — |
| 19 | `ren-wu-jia-shen` | 朝鲜壬午甲申 | 1882 | 3 | — |
| 20 | `jia-shen-yi-shu` | 甲申易枢 | 1884 | 2 | `yang-wu-yun-dong` |
| 21 | `zhong-gu-ao-men` | 中葡北京条约 | 1887 | 2 | — |
| 22 | `guang-xu-da-hun` | 大婚与亲政 | 1889 | 2 | `jia-shen-yi-shu` |
| 23 | `xing-zhong-hui` | 兴中会前夜 | 1892 | 2 | — |

> **15—23 与 6/7 的后补节点是为填两段历史断档加进来的**。原 14 条链的锚点年份
> （1851/1853/1856/1861/1862/1865/1871/1883/1894/1898/1899/1901/1904/1911）里
> **1872—1882（11 年）与 1884—1893（10 年）完全空白**。补齐后最大断档从 12 年降到 7 年
> （1904→1911）。仍缺的三段见本节末尾"未做"。

### 节点明细（线性链，箭头表示 nextNodeIds）

1. **太平天国兴亡**（1851，5 节）：金田起义 → 定都天京 → 天京事变 → 安庆失守 → 天京陷落
2. **第二次鸦片战争**（1856，3 节）：亚罗号事件 → 大沽口之战 → 北京条约
3. **捻军之乱**（1853，3 节）：捻军起事 → 曾国藩督师 → 捻军覆灭
4. **同治回乱**（1862，3 节）：陕甘回乱起 → 左宗棠平乱 → 收复西北
5. **洋务运动**（1861，4 节）：总理衙门设立 → 江南制造局 → 北洋水师成军 → 甲午战败
6. **左宗棠收复新疆**（1865，4 节）：阿古柏入侵 → 海防塞防之争 → 收复伊犁 → 新疆建省
7. **琉球台湾事件**（1871，4 节）：牡丹社事件 → 北京专条 → 废琉置县 → 台湾建省
8. **中法战争**（1883，3 节）：越南冲突 → 马尾海战 → 镇南关大捷
9. **甲午战争**（1894，3 节，前置洋务运动）：朝鲜东学党 → 黄海海战 → 马关条约
10. **戊戌变法**（1898，2 节）：明定国是 → 戊戌政变
11. **义和团运动**（1899，3 节，前置戊戌变法）：义和团兴起 → 八国联军 → 辛丑条约
12. **日俄战争**（1904，2 节）：旅顺攻防 → 朴茨茅斯和约
13. **清末新政**（1901，3 节，前置义和团运动）：庚子后变法 → 立宪运动 → 皇族内阁
14. **辛亥革命**（1911，3 节，前置清末新政）：武昌起义 → 南北议和 → 清帝退位
15. **民用工矿与商股**（1872，3 节，前置洋务运动）：轮船招商局 → 电线与开平矿务 → 上海倒款风潮
16. **同光接替**（1874，3 节，前置同治回乱）：同治帝崩 → 光绪即位 → 帝师进讲
17. **滇案与烟台条约**（1875，2 节，前置第二次鸦片战争）：马嘉理案 → 烟台条约
18. **丁戊奇荒**（1876，3 节）：晋陕赤地 → 易子而食 → 捐纳与吏治
19. **朝鲜壬午甲申**（1882，3 节）：壬午兵变 → 甲申政变 → 朝鲜派兵合同
20. **甲申易枢**（1884，2 节，前置洋务运动）：恭亲王罢 → 枢臣平庸边事棘
21. **中葡北京条约**（1887，2 节）：永管澳门之议 → 界址终未勘定
22. **大婚与亲政**（1889，2 节，前置甲申易枢）：皇帝大婚 → 亲政犹训政
23. **兴中会前夜**（1892，2 节）：上书不遇 → 檀香山集会

> **与洋务链的分工**：`yang-wu-yun-dong` 讲军工厂局与海军（江南制造局/北洋水师），
> `min-yong-gong-shang` 讲民用商股与市面（招商局/电报矿务/钱庄倒款）。两条链的第二节年代相邻，
> 文案刻意用「军用 / 民用」区别，避免出现同一主题读两遍。

> **前置依赖（9 组）**：`jia-wu-zhan-zheng` → `yang-wu-yun-dong`；`yi-he-tuan` → `wu-xu-bian-fa`；`qing-mo-xin-zheng` → `yi-he-tuan`；`xin-hai-ge-ming` → `qing-mo-xin-zheng`；`min-yong-gong-shang` → `yang-wu-yun-dong`；`tong-zhi-guang-xu` → `tong-zhi-hui-luan`；`yan-tai-tiao-yue` → `er-ci-ya-pian`；`jia-shen-yi-shu` → `yang-wu-yun-dong`；`guang-xu-da-hun` → `jia-shen-yi-shu`。未满足前置时该链不会在时间窗口触发，玩家需先完成前置链。
>
> ⚠️ **新增的 5 组前置只作用于本次新加的链，刻意没给任何既有链补前置**：给已上线的链加前置会改变它的触发时机（原本到年份即触发，改后须等前置跑完），那是行为变更而不是补内容。
>
> **末节点（isLastNode）**：每条链最后一节 `nextNodeIds` 为空，玩家完成该节后链进入 `completedChainIds`，不再触发。

### 存档与前端展示

- **存档（v2）**：`GameSave` 新增 `pendingChainNodes` / `completedChainIds` / `activeChainIds` 三个数组，记录剧情链运行时状态；历史事件 `events` 额外携带 `chainId` / `chainNodeId`。
- **EventCard**：剧情事件顶部显示角标「剧情 X/Y」（如「太平天国兴亡 · 2/5」），背景 `#8B1A1A` 白字。
- **FocusPanel**：`pendingChainNodes` 非空时显示「剧情待续」提示条（背景 `#FFF8E1`，书卷图标，可点击展开链名/进度/简介/下节标题）。
- **TurnTimeline**：含 `chainId` 的历史事件左侧显示书卷图标（替代普通圆点），`v-tooltip` 长按/hover 显示剧情链名。

---

## 结局判定规则

### 判定优先级

结局判定按以下优先级执行（数据源 [end-conditions.ts](file:///d:/code/codeWork/jintian-1851/game-web/src/utils/end-conditions.ts)）：

```ts
function checkEndConditions(save): EndReason {
  // 1. 属性崩溃（任一 ≤ 0）—— 最高优先级，不可恢复的失败，立即结束
  if (attributes.military <= 0) return 'military_collapse'
  if (attributes.economy <= 0) return 'economy_collapse'
  if (attributes.politics <= 0) return 'politics_collapse'
  if (attributes.people <= 0) return 'people_collapse'
  if (attributes.diplomacy <= 0) return 'diplomacy_collapse'

  // 2. 走到 1912 年之后才结算结局（1 回合 = 1 年，中途不结束游戏）
  if (date.year > 1912) {
    const zenithLocked = save.zenithYear !== undefined
    return zenithLocked || calcOverallPower(attributes) >= 85 ? 'victory' : 'time_up'
  }

  // 3. 继续游戏
  return 'continue'
}
```

**「中兴已定」锁定**：综合实力**首次**达到 `VICTORY_THRESHOLD` 时，`useTurn` 把当年写进
`save.zenithYear` 并在时间线播一条系统事件，**但游戏继续**——终局仍要走到 1912 年结算。
这样既保住"冲到极盛"的爽点，又让六十年真的被玩完（旧规则下实测 200 局全部第 22 回合必胜、
终局 1865 年，后面 47 年根本没机会走）。

### 判定阈值

| 阈值 | 值 | 含义 |
|---|---|---|
| `VICTORY_THRESHOLD` | 85 | 综合实力 ≥ 85 即锁定「中兴」；结算时（或曾锁定）判 `victory` |
| `TIME_UP_YEAR` | 1912 | 年份 > 1912 触发结算：达标/曾锁定 → `victory`，否则 → `time_up` |
| 属性崩溃线 | 0 | 任一属性 ≤ 0 触发对应崩溃（立即结束，不等结算） |

### 优先级设计理由

1. **属性崩溃优先于一切**：崩溃是不可恢复的失败，不因"还没走到 1912"而被救回
2. **胜利与时光尽头互斥**：它们是同一次结算的两种结果（达标 / 未达标），不再存在"胜利优先于时光尽头"这回事
3. **1912 结算是兜底**：时间硬上限保证游戏必能结束（年钟下约 62 回合，开链因时光跳跃约 44 回合）

### 7 种结局类型

| EndReason | 中文标签 | 详细文案 | 失败/胜利 |
|---|---|---|---|
| `military_collapse` | 军备崩溃 | 军力耗尽，无以御敌，势力遂亡于刀兵之间。 | 失败 |
| `economy_collapse` | 经济崩塌 | 财政枯竭，府库空虚，势力遂亡于匮乏之中。 | 失败 |
| `politics_collapse` | 政治瓦解 | 政令不通，纲纪废弛，势力遂亡于内乱之中。 | 失败 |
| `people_collapse` | 民心尽失 | 民怨沸腾，众叛亲离，势力遂亡于民心尽失。 | 失败 |
| `diplomacy_collapse` | 外交断绝 | 四面楚歌，孤立无援，势力遂亡于外交断绝。 | 失败 |
| `victory` | 中兴大业 | 历六十年而势不坠，运筹帷幄，终成中兴大业，名垂青史。 | 胜利 |
| `time_up` | 时光尽头 | 六十年光阴走尽，实力未足以言中兴，大清命数已终，后世自有评说。 | 中性 |

> `isFailureEnd(reason)` 判定：`reason !== 'victory' && reason !== 'time_up'` 即为失败，用于结局页面 UI 配色（失败红色 / 胜利金色 / 时光尽头灰蓝）。
> 年钟下 `time_up` 的语义已从"没输没赢的中性收尾"变成**"走完全程但未成中兴"**——刻意仍归为"非失败"
> （没崩盘也算走完一代人），但配色与文案要让人读出这是遗憾，不是平局。

### 史评档位（名望 → 结局评价，不参与判定）

结局页在 7 种结局之上再叠一层「史评」，由玩家终局名望决定（`getHistoryRating`）：

| 名望下限 | 称号 | 评语 | 实测占比（600 局，年钟） |
|---|---|---|---|
| ≥ 78 | 天下归心 | 口碑载道，四方望风而归。 | ~9% |
| ≥ 60 | 朝野称望 | 名动京师，士民称贤。 | ~30% |
| ≥ 42 | 声名平平 | 无功无过，时人评价不一。 | ~25% |
| ≥ 22 | 物议沸然 | 非议四起，信誉渐失。 | ~16% |
| 其余 | 身败名裂 | 口碑崩坏，为天下笑。 | ~20% |

> 划线随「1 回合 = 1 年」重标过一次：月钟下的 85/65/40/20 在年钟下会把五档压成两档
> （开链组实测 0%/36%/64%/0%/0%）。合并分位 p10=9 / 中位=54 / p90=77。
> **刻意没动 −3/回合 的衰减率**：降到 −2 会让分布整体上移约 63 点、全员撞 100 封顶——
> 衰减与增益是同一架天平的两端，改时钟时只能重划刻度，不能单边改数值。

**为什么只展示、不参与胜利判定**：实测把名望计入 `calcOverallPower`（权重取 0.2 / 0.3 / 0.5 / 1.0）
会把 200 局胜率从 **95.5% 抬到 99.5%~100%**，`time_up` 与崩溃结局几乎消失——
名望的量级（封顶前终局中位 162）远高于属性的 0-100 刻度，计入等于系统性抬高综合实力。
名望要真正参与胜负，得先重做它的量级与阈值标定，那是平衡重构，不是接通一个字段。

**同一张档位表也被后端 NPC 使用**：`server/server/utils/reputation-bands.ts` 镜像本表并附带一句
`npcStance`（态度倾向），注入每个 NPC 的 system prompt，兑现设计里「影响 NPC 态度」。
注入只偏置意图与文案、不改数值结算（与势力记忆的处理方式一致）；
两份表由 `game-web/tests/unit/mirror-consistency.test.ts` 深比较防漂移。

### 历史进程档位（剧情链完成度 → 结局评价，同样不参与判定）

结局页在「史评」之下再叠一层**历史进程**（`getChainCompletion` + `getChainTier`），
把玩家实际走完的剧情链当作结局叙述的一部分：

```
亲历 5/6 段史事（至 1865 年） · 半壁经行
太平天国兴亡 · 捻军之乱 · 第二次鸦片战争 · 洋务运动 · 同治回乱
另有 1 段未及收束
```

| 比例下限 | 称号 | 评语 |
|---|---|---|
| ≥ 0.8 | 亲历全局 | 凡当世大事，皆身与其间。 |
| ≥ 0.5 | 半壁经行 | 大势已动，而未尽处尚多。 |
| < 0.5 | 未竟之局 | 史册翻到一半便合上了，余下的留给旁人。 |

**分母刻意不是"23 条链"**，而是**终局年份之前（含当年）可达的链数**：
剧本按年代逐条解锁，22 回合赢在 1865 的人本来就碰不到 1894 以后的链。
用 23 当分母等于惩罚"通关太快"，而同样的经历在走到 1912 的存档上会算出完全不同的等级——
那是口径错误，不是难度。

**可达链数 < 3 时不给称号**：1/1 = 100% 这种"满级"毫无信息量，只会把开局没几回合的存档吹成完人；
一条也没完成时同样不分级，此时结局页只显示原始数字。

**为什么也不参与胜利判定**（与名望同一条理由链）：实测若把完成度当胜利门槛，
「关链」的模拟路径 `chainsCompleted` 恒为 0，胜率会直接归零，86.0% 这条基线整条作废。
更重要的是逻辑反了——链是**奖励**（节点 effects 远大于兜底事件），
用"你吃了多少奖励"当 KPI 只会逼人拖着不完成链来保住胜利。
真要治"22 回合定局"，工具是**链的密度闸门**（事件下发侧），不是结局侧的门槛。

数据源：`save.completedChainIds` / `activeChainIds`（存档 v2 起就有，旧档由迁移补空数组），
链名与 `startYear` 取自前端镜像 `src/data/story-chains.ts`，与后端逐字段由
`mirror-consistency.test.ts` 守卫。**派生值不落库**，所以老存档打开结局页也能立刻算出来。

### EndReason 与 EndedReason 类型分层

```ts
// 完整类型（含 'continue'，用于判定函数返回值）
type EndReason = 'continue' | 'military_collapse' | ... | 'time_up'

// 已触发结局类型（排除 'continue'，用于 GameSave.endedReason 字段）
type EndedReason = Exclude<EndReason, 'continue'>
```

`GameSave.endedReason` 字段类型为 `EndedReason | undefined`：
- `ended === false` 时 `endedReason` 为 `undefined`
- `ended === true` 时 `endedReason` 必为 7 种结局之一

---

## 综合实力 UI 展示规则

综合实力在 UI 上通过两个组件展示，互补无冗余。数据源均为 [goal-hint.ts](file:///d:/code/codeWork/jintian-1851/game-web/src/utils/goal-hint.ts) 的 `calcOverallPower()` 与 `VICTORY_THRESHOLD=90`。

### FocusPanel（顶部常驻）

源码：[FocusPanel.vue](file:///d:/code/codeWork/jintian-1851/game-web/src/components/FocusPanel.vue)

| 元素 | 规则 |
|---|---|
| 综合实力进度条 | `Math.round(overallPower)` 显示为 `XX/100`，`overallPercent` 取 `clamp(0, 100, overallPower)` 作为进度条宽度 |
| 危机行 | 仅当 `getCrisis(attributes)` 非 null 时渲染，红色高亮，文案 `{属性名} {当前值}（濒临崩溃）` |
| 本回合建议 | 优先用 AI 简报（`advisor-briefing` 返回的 `suggestion`）；AI 失败/降级时回退规则建议（`generateFocusHint` 生成） |
| 胜利高亮 | `overallPower >= VICTORY_THRESHOLD`（当前 85）时进度条变金色（`isVictory` computed） |
| 剧情待续条 | `pendingChainNodes` 非空时渲染，浅米黄背景 `#FFF8E1` + 书卷图标 + 数量徽标（如「1 条」），点击展开链名/进度/简介/下节标题（`max-height` + `transition` 过渡） |

### GoalPanel（底部可折叠，默认折叠）

源码：[GoalPanel.vue](file:///d:/code/codeWork/jintian-1851/game-web/src/components/GoalPanel.vue)

| 元素 | 规则 |
|---|---|
| 长期目标 | 固定文案「成就霸业（1851-1912）」 |
| 胜利条件 | 文案由 `VICTORY_THRESHOLD` 常量渲染（当前 85），不再硬编码 |
| 失败条件 | 固定文案「任一属性 ≤ 0」 |
| 综合实力进度条 | 与 FocusPanel 同源 `overallPower`；GoalPanel **不画阈值刻度线**，只列「综合实力 ≥ `VICTORY_THRESHOLD`」文字行（数字取常量） |
| InfoHint | 综合实力行附 InfoHint，hover/tap 显示 `TERM_EXPLANATIONS.overallPower` 解释文案 |

### EventCard 剧情进度角标

源码：[EventCard.vue](file:///d:/code/codeWork/jintian-1851/game-web/src/components/EventCard.vue)

当事件携带 `chainId` + `chainProgress` 时（即来自 [历史剧情链](#历史剧情链14-条脚本事件) 的脚本事件），顶部显示剧情进度角标：

| 元素 | 规则 |
|---|---|
| 角标文案 | 手机端「剧情 X/Y」（如「剧情 2/5」）；平板端（`sm:`）扩展为「{链名} · X/Y」（如「太平天国兴亡 · 2/5」） |
| 角标样式 | 背景 `#8B1A1A`，白字，字号 `24rpx`，圆角 `8rpx`，padding `8rpx 16rpx` |
| 链名 | 顶部左侧显示剧情链中文名（来自前端元数据镜像 `CHAIN_LABELS`），字号 `28rpx`，颜色 `#5C4030` |
| 普通事件 | 无 `chainId` 时不显示角标与链名，渲染与 MVP 一致 |

> 角标数据由 `generate-event` 在剧情链事件响应中注入（`chainId` / `chainNodeId` / `chainProgress`），前端仅展示，不自行计算剧情逻辑。

### 进度条阈值刻度设计

- **胜利阈值刻度线只在 `FocusPanel` 渲染**（GoalPanel 不画刻度，只列胜利条件文字行）
- 刻度位置 `left: thresholdPercent`、数字标签同为 `VICTORY_THRESHOLD`（现值 85），
  两处都取常量。此前 CSS 写死 `left: 90%`，阈值下调到 85 后刻度就指错了位置，已修
- FocusPanel 与 GoalPanel 共用 `VICTORY_THRESHOLD=90` 常量，避免硬编码不一致

---

## 危机预警阈值

源码：[goal-hint.ts](file:///d:/code/codeWork/jintian-1851/game-web/src/utils/goal-hint.ts) 的 `getCrisis()` + [useTurn.ts](file:///d:/code/codeWork/jintian-1851/game-web/src/composables/useTurn.ts) 的 `onCrisis` 回调。

### 阈值定义

| 常量 | 值 | 含义 |
|---|---|---|
| `CRISIS_THRESHOLD` | 30 | 属性 < 30 触发危机预警 |
| `VICTORY_THRESHOLD` | 85 | 综合实力 ≥ 85 触发胜利 |

> 注意：危机阈值 30 与崩溃阈值 0 是两个不同概念。30 是「预警线」（提示玩家优先应对），0 是「崩溃线」（直接失败结局）。

### getCrisis 算法

```ts
function getCrisis(attributes: Attributes): Crisis | null {
  // 遍历 5 维属性，返回 <30 中最低者
  // 多个 <30 时取最低；无 <30 返回 null
  let crisis = null
  for (const key of ['military', 'economy', 'politics', 'people', 'diplomacy']) {
    if (attributes[key] < 30) {
      if (crisis === null || attributes[key] < crisis.value) {
        crisis = { attr: key, name: ATTR_NAMES[key], value: attributes[key] }
      }
    }
  }
  return crisis
}
```

**取最低项的设计理由**：当多个属性同时 < 30 时，玩家面对多个红色警告会无所适从。取最低项让玩家聚焦「最危急的那一个」，符合「一次只让玩家做一个决策」的 UX 原则。

### 触发链路

1. `useTurn.startTurn` 内 `generate-event` 成功后调用 `getCrisis(state.attributes)`
2. 若返回非 null，触发 `onCrisis(crisis)` 回调
3. game-main 的 `onCrisis` 回调调 `toast.warning(\`${crisis.name} ${crisis.value}（濒临崩溃，建议优先应对）\`)`
4. 同时 FocusPanel 危机行渲染（红色高亮），GoalPanel 不重复提示

### Toast 行为

- **类型**：`toast.warning`（非 error，避免过度警示）
- **文案**：`{属性中文名} {当前值}（濒临崩溃，建议优先应对）`，如「军事 15（濒临崩溃，建议优先应对）」
- **duration**：默认 3000ms（ToastContainer 默认值），到时自动消失
- **触发频率**：每回合开始时检查一次（不会重复触发，除非进入新回合且属性仍 <30）

### 与结局判定的关系

- 危机预警（< 30）**不会**直接触发失败结局，仅是提示
- 属性 ≤ 0 时才触发对应崩溃结局（`military_collapse` 等），见 [结局判定规则](#结局判定规则)
- 玩家收到危机预警后仍有 1-N 回合反应时间（取决于属性下降速度），是「软提示」而非「硬失败」

---

## 文案规范

源码：[copywriting.ts](file:///d:/code/codeWork/jintian-1851/game-web/src/utils/copywriting.ts)。本节明确功能性文案与剧情文案的边界，避免风格混乱。

### 风格边界

| 文案类型 | 风格 | 示例 | 来源 |
|---|---|---|---|
| **功能性文案** | 白话为主，新手秒懂 | 「开始游戏」「确认决策」「网络连接失败，请检查网络」 | `BUTTON_TEXT` / `ERROR_TEXT` / `PAGE_TEXT` |
| **剧情文案** | 古风点缀，营造氛围 | 「运筹帷幄，决胜千里，终成中兴大业，名垂青史。」（victory 结局） | `end-conditions.ts` END_REASON_DETAILS |
| **混合文案** | 白话主体 + 古风术语 | 「局势推演中…」「优先应对军事危机」 | `PHASE_HINTS` / FocusPanel suggestion |

### 判定原则

1. **玩家每次看到的 UI 元素**（按钮、标签、提示、错误、空状态）→ 白话
2. **AI 生成的剧情内容**（事件描述、结局文案、军师对话）→ 古风
3. **术语首次出现**→ 附 InfoHint 白话解释（如「综合实力」旁带 `?` 图标，hover/tap 显示 `TERM_EXPLANATIONS.overallPower`）
4. **错误文案**→ 白话 + 技术错误码仅 `console.error`（不展示给玩家），见 `ERROR_TEXT`

### effects 标签规范

- 用完整词：「军事 +10」「银两 -100」
- 禁止单字缩写：「军 +10」「银 -100」
- 数据源：`EFFECT_LABELS` 映射表（`military → '军事'`、`silver → '银两'` 等 9 项）
- DecisionButton / NpcActionList 等组件统一从 `EFFECT_LABELS` 取标签，禁止局部硬编码

### 集中管理原则

- 所有面向玩家的文案必须集中在 `copywriting.ts`，禁止组件内硬编码
- 术语解释集中在 `TERM_EXPLANATIONS`，与 help 页百科内容保持一致
- 新增文案时先在 `copywriting.ts` 添加常量，再在组件中引用

### 阶段提示（PHASE_HINTS）规范

| 状态 | 文案 | 说明 |
|---|---|---|
| 等待决策 | `选择一个应对方案，或自己描述想做的事` | 引导新手 |
| 决策完成 | `决策已定，进入下一回合` | 简洁反馈 |
| 推演中 | `局势推演中…` | 古风术语 + 省略号表进行时 |
| 危机追加 | `，{attr}濒临崩溃，建议优先应对` | 拼接在阶段提示后，attr 为属性中文名 |

---

## 设计原则与平衡说明

### 1. 数值张力设计

- **5 维属性 0-100**：单一属性可从 50（起始）波动到 0（崩溃）或 100（满值），跨度 50
- **综合实力 0-100**：5 维的**加权**平均（`politics` / `people` 权重 1.3，军事/经济/外交 1.0，
  见 `game-web/src/utils/constants.ts` 的 `POWER_WEIGHTS`；治世之要偏向政治与民心），
  五维都是起始 50 时加权结果仍为 50。胜利阈值 `VICTORY_THRESHOLD = 85`，即需**净提升 35 点**
  ——旧版本此处写「40 点达到 90」，是阈值下调到 85 之后没跟着改（那次下调当时没有提案记录）
- **实测落点**：年钟 200 局严格基线（LLM 完全不可用、含外交、关链）终局 `avgPower = 89.3`，
  开链组 `= 92.5`；数字出处 `game-web/tests/unit/balance-regression.test.ts`（文件头记录了
  每组基线与它们各自的适用前提，跨时钟不可直接比较）
- **单回合 effects ±3~15**：5 回合可累积 ±25~75 点变化，足以改变属性走向
- **资源 1000/500/800/10**：足够支撑 10-20 回合常规消耗。**资源下限托底 0**（`applyEffects` 里
  `Math.max(0, …)`）——士兵/粮草/银两为负在物理上不成立，此前模拟实测银两可跌到 -850 且毫无后果。
  每回合毛产出为 `TURN_YIELD = { silver: 50, troops: 15, reputation: -3 }`，但**银两入账的是净额**
  （要扣养饷，见下）；**粮草刻意不给产出**，因为 200 局模拟显示全局粮草最低 160（起始 800），
  现有内容里几乎没有粮草压力，给它加产出只是把一个死数字涨得更快。原设计所说「超出后需通过事件补充」
  的正向补给事件至今一条都没有（内容里 food/troops 出现 43 次全是负向），属内容缺口。
- **养饷（兵多则饷重）**：`养饷 = ceil(兵员 / 100) × TROOP_UPKEEP_SILVER_PER_100`（当前 K=4），
  `净银两 = 50 − 养饷`。兵员 500 → 饷 20 → 净 +30；兵员 1300 → 饷 52 → **净 −2**，财政倒挂。
  此前兵员只有「事件扣数」和「+15/回合 产出」两条线，养大军毫无成本；实测**直接扣兵员几乎无效**
  （扣 10/回合 被 +15 产出整个吃掉，结局分布与不扣完全相同），所以改成对银两的联动。
  K 的标定曲线（200 局实测）：K=2/3→90.0%、**K=4→86.0%**、K=5→69.5%、K=6→59.0%、K=8→19.5%。
  K=4 时均饷 29.1 银/回合、对 +50 仍留 ~21 净余量；再往上余量迅速吃光，调 K 必须重跑 `balance-regression`。
- **名望封顶 100 + 每回合 −3 衰减**：名望此前不夹上限，200 局实测终局中位 162、最高 305，
  完全脱离「朝野声望 0-100」的刻度语义。单加封顶会让 200 局 100% 撞顶（档位区分度归零），
  所以封顶必须配衰减；−3/回合 实测终局 min=0 / p10=23 / 中位=59 / p75=74 / p90=88 / max=100，
  五个史评档位因此得到 约 12% / 28% / 35% / 15% / 10% 的分布。
  副作用：结盟/离间要花 10 点名望，衰减后攒够更难——属预期（名望本就该稀缺）。
- **资源枯竭惩罚**（[resource-penalty.ts](file:///d:/code/codeWork/jintian-1851/game-web/src/utils/resource-penalty.ts)，每回合结算各判一次）：

  | 触发 | 代价 | 判定时点 |
  |---|---|---|
  | `food ≤ 0` | 民心 −3、军事 −2（饥荒） | 产出**之后**（本回合补上就不算断） |
  | `troops ≤ 0` | 军事 −3（溃散） | 产出**之后** |
  | `silver ≤ 0` | 经济 −3、民心 −2（破产加赋） | 产出**之前** |

  破产为何时点相反：赋税是净正数入库，放在产出之后判定的话只要净产出 >0 就**永远触发不了**
  ——实测那样 K=4 胜率仍是 95.5%（惩罚形同不存在），而 K 要能咬人只能调到 6，一步跳到 59.0%，
  是阶跃不是梯度。语义依据：月初府库已空意味着本月已经靠加赋/赊欠撑过来，损伤既成事实，
  月底补税不能倒推抹掉。这条惩罚让 `economy_collapse` 结局第一次真的出现（此前 200 局 0 次）。

### 2. 失败概率平衡

- **5 种属性崩溃结局**：玩家需同时维持 5 维属性 > 0，任一崩盘即败
- **优势身份**：宗室与文官政治属性高（60/55），政治崩溃风险低
- **劣势身份**：武将与士绅军事属性低（45），军事崩溃风险高（需通过「新军操练」「兵饷拖欠」事件补强）

### 3. 胜利路径多样

- **军事胜利路径**：武将身份 + 湘军势力，专注军事事件 → 综合实力 90
- **经济胜利路径**：商贾身份 + 淮军势力，专注洋务兴办 → economy + military 双驱动
- **外交胜利路径**：宗室身份 + 清廷势力，专注朝贡/列强事件 → diplomacy + politics 双驱动

### 4. 历史沉浸感

- 6 个势力对应真实历史势力（清廷/湘军/淮军/太平天国/北洋/革命党）
- 4 个代表性历史剧情（兜底池示例）锚定真实时间点（1851 金田 / 1860 英法 / 1861-1895 洋务 / 1894 甲午）
- 1851-1912 时间跨度覆盖晚清主要历史节点

### 5. 后续平衡方向

MVP 阶段不引入复杂平衡机制，后续可考虑：

- **事件权重动态调整**：根据玩家属性短板提高对应类型事件出现率（如 military < 30 时军事事件 +20% 概率） —— **已落地（见 2026-08-07-event-weight-dynamic-adjust）**：前端计算 `attributeShortfall`（值 < `CRISIS_THRESHOLD`=30）随 `generate-event` 请求传入，后端提示词以软偏好（约 +20%）引导 LLM 优先补短板
- **NPC 行动反馈**：NPC 行动 effects 累计影响玩家属性，避免 NPC 行动孤立 —— **已落地（见 2026-08-06-npc-action-cumulative-impact）**：`NpcActionList` 顶部新增"本回合累计影响"汇总卡
- **资源产出机制**：每回合自动产出少量资源（如 silver +50/turn），避免长期消耗后无解 —— **已落地（见 2026-08-07-resource-per-turn-yield）**：`endTurn` 结算时 `calcTurnYield()` 返 `{ silver: 50 }` 经 `applyEffects` 入账，并以 `eventType:'系统'` 历史事件记录于 timeline
- **加权综合实力**：引入 `politics` 与 `people` 权重更高（治世之要），引导玩家注重内政 —— **已落地（见 2026-08-07-weighted-overall-power）**：`calcOverallPower` 改 `Σ(attr×w)/Σ(w)` 加权平均，`POWER_WEIGHTS = { politics: 1.3, people: 1.3, 其余 1.0 }`，阈值常量收口 `constants.ts`

---

### 6. 玩家主动外交（PLAYER_DIPLOMACY）

玩家可在回合内通过「外交」面板主动对 NPC 势力发起操作，弥补此前只能被动响应外交事件的缺口（关联提案 `2026-08-07-player-active-diplomacy`）。

**6 个动作（前端确定性规则，来源 `DIPLOMACY_RULES`）**：

| 动作 | 关系门槛 | 资源成本 | 确定性效果 |
|---|---|---|---|
| 结盟 | relationship ≥ 50 | 银两 -100、名望 -10 | relationship +30（cap 100），status = 'allied' |
| 宣战 | 无 | 兵员 -100 | relationship = -100（敌对，下回合 NPC 转挑衅/备战） |
| 行贿 | 无 | 银两 -80 | relationship +15（cap 100） |
| 通商 | 无 | 银两 -50 | relationship +10（cap 100），名望 +5 |
| 离间 | 无 | 银两 -60、名望 -10 | 目标 power -20（削弱；数据模型无势力间关系，故落地为削 power） |
| 质子 | 无 | 兵员 -50 | relationship +20（cap 100） |

**约束**：
- 每回合最多 1 次外交行动（`MAX_DIPLOMACY_PER_TURN = 1`，`diplomacyUsedThisTurn` 运行时守卫，`useTurn.startTurn` 开头重置）。
- 门槛/资源不足时按钮禁用（UI 预校验 + store 二次校验防绕过）。
- 外交为「次级操作」：独立于事件决策与 `hasDecided`，但 `isProcessingTurn` 为真时禁用。
- 改 `relationship`/`status`/`power` 后，下回合 NPC Agent 基于新值反应（敌对<-30 转挑衅/备战，友好>30 转外交/结盟），**后端无改动**。
- 每次外交行动追加 `eventType: '外交'` 历史事件（复用 `TurnTimeline` 的「外交」badge，靠 title + playerChoice 区分）。

### 6.1 谈判（写信，faction-negotiation）

除 6 个确定性按钮外，玩家可对单个势力「写信谈判」：以自然语言与势力 Agent 议价（`POST /api/game/faction-negotiate`，关联提案 `2026-08-18-faction-negotiation`）。外交面板每势力卡片有「写信谈判」入口，弹窗内完成全流程。

**两阶段状态机（单次谈判最多 2 次 AI 调用）**：
1. **letter（写信）**：玩家写信（1-200 字）→ Agent 以势力人格回信，表态 `accept`（应允）/ `reject`（拒绝）/ `counter`（还价，附表内条件与区间内定价）。
2. **settle（裁定，仅 counter 后可达）**：玩家「接受条件」或「还价」（仅主资源银两，区间 `[floor(下限×0.5), 原价]`）→ Agent 最终裁定 accept/reject，**不再提新条件**；玩家也可「放弃」（不调 AI，谈判结束）。

**条件兑换表 `NEGOTIATION_DEALS`（4 条议价版交易，前后端镜像）**：

| deal | 标签 | 关系门槛 | 价格区间（银两） | 效果区间 |
|---|---|---|---|---|
| `gift-deal` | 馈赠通好 | 无 | 60~120 | 关系 +10~+20 |
| `trade-deal` | 互市通商 | ≥ 0 | 40~80 | 关系 +8~+15，名望 +3~+5 |
| `truce-deal` | 破财止战 | ≤ -30 | 80~150 | 关系 +15~+25（宣战后求和的语言渠道） |
| `alliance-deal` | 歃血为盟 | ≥ 35 | 120~200（另名望 5~10） | 关系 +25~+30，status = 'allied' |

- **效果线性缩放**：`ratio = (price − 下限) / (上限 − 下限)`（clamp 0~1），各效果/副资源成本按 ratio 取整。Agent 只能选 dealId 并在区间内定价，**不产出最终数值与 status**——数值权威在前端兑换表（`applyNegotiationDeal` 确定性执行），防幻觉破坏平衡。
- `alliance-deal` 门槛 35 低于按钮结盟的 50，但价格更高（银两 120~200 + 名望 5~10 vs 100 + 10）——谈判的差异化价值是「花更多钱换更低门槛」，两条结盟路径并存。

**信件软性影响与配额**：
- 回信附 `relationshipDelta`（clamp ±10，弱于行贿 +15），未成交（应允/拒绝/放弃）时仅应用此值并入档外交事件。
- 独立配额 `negotiationUsedThisTurn`：每回合 1 次谈判（发起 letter 计 1 次，settle 追答不重复计），与按钮外交配额互不占用；letter 降级（X-Fallback）不消耗配额可重试，随 `resetDiplomacy()` 一并重置。
- 与按钮的关系：谈判是「话术 + 议价」通道，按钮是「确定性即时」通道；结盟等 status 变更只能经按钮或 `alliance-deal` 兑换触发。
