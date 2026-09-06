# ai-long-term-memory 规格

> 记忆底座：双表存储、bge-large-zh-v1.5 向量化、异步写入、全链路降级。对应 design.md D1-D6、D10。

## ADDED Requirements

### Requirement: 记忆表结构

系统 SHALL 新建 `game_events`（情景记忆）与 `faction_memories`（关系记忆）两张表，各含 `vector(1024)` 嵌入列与 HNSW 余弦索引，并按 `saveId` 归属。

#### Scenario: 表结构落地
- **WHEN** 执行 `pnpm db:push`
- **THEN** 创建 `game_events`（`id`/`saveId`/`turn`/`eventId`/`eventType`/`content`/`embedding vector(1024)`/`createdAt`）与 `faction_memories`（`id`/`saveId`/`factionId`/`turn`/`source`/`sentiment`/`content`/`embedding vector(1024)`/`createdAt`），并在两表 `embedding` 列上建立 `USING hnsw (embedding vector_cosine_ops)` 索引

#### Scenario: 索引与归属
- **WHEN** 查询任意一张记忆表
- **THEN** 检索条件 SHALL 至少包含 `saveId` 等值过滤（`faction_memories` 额外含 `factionId`），避免跨存档记忆泄漏

### Requirement: 事件记忆写入

`generate-event` 在成功生成事件后 SHALL 以 fire-and-forget 方式将该事件写入 `game_events`，不阻塞回合主流程。

#### Scenario: LLM 路径生成成功后写入
- **WHEN** `generate-event` 走 LLM 路径（`X-Event-Source: llm`）成功返回事件
- **THEN** 服务端在返回响应后异步执行 embedding 并插入 `game_events`（`content` = 事件标题 + 描述），失败仅记 warn 日志，不影响本次响应

#### Scenario: 剧情链与降级路径不写入
- **WHEN** 事件来源为 `pending-chain` / `time-window` / `fallback`
- **THEN** 不写入 `game_events`（脚本化事件与预置事件无去重价值，且避免污染检索池）

#### Scenario: 缓存命中不重复写入
- **WHEN** `generate-event` 命中 5 分钟缓存（`X-Cache: HIT`）
- **THEN** 不重复写入 `game_events`，也不执行检索

### Requirement: 势力记忆写入

NPC 行动与玩家对势力的作为 SHALL 写入 `faction_memories`，且归属到具体势力。

#### Scenario: NPC 自述行动入记忆
- **WHEN** `npc-actions` 中某势力 Agent 成功产出 `NpcAction`
- **THEN** 异步写入 `faction_memories`，`factionId` 取该势力 ID，`source` = `npc_action`，`content` = 行动类型 + 描述，`sentiment` 由行动类型推导（`挑衅`/`备战` 记为 `negative`，`结盟`/`外交` 记为 `positive`，`扩张`/`休养` 记为 `neutral`）

#### Scenario: 玩家自由决策的势力影响入记忆
- **WHEN** `resolve-decision` 判定的结果含非空 `factionEffects`
- **THEN** 对每个受影响的势力异步写入 `faction_memories`，`source` = `player_action`，`content` = 玩家输入原文 + 关系变化，关系上升记 `positive`、下降记 `negative`

#### Scenario: 写入失败静默降级
- **WHEN** embedding 调用失败或数据库插入失败
- **THEN** 捕获异常并记 warn 日志，不抛错、不重试、不影响端点正常响应

### Requirement: embedding 封装

系统 SHALL 提供统一的 embedding 调用封装，模型为 SiliconFlow `BAAI/bge-large-zh-v1.5`，维度 1024。

#### Scenario: 正常向量化
- **WHEN** 调用 `embedText('湘军粮道被断，士卒哗变')`
- **THEN** 返回长度 1024 的 `number[]`

#### Scenario: 调用失败或超时
- **WHEN** SiliconFlow embeddings 端点返回错误或超过 10 秒
- **THEN** 抛出可捕获的错误，由调用方按降级策略处理（不阻断主流程）

#### Scenario: 空文本不入调用
- **WHEN** 输入为空字符串或仅空白字符
- **THEN** 直接返回 `null`，不发起 embedding 请求

### Requirement: 向量相似度检索

系统 SHALL 提供基于余弦相似度的检索函数，且**不 select embedding 列**以规避 postgres-js 类型解析问题（design.md D6）。

#### Scenario: 按相似度召回
- **WHEN** 以查询文本检索某 `saveId` 下 `threshold=0.45`、`topK=5` 的记忆
- **THEN** 返回按相似度倒序的最多 5 条记录，每条含 `content`/`turn`/`similarity`，**不含** `embedding` 字段

#### Scenario: 空结果不算失败
- **WHEN** 该 `saveId` 下无任何记忆（如首回合）
- **THEN** 返回空数组，不抛错、不标记降级

#### Scenario: 检索失败抛错由调用方降级
- **WHEN** 数据库查询或 embedding 过程中抛出异常
- **THEN** 检索函数 SHALL 将错误向上传播（不吞错），由调用方按各自策略降级：`generate-event` 不注入避重清单并标记 `X-Memory-Skip: true`；`npc-actions` 跳过注入并标记 `X-Memory-Skip: true`；`search-memory` 工具返回 `MEMORY_UNAVAILABLE`
