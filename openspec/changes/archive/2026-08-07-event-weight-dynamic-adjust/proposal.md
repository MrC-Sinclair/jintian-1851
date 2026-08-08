# 变更提案：事件权重动态调整

> **状态：已归档（代码已落地，2026-08-07；提案评审后实现）**
> 关联设计规则：`docs/game-design.md:570`
> 关联 spec：`openspec/specs/ai-event-engine/spec.md`

## 背景

`docs/game-design.md:570` 规定：

> **事件权重动态调整**：根据玩家属性短板提高对应类型事件出现率（如 military < 30 时军事事件 +20% 概率）

当前现状（已查证）：
- `server/server/api/game/generate-event.ts` 调用 LLM 时传入 `stateSnapshot`（含玩家 attributes），
  但 `server/server/utils/prompts/generate-event.ts` 的提示词**只让 LLM「自由选类型」**，
  未注入任何"属性短板→类型加权"的明确指令，更无程序化概率控制。
- 事件类型（eventType）由 LLM 自由生成，设计意图的"补短板"导向在代码层**完全缺失**。

这是一条**后端 LLM 行为调优**类规则：核心改动在 server 提示词 + 可选的客户端结构化加权，
无法像纯函数那样做确定性单测，风险高于前端的确定性逻辑。

## 改动

1. **server 提示词增强**（`server/utils/prompts/generate-event.ts`）：
   - 新增"短板导向"指令段：前端在请求中附带 `attributeShortfall`（由客户端基于 `Attributes` 计算，
     低于阈值 30 的维度标记为短板），提示词据此要求 LLM 优先产出对应类型事件（如军事短板→军事/战争类）。
   - 保留 LLM 自由度的同时，把"补短板 +20%"作为**软性偏好**写入指令（+20% 为方向性目标，非硬约束，
     避免 LLM 输出退化或类型分布失真）。
2. **请求契约扩展**（`/api/game/generate-event`）：
   - 入参新增可选 `attributeShortfall: { dimension: string; value: number }[]`；
   - 透传到 prompt builder，不参与业务计算，仅作 LLM 输入信号。
3. **客户端短板计算**（`game-web/src/composables/useTurn.ts` 或新增 `utils/attribute-shortfall.ts`）：
   - 在 `startTurn` 组装请求时，基于 `s.state.attributes` 计算短板维度（值 < 30），一并传给后端。
   - **常量复用**：短板阈值复用既有 `CRISIS_THRESHOLD = 30`（`goal-hint.ts:19`，语义即"属性 < 30 视为短板/危机"），不新建 `SHORTFALL_THRESHOLD`，避免同义常量散落；`SHORTFALL_BONUS = 20`（+20% 偏好强度）入 `utils/constants.ts`。
4. **spec 同步**：在 `ai-event-engine` spec 新增 Requirement「事件短板导向生成」。

## 影响面

- **后端**：`generate-event.ts` API 入参 + `prompts/generate-event.ts` 提示词。
- **前端**：`useTurn.startTurn` 请求组装；新增/复用短板计算纯函数（可单测）。
- **协议**：`GenerateEventRequest` 新增可选字段，向后兼容（旧客户端不传则无短板偏好）。
- **不改动**：事件 resolve、资源、结局判定、UI 展示。

## 残余不确定性

- `[不确定]` LLM 对"补短板"软指令的遵循度依赖模型行为，无法 100% 保证 +20% 命中；
  建议以"短板维度事件占比相对基线提升"作为验收口径，而非精确概率。
- `[不确定]` 提示词增强可能略微增加 token 消耗（单次事件生成），需关注 `docs/ai-cost.md` 成本上限；
  建议实现后跑一次成本对照。
- `[不确定]` 若 LLM 过度集中短板类型导致体验单调，需回归"软偏好"强度（引入 `SHORTFALL_BONUS` 调节）。
- `[澄清]` **缓存键**：`generate-event.ts:160-173` 的 `computeCacheKey` 已含 `stateSnapshot` 哈希，`attributeShortfall` 由 attributes 派生（< 30），与 stateSnapshot 冗余——**不可**将 `attributeShortfall` 单独加入缓存键（无额外区分度且徒增键长度）。
- `[澄清]` **提示词已含属性值**：`prompts/generate-event.ts:52-54`【当前局势】已列出全部 5 维属性数值，LLM 本就能看到 military=15。本提案增量价值在于**显式短板导向指令**（把"看到低值"转为"被要求补短板"），非新增信息输入；实现者勿误以为此前 LLM 看不到短板。
- `[跨提案]` 本提案与 `resource-per-turn-yield`、`weighted-overall-power` 同属"后续平衡方向"，三者**联合降低难度**（被动补短板 + 免费资源 + 内政加速达 90）。三者全部落地后须跑一次联合平衡校验，对比落地前后胜利回合数/崩溃率，避免单看合理、合看失序（见 C1）。
