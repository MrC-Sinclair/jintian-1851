# 提案：把名望接上（NPC 态度 + 结局史评），并修掉它没有上限的问题

## 为什么 / Why

`docs/game-design.md:57` 承诺名望「影响 NPC 态度与结局评分」，实测两头都没落地：
`reputation` 在 `game-web/src/utils/end-conditions.ts` 与
`server/server/utils/prompts/npc-agent.ts` 里各出现 **0 次**——它只在事件 effects 里变动，不影响任何判定。

但「死数值」这个描述本身是错的，实测后有两个更要紧的事实：

1. **名望不涨反跌是不存在的：它单调暴涨且没有上限。** 200 局模拟终局名望
   min=116 / 中位 **161.5** / p90=199 / max=**305**，而起始值是 10。原因两条叠加：
   内容侧 60 条兜底事件 + 14 条剧情链里 `reputation` 正向 **149** 次、负向 **87** 次、净 **+301**；
   数值侧 `applyEffects` 只对资源做 `Math.max(0,…)` 下限托底，`ATTRIBUTE_MAX = 100` **只夹五维属性**。
2. **直接把名望计入综合实力会打穿平衡。** 实测把 `reputation` 作为第 6 维计入
   `calcOverallPower`，权重取 0.2 / 0.3 / 0.5 / 1.0 时 200 局胜率分别为
   99.5% / 100% / 100% / 100%（基线 95.5%），`time_up` 与崩溃结局几乎消失。
   根因是量级失配：名望终值 ~161 远高于属性的 0-100 刻度，计入等于系统性抬高综合实力。

结局页还有现症问题：`end-game/index.vue` 挂着 `StatusPanel`，玩家现在就能看到「名望 305」，
而设计给它的是「朝野声望 0-100」的语义。

## 改什么 / What Changes

- **封顶 + 衰减**（让名望回到 0-100 刻度）：`applyEffects` 给 `reputation` 加 100 上限（`REPUTATION_MAX`）；
  `TURN_YIELD` 增 `reputation: -3`（人走茶凉）。**只给名望封顶**——银两/兵员/粮草是存量计数，没有刻度语义。
- **单一档位表**：`game-web/src/utils/constants.ts` 的 `HISTORY_RATINGS`（min/label/remark/npcStance 五档），
  后端镜像 `server/server/utils/reputation-bands.ts`，由 `mirror-consistency.test.ts` 深比较防漂移。
- **(a) NPC 态度**：`buildNpcAgentPrompt` 注入一行「玩家如今的朝野名望：{档位}。{npcStance}」，
  排在关系值之后、决策目标之前；**只偏置意图与文案，不改数值结算**（与势力记忆同一处理方式）。
- **(b) 结局史评**：`getHistoryRating(reputation)` 供结局页 hero 区渲染称号 + 评语（`v-if="save"` 防闪最低档）。
  **名望不参与任何胜负判定**，并有用例锁住这条不变量。

## 关键决策与被排除的方案

| 决策 | 理由 |
|---|---|
| 史评只做展示，**不**计入胜利判定 | 实测计入会把胜率推到 100%（见上）。要让它参与胜负，得先重做名望量级 + 重标定阈值，那是平衡重构，不该借「接通字段」顺手做 |
| 封顶必须配衰减，且 −3/回合 | 单加封顶会让 200 局 **100% 撞在 100**，档位区分度归零（实测 p90−p10=0）。−3/回合 预测中位 56 / 实测 **59**、p90 88、仅约 4% 撞顶，五档分布 12%/28%/35%/15%/10% |
| 档位表两项目各一份 + 深比较测试 | 子项目无法互相 import，而仓库已有 `NEGOTIATION_DEALS` / `STORY_CHAINS` 的同款先例；表结构刻意含前端用不到的 `npcStance`，就是为了让 `toEqual` 一把梭而不是退化成注释约定 |
| 用「每回合产出」承载衰减，不新建机制 | `TURN_YIELD` 已是 endTurn 注入 + 系统事件记录两条通道的现成入口，前后端与模拟底盘都会自动带上 |
| 排除「把内容侧 149 处正向名望改小」 | 最贴近「名望靠事件挣」，但要动 150 处事件数据并重跑全部平衡基线，风险面与工作量都数倍；先用一行数值把刻度纠正，内容量级留给 #3 资源议题一并处理 |
| 排除「档位按分位数动态计算」 | 承认名望无界、按 p10/p50/p90 划线——但那样玩家看到的称号会随他人数据漂移，单机游戏没有可比群体 |

**已知代价（接受）**：结盟/离间要花 10 点名望，衰减后攒够更难；早期个别局名望会触底 0
（基线快照里逐资源下限的名望由 9 变 0 即此现象）。这是「名望应当稀缺」的预期结果，不是回归。

## 影响 / Impact

| 影响面 | 改动 |
|---|---|
| 前端 `game-web` | `constants.ts`（`REPUTATION_MAX` / `HISTORY_RATINGS` / `TURN_YIELD`）、`stores/game.ts`（名望封顶）、`utils/end-conditions.ts`（`getHistoryRating`）、`pages/end-game/index.vue`（史评区块与样式） |
| 后端 `server` | 新增 `utils/reputation-bands.ts`；`utils/prompts/npc-agent.ts` 注入一行 |
| 数据库 | 无变更 |
| API | 无签名变更（`stateSnapshot.resources.reputation` 早已存在，缺字段时按 0 处理） |
| 平衡 | **胜率零漂移**：重跑 200 局 baseline 仍 95.5%、simple-npc 仍 40.5%、avgTurns/avgPower 全同；只有逐资源下限里名望 9→0。基线快照注释已记录本次对照 |
| 成本 | `npc-actions` 输入 ~1200 → ~1250 tokens（+4%），单局 ¥0.111 → ¥0.112，MVP 月度 < ¥336。`docs/ai-cost.md` 各处合计已同步 |
| 测试 | 新增/改写：`end-conditions.test.ts` +4 例（含「名望不改变判定」不变量）、`game-store.test.ts` +2 例（封顶 / 触底）、`npc-agent-prompt.test.ts` +5 例、`mirror-consistency.test.ts` +2 例；同步 `turn-yield.test.ts`、`use-turn.test.ts`(×2)、`negotiation-balance.test.ts`（fixture 补名望收入源） |

## 能力 / Capabilities

### Modified Capabilities
- `turn-engine` - 「回合资源自动产出」纳入名望 −3 衰减与 100 封顶；新增史评档位要求（delta 见 `specs/turn-engine/spec.md`）
- `ai-npc-faction` - NPC 决策 prompt 注入玩家名望档位，只偏置意图与文案（delta 见 `specs/ai-npc-faction/spec.md`）
