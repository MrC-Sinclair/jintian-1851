# 金田：1851 — API 接口文档

> 本文档是 `server/server/api/game/` 下 8 个游戏 API 路由的**唯一接口定义来源**，禁止代码与文档脱节。
>
> 所有路由基础地址：开发期 `http://localhost:3000/api/game`，生产期 `https://api.jintian-1851.example.com/api/game`。

## 目录

- [通用约定](#通用约定)
- [POST /api/game/init-factions](#post-apigameinit-factions)
- [POST /api/game/generate-event](#post-apigamegenerate-event)
- [POST /api/game/resolve-decision](#post-apigameresolve-decision)
- [POST /api/game/npc-actions](#post-apigamenpc-actions)
- [POST /api/game/advisor-briefing](#post-apigameadvisor-briefing)
- [POST /api/game/advisor-chat](#post-apigameadvisor-chat)
- [POST /api/game/faction-negotiate](#post-apigamefaction-negotiate)
- [POST /api/game/sync-save](#post-apigamesync-save)
- [GET /api/game/sync-save](#get-apigamesync-save)
- [错误码表](#错误码表)

---

## 通用约定

### 响应格式

所有非流式接口统一返回：

```jsonc
// 成功
{ "ok": true, "data": { } }

// 失败
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "人类可读说明",
    "detail": { }
  }
}
```

### 频率限制

- 中间件：[server/middleware/rate-limit.ts](file:///d:/code/codeWork/jintian-1851/server/server/middleware/rate-limit.ts)
- 范围：`init-factions` / `generate-event` / `resolve-decision` / `npc-actions` / `advisor-chat` / `advisor-briefing` / `faction-negotiate` 七个 AI 端点
- 限制：按 `deviceId`（请求头 `x-device-id`）每分钟最多 10 次
- 超限：HTTP 429 + `{ "ok": false, "error": { "code": "RATE_LIMITED", "message": "请求过于频繁，请稍后再试" } }`
- **`sync-save` 不受频率限制**（非 AI 调用）

### 并发锁

- 实现：[server/utils/concurrency-lock.ts](file:///d:/code/codeWork/jintian-1851/server/server/utils/concurrency-lock.ts)
- 粒度：`saveId`（`generate-event` / `resolve-decision` / `npc-actions` / `advisor-chat` / `faction-negotiate` 均以 `saveId` 为锁键）
- 行为：同 `saveId` 已有进行中请求时，新请求立即返回 429 + `CONCURRENT_REQUEST`
- 锁超时：30 秒自动释放（防死锁）
- **`advisor-briefing` 不占用并发锁**（无副作用，可与上述端点并发，见 [advisor-briefing 章节](#post-apigameadvisor-briefing)）

### AI 调用通用约定

- 模型：`Qwen/Qwen3-8B`（完整 vendor 前缀）
- Provider：硅基流动 `https://api.siliconflow.cn/v1`
- 调用方式：
  - 结构化输出：`generateObject()` + zod schema + `providerOptions.openai.structuredOutputs: false`
  - 流式输出：`streamText()` + 自定义 SSE 协议
- thinking 控制：通过 [server/utils/siliconflow-fetch.ts](file:///d:/code/codeWork/jintian-1851/server/server/utils/siliconflow-fetch.ts) 的 `createSiliconFlowFetch(enableThinking?)` 在 fetch 层注入 `enable_thinking` 字段（避免被 `providerOptions.openai` zod schema 剥离）
- 超时：`generateObject` 路径 30 秒（`AbortSignal.timeout(30_000)`），`advisor-briefing` 10 秒（短小简报），`advisor-chat` 流式 60 秒

---

## POST /api/game/init-factions

开局 AI 生成 6-8 个近代势力组合。源码：[init-factions.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/init-factions.ts)。

### 请求

```http
POST /api/game/init-factions
Content-Type: application/json
x-device-id: {设备指纹}

{
  "background": "文官"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `background` | `'文官' / '武将' / '商贾' / '士绅' / '宗室'` | 是 | 玩家身份 |

### 响应（成功）

```json
{
  "ok": true,
  "data": {
    "factions": [
      {
        "id": "qing-ting",
        "name": "清廷",
        "summary": "大清朝廷，中央集权虽衰，仍有正统之名",
        "initialPower": 70,
        "initialRelationship": 50
      }
    ]
  }
}
```

降级时（LLM 失败）：响应体多一个 `fallback: true` 字段，响应头 `X-Fallback: true`，势力来自 [fallback-factions.ts](file:///d:/code/codeWork/jintian-1851/server/server/runtime/fallback-factions.ts)。

### 错误

| HTTP | code | 触发场景 |
|---|---|---|
| 400 | `INVALID_PARAMS` | body 解析失败 / `background` 不在枚举内 |
| 429 | `RATE_LIMITED` | 超 10 次/分钟 |
| 429 | `CONCURRENT_REQUEST` | 同 `saveId` 已有进行中请求 |

---

## POST /api/game/generate-event

AI 生成当前回合事件，含 2-4 个选项（每个选项含预定义 effects）。源码：[generate-event.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/generate-event.ts)。

### 请求

```http
POST /api/game/generate-event
Content-Type: application/json
x-device-id: {设备指纹}

{
  "saveId": "550e8400-e29b-41d4-a716-446655440000",
  "turn": 1,
  "stateSnapshot": {
    "turn": 1,
    "date": { "year": 1851, "month": 1 },
    "attributes": { "military": 50, "economy": 50, "politics": 50, "people": 50, "diplomacy": 50 },
    "resources": { "silver": 1000, "troops": 500, "food": 800, "reputation": 10 }
  },
  "character": {
    "background": "文官",
    "factionName": "清廷",
    "factionSummary": "大清朝廷..."
  },
  "factions": [
    { "id": "xiang-jun", "name": "湘军", "summary": "...", "power": 65, "relationship": 20, "status": "active" }
  ],
  "recentEvents": [],
  "pendingChainNodes": [
    { "chainId": "tai-ping-tian-guo", "nodeId": "node-2", "scheduledTurn": 2 }
  ],
  "completedChainIds": [],
  "activeChainIds": []
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `saveId` | string (uuid) | 是 | 存档 ID |
| `turn` | number (positive int) | 是 | 当前回合数 |
| `stateSnapshot` | object | 是 | 局势快照（不含 events/advisorMessages/factions 等频繁变化字段） |
| `stateSnapshot.attributes` | `{military,economy,politics,people,diplomacy: number}` | 是 | 5 维属性 |
| `stateSnapshot.resources` | `{silver,troops,food,reputation: number}` | 是 | 4 项资源 |
| `character` | object | 是 | 玩家身份信息（含 `background`/`factionName`/`factionSummary`） |
| `factions` | array | 是 | 全部势力列表（含 status） |
| `recentEvents` | array | 否 | 最近 5 条事件标题，作为 LLM 上下文（默认 `[]`） |
| `pendingChainNodes` | array | 否 | 挂起的剧情链节点（v2 存档必传，老客户端兼容 `.default([])`）。每项 `{ chainId, nodeId, scheduledTurn }` |
| `completedChainIds` | array (string) | 否 | 已完成的剧情链 ID 列表（避免重复触发），默认 `[]` |
| `activeChainIds` | array (string) | 否 | 进行中的剧情链 ID 列表（避免时间窗口重复触发同链），默认 `[]` |

> 三个剧情链状态字段用于**三层触发优先级**（详见下方响应 header `X-Event-Source`）：挂起节点优先 → 时间窗口匹配 → LLM 自主生成。老客户端不传时服务端按 `[]` 处理，完全兼容。

### 响应（成功）

```json
{
  "ok": true,
  "data": {
    "event": {
      "title": "金田起义",
      "description": "广西桂平金田村，洪秀全率拜上帝会众举旗反清...",
      "eventType": "历史剧情",
      "options": [
        { "id": "a", "label": "请缨率军南征", "effects": { "military": 8, "troops": -200, "reputation": 8, "diplomacy": 3 }, "nextChainNodeId": "node-2" },
        { "id": "b", "label": "招募乡勇守土", "effects": { "military": 4, "silver": -150, "people": 3 } }
      ],
      "chainId": "tai-ping-tian-guo",
      "chainNodeId": "node-1",
      "chainProgress": { "current": 1, "total": 5 }
    }
  }
}
```

`eventType` 取值：`'民生' / '军事' / '外交' / '随机' / '历史剧情'`（不含 `'npc'`）。
`options` 数量：2-4 个。

**剧情链事件专属字段**（仅当事件来自某条历史剧情链时返回，`LLM` 自主生成的普通事件不含这些字段）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `chainId` | string | 所属剧情链 ID（如 `tai-ping-tian-guo`） |
| `chainNodeId` | string | 当前节点 ID（如 `node-1`） |
| `chainProgress` | `{ current, total }` | 第 `current`/`total` 节（如 `{1, 5}`） |
| `options[].nextChainNodeId` | string（仅首节点选项携带） | 选择该选项后入队的下个节点 ID，供前端推进剧情链 |

> 普通（`LLM` 生成）事件不返回 `chainId`/`chainNodeId`/`chainProgress`；`options` 也不含 `nextChainNodeId`。

### 三层触发与响应 Header

`generate-event` 按以下优先级决定事件来源，并在响应头 `X-Event-Source` 标注（源码见 [generate-event.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/generate-event.ts)）：

1. **`pending-chain`（挂起节点优先）**：`pendingChainNodes` 非空时，直接返回其中首个节点的事件，**不调 LLM**，零额外 token 成本。节点 ID 找不到时降级到后续优先级并设 `X-Fallback: true`。
2. **`time-window`（时间窗口匹配）**：当前年份 `stateSnapshot.date.year` 命中某剧情链 `startYear`，且未 `completed`/`active`、前置链已 `completed` → 返回该链首节点，**不调 LLM**。同年份多链按 `startYear` 升序 + `chainId` 字典序选第一条。
3. **`llm`（LLM 自主生成）**：以上都不满足时调 `generateObject()` 生成普通事件。

> 剧情链事件（前两层）完全不消耗 LLM 额度，是扩充事件引擎"零成本增加历史沉浸"的核心设计。

### 工具注入（agent 化新增，T4）

进入 LLM 提示词构建前，`generate-event` 会**通过工具调用**获取最近历史事件：调用 `get-recent-events` 工具（`tool-context.ts` 中定义）得到近期事件列表，注入到事件生成 prompt，而非直接信任请求体 `recentEvents` 字段（工具结果为权威来源，避免客户端伪造/遗漏上下文）。

- 工具调用成功：prompt 携带工具返回的事件，`recentEvents` 请求字段被忽略。
- 工具调用失败（异常/超时）：**降级**使用请求体 `recentEvents`，并在响应头追加 `X-Tool-Fallback: true`（响应体不新增字段，仅头部标记）。

```
X-Tool-Fallback: true   # 仅当 get-recent-events 工具调用失败时存在
```

> 该降级与 `X-Fallback`（LLM 整体失败预置事件）相互独立：即使工具调用失败，只要后续 LLM 调用成功，就**不会**再设 `X-Fallback`；二者可在同一响应中并存。

### 缓存与降级

- **缓存键**：`sha256(saveId + turn + sha256(stateSnapshot JSON) + sha256({ pendingChainNodes, completedChainIds, activeChainIds }))`，5 分钟 TTL，命中时响应头 `X-Cache: HIT` 直接返回。剧情链状态变化（如新挂起节点）会使缓存键变化，确保新回合拿到正确事件
- **降级**：LLM 2 次重试均失败后返回预置事件（[fallback-events.ts](file:///d:/code/codeWork/jintian-1851/server/server/runtime/fallback-events.ts)），响应头 `X-Fallback: true`，响应体多 `fallback: true`

### 错误

| HTTP | code | 触发场景 |
|---|---|---|
| 400 | `INVALID_PARAMS` | body 解析失败 / zod 校验失败 |
| 429 | `RATE_LIMITED` | 超 10 次/分钟 |
| 429 | `CONCURRENT_REQUEST` | 同 `saveId` 已有进行中请求 |

---

## POST /api/game/resolve-decision

玩家自由输入决策时，AI 解析为结构化 effects。源码：[resolve-decision.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/resolve-decision.ts)。

> 注：玩家选择事件预置选项时**不调用本接口**，前端直接应用对应 `option.effects`。本接口仅用于「自由行动」输入。
>
> **疑问句守卫**：`playerDecision` 以疑问/求助词开头（怎么 / 怎样 / 如何 / 为什么 / 为啥 / 帮帮我 / 能不能 / 能否 / 该不该 / 该怎么办 / 请问）时，代码层直接拦截返回犹豫签名，**不调用 LLM**（实测 LLM 对疑问句无法稳定判犹豫且会幻觉 factionEffects）。实现：[hesitation-guard.ts](file:///d:/code/codeWork/jintian-1851/server/server/utils/hesitation-guard.ts)。

### 请求

```http
POST /api/game/resolve-decision
Content-Type: application/json
x-device-id: {设备指纹}

{
  "saveId": "550e8400-e29b-41d4-a716-446655440000",
  "turn": 3,
  "playerDecision": "暗中联络太平军，约定南北夹击清廷",
  "stateSnapshot": { },
  "event": {
    "title": "金田起义",
    "description": "...",
    "eventType": "历史剧情",
    "options": []
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `saveId` | string (uuid) | 是 | 存档 ID |
| `turn` | number (positive int) | 是 | 当前回合 |
| `playerDecision` | string (1-200 字) | 是 | 玩家自由输入的行动描述 |
| `stateSnapshot` | object | 是 | 同 `generate-event` |
| `event` | object | 是 | 当前回合事件（含 `title`/`description`/`eventType`/`options`） |
| `factions` | array | 否 | 全部势力精简列表（`{ id, name, relationship, status, power }`），自由行动需此上下文才能将决策文本关联到具体势力。旧客户端不传时不报错，仅不返回 `factionEffects` |

### 响应（成功）

```json
{
  "ok": true,
  "data": {
    "effects": {
      "military": -5,
      "diplomacy": -10,
      "people": 8,
      "reputation": -3,
      "silver": -50
    },
    "factionEffects": [
      { "factionId": "xiang-jun", "relationshipDelta": 15, "powerDelta": 10 }
    ]
  }
}
```

`effects` 是 `Record<string, number>`，键为属性/资源名（military/economy/politics/people/diplomacy/silver/troops/food/reputation），值为变化量（可正可负）。

`factionEffects`（可选）是自由行动对势力的「软性微调」数组，元素结构：

| 字段 | 类型 | 说明 |
|---|---|---|
| `factionId` | string | 目标势力 ID，**必须为请求 `factions` 之一**（服务端 sanitize 丢弃列表外 id，防幻觉） |
| `relationshipDelta` | number (±20) | 关系变化，前端最终 clamp(-100, 100) |
| `powerDelta` | number (±30) | 实力变化，前端最终 `Math.max(0, ...)` |

> **约束**：自由行动仅做软性微调，**禁止改 `status`**（结盟/宣战/摧毁仍走确定性外交按钮）。决策未指向任何势力时 `factionEffects` 为 `[]` 或省略。
> **资源代价**：决策的资源代价（如"资助湘军"→ `silver:-50`）经 `effects` 表达，与 `factionEffects` 叠加应用，形成"有代价的自然语言外交"。

### 降级

**疑问句守卫命中**时（见顶部说明），不调 LLM 直接返回，响应体多 `hesitation: true`（前端可据此提示玩家去问军师）：

```json
{
  "ok": true,
  "data": {
    "effects": { "people": -1, "silver": -10 },
    "factionEffects": []
  },
  "hesitation": true
}
```

LLM 2 次重试均失败后返回默认 effects + 空 `factionEffects`，响应头 `X-Fallback: true`，响应体多 `fallback: true`：

```json
{
  "ok": true,
  "data": {
    "effects": { "military": -3, "economy": -3, "politics": -3, "people": -3, "diplomacy": -3 },
    "factionEffects": []
  },
  "fallback": true
}
```

> 旧客户端未传 `factions` 时 `factionEffects` 恒为 `[]`（无上下文则 AI 无从关联势力），完全向后兼容。

### 错误

| HTTP | code | 触发场景 |
|---|---|---|
| 400 | `INVALID_PARAMS` | body 解析失败 / zod 校验失败（含 `playerDecision` 超 200 字） |
| 429 | `RATE_LIMITED` | 超 10 次/分钟 |
| 429 | `CONCURRENT_REQUEST` | 同 `saveId` 已有进行中请求 |

---

## POST /api/game/npc-actions

AI 生成其他势力本回合的行动。源码：[npc-actions.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/npc-actions.ts)。

### 请求

```http
POST /api/game/npc-actions
Content-Type: application/json
x-device-id: {设备指纹}

{
  "saveId": "550e8400-e29b-41d4-a716-446655440000",
  "turn": 3,
  "character": {
    "background": "文官",
    "factionName": "清廷"
  },
  "stateSnapshot": { },
  "factions": [
    { "id": "xiang-jun", "name": "湘军", "summary": "...", "power": 65, "relationship": 20, "status": "active" },
    { "id": "tai-ping", "name": "太平天国", "summary": "...", "power": 80, "relationship": -50, "status": "active" }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `saveId` | string (uuid) | 是 | 存档 ID |
| `turn` | number (positive int) | 是 | 当前回合 |
| `character` | object | 是 | 含 `background`/`factionName` |
| `stateSnapshot` | object | 是 | 同 `generate-event` |
| `factions` | array (≥1) | 是 | 全部势力列表，服务端会过滤 `status === 'active'` 后传给 LLM |

### 响应（成功）

```json
{
  "ok": true,
  "data": {
    "actions": [
      {
        "factionId": "tai-ping",
        "factionName": "太平天国",
        "action": "扩张",
        "target": "江南",
        "description": "太平军沿江东进，连克数城，江南大震。",
        "effects": { "people": -5, "military": -3 }
      },
      {
        "factionId": "xiang-jun",
        "factionName": "湘军",
        "action": "备战",
        "description": "曾国藩加紧练兵，于衡州整军待发。"
      }
    ]
  }
}
```

`action` 取值：`'扩张' / '结盟' / '备战' / '休养' / '挑衅' / '外交'`。
`target` 与 `effects` 字段可选。

> **`failedFactionIds`（agent 化新增，T3.4）**：当部分/全部 NPC 势力决策失败（Agent 异常、JSON 不可解析或格式非法）时，响应 `data` 额外携带 `failedFactionIds: string[]`（失败势力的 ID 列表）。前端据此在「天下动静」区块渲染红色「决策失败」角标卡片，并与成功行动合并计数。成功行动为全部时该字段省略。详见下方「部分失败」与「降级」。

### 特殊路径

- 若 `factions` 中无 `status === 'active'` 的 NPC 势力，直接返回 `{ ok: true, data: { actions: [] } }`（不调用 LLM）

### 部分失败（agent 化新增，T3.4）

`npc-actions` 现为多 Agent 并行（每个 active 势力独立 Agent，互不阻塞）。单个 Agent 失败不影响其他势力，失败的势力 ID 收集进 `failedFactionIds`，响应头 `X-Partial-Failure: true`，成功部分照常返回：

```json
{
  "ok": true,
  "data": {
    "actions": [
      { "factionId": "xiang-jun", "factionName": "湘军", "action": "备战", "description": "曾国藩加紧练兵。" }
    ],
    "failedFactionIds": ["tai-ping"]
  }
}
```

> 前端在「天下动静」区块中，成功行动与失败卡片合并计入「共 N 则」（总数 = 成功行动数 + 失败势力数）。

### 降级

LLM 2 次重试均失败后返回空数组，响应头 `X-Fallback: true`，响应体多 `fallback: true`：

```json
{ "ok": true, "data": { "actions": [], "failedFactionIds": ["f1", "f2"] }, "fallback": true }
```

> 全部失败时 `failedFactionIds` 含全部 active 势力 ID（此时成功行动为空），头部仍用 `X-Fallback: true`（与部分失败的 `X-Partial-Failure: true` 区分）。

### 错误

| HTTP | code | 触发场景 |
|---|---|---|
| 400 | `INVALID_PARAMS` | body 解析失败 / zod 校验失败 |
| 429 | `RATE_LIMITED` | 超 10 次/分钟 |
| 429 | `CONCURRENT_REQUEST` | 同 `saveId` 已有进行中请求 |

---

## POST /api/game/advisor-briefing

每回合开始时由 `useTurn.startTurn` 内部调用（非用户主动触发），让 LLM 给出当前局势总结 + 本回合建议，供 FocusPanel 顶部展示。源码：[advisor-briefing.post.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/advisor-briefing.post.ts)。

> 设计要点：
> - 与 `advisor-chat` 不同，本接口**非流式**，使用 `generateObject` 一次返回结构化结果
> - **不占用并发锁**（无副作用，可与 `generate-event` 并发进行，见 [并发锁](#并发锁)）
> - **受频率限制**（与其它 AI 端点共享 10 次/分钟/deviceId 配额）
> - 失败降级返回空简报 + `X-Fallback: true` header，**不抛 createError**（不阻断 startTurn 主流程）

### 请求

```http
POST /api/game/advisor-briefing
Content-Type: application/json
x-device-id: {设备指纹}

{
  "saveId": "550e8400-e29b-41d4-a716-446655440000",
  "turn": 3,
  "stateSnapshot": {
    "turn": 3,
    "date": { "year": 1851, "month": 3 },
    "attributes": { "military": 50, "economy": 50, "politics": 55, "people": 48, "diplomacy": 50 },
    "resources": { "silver": 850, "troops": 480, "food": 760, "reputation": 15 }
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `saveId` | string (uuid) | 是 | 存档 ID |
| `turn` | number (positive int) | 是 | 当前回合 |
| `stateSnapshot` | object | 是 | 同 [generate-event](#post-apigamegenerate-event) 的 `stateSnapshot`（不含 character/factions，保持轻量） |
| `stateSnapshot.attributes` | `{military,economy,politics,people,diplomacy: number}` | 是 | 5 维属性 |
| `stateSnapshot.resources` | `{silver,troops,food,reputation: number}` | 是 | 4 项资源 |
| `stateSnapshot.date` | `{year, month: number}` | 是 | 当前日期 |

> ⚠️ 与 `generate-event` 不同，本接口**不传 `character` / `factions` / `recentEvents`**，仅传 `stateSnapshot`，保持 prompt 轻量（T1.14 设计决策）。

### 响应（成功）

```json
{
  "ok": true,
  "data": {
    "summary": "军事告急，民心不稳",
    "suggestion": "优先应对军事危机"
  }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `summary` | string (≤60 字) | 局势一句话总结，白话为主 |
| `suggestion` | string (≤60 字) | 本回合建议，关注属性 < 30 的危机时优先提示 |

> FocusPanel 收到 `suggestion` 后会覆盖 `generateFocusHint` 生成的规则建议；`summary` 当前版本不直接渲染，仅作为 AdvisorDrawer 打开时插入「局势简报」消息的数据源。

### 特殊路径

#### 1. 开关关闭（`enableBriefing === false`）

`runtimeConfig.enableBriefing` 为 `false` 时，直接返回空简报，不调用 LLM：

```json
{
  "ok": true,
  "data": { "summary": "", "suggestion": "" },
  "disabled": true
}
```

> `disabled: true` 标识此次返回是因开关关闭（非失败降级），客户端可据此跳过简报渲染。

#### 2. 失败降级

LLM 调用失败（含 10s 超时）时，返回空简报 + `X-Fallback: true` 响应头：

```json
{
  "ok": true,
  "data": { "summary": "", "suggestion": "" },
  "fallback": true
}
```

> 降级时 FocusPanel 使用 `generateFocusHint` 的规则建议兜底（如「优先应对军事危机」「稳步发展各项实力」等），玩家无感知。

### 超时与重试

- **超时**：10 秒（`AbortSignal.timeout(10_000)`），短小简报超时即降级
- **重试**：**不重试**（与 `generate-event` 等 2 次重试不同），失败立即降级返回空简报
- **理由**：简报是辅助信息（非核心玩法），失败降级不影响玩家继续游戏，无需重试浪费 token

### 错误

| HTTP | code | 触发场景 |
|---|---|---|
| 400 | `INVALID_PARAMS` | body 解析失败 / zod 校验失败（含 `saveId` 非 UUID、`turn < 1` 等） |
| 429 | `RATE_LIMITED` | 超 10 次/分钟 |

> 注：本接口**不返回 `CONCURRENT_REQUEST`**（不占用并发锁）。LLM 失败也**不返回 500**，统一降级为 200 + `fallback: true`。

---

## POST /api/game/advisor-chat

军师对话，SSE 流式响应。源码：[advisor-chat.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/advisor-chat.ts)。

### 请求

```http
POST /api/game/advisor-chat
Content-Type: application/json
x-device-id: {设备指纹}

{
  "saveId": "550e8400-e29b-41d4-a716-446655440000",
  "turn": 3,
  "messages": [
    { "role": "user", "content": "眼下太平军势大，何以处之？", "turn": 3, "timestamp": 1721536800000 }
  ],
  "character": {
    "background": "文官",
    "backgroundPerks": { "politics": 5 },
    "factionId": "qing-ting",
    "factionName": "清廷",
    "factionSummary": "..."
  },
  "stateSnapshot": { },
  "recentEvents": []
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `saveId` | string (uuid) | 是 | 存档 ID |
| `turn` | number (positive int) | 是 | 当前回合 |
| `messages` | array (≥1) | 是 | 历史对话，最后一条 `role` 必须为 `user`；超 20 条时服务端自动截断保留最后 20 条 |
| `character` | object | 是 | 含 `background`/`backgroundPerks`/`factionId`/`factionName`/`factionSummary` |
| `stateSnapshot` | object | 是 | 同 `generate-event` |
| `recentEvents` | array | 否 | 最近事件上下文（默认 `[]`） |

### 响应（流式 SSE）

响应头：

```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
X-Truncated-Messages: true   # 仅在 messages 被截断时存在
```

响应体为 SSE 流，自定义协议（**非** OpenAI/Anthropic 标准格式）：

```
data: {"delta":"主公"}

data: {"delta":"，太平军虽势大"}

data: [DONE]
```

事件类型：

| 事件 | 说明 |
|---|---|
| `data: {"delta":"..."}` | AI 输出的文本片段（仅 `text-delta`，`reasoning-delta` 已被丢弃） |
| `data: {"type":"tool-call","toolName":"<工具名>","args":{...}}` | **（agent 化新增）** 军师决定调用某工具，开始执行。前端据此在对话区上方渲染「查询中」气泡（`advisor-tool--calling`） |
| `data: {"type":"tool-result","toolName":"<工具名>","result":{...}}` | **（agent 化新增）** 工具执行结果回灌。前端将对应气泡翻转为「已完成」（`advisor-tool--done`）或「失败」（`advisor-tool--fail`，result 含 `error` 字段） |
| `data: {"error":"AI_CALL_FAILED"}` | LLM 调用失败（流式过程中异常） |
| `data: [DONE]` | 流式结束 |

> **工具调用协议（T2.4 / agent-architecture-upgrade）**：`advisor-chat` 现已 agent 化，军师可自主调用 `get-recent-events` / `get-faction-info` / `get-all-factions` / `get-character-status` / `get-relationship` / `get-current-date` 六个只读工具（定义见 [tool-context.ts](file:///d:/code/codeWork/jintian-1851/server/server/utils/tool-context.ts)）。`tool-call` 与 `tool-result` 帧成对出现，前端 `useAdvisor` 的 `onToolCall` / `onToolResult` 回调负责维护气泡状态；工具结果会被回灌进下一轮 LLM 上下文，因此工具调用轮次的输入 token 高于纯文本轮次（见 [ai-cost.md](file:///d:/code/codeWork/jintian-1851/docs/ai-cost.md)）。

thinking 控制：`Qwen/Qwen3-8B` + `enable_thinking: false`（军师对话不展示 reasoning，避免破坏古风体验 + 节省 token）。

### 错误

| HTTP | code | 触发场景 |
|---|---|---|
| 400 | `INVALID_PARAMS` | body 解析失败 / zod 校验失败 / 最后一条消息 role 不为 user |
| 429 | `RATE_LIMITED` | 超 10 次/分钟 |
| 429 | `CONCURRENT_REQUEST` | 同 `saveId` 已有进行中请求 |

> 注：LLM 调用失败时**不返回 createError**，而是先写 `data: {"error":"AI_CALL_FAILED"}` 再 `end()`，避免破坏流式响应体。

---

## POST /api/game/faction-negotiate

玩家与单个 NPC 势力 Agent 的自然语言谈判（写信/游说）。源码：[faction-negotiate.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/faction-negotiate.ts)。

两阶段状态机（单次谈判最多 2 次 AI 调用）：
- `phase='letter'`：玩家写信（1-200 字）→ Agent 以势力人格回信并表态（`accept` 应允 / `reject` 拒绝 / `counter` 还价附表内条件）。
- `phase='settle'`：仅 letter 返回 `counter` 后可达，玩家「接受条件」或「还价」→ Agent 最终裁定（accept/reject，**不再提新条件**）。

> **防幻觉边界**：LLM 只产出意图（dealId + 区间内 price）与文案；效果数值由前端按镜像兑换表 `NEGOTIATION_DEALS`（[negotiation-deals.ts](file:///d:/code/codeWork/jintian-1851/server/server/utils/negotiation-deals.ts) ↔ [constants.ts](file:///d:/code/codeWork/jintian-1851/game-web/src/utils/constants.ts)）确定性执行，status 变更仅 `alliance-deal` → `'allied'` 由前端按表映射。

### 请求（letter 阶段）

```http
POST /api/game/faction-negotiate
Content-Type: application/json
x-device-id: {设备指纹}

{
  "saveId": "550e8400-e29b-41d4-a716-446655440000",
  "turn": 3,
  "phase": "letter",
  "factionId": "huai-jun",
  "letter": "久闻贵军威名，愿以白银结好。若蒙不弃，还请开个价码。",
  "character": { "background": "文官", "factionName": "清廷" },
  "stateSnapshot": { },
  "faction": { "id": "huai-jun", "name": "淮军", "summary": "...", "power": 60, "relationship": 40, "status": "active" }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `saveId` | string (uuid) | 是 | 存档 ID |
| `turn` | number (positive int) | 是 | 当前回合 |
| `phase` | `'letter'` \| `'settle'` | 是 | 谈判阶段 |
| `factionId` | string | 是 | 目标势力 ID，**必须与 `faction.id` 一致**（不一致返回 400） |
| `letter` | string (1-200 字) | 是 | 玩家信件原文 |
| `character` | object | 是 | `{ background, factionName }`（同 npc-actions） |
| `stateSnapshot` | object | 是 | 同 `generate-event` |
| `faction` | object | 是 | 目标势力全量（`{ id, name, summary, power, relationship, status }`） |

### 请求（settle 阶段，额外字段）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `previousReply` | string (1-200 字) | 是 | letter 阶段的回信（Agent 上下文，前端原样带回） |
| `deal` | object | 是 | Agent 上轮提出的条件 `{ dealId, price }`（服务端再 sanitize 防篡改） |
| `playerResponse` | `'accept'` \| `'counter'` | 是 | 玩家响应 |
| `counterPrice` | number | 条件必填 | `playerResponse='counter'` 时必填；服务端 clamp 回 `[floor(silverMin×0.5), 原价]` |

### 响应（成功）

```json
{
  "ok": true,
  "data": {
    "stance": "counter",
    "reply": "结盟非小事，需银两为证，白银一百两为贽，方可通好。",
    "relationshipDelta": 3,
    "deal": { "dealId": "gift-deal", "price": 100 }
  }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `stance` | `'accept'` \| `'reject'` \| `'counter'` | 表态；settle 阶段仅 accept/reject（LLM 返回 counter 会被降为 reject） |
| `reply` | string (≤200 字) | 回信（空时兜底「（无回信）」） |
| `relationshipDelta` | number (±10) | 信件软性关系影响（服务端已 clamp） |
| `deal` | object（可选） | 仅 letter 阶段 `stance='counter'` 时存在：`{ dealId, price }`（dealId ∈ 兑换表，price 已 clamp 区间） |

### 服务端 sanitize（防幻觉）

| 场景 | 处理 |
|---|---|
| LLM 输出表外 `dealId` / 关系门槛不满足 | 丢弃 deal 且 stance 强制降为 `reject`（玩家侧不展示条件卡片） |
| price 越界 | clamp 回该 deal 的银两区间 |
| `relationshipDelta` 越界 | clamp ±10 |
| `reply` 超长 / 非法 stance | 截断 200 字 / 降为 `reject` |
| settle 阶段 LLM 返回 counter | 降为 `reject`（不再提新条件） |

### 降级

AI 调用异常或 JSON 不可解析时**不重试**，返回 HTTP 200 + 响应头 `X-Fallback: true`：

```json
{
  "ok": true,
  "data": { "stance": "reject", "reply": "", "relationshipDelta": 0 },
  "fallback": true
}
```

> 前端语义：letter 阶段降级**不消耗谈判配额**（`negotiationUsedThisTurn` 不置位，允许同回合重试，提示「信使途中受阻」）；settle 阶段降级仅应用信件 `relationshipDelta`，配额不退。

### E2E 测试模式

请求头 `x-e2e-test-mode: 1` 时：Agent 步数压为 `stepCountIs(1)`、超时 8 秒（与 npc-actions 一致，加速端到端用例）。

### 错误

| HTTP | code | 触发场景 |
|---|---|---|
| 400 | `INVALID_PARAMS` | body 解析失败 / zod 校验失败（letter 长度、settle counter 缺 counterPrice 等） |
| 400 | `INVALID_PARAMS` | `factionId` ≠ `faction.id`，或 settle 携带非法 deal（表外 dealId / 门槛不满足） |
| 429 | `RATE_LIMITED` | 超 10 次/分钟 |
| 429 | `CONCURRENT_REQUEST` | 同 `saveId` 已有进行中请求 |

---

## POST /api/game/sync-save

上传/覆盖云端存档。源码：[sync-save.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/sync-save.ts)。

> 服务端权威 `updated_at` 方案：POST body **不含 `updatedAt` 字段**（zod `.strict()` 模式拒绝），`updated_at` 由 DB `NOW()` 生成，从源头消除两设备并发 race。

### 请求

```http
POST /api/game/sync-save
Content-Type: application/json
x-device-id: {设备指纹}

{
  "saveVersion": 2,
  "saveId": "550e8400-e29b-41d4-a716-446655440000",
  "deviceId": "device-abc123",
  "createdAt": 1721536800000,
  "character": {
    "background": "文官",
    "backgroundPerks": { "politics": 5 },
    "factionId": "qing-ting",
    "factionName": "清廷",
    "factionSummary": "..."
  },
  "state": {
    "turn": 3,
    "date": { "year": 1851, "month": 3 },
    "attributes": { "military": 50, "economy": 50, "politics": 55, "people": 48, "diplomacy": 50 },
    "resources": { "silver": 850, "troops": 480, "food": 760, "reputation": 15 }
  },
  "factions": [
    { "id": "xiang-jun", "name": "湘军", "summary": "...", "power": 65, "relationship": 20, "status": "active" }
  ],
  "events": [],
  "advisorMessages": [],
  "ended": false
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `saveVersion` | `1` / `2` | 是 | 存档结构版本（zod `union([literal(1), literal(2)])`） |
| `saveId` | string (uuid) | 是 | 存档唯一标识 |
| `deviceId` | string (≥1) | 是 | 设备指纹 |
| `createdAt` | number | 是 | 存档创建时间戳（毫秒） |
| `character` | object | 是 | 玩家身份信息 |
| `state` | object | 是 | 游戏状态（含 `turn`/`date`/`attributes`/`resources`） |
| `factions` | array (≥1) | 是 | 全部势力列表 |
| `events` | array | 是 | 历史事件列表 |
| `advisorMessages` | array | 是 | 军师对话列表 |
| `ended` | boolean | 是 | 是否已结局 |
| `endedAt` | number / null | 否 | 结局时间戳（`ended=true` 时必传） |
| `endedReason` | string / null | 否 | 结局原因 |
| `pendingChainNodes` | array | 否 | v2 新增：挂起的剧情链节点（结构与请求同） |
| `completedChainIds` | array (string) | 否 | v2 新增：已完成剧情链 ID 列表 |
| `activeChainIds` | array (string) | 否 | v2 新增：进行中剧情链 ID 列表 |

> ⚠️ **严禁传入 `updatedAt` 字段**：zod `.strict()` 模式会拒绝，返回 400 + 错误信息 `updatedAt is not allowed (server-authoritative)`。

> **存档版本（v1 → v2）**：服务端接受 `saveVersion` 为 `1` 或 `2`。v2 在 v1 基础上新增 `pendingChainNodes`/`completedChainIds`/`activeChainIds` 三个数组字段（其余字段不变，`events` 历史记录额外携带 `chainId`/`chainNodeId`）。客户端加载存档时若发现 v1 会自动迁移为 v2（补齐三个空数组），对玩家无感知。

### 响应（成功）

无论首次上传还是二次覆盖，均返回 200 OK：

```json
{
  "ok": true,
  "data": {
    "saveId": "550e8400-e29b-41d4-a716-446655440000",
    "updatedAt": 1721536801234,
    "endedAt": null,
    "endedReason": null
  }
}
```

`updatedAt` 为服务端 DB 生成的毫秒时间戳，客户端应写回本地存档。

### 错误

| HTTP | code | 触发场景 |
|---|---|---|
| 400 | `INVALID_PARAMS` | body 解析失败 / zod 校验失败（含传入 `updatedAt` 字段） |
| 500 | `DB_ERROR` | 数据库写入失败 |

> sync-save **不受频率限制**，**不使用并发锁**（无 race 风险，服务端权威方案保证）。

---

## GET /api/game/sync-save

拉取云端存档。源码：[sync-save.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/sync-save.ts)。

### 请求

```http
GET /api/game/sync-save?saveId=550e8400-e29b-41d4-a716-446655440000
x-device-id: {设备指纹}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `saveId` (query) | string (uuid) | 是 | 存档 ID |

### 响应（成功）

```json
{
  "ok": true,
  "data": {
    "save": {
      "saveVersion": 2,
      "saveId": "550e8400-e29b-41d4-a716-446655440000",
      "deviceId": "device-abc123",
      "createdAt": 1721536800000,
      "character": { },
      "state": { },
      "factions": [ ],
      "events": [ ],
      "advisorMessages": [ ],
      "ended": false
    },
    "updatedAt": 1721536801234
  }
}
```

`save` 为完整 GameSave 对象，`updatedAt` 为服务端最近更新时间戳（毫秒）。

### 错误

| HTTP | code | 触发场景 |
|---|---|---|
| 400 | `INVALID_PARAMS` | `saveId` 缺失或非 UUID 格式 |
| 404 | `SAVE_NOT_FOUND` | 云端未找到此存档 |
| 500 | `DB_ERROR` | 数据库查询失败 |

---

## 错误码表

| code | HTTP | 含义 | 触发接口 |
|---|---|---|---|
| `INVALID_PARAMS` | 400 | 请求参数校验失败（body 解析失败、zod 校验失败、UUID 格式错误等） | 全部 |
| `RATE_LIMITED` | 429 | 频率超限（>10 次/分钟/deviceId） | 6 个 AI 端点（init-factions / generate-event / resolve-decision / npc-actions / advisor-chat / advisor-briefing） |
| `CONCURRENT_REQUEST` | 429 | 同 `saveId` 已有进行中请求 | generate-event / resolve-decision / npc-actions / advisor-chat |
| `SAVE_NOT_FOUND` | 404 | 云端未找到此存档 | GET sync-save |
| `DB_ERROR` | 500 | 数据库读写失败 | sync-save |
| `METHOD_NOT_ALLOWED` | 405 | 非 POST/GET 方法 | sync-save |

### 降级标识（非错误）

当 LLM 调用失败降级时，响应**仍为 200 OK**，但有以下标识：

| 接口 | 降级响应 | 响应头 |
|---|---|---|
| `init-factions` | `fallback: true` + 6 个预置势力 | `X-Fallback: true` |
| `generate-event` | `fallback: true` + 随机预置事件 | `X-Fallback: true` |
| `resolve-decision` | `fallback: true` + 默认 effects（5 维属性各 -3） | `X-Fallback: true` |
| `npc-actions` | `fallback: true` + `actions: []` | `X-Fallback: true` |
| `advisor-briefing` | `fallback: true` + 空简报 `{summary:'', suggestion:''}` | `X-Fallback: true` |
| `advisor-chat` | 流式写 `data: {"error":"AI_CALL_FAILED"}` 后 end | 无 |

> **其它非错误响应头（agent 化新增）**：
> - `X-Partial-Failure: true`：`npc-actions` 部分 NPC 决策失败时设置（成功部分仍返回，区别于全部失败的 `X-Fallback`）。
> - `X-Tool-Fallback: true`：`generate-event` 的 `get-recent-events` 工具调用失败时设置（降级使用请求体 `recentEvents`），与 `X-Fallback` 相互独立、可并存。

### 缓存标识（非错误）

| 接口 | 缓存命中响应头 |
|---|---|
| `generate-event` | `X-Cache: HIT`（5 分钟 TTL，键为 `sha256(saveId + turn + sha256(stateSnapshot) + sha256({ pendingChainNodes, completedChainIds, activeChainIds }))`） |

