# 设计：玩家主动外交

## 上下文

玩家需在回合内主动塑造与 6 势力的关系。现有 `relationship`（-100~100）、`status`、`power` 字段与 NPC 的 relationship 驱动决策已就绪，缺口在**玩家侧写入能力**与**UI 入口**。

回合循环（`useTurn`）：`startTurn(事件) → makeDecision(选项/自由输入) → endTurn(NPC行动)`。外交作为**次级操作**，不占事件决策机会，回合内随时可在面板发起，受资源/每回合上限约束。

## 决策

### D1：独立面板（次级操作），不占事件决策
- `game-main` 底部新增「外交」入口按钮（与「军师/自由行动/确认决策」并列），点击展开 `DiplomacyPanel`（用既有 `CollapsibleSection` 或抽屉）。
- 外交行动**独立于** `hasDecided`/`isProcessingTurn` 守卫之外，但 `isProcessingTurn` 为真时禁用（防并发）。
- 优点：玩家代理权增强，不打断事件主线；缺点：需新 UI 层与状态。

### D2：6 动作确定性效果表（初版平衡值，待联合校验回调）

| 动作 | 关系门槛 | 资源成本 | 确定性效果 |
|---|---|---|---|
| 结盟 | `relationship ≥ 50` | silver -100, reputation -10 | `relationship += 30`（cap 100），`status = 'allied'` |
| 宣战 | 无 | troops -100 | `relationship = -100`（敌对，NPC 下回合转挑衅/备战） |
| 行贿 | 无 | silver -80 | `relationship += 15`（cap 100） |
| 通商 | 无 | silver -50 | `relationship += 10`（cap 100），`reputation += 5` |
| 离间 | 无 | silver -60, reputation -10 | 目标 `power -= 20`（削弱；见 D 离间语义） |
| 质子 | 无 | troops -50 | `relationship += 20`（cap 100），`lastAction='质子'` |

- 所有 `relationship` 变更经 `clamp(-100, 100)`。
- 成本不足或门槛未达时按钮禁用（UI 预校验 + store 二次校验，防绕过）。

### D3：每回合上限守卫（运行时 ref，接受 reload-bypass）
- 新增运行时标记 `diplomacyUsedThisTurn`（store ref，初始 false）；
- `applyDiplomacyAction` 前检查：已用则拒绝并 toast；成功后置 true；
- `useTurn.startTurn` 开头重置为 false（新回合解锁）。
- 常量 `MAX_DIPLOMACY_PER_TURN = 1` 入 `utils/constants.ts`。
- **reload-bypass 已知限制**：ref 不持久化，中途退出重进可重置上限。改为存 `GameSave.state` 会触发 `sync-save` 的 `z.strictObject()` 拒绝（`state` 未声明该字段，见 `server/api/game/sync-save.ts:37-53`），需同步改 server zod——破坏"无后端改动"前提，MVP 接受此限制（资源 silver/troops 有限，天然封顶）。

### D4：store 新增 applyDiplomacyAction（不可变更新范式）
```ts
function applyDiplomacyAction(factionId: string, action: PlayerDiplomacyAction): boolean {
  const save = currentSave.value
  if (!save || isProcessingTurn.value || diplomacyUsedThisTurn.value) return false
  const fac = save.factions.find((f) => f.id === factionId)
  if (!fac) return false
  const rule = DIPLOMACY_RULES[action]
  // 门槛 + 成本校验（canAfford 为 store 新增纯函数：资源 ≥ |成本|）
  if (fac.relationship < rule.minRelationship) return false
  if (!canAfford(rule.cost, save.state.resources)) return false
  // 扣资源（复用 applyEffects，负值成本即扣减）
  applyEffects(rule.cost)
  // 不可变更新 factions（仿 updateState/applyEffects 范式：建新数组 + 重赋 currentSave + 刷 updatedAt）
  const newFactions = save.factions.map((f) =>
    f.id === factionId
      ? {
          ...f,
          relationship: clamp(f.relationship + rule.relDelta, -100, 100),
          ...(rule.setStatus ? { status: rule.setStatus } : {}),
          ...(rule.powerDelta ? { power: Math.max(0, f.power + rule.powerDelta) } : {}),
          lastAction: action
        }
      : f
  )
  currentSave.value = { ...save, factions: newFactions, updatedAt: Date.now() }
  diplomacyUsedThisTurn.value = true
  // 时间线记录（复用既有 '外交' EventType，见 D6）
  appendEvent({
    turn: save.state.turn,
    eventType: '外交',
    title: `你向${fac.name}${action}`,
    description: '...',
    playerChoice: action,
    effects: rule.cost
  })
  return true
}
```
- **禁止直接变异 `factions[i]`**：store 既有方法（`updateState`/`applyEffects`）一律建新对象 + 重赋 `currentSave.value` + 刷 `updatedAt`（同步冲突解决契约）；`applyDiplomacyAction` 是 store 首个 faction 写入方法，须立好范式。
- `canAfford(cost, resources): boolean` 为 store 新增纯函数（逐项校验 `resources[k] >= |cost[k]|`）。
- `DIPLOMACY_RULES` 表（动作→{minRelationship, cost, relDelta, setStatus?, powerDelta?}）入 `utils/constants.ts` 或 `diplomacy.ts`。

### D5：复用现有 NPC AI 反应
- 玩家改 `relationship` 后，下个 `endTurn` 的 NPC Agent 读取新值，敌对（<-30）转挑衅/备战、友好（>30）转外交/结盟——**无需新增后端逻辑**。
- 离间改 `power` 同样生效：`useTurn.endTurn` 把 `s.factions`（含 power）整体上传 npc-actions（`ai-cost.md` compressFactions 传 power 字段），故 power 削弱也流入下回合 NPC 决策。
- 即时反馈仅限 UI（关系条变化 + toast），NPC 实质反应在回合结算时体现。

### D6：时间线记录（复用既有 '外交' 类型，零改动）
- `EventType` 已含 `'外交'`（原 5 类事件之一，`game.ts:11`），`EVENT_TYPE_LABELS` 已有 `外交:'外交'`（`copywriting.ts:125`），`TurnTimeline.typeClass` 已有 `case '外交'`（`TurnTimeline.vue:89`）——**三者均已存在，零改动**。
- 玩家外交行动历史事件复用 `eventType:'外交'`，与 AI 外交事件共用 badge；靠 `title`（"你向X结盟"）+ `playerChoice` 区分。

### D7：离间语义（简化）
- 数据模型无「势力↔势力」关系，故离间落地为削弱目标 `power`（确定性、契合 NPC AI 的 power 比较），而非挑拨两势力互斗。后续如需真实离间可扩展关系图。

## 数据结构

```ts
export type PlayerDiplomacyAction = '结盟' | '宣战' | '行贿' | '通商' | '离间' | '质子'

interface DiplomacyRule {
  minRelationship: number          // 关系门槛（默认 0）
  cost: Partial<Resources>         // 资源成本（负值，经 applyEffects 扣减）
  relDelta: number                 // 对目标 relationship 的增量
  setStatus?: FactionStatus        // 状态覆写（如 结盟→'allied'）
  powerDelta?: number              // 对目标 power 的增量（离间用负值）
}
```

## 多端兼容

- 纯前端逻辑 + 常量 + 组件，无浏览器 API，H5/小程序/App 一致。
- 新增组件沿用 `CollapsibleSection` 与既有样式 token，不引入新依赖。

## 验证

- 单测 `applyDiplomacyAction`：门槛拦截（关系不足拒绝结盟）、成本不足拒绝、每回合上限、关系 clamp、状态/实力变更正确。
- 单测 `DIPLOMACY_RULES` 表：6 动作字段完整、成本合理。
- 组件：按钮禁用态（门槛/资源/已用）、面板展开/收起、时间线 `eventType:'外交'` 渲染。
- `pnpm lint` + `pnpm typecheck` + `pnpm test:unit`（game-web）。
- 跨提案联合平衡校验：与自动资源/加权实力/事件权重三提案合并跑标准通关路径，确认难度未失衡。
