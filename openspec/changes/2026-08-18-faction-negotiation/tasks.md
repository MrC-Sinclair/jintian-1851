# 任务：与 NPC 势力自然语言谈判

> 验证纪律：每个代码任务完成后，在对应子项目目录运行 `pnpm lint`；涉及类型变更额外 `pnpm typecheck`；核心逻辑变更额外 `pnpm test:unit`。命令必须在 `game-web/` 或 `server/` 各自目录执行，禁止在仓库根目录运行。

## 1. 后端：兑换表常量与 zod schema
- [x] `server/server/utils/negotiation-deals.ts` 新建：`NEGOTIATION_DEALS`（gift/trade/truce/alliance 四条，含价格区间、效果区间、requires 门槛）+ `sanitizeDeal(deal)` / `scaleEffect(deal, price)` 纯函数（clamp、ratio 线性缩放）
- [x] `server/server/api/game/faction-negotiate.ts` 定义 `letterBodySchema` / `settleBodySchema`（counterPrice 与 playerResponse='counter' 的 refine 联动校验）
- 验证：`cd server && pnpm lint && pnpm typecheck` ✅

## 2. 后端：谈判 Agent 提示词
- [x] `server/server/utils/prompts/negotiation-agent.ts` 新建：`buildNegotiationPrompt(faction, character, relationship, phase, letter, opts)` —— 复用 npc-agent 人格分支（<-30 / >30 / 中立），letter 阶段要求输出 `{ stance, reply, relationshipDelta, deal? }` 且 deal 只能从表内选 + 区间内定价；settle 阶段要求最终裁定（accept/reject，不再提新条件）
- 验证：`cd server && pnpm lint && pnpm typecheck` ✅

## 3. 后端：faction-negotiate 端点
- [x] `server/server/api/game/faction-negotiate.ts` 实现：复用 `createSiliconFlowFetch` + `streamText` + `stopWhen: stepCountIs(3)`（E2E 模式 1）+ `createNpcTools`（4 工具）+ JSON 鲁棒提取
- [x] sanitize 链：stance 白名单 / dealId ∈ 表（非法 → 丢 deal + stance 降 reject）/ price clamp 区间 / relationshipDelta clamp ±10 / reply 截断 200 字
- [x] 复用 saveId 并发锁（429 `CONCURRENT_REQUEST`）+ `x-device-id` 10 次/分钟限流（429 `RATE_LIMITED`，middleware 按路径前缀自动覆盖）+ 失败降级（`{ ok, fallback: true }` + `X-Fallback: true`）
- 验证：`cd server && pnpm lint && pnpm typecheck && pnpm test:unit` ✅

## 4. 后端：单元测试
- [x] schema 边界：letter 1-200 字、counterPrice 联动必填、factionId/faction.id 一致性（`tests/api/faction-negotiate.test.ts` 16 用例）
- [x] sanitize：非法 dealId 丢弃、price 越界 clamp、relationshipDelta 越界 clamp、reply 超长截断（另 `tests/unit/negotiation-deals.test.ts` 15 用例覆盖门槛/clamp/缩放）
- [x] 降级：AI 异常 / JSON 不可解析 → fallback:true 且不含 deal（不重试）
- 验证：`cd server && pnpm test:unit && pnpm test:api` ✅（123 + 87 全绿）

## 5. 前端：常量、类型与 store
- [x] `game-web/src/utils/constants.ts` 增 `NEGOTIATION_DEALS`（与 server 表镜像）、`MAX_NEGOTIATION_PER_TURN = 1`、`NEGOTIATION_LETTER_DELTA_LIMIT = 10`、`scaleNegotiationEffect(deal, price)` 缩放函数（另加 `counterPriceRange` 还价区间）
- [x] `game-web/src/types/` 增谈判类型（`NegotiationStance` / `NegotiationDeal` / `FactionNegotiateResponse`；`FactionNegotiateResult` 导出自 useTurn）
- [x] `game-web/src/stores/game.ts` 增 `negotiationUsedThisTurn` ref + `applyLetterDelta` / `applyNegotiationDeal`（不可变更新，扣费→缩放效果→alliance status→追加 eventType `外交` 事件）；`resetDiplomacy()` 一并重置谈判配额；fallback 时不置位配额（useTurn 层实现）
- 验证：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit` ✅

## 6. 前端：NegotiationDialog 组件与集成
- [x] `game-web/src/components/NegotiationDialog.vue` 新建：信件 textarea（x/200 计数）→ loading → 回信卡片 + 条件卡片（deal 名称/代价/效果预览）→ 接受条件 / 还价（仅主资源，区间 [min×0.5, 原价]）/ 放弃；按钮 ≥44px 触摸目标（min-height 88rpx）
- [x] `game-web/src/components/DiplomacyPanel.vue` 每势力卡片加「写信」按钮（`isProcessingTurn` / `negotiationUsedThisTurn` / `status==='destroyed'` 时禁用），标题栏展示双配额剩余
- [x] `game-web/src/composables/useTurn.ts` 增 `sendNegotiationLetter` / `respondNegotiationDeal`（调 `/api/game/faction-negotiate`，防重复提交守卫：发送中 stage 锁定 + 服务端并发锁兜底；`utils/api.ts` 增 `postWithMeta` 保留顶层 fallback 标志）
- 验证：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit` ✅

## 7. 前端：单元测试与 E2E
- [x] 缩放计算：ratio 0 / 0.5 / 1 三档效果取整断言（`tests/unit/negotiation.test.ts`）
- [x] `applyNegotiationDeal`：资源不足拒绝、扣费正确、alliance 触发 `status='allied'`、事件追加；配额：letter 置位 / settle 不计 / fallback 退还 / startTurn 重置 / 与外交按钮独立（共 22 用例）
- [x] E2E `game-web/tests/e2e/faction-negotiation.spec.ts`：写信 → 回信 → 接受条件 → 资源与关系变化断言（`x-e2e-test-mode: 1`）。`pnpm exec playwright test` 1 passed（48.4s；服务端日志确认 letter counter gift-deal@100 → settle accept，银两精确扣减 100、谈判配额用尽）
- 验证：`cd game-web && pnpm test:unit && pnpm test:e2e` ✅

## 7.5 联合平衡校验（design.md 残余不确定性收口，2026-08-18）
- [x] 新增 `game-web/tests/unit/negotiation-balance.test.ts`（11 用例）：
  - 跨提案不变量：四路径（无/仅按钮/仅谈判/全开）实力均收敛 ≥90，通关回合数一致（关系不进综合实力，谈判不拖慢主平衡）
  - 经济不变量：最坏情况（还价全接受 + delta 恒 +10）银两全程 >0；单回合最大理论支出 300 银 ≤ 6 回合自动资源回补
  - 叠加不变量：模拟内单势力单回合关系跳变 ≤40（含自由行动通道的完整上限 60 与 design 声明一致）
  - 免费通道：纯 applyLetterDelta(+10/回合) 单势力 -100→0 需 ≥8 回合
  - 静态性价比：gift/trade/truce 区间两端均不超同位按钮动作的 1.1~1.25 倍；还价下限 ratio=0 效果取下限（博弈激励）；alliance-deal 总成本 > 按钮结盟（门槛低 15 换价格高 20+ 的设计意图成立）
- 量化指标（最坏情况贪心策略）：none/buttons/negotiation/both 四模式 turnsToWin 均 28；both 模式 minSilver 500、maxSpend 130、双配额行动各 11 次、5 NPC 全 allied（见 design.md 残余不确定性 `[观察]` 项）
- 结论：**首版兑换表数值通过全部校验，无需调整**；还价拒绝率与全结盟速度列入发版后观察项
- 验证：`cd game-web && pnpm exec vitest run tests/unit/negotiation-balance.test.ts` ✅（11 passed）

## 8. 文档同步
- [x] `docs/API.md` 新增 `POST /api/game/faction-negotiate` 章节（入参/出参/错误码/降级/限流，与现有 6 AI 端点同格式），通用约定/目录/错误码同步 7 端点口径
- [x] `docs/game-design.md` 外交节补「6.1 谈判（写信）」玩法：两阶段流程、兑换表、独立配额、与按钮的关系
- [x] `docs/ai-cost.md` 补 faction-negotiate 行（模型/调用方式/单次 token 与成本/限流归并说明），降级策略表与频率限制范围同步
- 验证：人工评审对照代码字段名一致性

## 9. spec 合并（归档时）
- [ ] 将本提案 `specs/ai-faction-negotiation/spec.md` delta 合并入 `openspec/specs/ai-faction-negotiation/spec.md` master（新建），proposal.md 顶部追加状态块，目录移入 `archive/`
- 验证：对照 `openspec/config.yaml` 规则逐条检查
