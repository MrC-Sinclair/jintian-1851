# 设计：资源产出机制

## 上下文

`game-design.md:572` 要求每回合自动产出少量资源。现有回合推进链路（`useTurn.endTurn`）：

```
endTurn(playerChoice)
  → NPC 行动 (npc-actions)
  → applyEffects(npc effects)
  → 追加历史事件
  → turn+1, date.month+1
  → 持久化 + 结局判定
```

资源仅在 `applyEffects` 处变动，无回合级自动产出。

## 决策

### D1：产出注入点在 endTurn（回合结算时）
- 选择 `endTurn` 内 NPC 应用之后、`turn+1` 之前，语义为"本月赋税/产出结算"；
- 与 NPC 行动同属"回合结束结算"，时序清晰、可审计。

### D2：产出以"系统历史事件"形式落地
- `calcTurnYield()` 返回 `Partial<Resources>`；
- 同时 `store.appendEvent`（**store 实际方法名**，见 `stores/game.ts:172`；无 `addHistory`）一条 HistoryEvent：
  - `eventType: '系统'`——**扩展 `EventType` 枚举**（`types/game.ts:11` 现 `'民生'|'军事'|'外交'|'随机'|'历史剧情'|'npc'`，新增 `'系统'`），同步 `EVENT_TYPE_LABELS`；
  - `playerChoice: ''`（系统事件无玩家选择，但 `HistoryEvent.playerChoice: string` 必填，见 `game.ts:113`，用空串满足约束）；
  - `effects: { silver: 50 }`（非空，记录产出，区别于玩家决策事件的 `effects: {}`）；
  - 文案来自 `copywriting.ts`，避免资源凭空增加不可解释，符合 timeline 审计习惯。

### D3：常量集中、结构可扩展
- `TURN_YIELD: Partial<Resources> = { silver: 50 }` 入 `utils/constants.ts`；
- 返回类型用 `Partial<Resources>`，未来扩展（如 `food`、`troops`）不改签名。

### D4：复用既有 applyEffects，不新造写入路径
- `store.applyEffects(calcTurnYield())` 与决策/NPC 共用原子写入，避免 Read-Modify-Write 竞态
  （符合 AGENTS.md 数据安全规则）。

### D5：防重复提交
- `endTurn` 已有 `if (store.isProcessingTurn) return` 守卫，产出在其内执行，天然受保护。

## 数据结构

```ts
// utils/turn-yield.ts
export const TURN_YIELD: Partial<Resources> = { silver: 50 }
export function calcTurnYield(): Partial<Resources> {
  return { ...TURN_YIELD }
}
```

## 多端兼容

- 纯前端逻辑 + 常量，无浏览器 API，跨端一致。
- 不新增 UI，产出仅体现在 timeline 系统事件，复用既有渲染。

## 验证

- 单测 `calcTurnYield`：返回固定值、不可被外部修改（返回副本）。
- 集成（useTurn 单测）：`endTurn` 后 `store.currentSave.state.resources.silver` 增加 50，
  且 `events` 末条为 `eventType='系统'` 的产出事件（**字段名是 `eventType` 非 `type`**，值 `'系统'` 非 `'system'`）。
- 渲染：确认 `TurnTimeline` 能正确渲染 `eventType='系统'`（不报错/不漏显）。
- 平衡校验：连推 20 回合，资源处于可玩区间（手工/脚本核对 `docs/ai-cost.md` 外的经济平衡）。
- 跨提案联合校验：与 event-weight / weighted-overall-power 全部落地后跑标准通关路径（见 C1）。
