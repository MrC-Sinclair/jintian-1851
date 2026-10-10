# 金田：1851 — AI 成本与缓存策略

> 本文档说明 GAME 项目 AI 调用的 token 成本预估、缓存策略、降级方案，与 [design.md D3-D5](file:///d:/code/codeWork/jintian-1851/openspec/changes/archive/add-qing-revival-mvp/design.md) 保持一致。

## 模型分配

MVP 阶段全部使用 `Qwen/Qwen3-8B`（硅基流动 SiliconFlow），单价约 ¥0.35 / 1M tokens（输入+输出统一价）。

| 调用场景 | 模型 | 调用方式 | `enable_thinking` | 超时 |
|---|---|---|---|---|
| 开局生成势力 | `Qwen/Qwen3-8B` | `generateObject()` | `true` | 30s |
| 回合事件生成 | `Qwen/Qwen3-8B` | `generateObject()` | `true` | 30s |
| 自由决策判定 | `Qwen/Qwen3-8B` | `generateObject()` | `true` | 30s |
| NPC 势力行动 | `Qwen/Qwen3-8B` | `generateObject()` | `true` | 30s |
| 军师对话（流式） | `Qwen/Qwen3-8B` | `streamText()` SSE | `false` | 60s |
| 势力谈判（写信/裁定） | `Qwen/Qwen3-8B` | `streamText()` + 工具 | `false` | 30s |

**未启用模型**（保留）：

| 模型 | 原计划场景 | MVP 状态 |
|---|---|---|
| `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` | 开局深度推演 | 未启用（R1 强制思考 10-30s 延迟，玩家流失风险） |
| `Qwen/Qwen3.5-4B` | 视觉场景 | 未启用（MVP 无多模态需求） |
| `THUDM/GLM-Z1-9B-0414` | 备选 | 未启用 |

**Embedding 模型**（AI 长期记忆提案新增）：

| 模型 | 场景 | 价格 | 维度 | 上下文 | 单句延迟 |
|---|---|---|---|---|---|
| `BAAI/bge-large-zh-v1.5` | 记忆向量化（事件去重 / NPC 记忆 / 军师检索） | **免费** | 1024 | 512 token（硬上限，超长 400） | ~99ms |

> 模型 ID 沉淀于 [server/server/config/models.ts](file:///d:/code/codeWork/jintian-1851/server/server/config/models.ts)（`EMBEDDING_MODEL_ID`），调用统一走 `embedText()`（512 token 硬上限 → 内容先截断到 750 字符再向量化）。备选 `Pro/BAAI/bge-m3`（8K 上下文，¥0.07/M tokens），切换仅需改一处配置。

## 单回合 AI 调用拆分

参考 [design.md D3](file:///d:/code/codeWork/jintian-1851/openspec/changes/archive/add-qing-revival-mvp/design.md) 的「AI 全包四段拆分」。

### 必发调用（每回合固定）

| 序号 | 接口 | 触发条件 | 备注 |
|---|---|---|---|
| 1 | `generate-event` | 回合开始 | 缓存键 `sha256(saveId + turn + sha256(stateSnapshot JSON) + sha256({ pendingChainNodes, completedChainIds, activeChainIds }))`，5 分钟 TTL |
| 2 | `npc-actions` | 玩家决策后 | 无缓存，每回合必发 |

### 条件调用

| 序号 | 接口 | 触发条件 | 备注 |
|---|---|---|---|
| 3 | `resolve-decision` | 玩家选择「自由行动」输入而非事件预置选项 | 选事件选项时不调用，前端直接应用 `option.effects` |
| 4 | `advisor-chat` | 玩家点击「军师」 | 可一回合多次触发，每次对话独立 |
| 5 | `faction-negotiate` | 玩家发起「写信谈判」 | 单次谈判最多 2 次调用（letter + settle），受独立配额 `negotiationUsedThisTurn`（每回合 1 次）约束；letter 降级不消耗配额可重试 |

### 开局调用

| 序号 | 接口 | 触发条件 | 备注 |
|---|---|---|---|
| 0 | `init-factions` | 进入角色创建页 | 单次调用，6-8 个势力 |

## Token 成本预估

> Qwen3-8B 单价 ¥0.35 / 1M tokens，下表估算含输入+输出。
>
> **实测校准数据源**：各端点 LLM 调用已统一设置 `maxOutputTokens` 上限，并在调用完成后输出 `[llm-usage]` 单行 JSON 日志（含 endpoint / inputTokens / outputTokens / totalTokens，多步 Agent 按次记录），生产环境可用日志聚合校准下表纸面估算（见 `server/utils/llm-usage.ts`）。
>
> **输出上限**：generate-event 2000 / resolve-decision 500 / init-factions 2500 / npc-actions 1000（每 Agent）/ advisor-chat 1500 / advisor-briefing 800 / faction-negotiate 1000。

### 单回合成本

| 调用 | 输入 token | 输出 token | 单次成本 |
|---|---|---|---|
| `generate-event`（含 system prompt + stateSnapshot + factions） | ~1500 | ~600 | ¥0.000735 |
| `npc-actions`（含 system prompt + compressedFactions + stateSnapshot） | ~1200 | ~500 | ¥0.000595 |
| `resolve-decision`（仅自由输入时） | ~1800 | ~100 | ¥0.000665 |
| `advisor-chat`（单轮，~300 字回复） | ~2000 | ~500 | ¥0.000875 |
| `faction-negotiate`（单阶段：人格 prompt + 兑换表 + 信件/上下文） | ~1200 | ~250 | ¥0.000508 |

> 谈判完整一轮（letter + settle）≈ 2 × ¥0.000508 ≈ ¥0.001，与 npc-actions（每回合必发）同量级；接受条件的效果执行是纯前端确定性计算，不耗 AI。

**典型回合**（选项决策 + 1 次军师对话）：

```
generate-event + npc-actions + advisor-chat
= ¥0.000735 + ¥0.000595 + ¥0.000875
= ¥0.002205 / 回合
```

**自由输入回合**（自由决策 + 1 次军师对话）：

```
generate-event + resolve-decision + npc-actions + advisor-chat
= ¥0.000735 + ¥0.000665 + ¥0.000595 + ¥0.000875
= ¥0.002870 / 回合
```

### 单局成本（典型 50 回合）

| 场景 | 计算 | 单局成本 |
|---|---|---|
| 全部选项决策，无军师对话 | 50 × (¥0.000735 + ¥0.000595) | ¥0.0665 |
| 全部选项决策 + 每回合军师 | 50 × ¥0.002205 | ¥0.110 |
| 全部自由输入 + 每回合军师 | 50 × ¥0.002870 | ¥0.144 |
| 开局 + 50 回合 + 每回合军师 | ¥0.001 + ¥0.110 | **¥0.111** |

**结论**：单局成本约 ¥0.07 ~ ¥0.15，可接受。

### Embedding 成本（AI 长期记忆）

按 50 回合典型局的 embedding 调用拆分（design.md D10）：

| 场景 | 次数 | 单次 tokens | 小计 |
|---|---|---|---|
| 事件向量化（写入，generate-event 成功后） | 50 | ~150 | 7,500 |
| NPC 行动记忆写入（npc-actions 成功后） | ~100（2 NPC × 50 回合） | ~80 | 8,000 |
| 玩家行动记忆写入（resolve-decision 含 factionEffects 时） | ~30 | ~80 | 2,400 |
| 事件去重检索（generate-event LLM 路径前） | 50 | ~100 | 5,000 |
| 军师记忆检索（advisor-chat search-memory 工具） | ~50 | ~50 | 2,500 |
| NPC 记忆检索（npc-actions 决策前，正/负/中 3 路） | ~100 | ~30 | 3,000 |
| **合计** | | | **~26K tokens/局** |

| 计费档位 | 单局成本 | 说明 |
|---|---|---|
| 免费档（`BAAI/bge-large-zh-v1.5`，当前选用） | **¥0** | SiliconFlow 免费档 |
| Pro 档（`Pro/BAAI/bge-m3`，¥0.07/M） | ≈ **¥0.0018/局** | 备选，需检索超长文本时切换 |

**结论**：对比单局 ¥0.11（含军师）的 LLM 成本，embedding 增幅 **< 2%**；免费档下为 ¥0。embedding 不做结果缓存（单次成本 ≈ 0，缓存收益低于复杂度）；`generate-event` 缓存命中时跳过去重检索，不产生 embedding 调用。全链路失败静默降级（写入跳过 / 检索返回空），不重试、不阻断回合。

### 架构升级对成本的影响（agent-architecture-upgrade）

agent 化改造改变了两处 AI 调用的形态，整体单局 token 成本上升，但仍在可接受区间：

| 调用 | 升级前 | 升级后 | 成本变化 |
|---|---|---|---|
| `advisor-chat`（纯文本轮） | 单步 `streamText` | 单步 `streamText`（无工具调用时等价） | 不变 |
| `advisor-chat`（触发工具轮） | — | 军师先调工具（`get-recent-events` 等），工具结果回灌第二步再生成回复；请求额外携带工具定义 | 单轮输入 token **+40%~60%**（两步叠加，仅触发工具的轮次受影响） |
| `npc-actions` | 单次结构化生成全部 NPC 行动 | 每个 active 势力独立 Agent 并行（`buildNpcAgentPrompt` + `createNpcTools`，`stopWhen: stepCountIs(5)`） | 随 active 势力数**线性上升**（N 个 Agent × 各自 system prompt + 最多 5 步） |
| `npc-actions-finalize`（空文本兜底） | — | 某 Agent 步数被工具调用吃光导致 `text` 为空时，不带 tools 再跑一轮强制出 JSON | **仅失败时产生**（实测约 10% 的 Agent 触发），单步、输入含已完成的工具结果，约等于该 Agent 的一次额外调用 |
| `generate-event` | 直接用请求体 `recentEvents` | 改由 `get-recent-events` 工具注入（失败降级回请求体，见 `X-Tool-Fallback`） | 基本不变（工具调用在进程内，无额外 LLM token） |

**混合单回合估算（含工具调用与多 Agent）**：

假设单局 50 回合中，约 50% 的军师对话轮次触发工具、active NPC 平均 2 个：

```
generate-event                        ≈ ¥0.000735  （不变）
npc-actions（2 个 Agent，含多步）     ≈ ¥0.0010   （原 ¥0.000595，约 ×1.7）
advisor-chat（含~50% 工具轮，混合）   ≈ ¥0.0011   （原 ¥0.000875，约 ×1.25）
= ¥0.002835 / 回合（典型，含军师）
```

对比升级前典型回合 `¥0.002205`，约 **+29%**；若军师高频使用工具或 active 势力更多，单回合可较升级前高 **40%~60%**。考虑到单局绝对值仍仅约 ¥0.11~¥0.16，MVP 阶段（< 100 DAU）月度成本仍 < ¥500，可接受。

### 月度成本预估（1000 DAU）

假设单用户日均 1 局 50 回合 + 每回合军师：

```
1000 用户 × ¥0.111 / 局 × 1 局 / 日 × 30 日
= ¥3330 / 月
```

**MVP 阶段**（< 100 DAU）：< ¥333 / 月，可接受。

## 缓存策略

源码：[server/utils/ai-cache.ts](file:///d:/code/codeWork/jintian-1851/server/server/utils/ai-cache.ts)

### 缓存范围

**仅 `generate-event` 接口启用缓存**，其他 AI 接口不缓存。

### 缓存键

```
sha256(saveId + turn + sha256(JSON.stringify(stateSnapshot)) + sha256(JSON.stringify({ pendingChainNodes, completedChainIds, activeChainIds })))
```

**不含 `playerDecision`**：因为 `generate-event` 接口不接收玩家决策（事件生成与玩家决策解耦，详见 [design.md D6](file:///d:/code/codeWork/jintian-1851/openspec/changes/archive/add-qing-revival-mvp/design.md)）。

### 缓存存储

- **进程内 `Map<key, { result, expireAt }>`**：MVP 单实例够用
- **不持久化**：进程重启清空
- **后续可换 Redis**：当多实例部署时

### TTL

- 默认 5 分钟（`CACHE_TTL_MS = 5 * 60 * 1000`）
- 命中时响应头 `X-Cache: HIT` 直接返回，不调用 LLM

### 缓存失效场景

| 场景 | 是否失效 | 原因 |
|---|---|---|
| 同回合重新打开游戏 | 否 | stateSnapshot 不变，缓存命中 |
| 玩家决策后下一回合 | 是 | turn +1，缓存键变化 |
| 玩家切换存档 | 是 | saveId 变化，缓存键变化 |
| 属性变化（如 NPC effects 应用） | 是 | stateSnapshot 变化，缓存键变化 |
| 剧情链状态变化（如新挂起节点、完成剧情链） | 是 | 缓存键含 chainHash（pendingChainNodes / completedChainIds / activeChainIds），键变化 |
| 进程重启 | 是（全部失效） | 进程内 Map 不持久化 |
| 5 分钟后 | 是 | TTL 过期 |

## 降级策略

参考 [design.md D3](file:///d:/code/codeWork/jintian-1851/openspec/changes/archive/add-qing-revival-mvp/design.md) 「降级策略」。

### 统一原则

- **任一段失败不阻断回合**：用预置数据兜底
- **响应头 `X-Fallback: true`**：前端可识别降级状态（如显示「军师推演受阻」提示）
- **响应体 `fallback: true`**：机器可读
- **重试 1 次后降级**：`generateObject` 路径重试 1 次（共 2 次调用），仍失败则降级
- **`advisor-chat` 不重试**：流式响应中途失败无法重试（已写入部分 chunk）

### 各接口降级

| 接口 | 降级返回 | 数据源 |
|---|---|---|
| `init-factions` | 6 个预置势力 | [fallback-factions.ts](file:///d:/code/codeWork/jintian-1851/server/server/runtime/fallback-factions.ts)（湘军/淮军/太平天国/清廷/北洋/革命党，按 background 调整 initialRelationship） |
| `generate-event` | 随机预置事件 | [fallback-events.ts](file:///d:/code/codeWork/jintian-1851/server/server/runtime/fallback-events.ts)（60 条事件，5 类型各 12 条） |
| `resolve-decision` | 默认 effects `{military:-3, economy:-3, politics:-3, people:-3, diplomacy:-3}` | 模拟决策失误的惩罚 |
| `npc-actions` | `{ actions: [] }` | 跳过本回合 NPC 行动 |
| `advisor-chat` | 流式写 `data: {"error":"AI_CALL_FAILED"}` 后 end | 前端显示「军师沉默」占位 |
| `faction-negotiate` | `{ stance:'reject', reply:'', relationshipDelta:0 }` + `fallback:true`（不重试） | 前端提示「信使途中受阻」，letter 阶段不消耗谈判配额 |

## 频率限制

源码：[server/middleware/rate-limit.ts](file:///d:/code/codeWork/jintian-1851/server/server/middleware/rate-limit.ts)

| 项 | 值 |
|---|---|
| 限制范围 | 7 个 AI 端点（init-factions / generate-event / resolve-decision / npc-actions / advisor-chat / advisor-briefing / faction-negotiate，不含 `sync-save`） |
| 限制维度 | `deviceId`（请求头 `x-device-id`） |
| 限制阈值 | 10 次 / 分钟 |
| 超限响应 | HTTP 429 + `RATE_LIMITED` |
| 存储 | 进程内 `Map<deviceId, { count, resetAt }>` |
| 重置 | 1 分钟滚动窗口 |

## 并发锁

源码：[server/utils/concurrency-lock.ts](file:///d:/code/codeWork/jintian-1851/server/server/utils/concurrency-lock.ts)

| 项 | 值 |
|---|---|
| 锁粒度 | `saveId` |
| 锁实现 | 进程内 `Map<saveId, Promise>`，请求到达时若有进行中 Promise 则返回 429 |
| 锁超时 | 30 秒自动释放（防死锁） |
| 超限响应 | HTTP 429 + `CONCURRENT_REQUEST` |
| 设计目的 | 防止玩家快速点击导致同一回合多次 AI 调用浪费 token（前端 `isProcessingTurn` 防抖的兜底） |

## 成本优化建议

### 短期（MVP 阶段）

1. ✅ `generate-event` 5 分钟缓存（已实现）
2. ✅ 选项预定义 effects（已实现，玩家选选项时无需调用 `resolve-decision`）
3. ✅ `advisor-chat` 消息截断（已实现，保留最后 20 条）
4. ✅ `npc-actions` 势力压缩（已实现，`compressFactions` 仅传 4 字段）

### 中期（用户增长后）

1. **Redis 缓存**：替换进程内 Map，支持多实例共享缓存
2. **更长 TTL**：`generate-event` 缓存延长至 30 分钟（玩家若回头重玩同回合可命中）
3. **模型分级**：简单事件用 `Qwen3.5-4B`（更便宜），复杂事件用 `Qwen3-8B`
4. **批量调用**：单次 LLM 调用同时生成 event + npc-actions（牺牲容错换成本）

### 长期（商业化阶段）

1. **本地小模型**：玩家本地推理简单事件，云端仅处理复杂场景
2. **用户付费分级**：免费用户限频更严，付费用户解锁 `DeepSeek-R1` 深度推演
3. **缓存预热**：开局时预生成常用事件模板，玩家进入回合时直接命中
