# 设计：自由行动打通势力关系与实力

## 上下文
回合循环：`startTurn(事件) → makeDecision(选项/自由输入) → endTurn(NPC行动)`。确定性外交（`player-active-diplomacy`）是独立于事件决策的次级操作，可改 faction 的 `relationship/status/power`，且 D5 已证实 NPC Agent 在下个 `endTurn` 读取新 relationship 自动反应，无需新增后端逻辑。

本提案让「自由行动」这一**事件决策内**的自然语言通道也能影响势力，填补其与外交系统的断层。核心约束来自已落地代码：
- `resolve-decision` 当前入参仅 `{saveId, turn, playerDecision, stateSnapshot, event}`，无 `factions`；`effectsSchema` 仅 `effects: Record<string,number>`。
- `store.applyDiplomacyAction`（`game-web/src/stores/game.ts:262`）已建立不可变更新 factions 范式：建新数组 + 重赋 `currentSave.value` + 刷 `updatedAt`，`relationship` 经 `clamp(-100,100)`，`power` 经 `Math.max(0,...)`。
- `relationship` 范围 -100~100，`status` 含 `active/destroyed/allied`（设计与资源约束见 `DIPLOMACY_RULES`）。

## 决策

### D1：自由行动走独立 faction 通道，不复用 `applyDiplomacyAction`
- 新增 store 方法 `applyFreeFactionEffects(factionEffects)`，**不**受 `diplomacyUsedThisTurn` 守卫限制（自由行动是事件决策的一部分，与"每回合 1 次确定性外交"是不同系统），避免日常决策被外交上限误伤。
- 复用其不可变更新范式（新数组 + 重赋 + 刷 updatedAt + clamp/power 保护）。
- 资源代价由 AI 在 `effects.resources` 中表达（如"资助"→ `silver:-50`），经现有 `applyEffects` 扣减；关系/实力经 `applyFreeFactionEffects` 应用。两通道叠加，形成"有代价的自然语言外交"。

### D2：`factionEffects` 仅做"软性微调"，禁止改 `status`
- 自由行动可改：`relationshipDelta`（clamp ±20，最终 clamp -100~100）、`powerDelta`（clamp ±30，最终 `Math.max(0,...)`）。
- **不允许** `setStatus`（结盟/宣战/摧毁仍走确定性按钮，避免 AI 绕过 `minRelationship` 门槛直接操控胜负关键状态）。
- 设计理由：确定性外交的"结盟需 relationship≥50 且 setStatus='allied'"是刻意设置的玩法门槛；若自由行动能直接结盟，门槛形同虚设。分层后玩家可先自由行动"暗中资助"把关系推近，再下回合用确定性按钮"结盟"——形成自然的玩法层次。

### D3：后端 `factions` 入参与 prompt 注入
- 前端 `makeDecision` 传 `factions: s.factions`（范式同 `generate-event` 上传 factions）。
- prompt 注入精简势力信息：`id / name / relationship / status / power`（不传 summary 以控成本）。
- prompt 明确：当决策文本指向某势力（如"资助湘军"），在 `factionEffects` 中对其返回合理 `relationshipDelta`；`factionId` 必须是给定列表中的 id，不可编造。

### D4：幻觉防护（sanitize）
- 后端对 `factionEffects` 逐条校验：`factionId` 必须存在于传入 `factions`；否则丢弃该条（与 `generate-event` 过滤无效 option 一致）。
- schema 用 `z.array(...)` 且 `factionId: z.string()`，运行时 sanitize 兜底（zod 无法在 schema 内引用运行时 factions 列表）。

### D5：降级与兼容性
- 降级（`X-Fallback`）：`factionEffects` 返回空数组 `[]`，不改动任何势力（与降级默认 effects 一致）。
- 向后兼容：旧客户端不传 `factions` 时后端不报错，`factionEffects` 始终为 `[]`（无上下文则 AI 无从关联势力）。

### D6：成本与调用次数
- 新增 factions 上下文约 +200~400 tokens/调用；**不增加 LLM 调用次数**（每决策仍 1 次 `generateObject`）。
- 复用现有并发锁 + 每 deviceId 10/min 频率限制（在 `resolve-decision.ts` 已存在），无需新增。

### D7：NPC 反应自动生效（零后端增量）
- 改完 `relationship/power` 后，下个 `endTurn` 的 `npc-actions` 读取新值（经 `compressFactions` 传 relationship/power），敌对(<−30)转挑衅、友好(>30)转外交——与确定性外交 D5 完全相同机制，无需新增后端逻辑。

## 数据结构
```ts
// 后端 effectsSchema 扩展
const factionEffectSchema = z.object({
  factionId: z.string(),                                  // 必须 ∈ 传入 factions 的 id
  relationshipDelta: z.number().min(-20).max(20).optional(),
  powerDelta: z.number().min(-30).max(30).optional()
})
const effectsSchema = z.object({
  effects: z.record(z.string(), z.number()),               // 现有：属性+资源
  factionEffects: z.array(factionEffectSchema).optional()  // 新增
})

// 前端类型（useTurn.ts）
export type FreeFactionEffect = {
  factionId: string
  relationshipDelta?: number
  powerDelta?: number
}
export type ResolveDecisionResponse = {
  effects: Partial<Attributes & Resources>
  narrative?: string
  factionEffects?: FreeFactionEffect[]
}
```

## 多端兼容
- `resolve-decision` 为后端 API，H5/小程序/App 调用一致；factions 由前端 `useTurn` 取自 `currentSave`，三端同源。
- 前端逻辑（`makeDecision` / `applyFreeFactionEffects` / 反馈 UI）为纯 TS + 现有组件，**无浏览器 API**，三端一致。
- 反馈 UI 仅展示文本变化（"湘军关系 +15"），复用现有 `decisionApplied` 反馈区，无新增触摸交互元素，故无需额外 ≥36/44px 适配；若后续改为卡片式提示，遵循现有 `EventCard` 间距 token。
- 手机端与平板端均复用同一反馈区，无差异布局。

## 验证
- 后端单测：`resolve-decision` 自由输入"资助湘军"返回对其 `factionEffects[0].relationshipDelta>0`；无效 factionId 被 sanitize 丢弃；降级返回空数组。
- 前端单测：`applyFreeFactionEffects` 正确 clamp relationship(-100~100)/power(≥0)、刷 updatedAt、不可变更新（原数组不变）；两通道叠加资源与关系。
- 集成：自由行动"暗中资助湘军"→ 湘军 relationship 上升、silver 下降；下回合 `npc-actions` 对该势力反应（友好度提升）。
- `pnpm lint` + `pnpm typecheck` + `pnpm test:unit`（game-web 与 server 各自）；`docs/API.md` 同步。
- 多端冒烟：H5 与微信小程序各走一遍自由行动含势力变化。
