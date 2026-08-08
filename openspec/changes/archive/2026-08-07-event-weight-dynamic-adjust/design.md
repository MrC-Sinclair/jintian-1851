# 设计：事件权重动态调整

## 上下文

`game-design.md:569` 要求事件生成向玩家属性短板倾斜。现有链路：

```
useTurn.startTurn
  → POST /api/game/generate-event { stateSnapshot: s.state, ... }
  → server generate-event.ts
  → buildGenerateEventPrompt(stateSnapshot, ...)
  → LLM 自由生成 eventType
```

`buildGenerateEventPrompt` 当前未对 eventType 做短板导向约束（已读 `prompts/generate-event.ts` 确认）。

## 决策

### D1：短板信号由客户端计算，后端仅作提示词输入（推荐）
- 客户端计算 `attributeShortfall`（值 < 30 的维度），随请求传入；
- server 仅将其拼入 prompt，**不做服务端概率运算**，保持后端无状态、易测试。
- 理由：短板阈值是前端展示层概念（与 StatusPanel 文案同源），放客户端避免前后端重复定义。

### D2：软偏好 vs 硬约束
- 采用**软偏好**（+20% 方向性引导），写入 prompt 指令；
- 不实现"服务端按权重抽事件类型"的硬路由（会破坏 LLM 叙事连贯性，且需类型枚举落地）。
- 理由：事件类型由 LLM 生成、无封闭枚举，硬路由不可行也不必要。

### D3：阈值复用、加成集中为常量
- **短板阈值复用** `CRISIS_THRESHOLD = 30`（`goal-hint.ts:19`，语义即"属性 < 30 视为短板/危机"），不新建 `SHORTFALL_THRESHOLD`，避免同义常量散落导致后续调阈值漏改；
- `SHORTFALL_BONUS = 20`（+20% 偏好强度，来自设计规则示例）放入 `game-web/src/utils/constants.ts`，便于平衡微调；
- 跨提案常量收口（C2）：`CRISIS_THRESHOLD`/`VICTORY_THRESHOLD` 统一 import 自 `constants.ts`，`goal-hint.ts` 与 `end-conditions.ts` 不各自定义。

### D4：向后兼容
- `attributeShortfall` 为可选字段；server 缺失时跳过短板指令段，行为退化为现状。

## 数据结构

```ts
// 客户端计算
type AttributeShortfall = { dimension: keyof Attributes; value: number }

function calcAttributeShortfall(
  attrs: Attributes,
  threshold = CRISIS_THRESHOLD  // 复用 goal-hint.ts 的 30，不新建 SHORTFALL_THRESHOLD
): AttributeShortfall[]

// 请求契约（GenerateEventRequest 扩展）
attributeShortfall?: AttributeShortfall[]
```

## 提示词片段（伪代码）

```
若 attributeShortfall 非空：在生成事件类型时，优先选择能弥补以下短板的事件类型，
相对基线约 +20% 倾向（示例：military 短板→军事/战争/边患类事件）。
保持叙事合理，勿生硬堆砌。
```

## 多端兼容

- 纯协议 + 前端纯函数，无浏览器 API，H5/小程序/App 一致。
- 后端提示词变更不影响客户端渲染。

## 验证

- 单测：`calcAttributeShortfall`（值 < 30 返回、≥ 30 不返回、空 attrs 返回 []）。
- 集成：mock LLM 响应，断言请求体含 `attributeShortfall`；缺失时 prompt 无短板段。
- **缓存**：确认 `attributeShortfall` 未被加入 `computeCacheKey`（由 stateSnapshot 派生，冗余）。
- 验收（不确定性）：H5 实测多回合，统计短板维度事件占比相对基线提升。
