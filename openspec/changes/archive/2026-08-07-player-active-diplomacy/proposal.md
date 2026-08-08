# 变更提案：玩家主动外交

> **状态：提案中（待实现）**
> 关联设计：现有 `docs/game-design.md` 关系矩阵（L146-162）、外交胜利路径（L559）、`Faction.relationship`（-100~100 连续刻度）、`FactionStatus.allied`
> 关联 spec：`openspec/specs/ai-npc-faction/spec.md`（relationship 驱动 NPC 决策）、`turn-engine`（回合循环）

## 背景

当前玩家对 6 个势力的交互**完全被动**：仅在「事件选项」里响应外交类事件，无法主动对特定势力发起操作。`docs/game-design.md:559` 列出「外交胜利路径（宗室 + 清廷，专注朝贡/列强事件）」，但缺乏玩家主动塑造关系的手段，外交维度沦为纯随机事件。

现状（已查证）：
- `Faction` 已含 `relationship: number`（-100~100）与 `status: 'active'|'destroyed'|'allied'`，`copywriting.ts` 有完整关系 5 档（盟友/友好/中立/紧张/敌对）文案。
- NPC 侧 `NpcActionType` 含 `结盟/外交/挑衅/备战`，NPC Agent 已按 `relationship` 动态决策（敌对→挑衅/备战，友好→外交/结盟）。
- **玩家侧缺口**：`stores/game.ts` 无任何修改 `factions[].relationship/status` 的方法（仅 `setNpcActions`/`setNpcFailedFactionIds`）；`game-main` 底部无外交入口。（注：`EventType` 已含 `'外交'`——原 5 类事件之一，玩家外交行动复用该类型，**无需扩枚举**。）

本功能让玩家通过**独立外交面板（次级操作）**主动对势力发起 6 类动作，资源/关系门槛为确定性规则，NPC 反应复用现有 AI。

## 改动

1. **新类型 `PlayerDiplomacyAction`**（`types/game.ts`）：6 动作 `'结盟' | '宣战' | '行贿' | '通商' | '离间' | '质子'`（玩家主动动作，与 NPC 的 `NpcActionType` 区分）。
2. **store 新增 `applyDiplomacyAction(factionId, action)`**（`stores/game.ts`）：确定性地扣资源（`applyEffects`）+ 改 `factions[i].relationship`（clamp -100~100）/ `status`（结盟→`allied`）/ `power`（离间削弱）；记录 `lastAction`；受每回合上限守卫。
3. **新组件 `DiplomacyPanel.vue`** + 底部「外交」入口按钮（`game-main/index.vue`）：列出 6 势力（关系条 + 6 动作按钮），按钮按门槛/资源可用性禁用；动作即时反馈（toast + 关系条动画）。
4. **6 动作确定性规则**（见 design.md D2 表）：结盟需关系≥50、宣战耗兵力、行贿耗银两等，全部前端计算。
5. **时间线记录**：每次外交行动追加一条 `eventType: '外交'`（复用既有类型——`EventType`/`EVENT_TYPE_LABELS`/`TurnTimeline.typeClass` 的 `'外交'` 均已存在，零改动）的历史事件，可追溯。
6. **spec 同步**：`ai-npc-faction` 补 Requirement「玩家主动外交影响 relationship」；`turn-engine` 补「外交次级操作」Scenario。

## 影响面

- **前端**：`types/game.ts`（`PlayerDiplomacyAction` 类型）、`stores/game.ts`、`game-main/index.vue`、新 `DiplomacyPanel.vue`、`copywriting.ts`（6 动作文案；`EventType`/`EVENT_TYPE_LABELS`/`TurnTimeline` 的 `'外交'` 均已存在，复用零改动）。
- **数据**：`factions[].relationship/status/power` 现可由玩家修改（原仅 NPC 决策间接影响）；新增每回合外交上限字段（存 `state` 或运行时）。
- **后端**：**无改动**——NPC 反应已 relationship 驱动，玩家改关系后下个 `endTurn` 自然生效。
- **不改动**：事件生成、结局判定、属性/资源核心循环（外交只改势力关系与资源）。

## 残余不确定性

- `[不确定]` **离间语义**：数据模型仅存「玩家↔势力」关系，无「势力↔势力」关系。初版将离间落地为「削弱目标势力 `power` -20」（确定性、契合 NPC AI 的 power 字段），而非真实挑拨两势力互斗；需评审是否可接受。
- `[不确定]` **每回合上限**：初版取「每回合最多 1 次外交行动」（`diplomacyUsedThisTurn` **运行时 ref**，`startTurn` 重置），避免次级操作喧宾夺主；阈值可调。**reload-bypass 已知限制**：ref 不持久化，玩家中途退出重进可重置上限。改为存入 `GameSave.state` 持久化会触发后端 `sync-save` 的 `z.strictObject()` 拒绝（`state` 未声明该字段，见 `server/api/game/sync-save.ts:37-53`），需同步改 server zod——破坏本提案"无后端改动"前提，故 MVP 接受此限制（资源 silver/troops 有限，天然封顶）。
- `[跨提案]` **联合平衡**：刚落地的三份平衡提案（自动资源/加权实力/事件权重）已整体降低难度；外交若成本过低会进一步失衡。本提案动作成本须偏高，且建议与三提案一并做联合平衡校验（参照既有 C1 约定）。
- `[不确定]` 宣战设为 `relationship = -100`，不新增 `hostile` 状态（连续刻度已编码敌对），NPC 行为由现有 `<-30` 分支覆盖；若需独立「战争状态」UI 则后续扩展。
- `[不确定]` **结盟的连带效果**：`game-design.md:171` 规定 `status==='allied'` 势力**不参与 npc-actions**，故玩家结盟=让该势力下回合停止行动（消除一个威胁源）。这是强效果，D2 成本（silver-100/reputation-10/关系≥50 门槛）部分对冲，但联合校验须含"高频结盟消威胁"路径。
- `[需补]` **`canAfford` 未定义**：design D4 引用 `canAfford(rule.cost)` 做"资源 ≥ |成本|"预校验，但 store 现无此方法，tasks 须补一个纯函数（可入 store 或 utils）。
