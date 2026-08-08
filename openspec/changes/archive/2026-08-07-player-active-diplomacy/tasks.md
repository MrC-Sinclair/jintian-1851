# 任务清单：玩家主动外交

## T1：类型与常量
- `types/game.ts` 新增 `PlayerDiplomacyAction` 类型。（`EventType` 已含 `'外交'`，无需扩枚举——复用既有。）
- `utils/constants.ts` 新增 `MAX_DIPLOMACY_PER_TURN=1` 与 `DIPLOMACY_RULES`（6 动作规则表）。

## T2：store applyDiplomacyAction（不可变范式）
- `stores/game.ts` 新增 `diplomacyUsedThisTurn` ref（startTurn 重置；接受 reload-bypass，见 design D3）+ `applyDiplomacyAction(factionId, action): boolean` + `canAfford(cost, resources)` 纯函数（资源 ≥ |成本|）；
- 实现门槛/成本校验、扣资源（`applyEffects`）、**不可变更新 factions**（建新数组 + 重赋 `currentSave.value` + 刷 `updatedAt`，仿 `updateState` 范式，禁止直接变异 `factions[i]`）、置上限、追加时间线事件。
- 单测：门槛拦截/成本不足/上限/ clamp/ 状态变更/canAfford 边界/不可变更新（返回新数组、原数组不变）。

## T3：DiplomacyPanel 组件 + 入口
- 新 `components/DiplomacyPanel.vue`：列出 6 势力（关系条 + 6 动作按钮），按钮按门槛/资源/已用禁用。
- `game-main/index.vue` 底部新增「外交」入口按钮，点击切换面板（抽屉/折叠）。
- 复用 `CollapsibleSection` 样式 token。

## T4：6 动作规则落地
- 按 design.md D2 表实现 `DIPLOMACY_RULES`（结盟≥50 耗银两名望、宣战耗兵力、行贿耗银两、通商耗银两+名望、离间削 power、质子耗兵力）。

## T5：文案与时间线渲染
- `copywriting.ts`：新增 6 动作中文文案（标题/按钮/tooltip）。（`EVENT_TYPE_LABELS` 的 `外交` 已存在、`TurnTimeline.typeClass` 的 `'外交'` 分支已存在——均复用零改动。）
- 外交行动追加 `eventType:'外交'` 历史事件，验证 TurnTimeline 正确渲染（既有分支，不新增）。

## T6：spec 同步 + 文档回标
- `ai-npc-faction/spec.md` 补 Requirement「玩家主动外交影响 relationship」（NPC 下回合按新关系反应）。
- `turn-engine/spec.md` 补「外交次级操作」Scenario（每回合上限、不占事件决策）。
- `game-design.md` 新增「主动外交」设计规则条目（关联本提案）。

## T7：验证
- `pnpm lint` + `pnpm typecheck`（game-web）；
- `pnpm test:unit`（applyDiplomacyAction 单测 + DiplomacyPanel 组件测试 + TurnTimeline 外交渲染）；
- 跨提案联合平衡校验（与自动资源/加权实力/事件权重一并评估难度）。
- ✅ **C1 已落地（2026-08-07）**：由 `game-web/tests/unit/balance-regression.test.ts`（纯函数底盘 `tests/sim/balance-sim.ts`，兜底事件池 mock LLM）满足。200 种子 × 50 回合：胜率 99.5%、avgTurns≈36（median 35）、仅 1 局超时未通关、无属性崩溃/异常；外交开关对比恒等，证明本提案次级操作不拖慢主平衡。
