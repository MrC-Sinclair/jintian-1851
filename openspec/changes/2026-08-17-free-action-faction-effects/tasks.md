# 任务：自由行动打通势力关系与实力

> 验证纪律：每个代码任务完成后，在对应子项目目录运行 `pnpm lint`；涉及类型变更额外 `pnpm typecheck`；核心逻辑变更额外 `pnpm test:unit`。命令必须在 `game-web/` 或 `server/` 各自目录执行，禁止在仓库根目录运行。

## 1. 后端：resolve-decision 扩展 factions 入参与 factionEffects 出参
- [ ] `server/server/api/game/resolve-decision.ts` bodySchema 增 `factions`（可选，复用 generate-event 的 factions 结构）
- [ ] `effectsSchema` 增 `factionEffectSchema`（`factionId` / `relationshipDelta` ±20 可选 / `powerDelta` ±30 可选）+ `factionEffects` 数组可选
- [ ] prompt 注入精简势力信息（id/name/relationship/status/power），约束 factionId 必须 ∈ 列表、仅软性微调、禁止 setStatus
- [ ] sanitize：`factionEffects` 过滤无效 factionId；降级返回 `[]`
- 验证：`cd server && pnpm lint && pnpm typecheck && pnpm test:unit`

## 2. 前端：类型与 makeDecision 应用
- [ ] `game-web/src/composables/useTurn.ts` `ResolveDecisionResponse` 增 `factionEffects?`；`makeDecision(freeInput)` 传 `factions: s.factions`，拿到后调用 `applyFreeFactionEffects`
- [ ] `game-web/src/types` 增 `FreeFactionEffect` 类型
- 验证：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit`

## 3. 前端：store 新增 applyFreeFactionEffects
- [ ] `game-web/src/stores/game.ts` 新增方法：不可变更新 factions（仿 `applyDiplomacyAction`），clamp relationship(-100~100)/power(≥0)，刷 updatedAt；不受 `diplomacyUsedThisTurn` 守卫
- [ ] 与 `applyEffects`（资源/属性）顺序叠加
- 验证：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit`

## 4. 前端：决策反馈 UI 增量
- [ ] `game-main` 决策应用反馈区展示势力关系/实力变化（如"湘军 关系 +15"），复用现有反馈组件
- 验证：`cd game-web && pnpm lint`

## 5. 文档与集成验证
- [ ] 更新 `docs/API.md` 的 `resolve-decision` 段（入参 factions、出参 factionEffects、sanitize、降级、向后兼容）
- [ ] 集成冒烟：自由行动"暗中资助湘军" → 湘军 relationship↑、silver↓；下回合 NPC 反应生效
- [ ] 多端冒烟：H5 + 微信小程序各走一遍
- 验证：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit`
