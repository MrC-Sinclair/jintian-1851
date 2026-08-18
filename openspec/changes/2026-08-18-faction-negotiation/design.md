# 设计：与 NPC 势力自然语言谈判

## 上下文

- 外交按钮现状：`game-web/src/components/DiplomacyPanel.vue` 6 动作 + `DIPLOMACY_RULES`（`game-web/src/utils/constants.ts`），纯前端确定性规则；`diplomacyUsedThisTurn` 每回合 1 次，`useTurn.startTurn` 内 `resetDiplomacy()` 重置
- NPC Agent 现状：`server/server/api/game/npc-actions.ts` —— `streamText` + `stopWhen: stepCountIs(3)` + `createNpcTools`（`server/server/utils/tool-context.ts`）4 工具（get-faction-info / get-all-factions / get-relationship / get-character-status）+ `Promise.all` 并行；人格提示词 `server/server/utils/prompts/npc-agent.ts` 按 relationship 三分支生成决策目标；JSON 鲁棒提取（`extractNpcActionJson`）+ `normalizeNpcAction` 强制以入参为准防 LLM 自报
- 对话端点参照：`advisor-chat`（SSE 流式 + saveId 并发锁 + 降级 + 10 次/分钟限流）
- 软性影响先例：`2026-08-17-free-action-faction-effects` 确立"自然语言 → 软性微调（relationshipDelta ±20 / powerDelta ±30），禁止改 status"边界。本提案是该原则的**受控扩展**：status 变更只允许经兑换表触发（确定性路径 + 真实资源成本），而非 LLM 自由输出

## Non-Goals

- 不做多轮无限对话（严格两阶段封顶，见 D1）
- 不做势力间关系矩阵（`get-relationship` 仍用平均值近似，与现状一致）
- 不做谈判影响 NPC 其他势力对玩家的看法（溢出效应留给 npc-actions 下回合反应）
- 不改 `DIPLOMACY_RULES` 既有 6 按钮数值（谈判表独立设计，见 D2）
- 不做 SSE 流式回信（见 D3，留作后续升级）

## 决策

### D1：两阶段状态机，单次谈判最多 2 次 AI 调用

- 做法：谈判状态机 `idle → letter_sent → settled`
  - **letter 阶段（调用 1）**：玩家写信（1-200 字）→ Agent 回信，输出 `{ stance: 'accept'|'reject'|'counter', reply, relationshipDelta, deal? }`；`stance='counter'` 时附条件（dealId + Agent 定价）
  - **settle 阶段（调用 2，仅 counter 时可达）**：玩家「接受条件」或「还价」→ Agent 最终裁定 `{ stance: 'accept'|'reject', reply }`，**不再提新条件**；玩家也可「放弃」（不调用，谈判结束，配额已耗）
- 理由：用户设定"最多 3 次调用封顶"，本设计压到 2 次（信件 + 一次追答），成本 ≈ ¥0.0012/次完整谈判，与 npc-actions（¥0.0010/回合）同量级；"接受条件"的效果执行是纯前端确定性计算，不耗 AI

### D2：条件兑换表——LLM 选条件不定价（区间内定价），效果线性缩放

- 做法：`NEGOTIATION_DEALS` 预定义 4 条交易，cost 均为**扣减量**（正值），价格区间内 Agent 可自主定价，效果按同一比例缩放：

```ts
export const NEGOTIATION_DEALS = [
  { id: 'gift-deal',    label: '馈赠通好', cost: { silver: [60, 120] },              effect: { relationship: [10, 20] },                          requires: {} },
  { id: 'trade-deal',   label: '互市通商', cost: { silver: [40, 80] },               effect: { relationship: [8, 15], reputation: [3, 5] },      requires: { minRelationship: 0 } },
  { id: 'truce-deal',   label: '破财止战', cost: { silver: [80, 150] },              effect: { relationship: [15, 25] },                          requires: { maxRelationship: -30 } },
  { id: 'alliance-deal',label: '歃血为盟', cost: { silver: [120, 200], reputation: [5, 10] }, effect: { relationship: [25, 30], status: 'allied' }, requires: { minRelationship: 35 } },
] as const
```

- **线性缩放**：`ratio = (price − costMin) / (costMax − costMin)`（clamp 0~1，锚定主资源 silver，其余资源同 ratio），每个效果值 `= effectMin + ratio × (effectMax − effectMin)` 后取整
- **还价**：玩家仅可对主资源 silver 出价，区间 `[floor(silverMin × 0.5), 原价]`；Agent 裁定接受（按还价重新计算 ratio 与效果）或拒绝
- **防幻觉 sanitize（server 端）**：`dealId` 必须 ∈ 表内 id，否则丢弃 deal 且 stance 强制降为 `reject`；`price` clamp 回区间；`relationshipDelta` clamp ±10；`reply` 截断 200 字；`status` 变更只允许 `alliance-deal` 映射的 `'allied'`（LLM 输出中不含 status 字段，前端按表执行）
- 理由：`alliance-deal` 门槛 35 略低于按钮的 50，但价格更高（银两 120~200 + 名望 5~10 vs 按钮 100 + 10）——谈判的差异化价值是"花更多钱换更低门槛"，形成两条并存的结盟路径；`truce-deal` 补上"宣战后求和"的语言渠道（现状只能行贿 +15 硬拉）。数值均可在评审时调整

### D3：非流式 JSON 返回（不做 SSE）

- 做法：端点一次性返回完整 JSON（回信 ≤160 字 + 结构化 stance/deal），前端 loading 3~8 秒 + 骨架文案
- 理由：回信短、需结构化字段（stance/deal 与文案耦合解析易错），npc-actions 已验证"streamText → text 提取 JSON"模式可直接复用；advisor 的 SSE 是长回复场景，谈判不需要。后续若要打字机体验可升级，接口形状不变

### D4：独立配额，降级退还

- 做法：新 ref `negotiationUsedThisTurn`，发起 `letter` 成功（非 fallback）即置 true；`settle` 不计；`startTurn` 与 `resetDiplomacy()` 一并重置；服务端 X-Fallback 时前端**不置位**配额，允许重试（连续失败由 10 次/分钟限流兜底）
- 理由：谈判是软性/兑换制通道，与按钮外交（确定性即时效果）性质不同，共用配额会让玩家在两者间二选一，降低新功能使用率

### D5：效果执行全在前端，AI 只产出意图与文案

- 做法：`applyNegotiationDeal(dealId, price, letterDelta)` 在 `stores/game.ts` 按兑换表确定性执行（扣资源 → 缩放效果 → 可能的 status 变更 → 追加 `save.events`，eventType 复用 `外交`），与 `applyDiplomacyAction` 相同的不可变更新范式
- 理由：数值权威在客户端规则表（与按钮外交一致的架构），server 只做 AI 编排与 sanitize，避免双端数值逻辑漂移；`sync-save` 整体覆盖 JSONB 的既有同步方式不变

### D6：并发锁 / 限流 / 降级 / E2E 模式全复用

- 做法：加入 `generate-event` / `resolve-decision` / `npc-actions` / `advisor-chat` 共用的 saveId 粒度并发锁（30 秒自动释放，冲突 429 `CONCURRENT_REQUEST`）与 `x-device-id` 10 次/分钟限流；AI 失败返回 `{ ok: true, fallback: true }` + `X-Fallback: true`；支持 `x-e2e-test-mode: 1`（`stepCountIs(1)` + 8 秒超时）
- 理由：谈判两阶段是两次独立 HTTP 请求，锁天然按请求粒度生效（letter 与 settle 不会同时发出——前端状态机保证）；无新增基础设施

## 数据结构

```ts
// ---- server/server/api/game/faction-negotiate.ts ----
const letterBodySchema = z.object({
  saveId: z.string().uuid(),
  turn: z.number().int().positive(),
  phase: z.literal('letter'),
  factionId: z.string().min(1),
  letter: z.string().min(1).max(200),          // 玩家信件
  character: z.object({ background: z.enum(['文官','武将','商贾','士绅','宗室']), factionName: z.string() }),
  stateSnapshot: z.object({                    // 同 npc-actions 结构
    turn: z.number().int().positive(),
    date: z.object({ year: z.number(), month: z.number() }),
    attributes: z.object({ military: z.number(), economy: z.number(), politics: z.number(), people: z.number(), diplomacy: z.number() }),
    resources: z.object({ silver: z.number(), troops: z.number(), food: z.number(), reputation: z.number() }),
  }),
  faction: z.object({ id: z.string(), name: z.string(), summary: z.string(), power: z.number(), relationship: z.number(), status: z.enum(['active','destroyed','allied']) }),
})

const settleBodySchema = letterBodySchema.extend({
  phase: z.literal('settle'),
  letter: z.string().min(1).max(200),
  previousReply: z.string().min(1).max(200),   // letter 阶段的回信（Agent 上下文）
  deal: z.object({ dealId: z.string(), price: z.number() }),  // Agent 上轮提的条件，前端原样带回
  playerResponse: z.enum(['accept', 'counter']),
  counterPrice: z.number().optional(),          // playerResponse='counter' 时必填
})

// 出参（两阶段同构，settle 无 deal 字段）
// { ok: true, data: { stance: 'accept'|'reject'|'counter', reply: string, relationshipDelta: number, deal?: { dealId: z.string(), price: z.number() } }, fallback?: boolean }

// ---- game-web/src/utils/constants.ts ----
export const MAX_NEGOTIATION_PER_TURN = 1
export const NEGOTIATION_LETTER_DELTA_LIMIT = 10       // 信件本身关系影响 clamp ±10
// NEGOTIATION_DEALS 见 D2

// ---- game-web/src/stores/game.ts ----
negotiationUsedThisTurn: Ref<boolean>
applyNegotiationDeal(dealId: NegotiationDealId, price: number, letterDelta: number): boolean  // 成交执行
applyLetterDelta(factionId: string, delta: number): void                                    // 未成交仅信件影响
```

## 多端兼容

- **弹窗与输入**：`NegotiationDialog` 用 uni-app 条件无关的居中弹窗 + `textarea`（H5/小程序行为一致）；信件计数器（x/200）；触摸目标：发送/接受/还价/放弃按钮均 ≥44px 高
- **键盘遮挡**：小程序端 `adjust-position` 默认推起即可，H5 端弹窗 `position:fixed` + `viewport` 单位，已验证模式（外交抽屉同款）
- **无 SSE 依赖**：非流式对三端（H5/微信小程序/App webview）零差异，避免 advisor 的三端流式兼容复杂度
- **降级文案**：fallback 时提示「信使途中受阻，未能送达」（不消耗配额），三端一致

## 验证

- **server 单测**（`pnpm test:unit` in `server/`）：zod schema 边界（letter 长度/counterPrice 必填联动）；sanitize（非法 dealId → reject、price clamp、relationshipDelta clamp、reply 截断）；降级路径（AI 失败 → fallback:true）
- **game-web 单测**：`NEGOTIATION_DEALS` 缩放计算（ratio 0/0.5/1 三档）；`applyNegotiationDeal`（扣费→效果→alliance status 变更→事件追加；资源不足拒绝）；配额（letter 置位、settle 不计、fallback 退还、startTurn 重置、与 diplomacyUsedThisTurn 独立）
- **E2E 冒烟**（`game-web/`，`x-e2e-test-mode: 1`）：写信 → 回信 → 接受条件 → 资源/关系变化断言
- 命令：`cd server && pnpm lint && pnpm typecheck && pnpm test:unit`；`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit`

## 残余不确定性

- ~~`[可调]` **兑换表数值**（门槛 35、价格区间、效果区间）为首版拍脑袋值，建议评审时对照 `tests/unit/diplomacy-balance.test.ts` 的平衡基线再定稿~~ → **已校验（2026-08-18）**：`tests/unit/negotiation-balance.test.ts` 11 项联合平衡校验全过——四路径（无/仅按钮/仅谈判/全开）通关回合数完全一致（28 回合，关系不进综合实力）；最坏情况（还价全接受 + delta 恒 +10）银两全程 >0（both 模式 minSilver 500）、单回合最大理论支出 300 银 ≤ 6 回合自动资源回补；单势力单回合关系跳变 ≤40（模拟内，含自由行动上限 60 与 design 声明一致）；纯信件免费通道 -100→0 需 ≥8 回合；静态性价比 gift/trade/truce 均不超同位按钮的 1.1~1.25 倍。**首版数值无需调整。**
- `[观察]` **还价博弈依赖 Agent 拒绝率**：还价压到下限时性价比翻倍（gift 30 银 +10 关系 ≈ 行贿 1.78 倍），靠 prompt「还价过低可拒绝」+ LLM 人格分支平衡；若线上实测发现 Agent 几乎不拒绝，可收紧 `counterPriceRange` 下限（如 floor(min×0.7)）。
- `[观察]` **极端贪心可全结盟**：最坏情况模拟（还价全接受）both 模式 28 回合内 5 个 NPC 势力全部 allied（npc-actions 退出活跃）。依赖每回合 1 次配额 + 势力数天然封顶，且真实 LLM 不会全接受；发版后观察 npc-actions 空转率。
- `[不确定]` **allied 势力写信**：结盟后是否允许继续写信（维持关系/续盟）？首版允许（兑换表过滤 `alliance-deal`），若测试发现刷分化再收紧
- `[不确定]` **叠加上限**：单回合 relationship 理论最大变化 = 信件 10 + 兑换 30 + 自由行动 20 = 60，MVP 不设全局上限（成本天然限制），发版前观察
- `[跨提案]` **离间对称性**：谈判表无"挑拨两势力"条目（依赖势力间关系矩阵，现状无），与按钮离间的语义局限一致
