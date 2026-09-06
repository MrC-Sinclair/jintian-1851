# 设计：AI 长期记忆（事件语义去重 + 势力关系记忆）

## Goals

- 让 NPC 势力「记得」玩家做过什么，并用记忆影响其决策与叙事，使游戏世界产生跨回合的因果积累
- 让军师能回答 20 回合以外的历史问题（语义检索，而非截断取最近 N 条）
- 消除长局同质事件重复，降低无效 token 消耗
- 兑现 pgvector 能力预留，且**单局 AI 成本增幅 < 2%**、**前端零改动**

## Non-Goals

- 不做跨存档的玩家画像（同一 deviceId 跨局记忆）——属 C 档，本期不做
- 不做记忆的 LLM 摘要压缩（长局记忆裁剪）——长局 50 回合量级无需压缩，条目数可控
- 不引入账号系统，归属模型沿用 `saveId`
- 不改前端：不新增 HTTP 端点，不新增 UI（记忆可见性通过 NPC 行动文案与军师回答自然体现）
- 不把记忆数值化：记忆**不改变** `relationship` 等数值计算路径，只作为 LLM 的决策上下文与叙事素材（见 D8）

## Decisions

### D1：用 pgvector，不引入独立向量库

> ⚠️ **实测发现（2026-09-06 spike）**：`docker/initdb/01-vector.sql` 脚本虽存在且挂载正确（`/docker-entrypoint-initdb.d`），但 `CREATE EXTENSION` **并未自动执行**——该脚本仅在数据目录首次初始化时运行，而 `game-postgres` 容器早于脚本创建（6 周 vs 脚本后加），扩展实际未创建。实测需在 `db:push` 流程中显式执行 `CREATE EXTENSION IF NOT EXISTS vector`（已在 dev 库手动补建，test 库因用户不匹配待补）。
>
> Drizzle 文档明确：**Drizzle 不会自动创建 extension**。故 `tasks.md` 任务 2 第 0 步已加入幂等 `CREATE EXTENSION`。

`drizzle-orm@^0.36` 原生支持 `vector()` 列与 HNSW 索引（要求 ≥0.31，项目 0.36 满足），`pgvector` 镜像自带 0.8.5 扩展文件，执行 `CREATE EXTENSION` 即可启用。

对比独立向量库（如 LanceDB / Qdrant）：pgvector 零新增运维组件、与 `game_saves` 同库可事务一致、数据量级（单局百级条目）远未触及性能瓶颈。选型成本最低。

### D2：双表而非单表

| 表 | 语义 | 检索作用域 | 条目来源 |
|---|---|---|---|
| `game_events` | 情景记忆：本局发生了什么 | `saveId` 全局 | `generate-event` 产出的事件 |
| `faction_memories` | 关系记忆：某势力对玩家的印象 | `saveId` + `factionId` 双重隔离 | `npc-actions`（NPC 自述行动）、`resolve-decision`（玩家对势力的作为） |

拆分的理由是**检索域不同**：事件去重需要跨回合全局视野；NPC 决策必须只读自己的记忆，若混在一张表里要靠 `where factionId = ?` 过滤，语义纠缠且易误召回。双表让「NPC 只能看到自己的记忆」成为表结构层面的硬约束。

### D3：embedding 模型选 `BAAI/bge-large-zh-v1.5`（实测更优）+ 截断约束

SiliconFlow 实测价格与延迟（2026-09-06 spike 核实）：

| 模型 | 价格 | 维度 | 上下文 | 单句延迟 |
|---|---|---|---|---|
| `BAAI/bge-large-zh-v1.5` | **免费** | 1024 | 512 token | ~99ms |
| `BAAI/bge-m3` | 免费（Pro 档 ¥0.07/M） | 1024 | 8K | ~327ms |
| `Pro/BAAI/bge-m3` | ¥0.07 / M tokens | 1024 | 8K | ~327ms |

**实测选 `bge-large-zh-v1.5`**，理由（spike 对比 8 组中文近代样本，余弦相似度）：

| 类别 | bge-m3 | bge-large-zh-v1.5 |
|---|---|---|
| A 近义重复（应去重） | 0.739~0.834 | **0.798~0.860** |
| B 主题相关（不应误杀） | 0.438~0.696 | 0.554~0.731 |
| C 完全无关（噪声） | 0.331~0.450 | **0.305~0.420** |

`bge-large-zh-v1.5` 的 A/B 区分间隔（0.067）明显宽于 `bge-m3`（0.043），中文古文语义分离更干净；延迟仅 1/3，免费档下无成本差异。

**硬约束（spike 实测）**：`bge-large-zh-v1.5` 的 512 token 是**硬上限**，超长直接返回 `Bad Request`（非静默截断）。故 `embedText` SHALL 在调用前将 content 截断到 `EMBEDDING_MAX_CHARS = 750` 字符（≈500 token，留安全余量），截断后再向量化。事件文本（标题+描述 ~200 字）天然安全；玩家自由输入可能超长，截断必要。

> `bge-m3` 保留为备选：若未来需检索超长文本且不愿截断，可一键切 `bge-m3`（8K 上下文）；其 A/B 间隔更窄，阈值需相应回退到 (0.70, 0.74]（见 D9）。模型 ID 沉淀于 `config/models.ts`，切换仅改一处。

维度固定 **1024**，写入 schema 为 `vector('embedding', { dimensions: 1024 })`。

> 注：2026-09-05 提案 D3 写的是 `BAAI/bge-m8-zh`（¥0.065/1M），该模型名在 SiliconFlow 模型广场未检索到，疑为笔误；本提案以实测的 `bge-large-zh-v1.5` 替换。

### D4：记忆写入后端自足，前端零改动（关键决策）

当前后端无状态：事件与决策数据存在前端本地存档，后端只在被调用时看到请求体快照。因此必须明确记忆写入的数据来源边界：

| 记忆源 | 后端是否可见 | 写入位置 | 目标表 |
|---|---|---|---|
| 生成的回合事件 | ✅ `generate-event` 自己产出 | 生成成功后 fire-and-forget | `game_events` |
| NPC 本回合行动 | ✅ `npc-actions` 自己产出 | Agent 决策成功后 fire-and-forget | `faction_memories` |
| 玩家自由输入决策（含 `factionEffects`） | ✅ `resolve-decision` 自己产出 | 判定成功后 fire-and-forget | `faction_memories` |
| 玩家选预置选项（不调后端，前端直接应用 `option.effects`） | ❌ 后端不可见 | — | — |

**决策**：前三类覆盖了最关键的记忆源——「发生了什么」「NPC 做过什么」「玩家主动做过什么」。第四类（选预置选项）大多只改玩家自身属性、少含势力关系变化，本期放弃，换取**前端零改动**与后端独立可交付。

写入方式沿用 `advisor-briefing` 的 fire-and-forget 哲学：**不阻塞回合主流程、不占用 `concurrency-lock`、失败静默跳过**。记忆是增益而非必需，绝不能因写记忆失败而让回合卡住。

### D5：全链路降级（沿用项目既有降级哲学）

| 失败点 | 降级行为 | 响应标识 |
|---|---|---|
| embedding 调用失败/超时（10s） | 跳过该条记忆写入 | 无（静默，仅 warn 日志） |
| 向量检索失败 | 跳过检索，端点走既有逻辑（事件照常生成 / NPC 照常决策 / 军师照常回答） | `X-Memory-Skip: true` |
| 表为空（首回合无历史） | 正常返回空结果，不视为失败 | 无 |

`advisor-chat` 流式路径特殊处理：`search-memory` 工具在 `execute` 内同步 await 检索（bge-large-zh-v1.5 延迟百毫秒级，~99ms），失败时返回 `{ error: 'MEMORY_UNAVAILABLE' }`，LLM 自行转向其他工具或直接回答。前端已有 `tool-call` 气泡机制（"军师正在查询…"），**无需改动**。

### D6：规避 postgres-js 的 vector 类型解析坑

`postgres@^3.4` 未注册 pgvector 的 `vector` 类型 OID parser，SELECT 出 vector 列会退化为字符串 `'[0.1,0.2,...]'`，需在应用层手工 JSON.parse。

**规避方案：查询一律不 select embedding 列**，只 select 相似度标量：

```ts
const similarity = sql`1 - (${cosineDistance(gameEvents.embedding, queryVec)})`
db.select({ id: gameEvents.id, content: gameEvents.content, similarity })
  .from(gameEvents)
  .where(and(eq(gameEvents.saveId, saveId), gt(similarity, 0.9)))
  .orderBy((t) => desc(t.similarity))
  .limit(5)
```

`similarity` 是 `float8`，postgres-js 原生支持，无需自定义 parser。

插入侧无坑：Drizzle `vector` 列的 `mapToDriverValue` 会 `JSON.stringify` 成 `'[0.1,0.2]'` 字面量，pgvector 可直接消费。

> 若未来确需回读原始向量，再在 postgres.js 客户端注册 `types` 自定义 parser，本期不做。

### D7：NPC 记忆的作用域硬隔离

`faction_memories` 查询必须同时满足 `saveId = ?` **且** `factionId = ?`。每个 NPC Agent 只能检索自己的记忆，在 `buildNpcAgentPrompt` 中以「你记得关于玩家势力的事」注入。

隔离的两个理由：① 湘军不该知道淮军和玩家的私下交易；② 防止 6 个 Agent 召回同一批记忆导致决策同质化。

### D8：记忆只影响叙事与意图偏置，不改数值

**风险**：若记忆直接驱动 NPC 敌对行为，长局中负面记忆会单向累积，6 个势力集体记仇 → 玩家被围殴 → 难度失控。

**对策**：
- `faction_memories` 记录 `sentiment`（`positive` / `negative` / `neutral`），检索时 **topK 内正负混合召回**，prompt 同时呈现恩怨两面
- `relationship` 数值仍由既有 `factionEffects` 体系计算，记忆**不参与**任何数值结算
- 记忆只改变 NPC 的「意图倾向」与「行动描述文案」（如"念及当年湘军曾受其资助，按兵不动" / "旧怨未雪，此次必取其利"）

即：记忆改变的是**怎么说和倾向怎么做**，不是**结算数字**。

### D9：检索参数（基于 spike 实测校准）

基于实测区间（bge-large-zh-v1.5：A 类近义 0.798~0.860、B 类主题相关 0.554~0.731、C 类无关 0.305~0.420）：

| 消费点 | 阈值 | topK | 作用域 | 校准依据 |
|---|---|---|---|---|
| `generate-event` 事件去重 | **0.76** | 5 | `saveId` | 介于 B 最高 0.731 与 A 最低 0.798 之间 |
| `npc-actions` NPC 记忆 | **0.45** | 3 | `saveId` + `factionId` | 高于 C 最高 0.420、低于 B 最低 0.554，召回优先 |
| `advisor-chat` 军师检索 | **0.45** | 5 | `saveId` | 同 NPC，召回优先允许弱相关联想 |

> ⚠️ **阈值校准修正（spike 实测）**：原设计「去重 0.9 / 召回 0.5」经实测证明 **0.9 形同虚设**——A 类最高相似度仅 0.860，永远触发不了去重。现按模型实测区间重设。阈值沉淀为常量（`DEDUP_THRESHOLD = 0.76` / `RECALL_THRESHOLD = 0.45`），上线后按监控调优（样本仅 8 组/类，灰度期建议复核）。

### D10：并发控制与 token 成本策略

**并发**：
- 记忆写入：fire-and-forget，**不占用** `concurrency-lock`（无副作用，与 `advisor-briefing` 同款）
- 记忆检索：在既有端点内执行，受端点已有的 `saveId` 锁保护，无新增并发面
- embedding 调用统一 `AbortSignal.timeout(10_000)`

**成本**（按 50 回合典型局）：

| 场景 | 次数 | 单次 tokens | 小计 |
|---|---|---|---|
| 事件向量化（写入） | 50 | ~150 | 7,500 |
| NPC 行动记忆写入 | ~100（2 NPC × 50 回合） | ~80 | 8,000 |
| 事件去重检索（查询 embedding） | 50 | ~100 | 5,000 |
| 军师记忆检索 | ~50 | ~50 | 2,500 |
| NPC 记忆检索 | ~100 | ~30 | 3,000 |
| **合计** | | | **~26K tokens/局** |

- 免费档（`BAAI/bge-large-zh-v1.5`，本提案选用）：**¥0**
- Pro 档（`Pro/BAAI/bge-m3`，¥0.07/M）：≈ **¥0.0018/局**

对比 `docs/ai-cost.md` 现有单局 ¥0.11（含军师），增幅 **< 2%**，MVP 阶段（<100 DAU）月度增量可忽略。

**缓存**：embedding 单次成本 ≈ 0，不做结果缓存（缓存收益低于复杂度）。`generate-event` 的既有 5 分钟缓存逻辑不变——缓存命中时**跳过**检索（无需去重）。

**流式输出**：`advisor-chat` 为 SSE 流式。记忆检索发生在两种时机：① `search-memory` 工具被 LLM 调用时（工具 execute 内同步 await）；② 不预注入全量记忆（避免首 chunk 延迟）。工具调用期间前端已有 "军师正在查询…" 气泡，体验无损。

## 风险

| 风险 | 缓解 |
|---|---|
| SiliconFlow 免费档 embedding 有速率限制或后续转为收费 | 模型 ID 沉淀在 `config/models.ts`，可一键切 Pro 档或 `bge-large-zh-v1.5`；全链路降级保证不影响主玩法 |
| 近代文言语境下 embedding 语义匹配质量不达预期 | 阈值做成常量，实测后调优；初始阈值取保守值（去重 0.9 / 召回 0.5） |
| 负面记忆单向累积导致难度失控 | D8 的正负混合召回 + 记忆不参与数值结算双保险 |
| 长局记忆条目膨胀 | 单局 50 回合量级约 150~200 条，远未触及 pgvector 瓶颈；后续可加 `saveId` 维度的定期清理任务（本期不做） |
| HNSW 索引对既有数据的影响 | 两表均为新建空表，无历史数据迁移风险 |
