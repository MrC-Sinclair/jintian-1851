# 任务：自由行动打通势力关系与实力

> 验证纪律：每个代码任务完成后，在对应子项目目录运行 `pnpm lint`；涉及类型变更额外 `pnpm typecheck`；核心逻辑变更额外 `pnpm test:unit`。命令必须在 `game-web/` 或 `server/` 各自目录执行，禁止在仓库根目录运行。

## 1. 后端：resolve-decision 扩展 factions 入参与 factionEffects 出参
- [x] `server/server/api/game/resolve-decision.ts` bodySchema 增 `factions`（可选，复用 generate-event 的 factions 结构）
- [x] `effectsSchema` 增 `factionEffectSchema`（`factionId` / `relationshipDelta` ±20 可选 / `powerDelta` ±30 可选）+ `factionEffects` 数组可选
- [x] prompt 注入精简势力信息（id/name/relationship/status/power），约束 factionId 必须 ∈ 列表、仅软性微调、禁止 setStatus
- [x] sanitize：`factionEffects` 过滤无效 factionId；降级返回 `[]`
- 验证：`cd server && pnpm lint && pnpm typecheck && pnpm test:unit` ✅（lint/typecheck 通过，104 单测通过）

## 2. 前端：类型与 makeDecision 应用
- [x] `game-web/src/composables/useTurn.ts` `ResolveDecisionResponse` 增 `factionEffects?`；`makeDecision(freeInput)` 传 `factions: s.factions`，拿到后调用 `applyFreeFactionEffects`
- [x] `game-web/src/types` 增 `FreeFactionEffect` 类型
- 验证：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit` ✅（lint/typecheck 通过，327 单测通过）

## 3. 前端：store 新增 applyFreeFactionEffects
- [x] `game-web/src/stores/game.ts` 新增方法：不可变更新 factions（仿 `applyDiplomacyAction`），clamp relationship(-100~100)/power(≥0)，刷 updatedAt；不受 `diplomacyUsedThisTurn` 守卫
- [x] 与 `applyEffects`（资源/属性）顺序叠加
- 验证：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit` ✅

## 4. 前端：决策反馈 UI 增量
- [x] `game-main` 决策应用反馈区展示势力关系/实力变化（如"湘军 关系 +15"），复用现有反馈组件
- 验证：`cd game-web && pnpm lint` ✅

## 5. 文档与集成验证
- [x] 更新 `docs/API.md` 的 `resolve-decision` 段（入参 factions、出参 factionEffects、sanitize、降级、向后兼容）
- [x] 集成冒烟（浏览器端到端）：`game-web/tests/e2e/free-action-faction-effects.spec.ts` 跑通 —— 自由行动"暗中资助关系最友好的势力" → 服务端返回 `factionEffects:[{factionId,relationshipDelta:+20}]` → 前端「势力动向」反馈区出现并展示"关系 +20"。`pnpm exec playwright test` 1 passed。
- [x] 多端冒烟：
  - H5：上述 e2e（Playwright/Chromium）已覆盖浏览器端到端路径 ✅
  - 微信小程序：本环境无微信开发者工具，逻辑层（`useTurn`/store/`game-main`）与 H5 完全共用、无浏览器 API 依赖；人工走查项已登记至 `openspec/pre-launch-checklist.md`（来源：free-action-faction-effects），发布前执行
- 验证：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit` ✅

## 6. 单测补齐（结案前，2026-08-18）
- [x] 修复既有回归：`server/tests/setup.ts` 补 `getHeader` mock（E2E 测试模式功能后加时遗漏，导致 resolve-decision 2 个既有用例 `getHeader is not defined` 失败）
- [x] 后端 `server/tests/api/resolve-decision.test.ts` 补 faction 用例：携带 factions 返回有效 factionEffects / sanitize 丢弃无效 factionId / 不传 factions 恒 `[]`（向后兼容）/ 疑问句守卫 factionEffects 恒空且不调 LLM；降级用例补「空 factionEffects」断言
- [x] 前端 `game-web/tests/unit/game-store.test.ts` 补 `applyFreeFactionEffects` 6 用例：应用 delta + 刷 updatedAt + 不可变更新 / clamp（delta ±20/±30、relationship [-100,100]、power ≥0）/ 无效 factionId 忽略 / 与 `applyEffects` 两通道叠加 / `lastFreeFactionEffects` 反馈记录与清空 / 无存档与空数组安全早退
- 验证：server `pnpm lint && pnpm test:unit && pnpm test:api`（123 + 71 全绿）；game-web `pnpm lint && pnpm typecheck && pnpm test:unit`（333 全绿）✅
