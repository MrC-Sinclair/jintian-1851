# ai-event-engine — AI 事件生成

## ADDED Requirements

### Requirement: 结构化事件生成接口

`POST /api/game/generate-event` MUST 返回结构化事件，含标题、描述、选项、状态影响。

#### Scenario: 正常生成事件

WHEN 前端发送 `POST /api/game/generate-event` body 含 `{ saveId, turn, stateSnapshot }`（不传玩家决策）
THEN 服务端使用 `Qwen/Qwen3-8B` 模型调用 `generateObject()` + zod schema
AND 提示词包含：玩家身份/势力、当前局势、最近 5 条事件标题（首回合注入"游戏开场"上下文）、要求生成 1 个事件
AND 返回结构：
  ```typescript
  {
    event: {
      title: string          // ≤ 20 字
      description: string    // 50-200 字
      eventType: '民生' | '军事' | '外交' | '随机' | '历史剧情'
      options: Array<{       // 2-4 个选项，每个含预定义 effects
        id: string
        label: string        // ≤ 30 字
        effects: { military?, economy?, politics?, people?, diplomacy?, silver?, troops?, food?, reputation? }
      }>
    }
  }
  ```

#### Scenario: 参数校验失败

WHEN body 缺少必填字段 或 `stateSnapshot` 结构不正确 或 `turn < 1`
THEN 返回 HTTP 400 + `{ "ok": false, "error": { "code": "INVALID_PARAMS", "message": "...", "detail": zodErrors } }`

#### Scenario: zod schema 强约束返回值

WHEN LLM 返回的 JSON 不符合 schema（如 title 超长、options 数量不在 2-4）
THEN `generateObject()` 抛错
AND 服务端自动重试 1 次
AND 重试仍失败则从 `server/runtime/fallback-events.ts` 随机抽 1 个事件返回
AND 响应 header `X-Fallback: true` 标识降级

### Requirement: 5 分钟事件缓存

服务端 MUST 缓存 `generate-event` 结果，同输入同输出 5 分钟内不重复调 LLM。

#### Scenario: 缓存命中

WHEN 同一 `{ saveId, turn, playerDecision, stateHash }` 在 5 分钟内再次请求
THEN 服务端直接返回缓存的 event 对象
AND 不调用 LLM
AND 响应 header `X-Cache: HIT`

#### Scenario: 缓存未命中

WHEN 首次请求 或 TTL 过期 或 输入不同
THEN 服务端调用 LLM 生成
AND 响应 header `X-Cache: MISS`
AND 结果写入缓存

#### Scenario: 缓存键计算

WHEN 计算缓存键时
THEN 输入 = `saveId + turn + sha256(stateSnapshot)`（不依赖 playerDecision，因为 generate-event 不再接收玩家决策）
AND 输出 = `sha256(input)`
AND 作为 `Map<key, { result, expireAt }>` 存储

### Requirement: 事件类型权重分布

事件 MUST 按 5 类权重分布：民生 30%、军事 25%、外交 20%、随机 15%、历史剧情 10%。

#### Scenario: 提示词注入事件类型权重

WHEN 服务端构造提示词时
THEN 从权重表随机选 1 个事件类型
AND 在提示词中要求 LLM 生成该类型事件
AND 历史剧情类型注入具体历史事件池（如「太平军攻陷南京」「甲午战争」「戊戌变法」等）

#### Scenario: 历史剧情事件触发时机

WHEN 当前游戏内时间与某历史事件时间吻合（如 1851-1 触发「金田起义」）
THEN 提示词优先要求生成该历史剧情
AND 不强制生成（LLM 仍可基于玩家势力状态调整细节）

### Requirement: 自由输入决策判定接口

`POST /api/game/resolve-decision` MUST 接收玩家自由输入文本，返回 AI 判定的效果。

#### Scenario: 正常判定自由输入

WHEN 前端发送 `POST /api/game/resolve-decision` body 含 `{ saveId, turn, playerDecision, stateSnapshot, event }`
THEN 服务端使用 `Qwen/Qwen3-8B` 模型调用 `generateObject()` + zod schema
AND 提示词包含：玩家身份/势力、当前局势、本回合事件、玩家自由输入内容
AND 返回结构 `{ effects: { military?, economy?, politics?, people?, diplomacy?, silver?, troops?, food?, reputation? } }`
AND 每项属性影响范围 ±5~15

#### Scenario: 自由输入校验

WHEN `playerDecision` 长度 > 200 或为空字符串
THEN 返回 HTTP 400 + `{ "ok": false, "error": { "code": "INVALID_PARAMS", "message": "..." } }`

#### Scenario: 判定失败降级

WHEN `generateObject()` 重试 1 次后仍失败
THEN 服务端返回默认效果 `{ military: -3, economy: -3, politics: -3, people: -3, diplomacy: -3 }`
AND 响应 header `X-Fallback: true`
AND 前端 toast 提示「AI 判定失败，已应用默认效果」

#### Scenario: 并发锁防重复

WHEN 同一 `saveId` 已有进行中的 resolve-decision 请求
THEN 返回 HTTP 429 + `{ "ok": false, "error": { "code": "CONCURRENT_REQUEST", "message": "本回合决策正在判定中" } }`

### Requirement: 兜底事件池

服务端 MUST 维护至少 20 条预置事件作为兜底。

#### Scenario: LLM 完全失败时返回兜底事件

WHEN `generateObject()` 重试 1 次后仍失败
THEN 服务端从 `server/runtime/fallback-events.ts` 随机抽 1 个事件
AND 该事件类型与请求的 `eventType` 匹配（若池中无匹配则随机）
AND 返回 `{ event, effects, fallback: true }`

#### Scenario: 兜底事件池内容

WHEN 检查 `fallback-events.ts`
THEN 至少包含 20 条事件，覆盖 5 类型（民生/军事/外交/随机/历史剧情各 4 条）
AND 每条事件含 `title, description, options(2-4 个), effects`
AND effects 数值平衡（每项属性影响 ±5~15）

### Requirement: 并发锁防重复

同一 `saveId` 同时 MUST 只能有一个 generate-event 请求进行中。

#### Scenario: 同存档并发请求被拒绝

WHEN 同一 `saveId` 已有进行中的 generate-event 请求
AND 新请求到达且不命中缓存
THEN 服务端返回 HTTP 429 + `{ "ok": false, "error": { "code": "CONCURRENT_REQUEST", "message": "本回合正在处理中" } }`
AND 不调用 LLM
