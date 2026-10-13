# 金田：1851 — API 接口文档

> 本文档是 `server/server/api/game/` 下 8 个游戏 API 路由的**唯一接口定义来源**，禁止代码与文档脱节。
>
> 所有路由基础地址：开发期 `http://localhost:3000/api/game`，生产期 `https://api.jintian-1851.example.com/api/game`。

## 目录

- [通用约定](#通用约定)
- [GET /api/health](#get-apihealth)
- [POST /api/game/init-factions](#post-apigameinit-factions)
- [POST /api/game/generate-event](#post-apigamegenerate-event)
- [POST /api/game/resolve-decision](#post-apigameresolve-decision)
- [POST /api/game/npc-actions](#post-apigamenpc-actions)
- [POST /api/game/advisor-briefing](#post-apigameadvisor-briefing)
- [POST /api/game/advisor-chat](#post-apigameadvisor-chat)
- [POST /api/game/faction-negotiate](#post-apigamefaction-negotiate)
- [POST /api/game/device-credential](#post-apigamedevice-credential)
- [POST /api/game/sync-save](#post-apigamesync-save)
- [GET /api/game/sync-save](#get-apigamesync-save)
- [GET /api/game/saves](#get-apigamesaves)
- [DELETE /api/game/saves](#delete-apigamesaves)
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

> ⚠️ 失败体在线上有**两种封装形态**，取决于服务端怎么返回：
> - 中间件直接 `return`（如 429 `RATE_LIMITED`、400 `MISSING_DEVICE_ID`）→ 就是上面的顶层形态；
> - 路由 `return createError({ statusCode, data: { ok:false, error:{…} } })`（绝大多数业务错误，
>   含 401 `INVALID_DEVICE_TOKEN`、409 `CREDENTIAL_EXISTS`）→ H3/Nitro 会把它包成
>   `{ statusCode, statusMessage, message, data: { ok:false, error:{…} } }`，业务错误体多了一层 `data`。
>
> 前端 `game-web/src/utils/api.ts` 的 `unwrapErrorEnvelope()` 负责拆这一层，两种形态都归一到
> `ApiError.code`。新增按 `code` 分支的逻辑时不必自己处理嵌套，但**不要**在前端直接读裸响应体。

### 请求头

| 头 | 必填 | 说明 |
|---|---|---|
| `x-device-id` | 是（`/api/game/` 全部） | 设备标识，限流按它分桶；缺失返回 400 + `MISSING_DEVICE_ID`。**它不再是权限凭证** |
| `x-device-token` | 存档读写必填（收紧后） | 设备凭据，`POST /api/game/device-credential` 下发。存档端点用它**反查权威属主 deviceId** |

> 双轨兼容期（`DEVICE_AUTH_ENFORCED=false`，当前默认）：无凭据的存档请求仍回落到
> query/body 自声明的 `deviceId`，服务端每条都打一行 `[auth-compat] deviceId=前8位***` 日志。
> 日志归零即代表可收紧。收紧后缺凭据 → 401 `DEVICE_TOKEN_REQUIRED`；
> 凭据反查不到 → 401 `INVALID_DEVICE_TOKEN`（**不降级**，否则冒领尝试会被兼容逻辑吞掉）。

### 频率限制

- 中间件：[server/middleware/rate-limit.ts](file:///d:/code/codeWork/jintian-1851/server/server/middleware/rate-limit.ts)，按 `deviceId`（请求头 `x-device-id`）**分三个桶**独立计数
- 超限：HTTP 429 + `{ "ok": false, "error": { "code": "RATE_LIMITED", "message": "请求过于频繁，请稍后再试" } }`

| 桶 | 覆盖端点 | 上限 |
|---|---|---|
| `ai` | 7 个 AI 端点（`init-factions` / `generate-event` / `resolve-decision` / `npc-actions` / `advisor-chat` / `advisor-briefing` / `faction-negotiate`）+ 存档读写 `GET/DELETE /api/game/saves` | 10 次/分钟 |
| `save` | `/api/game/sync-save`（POST/GET） | 30 次/分钟 |
| `auth` | `POST /api/game/device-credential` | 5 次/分钟 |

> **为什么分桶而不是把 `sync-save` 也塞进 `ai` 桶**：正常一回合客户端就要发
> generate-event + advisor-briefing + npc-actions + resolve-decision + sync-save 共 4-5 个请求，
> 共用 10 次/分钟会让手快的玩家两三个回合就被 429 卡住。
> **为什么不能再放任 `sync-save` 不限流**：它此前是唯一无上限的写端点，
> 每次携带一个新 `saveId` 就插入一行，可被用来把 44G 的系统盘写满。
> 存档读写 `saves` 走 `ai` 桶（它们能批量读删，正常客户端每分钟远不到 10 次）。

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
- 超时：`generateObject` 路径 30 秒（`AbortSignal.timeout(30_000)`），`advisor-briefing` 20 秒（实测 10s 会 100% 命中超时），`advisor-chat` 流式 60 秒

---

## GET /api/health

存活与依赖就绪探针。源码：[health.get.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/health.get.ts)。

> 放在 `/api/health` 而不是裸 `/health`：Caddy 只反代 `/api/*`，裸路径会被静态站点的
> `try_files` 兜成 `index.html`，外部探活会拿到 200 + HTML 而不是真实状态。
>
> **本端点会真查一次数据库**（`select 1`，3 秒超时）。此前容器 healthcheck 打的是
> `/api/game/saves`，而那个请求在 rate-limit 中间件里就因缺 `x-device-id` 返 400 了，
> 连库都没碰——postgres 挂掉容器依然 healthy。现在 DB 不可用返回 **503**，容器转 unhealthy。
>
> 不会造成重启风暴：部署里没有 autoheal，`unhealthy` 只是状态标记；
> `depends_on: condition: service_healthy` 仅作用于启动顺序。

### 请求

```http
GET /api/health
```

无参数、无请求头要求，**不受限流**（限流只覆盖 `/api/game/` 前缀）、不使用并发锁。

### 响应

DB 可用（HTTP 200）：

```json
{ "ok": true, "data": { "status": "ok", "db": "up", "uptimeSec": 1834, "probeMs": 3 } }
```

DB 不可用（HTTP 503）：

```json
{ "ok": false, "data": { "status": "degraded", "db": "down", "uptimeSec": 12, "probeMs": 3001 } }
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `status` | `ok` / `degraded` | 进程一定活着，区别只在依赖 |
| `db` | `up` / `down` | `select 1` 是否在 3 秒内成功 |
| `uptimeSec` | number | 进程运行秒数，用于判断是否刚重启过 |
| `probeMs` | number | DB 探针耗时（毫秒）。接近 3000 说明库在超时边缘，即使仍返回 up 也值得关注 |

响应体刻意不含环境变量、连接串、版本号等信息。

### 容器探活命令

`deploy/docker-compose.deploy.yml` 的 app 服务 healthcheck 要求 **HTTP 200 且响应体 `ok === true`**，
`timeout: 10s` 必须大于服务端 3s 的 DB 探针超时，否则「慢」会被 Docker 误判成「死」。

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
  "activeChainIds": [],
  "zenithYear": 1882
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
| `zenithYear` | number (positive int) | 否 | 「中兴已定」锁定年份：综合实力首次达阈值的年份。**年钟新增**，缺省即从未锁定 |

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

`eventType` 取值：`'民生' / '军事' / '外交' / '随机' / '历史剧情' / '系统'`（不含 `'npc'`；`系统` 为回合结算自动产出的资源事件）。
`options` 数量：2-4 个。

**剧情链事件专属字段**（仅当事件来自某条历史剧情链时返回，`LLM` 自主生成的普通事件不含这些字段）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `chainId` | string | 所属剧情链 ID（如 `tai-ping-tian-guo`） |
| `chainNodeId` | string | 当前节点 ID（如 `node-1`） |
| `chainProgress` | `{ current, total }` | 第 `current`/`total` 节（如 `{1, 5}`） |
| `options[].nextChainNodeId` | string（仅首节点选项携带） | 选择该选项后入队的下个节点 ID，供前端推进剧情链 |
| `eventDate` | `{ year, month }`（**仅时光跳跃时返回**） | 该链锚点年份晚于当前游戏日历时的目标年月（恒为锚点年 1 月）。前端 `useTurn.startTurn` 据此把日历直接推到该年月 |

**时光跳跃**：**1 回合 = 1 年**，日历自己每回合走一年，约 62 回合即可走完 1851—1912；
跳跃因此从"必需"降级为"补漏"——用于跨过两个链锚点之间的空档年。
（月钟时代它不然：中位 37 回合只推进 3 年多，23 条链里绝大多数永不触发，`time_up` 是死代码。
详见 `docs/game-design.md` 的时间推进一节。）
链的锚点年份晚于当前年份时，服务端下发 `eventDate` 并把描述改写成
`【{当前年}—{锚点年} 年间】{链概述} {节点描述}`，交代这段空档。
只在链首（`time-window` 路径）判定；链内后续节点走 `pending-chain` 接续，日历停在链开始的年代，
否则一条 5 节点的链会把时间往前推 5 次。

> 普通（`LLM` 生成）事件不返回 `chainId`/`chainNodeId`/`chainProgress`/`eventDate`；`options` 也不含 `nextChainNodeId`。

### 三层触发与响应 Header

`generate-event` 按以下优先级决定事件来源，并在响应头 `X-Event-Source` 标注（源码见 [generate-event.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/generate-event.ts)）：

1. **`pending-chain`（挂起节点优先）**：`pendingChainNodes` 非空时，直接返回其中首个节点的事件，**不调 LLM**，零额外 token 成本。节点 ID 找不到时降级到后续优先级并设 `X-Fallback: true`。
2. **`time-window`（下一条剧情链）**：取 `startYear` **不早于**当前年份 `stateSnapshot.date.year` 的第一条链，且未 `completed`/`active`、前置链已 `completed` → 返回该链首节点，**不调 LLM**。多条候选按 `startYear` 升序 + `chainId` 字典序取第一条；锚点晚于当前年时附带 `eventDate` 触发时光跳跃。
   > 旧实现要求 `startYear === 当前年`，日历一旦跨过那一年，该链就永久错过。改为「取下一条」是时光跳跃成立的前提。
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
- **降级路径避重**：`getRandomFallbackEvent(type?, avoidTitles?)` 会先剔除 `recentEvents` 里已出现过的标题再随机。
  此前兜底是纯 `Math.random()`，而语义去重只实现在 LLM 路径，导致「LLM 挂了走兜底」的长局会在 60 条里反复抽到同一条事件。
  若整池被剔空（长局必然发生），回退全池随机——**避重永远不能导致返回不了事件**

### 流式模式（`?stream=1`）

网关存在「快实例 / 慢实例」，慢实例上生成 300+ tokens 的事件要 40-60s，整包等待玩家完全无感知。
请求带 `?stream=1` **或** `Accept: text/event-stream` 时，响应改为 SSE 流（协议与 `advisor-chat` 一致，
`data: <JSON>\n\n`，结束推 `data: [DONE]`）：

| 帧 | 含义 |
|---|---|
| `{ "delta": "…" }` | 已生成部分的**增量**文本。服务端用 `extractPartialField` 从未闭合的 JSON 片段里尽力读出 `title` / `description`，只推新增字符，前端可渐进显示 |
| `{ "event": { … } }` | 完整事件对象（选项与效果必须完整后才可交互，故只在这一帧给） |
| `{ "event": { … }, "fallback": true }` | 流式生成失败降级为预置事件。**降级时 header 已发出**，`X-Fallback` 无法补写，改用帧内字段告知前端 |
| `data: [DONE]` | 流结束 |

实现要点：

- 流式走 `streamText` + `response_format: { type: 'json_object' }`（**不用** structuredOutputs）：
  实测流式下 json_object 解析成功率 5/5，且不必把完整 schema 作为输入 token 发送，省输入也省排队
- 超时 45s（非流式是 30s × 2 次重试）。流已开始推送就无法静默重试，只能一次给足时间
- 缓存命中与剧情链预置事件**也走 SSE**：直接推 `{event}` + `[DONE]`，前端无感知差异
- 响应头 `X-Accel-Buffering: no` 关闭 Nginx 缓冲；反向代理侧对应 Caddy `flush_interval -1`
- 非流式请求完全不进这段代码，行为与改造前一致
- 前端仅 **H5** 走流式（`useTurn.fetchEventWithStream` 判 `uniPlatform`）：小程序 chunked 兼容性不稳定，
  且流式失败时回退到非流式 `post`，首帧超时放宽到 20s（对齐服务端 30s LLM 超时，避免慢实例被误判失败）

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

### 末步兜底（空文本修复）

每个 Agent 的步数预算为 `stopWhen: stepCountIs(5)`（E2E 模式 `stepCountIs(1)`）。若模型把步数全花在工具调用上，`streamText` 会以 `finishReason='tool-calls'` 结束且 `text` 为空串——**这不是异常，早期版本会把它直接记成「决策生成失败」**（实测约 10% 触发率，线上曾出现单回合 7 个 NPC 全失败）。

现在检测到空 `text` 后追加一轮兜底：复用「已含工具结果的对话 + 原始用户指令」，但**不再注册 tools**，模型无路可查只能直接输出 JSON。该轮以 `npc-actions-finalize` 标签计入 `[llm-usage]` 日志，超时 15s（E2E 4s）。兜底轮仍无输出时，才计入 `failedFactionIds`。

> 注意 `result.response.messages` 只含生成的 `assistant` / `tool` 消息，**不含 system 与首轮 user**，兜底轮需自行补回，否则请求里丢失玩家意图那一轮。

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

每回合开始时由 `useTurn.startTurn` 内部调用（非用户主动触发，且**不 await**——事件就绪即交还玩家，简报异步后到），让 LLM 给出当前局势总结 + 本回合建议，供 FocusPanel 顶部展示。源码：[advisor-briefing.post.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/advisor-briefing.post.ts)。

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

LLM 调用失败（含 20s 超时）时，返回空简报 + `X-Fallback: true` 响应头：

```json
{
  "ok": true,
  "data": { "summary": "", "suggestion": "" },
  "fallback": true
}
```

> 降级时 FocusPanel 使用 `generateFocusHint` 的规则建议兜底（如「优先应对军事危机」「稳步发展各项实力」等），玩家无感知。

### 超时与重试

- **超时**：20 秒（`AbortSignal.timeout(20_000)`）。原值 10s 画在了实测延迟分布的中位数上（线上连续 8 次调用 8/8 卡在 10.09s 超时、静默返回空简报），等于该功能长期不可用；20s 覆盖实测 P99
- **重试**：**不重试**（与 `generate-event` 等 2 次重试不同），失败立即降级返回空简报
- **调用方不得 await 本接口**：`useTurn.startTurn` 发起后立刻返回事件让玩家可操作，简报回来再异步落地 `onBriefing`。慢返回因此不再拖住回合开始；前端用请求序号丢弃迟到的旧回合简报（见 `game-web/src/composables/useTurn.ts` 的 `briefingSeq`）
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

## POST /api/game/device-credential

注册设备凭据（存档归属鉴权）。源码：[device-credential.post.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/device-credential.post.ts)
实现：[utils/device-auth.ts](file:///d:/code/codeWork/jintian-1851/server/server/utils/device-auth.ts)

> **一个 `deviceId` 只能成功注册一次（首绑即锁）**。成功时服务端生成 256bit 随机凭据，
> **仅此一次**在响应里返回明文，库里只存 `sha256`。此后存档读写带 `x-device-token`，
> 服务端按 hash 反查出权威 `deviceId`。
>
> 它防的是「事后冒领」：攻击者获知他人 deviceId 后换不到凭据，也就无法列出/读取/删除其存档。
> 它**防不住「首个声明者」**——兼容期任何人都能替未注册的 deviceId 抢下绑定，
> 这是「不要求老玩家重装、存量存档无损归属」的对价，靠 `DEVICE_AUTH_ALLOW_FIRST_BIND=false` 收窄。
> 清缓存/换浏览器会丢凭据且无法找回，需要真实身份（微信 openid）才能解决，不属本接口范围。

### 请求

```http
POST /api/game/device-credential
Content-Type: application/json
x-device-id: {设备指纹}

{ "deviceId": "550e8400-e29b-41d4-a716-446655440000" }
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `deviceId` | string (uuid) | 是 | 客户端自生成的设备标识（`utils/device-id.ts`）；zod `.strict()`，多余字段一律 400 |

### 响应（成功）

```json
{
  "ok": true,
  "data": {
    "deviceId": "550e8400-e29b-41d4-a716-446655440000",
    "token": "3f9c1e...（64 位十六进制，只在此处出现一次）"
  }
}
```

客户端把 `token` 持久化（H5 `localStorage` / 小程序 `uni.setStorageSync`，键 `game_device_token`），
此后由 `utils/api.ts` 自动注入到每个请求的 `x-device-token` 头。

### 错误

| HTTP | code | 触发场景 |
|---|---|---|
| 400 | `INVALID_PARAMS` | `deviceId` 缺失/非 UUID，或带多余字段，或请求体解析失败 |
| 403 | `ENROLLMENT_CLOSED` | `DEVICE_AUTH_ALLOW_FIRST_BIND=false`，注册窗口已关闭 |
| 405 | `METHOD_NOT_ALLOWED` | 非 POST |
| 409 | `CREDENTIAL_EXISTS` | 该 `deviceId` 已绑定（含被吊销的情形，吊销即封禁不再发凭据） |
| 429 | `RATE_LIMITED` | 超 `auth` 桶 5 次/分钟 |
| 500 | `DB_ERROR` | 数据库写入失败 |

> 前端侧：`ensureCredential()` 对 409/403 停止重试（`enrollmentBlocked`），网络失败与 429 保留下次重试；
> 存档请求遇 401 `INVALID_DEVICE_TOKEN` 时由 `withCredentialRetry()` **清本地凭据并重试一次**
> （重注册成功→新凭据；被判已绑定→空凭据回落 `deviceId` 兼容通道）。
> ⚠ 服务端对路由级 `createError` 的响应体把业务错误嵌在顶层 `data` 下，前端 `unwrapErrorEnvelope()` 负责拆包，
> 否则 `code` 一律读成 `INVALID_RESPONSE`，上述两条分支都不会生效。

### 鉴权事件日志与运维

每次属主裁决与注册裁决都输出**一行 JSON**（与 `[llm-usage]` 同一取向：不落库、不引常驻服务）：

```
[auth-event] {"ts":"2026-10-14T00:00:00.000Z","kind":"owner_by_compat","device":"11111111"}
```

| `kind` | 含义 | 对应 HTTP |
|---|---|---|
| `owner_by_token` | 带有效凭据，属主由凭据反查 | 放行 |
| `owner_by_compat` | 无凭据、按客户端自声明的 `deviceId` 放行（兼容期残余） | 放行 + `[auth-compat]` |
| `invalid_token` | 带了凭据但查不到/已吊销，**不降级** | 401 |
| `token_required` | 收紧后无凭据 | 401 |
| `missing_identity` | 既无凭据也无 `deviceId` | 400 |
| `enrolled` / `enroll_exists` / `enroll_closed` | 首绑成功 / 重复注册被拒 / 注册已关闭 | 200 / 409 / 403 |

`device` 只记 **前 8 位掩码**（完整标识不落盘，与 `[auth-compat]` 同一条纪律）；
`invalid_token`/`missing_identity` 手上没有可信标识，该字段为空串。

聚合与收紧闸门（兼容期观察、cron 可直接按退出码报警）：

```bash
docker logs --since 24h jintian-api 2>&1 | pnpm auth-report
docker logs --since 24h jintian-api 2>&1 | pnpm auth-report --fail-if-compat   # 未归零退 2
```

- `兼容通道占比 = owner_by_compat / (owner_by_token + owner_by_compat)`，**分母只算成功裁决**。
- 退出码：0 正常 / 1 用法或输入错误（含一行都没解析到，免得把"抓日志失败"读成"零流量"）/ 2 兼容通道未归零。
- 三态判据：`resolved`（可收紧）/ `pending`（还有兼容流量）/ `no_data`（窗口内没有成功裁决样本）。
  **`no_data` 不等于归零**，`--fail-if-compat` 下同样退 2。

吊销设备凭据（`revoked_at` 的唯一写入路径，语义见 [db-schema.md](db-schema.md)）：

```bash
pnpm auth:revoke <deviceId> --dry-run   # 先看状态
DATABASE_URL=... pnpm auth:revoke <deviceId>
```

> ⚠️ **兼容期吊销 ≠ 断访问**：吊销只让凭据失效，存档行按设计留存。未置
> `DEVICE_AUTH_ENFORCED=true` 时，被吊销设备会「401 → 清本地凭据 → 重注册被 409 拒 →
> 回落 `deviceId` 自声明通道」，**仍能读写自己的存档**。真要阻断须先收紧，或另行删除其存档行。
> 脚本执行后会把这一点打进输出。
> 本地跑须显式给 `DATABASE_URL`（脚本故意不做兜底连接串，免得拿默认串连到别的库去写）。

---

## POST /api/game/sync-save

上传/覆盖云端存档。源码：[sync-save.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/sync-save.ts)。

> 服务端权威 `updated_at` 方案：POST body **不含 `updatedAt` 字段**（zod `.strict()` 模式拒绝），`updated_at` 由 DB `NOW()` 生成，从源头消除两设备并发 race。
>
> **属主校验**：属主 `deviceId` 由 `x-device-token` 设备凭据**反查**得出（见 [POST /api/game/device-credential](#post-apigamedevice-credential)），
> 不再采信 body 里的自声明；`ON CONFLICT DO UPDATE` 附加 `setWhere(device_id = 属主 deviceId)` 原子条件，
> `saveId` 已存在但属于其他设备时返回 403 `SAVE_FORBIDDEN`。
> 双轨兼容期（`DEVICE_AUTH_ENFORCED=false`）无凭据的请求仍回落到 body 的 `deviceId`，服务端打 `[auth-compat]` 日志。
>
> **导入他人存档的归属**：`save_data` blob 内的 `deviceId` 只是客户端快照。导入的存档首次上传时
> 以**上传者的凭据属主**入库；若该 `saveId` 已存在且属于导出者，则返回 403（不覆盖他人存档）。

### 请求

```http
POST /api/game/sync-save
Content-Type: application/json
x-device-id: {设备指纹}
x-device-token: {设备凭据，属主证明}

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
| `deviceId` | string (≥1) | 是 | 设备指纹。**仅作存档内容快照**：属主判定用 `x-device-token` 反查值，与本页不一致时以凭据为准 |
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
| `zenithYear` | number (positive int) | 否 | 年钟新增：「中兴已定」锁定年份。`saveDataSchema` 是 **strict 模式**，不显式声明就会把带该字段的存档整条 400 拒掉 |

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
| 401 | `INVALID_DEVICE_TOKEN` | 带了 `x-device-token` 但库里反查不到（凭据被吊销或伪造）——**不降级**采信 body 的 deviceId |
| 401 | `DEVICE_TOKEN_REQUIRED` | 服务端已收紧（`DEVICE_AUTH_ENFORCED=true`）却未带凭据 |
| 403 | `SAVE_FORBIDDEN` | `saveId` 已存在且归属于其他设备（禁止覆盖他人存档） |
| 500 | `DB_ERROR` | 数据库写入失败 |

> sync-save 走**独立的 `save` 桶**（30 次/分钟，不与 AI 端点的 10 次/分钟配额互相挤占），
> 但**不使用并发锁**（无 race 风险，服务端权威方案保证）。
> 此前它完全不受任何频率限制，是所有写端点里唯一无上限的一个：
> 每次携带新 `saveId` 就插入一行，可被用来把服务器磁盘写满。

---

## GET /api/game/sync-save

拉取云端存档。源码：[sync-save.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/sync-save.ts)。

### 请求

```http
GET /api/game/sync-save?saveId=550e8400-e29b-41d4-a716-446655440000
x-device-id: {设备指纹}
x-device-token: {设备凭据，属主证明}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `saveId` (query) | string (uuid) | 是 | 存档 ID |
| `deviceId` (query) | string (≥1) | 否 | **仅兼容期兜底**：未带凭据时用它当属主；带了 `x-device-token` 就不必传，新客户端不再传 |

> **属主校验**：属主取自 `x-device-token` 反查，`WHERE save_id = $1 AND device_id = $2` 用该值。
> 不匹配时返回 404（与「不存在」同响应，不泄漏他人存档存在性）。
> 前端 `useSaveSync` 先 `await ensureCredential()`：拿到凭据则 URL 只带 `saveId`，拿不到才回落带 `deviceId`。

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
| 400 | `INVALID_PARAMS` | `saveId` 缺失或非 UUID 格式；或既无凭据又无 `deviceId`（兼容期） |
| 401 | `INVALID_DEVICE_TOKEN` | 凭据反查不到属主（吊销/伪造），不降级采信 query 的 deviceId |
| 401 | `DEVICE_TOKEN_REQUIRED` | 已收紧但未带凭据 |
| 404 | `SAVE_NOT_FOUND` | 云端未找到此存档，或存档不属于该属主（不区分，防存在性泄漏） |
| 500 | `DB_ERROR` | 数据库查询失败 |

---

## GET /api/game/saves

按属主拉取存档列表（多存档管理基础能力）。源码：[saves.get.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/saves.get.ts)。

> 仅返回摘要（不含完整 `saveData` blob），按 `updated_at` 倒序；命中 `idx_game_saves_device_id` 索引。
> 属主模型与 sync-save 一致：由 `x-device-token` 凭据反查，兼容期才回落用 query 的 `deviceId`。

### 请求

```http
GET /api/game/saves?limit=20
x-device-id: {设备指纹}
x-device-token: {设备凭据，属主证明}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `deviceId` (query) | string (1-64) | 否 | **仅兼容期兜底**：无凭据时按它过滤；有凭据时忽略 |
| `limit` (query) | number (1-50) | 否 | 返回条数上限，默认 20 |

### 响应（成功）

```json
{
  "ok": true,
  "data": {
    "saves": [
      {
        "saveId": "550e8400-e29b-41d4-a716-446655440000",
        "saveVersion": 2,
        "updatedAt": 1721536801234,
        "endedAt": null,
        "endedReason": null,
        "summary": {
          "background": "文官",
          "factionName": "清廷",
          "turn": 7,
          "ended": false
        }
      }
    ]
  }
}
```

`summary` 从 `saveData` JSONB 中提取；`saveData` 结构异常时字段安全兜底为空值（不 500）。

### 错误

| HTTP | code | 触发场景 |
|---|---|---|
| 400 | `INVALID_PARAMS` | `limit` 非 1-50 整数；或既无凭据又无 `deviceId`（兼容期） |
| 401 | `INVALID_DEVICE_TOKEN` | 凭据反查不到属主（吊销/伪造） |
| 401 | `DEVICE_TOKEN_REQUIRED` | 已收紧但未带凭据 |
| 500 | `DB_ERROR` | 数据库查询失败 |

> saves 走 rate-limit 的 **`ai` 桶**（10 次/分钟），不使用并发锁（只读列表）。
> 旧文档写「不受频率限制」是脱节表述——`utils/rate-limit.ts` 一直把它算在 `ai` 桶里。

---

## DELETE /api/game/saves

删除云端存档（多存档管理收尾能力）。源码：[saves.delete.ts](file:///d:/code/codeWork/jintian-1851/server/server/api/game/saves.delete.ts)。

> 属主校验与 sync-save 同口径：`save_id + device_id` 双条件原子删除，0 行命中返回 404（与「不存在」同响应，不泄漏他人存档存在性）。
>
> ⚠️ **记忆行清理排在主删除成功之后**：`game_events` / `faction_memories` 没有 `device_id` 列，
> 「这个 saveId 是不是你的」只能由主删除的返回行数来证明。先清记忆再删存档的旧写法，
> 会让任何知道他人 `saveId` 的人擦掉对方的记忆行，而响应的 404 还假装拒绝了请求。
> 清理失败仅告警，不影响已成功的存档删除。

### 请求

```http
DELETE /api/game/saves?saveId=550e8400-e29b-41d4-a716-446655440000
x-device-id: {设备指纹}
x-device-token: {设备凭据，属主证明}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `saveId` (query) | string (uuid) | 是 | 待删除存档 ID |
| `deviceId` (query) | string (1-64) | 否 | **仅兼容期兜底**：无凭据时用它做属主条件 |

### 响应（成功）

```json
{ "ok": true, "data": { "saveId": "550e8400-e29b-41d4-a716-446655440000", "deleted": true } }
```

### 错误

| HTTP | code | 触发场景 |
|---|---|---|
| 400 | `INVALID_PARAMS` | `saveId` 非 UUID；或既无凭据又无 `deviceId`（兼容期） |
| 401 | `INVALID_DEVICE_TOKEN` | 凭据反查不到属主（吊销/伪造） |
| 401 | `DEVICE_TOKEN_REQUIRED` | 已收紧但未带凭据 |
| 404 | `SAVE_NOT_FOUND` | 云端未找到此存档，或存档不属于该属主（不区分，防存在性泄漏）。**此时不动记忆行** |
| 500 | `DB_ERROR` | 数据库删除失败 |

> saves DELETE 走 rate-limit 的 **`ai` 桶**（10 次/分钟），不使用并发锁（与 saves GET 同口径）。

---

## 错误码表

| code | HTTP | 含义 | 触发接口 |
|---|---|---|---|
| `INVALID_PARAMS` | 400 | 请求参数校验失败（body 解析失败、zod 校验失败、UUID 格式错误等） | 全部 |
| `MISSING_DEVICE_ID` | 400 | 缺少 `x-device-id` 请求头 | `/api/game/` 全部（限流中间件） |
| `RATE_LIMITED` | 429 | 频率超限（`ai` 10/分钟、`save` 30/分钟、`auth` 5/分钟，按 deviceId 分桶） | 7 个 AI 端点 + 存档读写 `saves` + `sync-save` + `device-credential` |
| `CONCURRENT_REQUEST` | 429 | 同 `saveId` 已有进行中请求 | generate-event / resolve-decision / npc-actions / advisor-chat / faction-negotiate |
| `INVALID_DEVICE_TOKEN` | 401 | 带了 `x-device-token` 但反查不到未吊销的凭据（伪造或已吊销）；**不降级**采信自声明的 deviceId | POST/GET sync-save / GET saves / DELETE saves |
| `DEVICE_TOKEN_REQUIRED` | 401 | 服务端已收紧（`DEVICE_AUTH_ENFORCED=true`）却未带凭据 | 同上 |
| `ENROLLMENT_CLOSED` | 403 | 注册窗口已关闭（`DEVICE_AUTH_ALLOW_FIRST_BIND=false`） | POST device-credential |
| `SAVE_NOT_FOUND` | 404 | 云端未找到此存档（或属主校验不通过，不区分） | GET sync-save / DELETE saves |
| `SAVE_FORBIDDEN` | 403 | 存档归属于其他设备，禁止覆盖 | POST sync-save |
| `CREDENTIAL_EXISTS` | 409 | 该 deviceId 已绑定凭据（首绑即锁；含已吊销设备） | POST device-credential |
| `DB_ERROR` | 500 | 数据库读写失败 | sync-save / saves / device-credential |
| `METHOD_NOT_ALLOWED` | 405 | 方法不支持（sync-save 仅 POST/GET；device-credential 仅 POST） | sync-save / device-credential |

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

> **记忆降级标识（AI 长期记忆新增，均非错误、仍 200 OK）**：
> - `X-Dedup-Applied: true`：`generate-event` LLM 路径生成**前**检索到同 `saveId` 的相似历史事件（相似度 > 0.76，topK 5），已在 prompt 注入「避免重复」清单。命中才设置，与 `X-Fallback` / `X-Tool-Fallback` 相互独立、可并存。
> - `X-Memory-Skip: true`：记忆向量检索失败时设置——`generate-event`（去重检索失败，跳过避重清单）与 `npc-actions`（势力记忆检索失败，跳过记忆注入）。检索为增益而非必需，失败不影响事件生成与 NPC 决策。
> - 记忆写入（`game_events` / `faction_memories`）为 fire-and-forget，失败**静默跳过**（仅服务端 warn 日志），响应头无任何标识。

### 缓存标识（非错误）

| 接口 | 缓存命中响应头 |
|---|---|
| `generate-event` | `X-Cache: HIT`（5 分钟 TTL，键为 `sha256(saveId + turn + sha256(stateSnapshot) + sha256({ pendingChainNodes, completedChainIds, activeChainIds }))`） |

