## ADDED Requirements:

### Requirement: 谈判两阶段接口

`POST /api/game/faction-negotiate` 提供玩家与单个 NPC 势力 Agent 的自然语言谈判。两阶段状态机：`phase='letter'`（玩家写信 1-200 字，Agent 回信并表态）与 `phase='settle'`（仅当 letter 阶段 `stance='counter'` 时可达，玩家「接受条件」或「还价」，Agent 最终裁定，不再提新条件）。单次谈判最多 2 次 AI 调用。请求携带 `character` / `stateSnapshot` / `faction`（单势力全量），出参 `{ stance: 'accept'|'reject'|'counter', reply ≤200字, relationshipDelta, deal? }`。复用 npc-actions 的 `streamText` + `createNpcTools`（4 查询工具）+ `stopWhen: stepCountIs(3)` 模式；请求头 `x-e2e-test-mode: 1` 时步数压为 1、超时 8 秒。

#### Scenario: 写信获得还价
- **WHEN** 玩家对 relationship=40 的淮军发起 `phase='letter'`，信件内容为请求结盟并愿出钱
- **THEN** Agent 基于人格与关系上下文回信，返回 `stance='counter'` 与 `deal: { dealId: 'alliance-deal', price ∈ [120,200] }`（价格由 Agent 在区间内自定），前端展示回信与条件卡片，进入待响应状态

#### Scenario: 接受条件触发确定性兑换
- **WHEN** letter 阶段返回 counter 后，玩家选择「接受条件」，前端以 `phase='settle'` + `playerResponse='accept'` 请求（携带原 deal 与 previousReply）
- **THEN** Agent 返回确认回信（`stance='accept'`），前端 `applyNegotiationDeal` 按兑换表扣减银两/名望、按价格比例缩放 relationship 效果、`alliance-deal` 时置 `status='allied'`，并追加 eventType `外交` 历史事件

#### Scenario: 还价由 Agent 最终裁定
- **WHEN** 玩家对条件还价（`playerResponse='counter'` + `counterPrice`，区间 [主资源下限×0.5, 原价]）
- **THEN** Agent 裁定返回 `stance='accept'`（前端按还价重新缩放效果并执行）或 `stance='reject'`（谈判结束，仅应用信件 relationshipDelta），不返回新 deal

#### Scenario: 玩家放弃无需调用
- **WHEN** letter 阶段返回 counter 后玩家点「放弃」
- **THEN** 前端不发起 settle 请求，直接关闭谈判并仅应用信件 relationshipDelta，配额已消耗不退还

### Requirement: 条件兑换表与防幻觉 sanitize

谈判条件来自预定义 `NEGOTIATION_DEALS`（馈赠通好/互市通商/破财止战/歃血为盟），每条含资源价格区间、效果区间与关系门槛（如 `alliance-deal` 要求 relationship≥35、`truce-deal` 要求 relationship≤-30）。效果随价格线性缩放：`ratio = (price − 下限) / (上限 − 下限)`，各效果值在自身区间按 ratio 取整。LLM 只能选择 dealId 与区间内价格，**不产出最终数值与 status**；status 变更仅由前端按表映射（仅 `alliance-deal` → `'allied'`）。服务端 sanitize：非法 `dealId` 丢弃 deal 且 stance 强制降为 `reject`；`price` clamp 回区间；`relationshipDelta` clamp ±10；`reply` 截断 200 字。

#### Scenario: 非法 dealId 被丢弃
- **WHEN** LLM 输出 `dealId: 'war-deal'`（不在表内）
- **THEN** 服务端丢弃该 deal，返回 `stance='reject'` 与正常回信，玩家侧不展示任何条件卡片

#### Scenario: 越界价格被修正
- **WHEN** LLM 对 `gift-deal`（区间 [60,120]）输出 `price: 500`
- **THEN** 服务端 clamp 为 120 后返回，前端按 120 计算缩放效果

### Requirement: 信件软性关系影响

无论是否成交，letter 阶段回信附 `relationshipDelta`（LLM 对信件语气/内容的态度反应），前端 `applyLetterDelta` 应用并 clamp 至 ±10（弱于行贿按钮的 +15）。多次谈判的叠加受独立配额（每回合 1 次）约束。

#### Scenario: 拒绝时小幅关系损失
- **WHEN** 玩家对 relationship=-50 的太平天国写信措辞傲慢，Agent 返回 `stance='reject'`、`relationshipDelta: -8`
- **THEN** 前端应用后该势力 relationship 变为 -58（clamp 边界内），谈判记录入历史事件

### Requirement: 独立回合配额

谈判配额 `negotiationUsedThisTurn` 每回合上限 1 次（`MAX_NEGOTIATION_PER_TURN = 1`）：发起 `letter` 且非降级时置位；`settle` 追答不重复计数；`useTurn.startTurn` 随 `resetDiplomacy()` 一并重置。与按钮外交配额 `diplomacyUsedThisTurn` 互不占用。降级（X-Fallback）时前端不置位，允许同回合重试（连续失败由 10 次/分钟限流兜底）。

#### Scenario: 谈判与按钮外交同回合并存
- **WHEN** 玩家本回合已对湘军行贿（消耗 diplomacyUsedThisTurn），随后对淮军发起写信谈判
- **THEN** 谈判正常进行（两个配额独立），本回合不可再点任何外交按钮，也不可再发起第二次谈判

#### Scenario: 降级退还配额
- **WHEN** letter 请求 AI 失败返回 `fallback: true` + `X-Fallback: true`
- **THEN** 前端提示「信使途中受阻，未能送达」，不置位 negotiationUsedThisTurn，玩家可重试

### Requirement: 失败降级

AI 调用异常或 JSON 不可解析时，端点返回 `{ ok: true, data: { stance: 'reject', reply: '', relationshipDelta: 0 }, fallback: true }` 与响应头 `X-Fallback: true`，HTTP 200（与 npc-actions 降级语义一致，游戏不中断）。不重试。

#### Scenario: AI 超时降级
- **WHEN** Agent 调用超过 30 秒超时（AbortSignal）
- **THEN** 返回降级结构 + `X-Fallback: true`，前端走降态文案且退还配额

### Requirement: 并发锁与限流

端点纳入现有 saveId 粒度并发锁（进程内 Map，30 秒自动释放；同 saveId 进行中再请求返回 429 `CONCURRENT_REQUEST`）与 `x-device-id` 10 次/分钟限流（429 `RATE_LIMITED`），与 generate-event / resolve-decision / npc-actions / advisor-chat 共用池。letter 与 settle 不会并发发出（前端状态机保证串行）。

#### Scenario: 重复点击被并发锁拦截
- **WHEN** letter 请求未返回时玩家快速重发同 saveId 请求
- **THEN** 服务端返回 429 `CONCURRENT_REQUEST`，前端防重复提交守卫（发送中 disabled）兜底，不产生双倍 AI 调用

### Requirement: 谈判历史记录

谈判成交（settle accept）或仅信件影响（reject/放弃）后，前端追加事件到 `save.events`（复用 eventType `外交`），内容含势力名、deal 标签（若有）与一句话摘要；事件列表超 50 条按现有规则截断。

#### Scenario: 成交事件入档
- **WHEN** 玩家接受淮军 `alliance-deal` 条件成交
- **THEN** `save.events` 追加 eventType `外交` 的事件（如「与淮军歃血为盟：耗银两 160、名望 8，关系 +28」），下回合 npc-actions 中淮军按 `status='allied'` 退出活跃决策
