# service-observability 规格变更（健康探针与成本观测）

## ADDED Requirements

### Requirement: 健康探针真查数据库
系统 SHALL 提供 `GET /api/health`，用一次带超时的 `select 1` 判定数据库可用性；
进程存活但依赖不可用时 MUST 返回 HTTP **503** 与 `{ ok: false }`。

#### Scenario: 依赖正常
- **WHEN** 数据库可达且探针在超时内完成
- **THEN** 返回 200 + `{ ok: true, data: { status: "ok", db: "up", uptimeSec, probeMs } }`

#### Scenario: 依赖不可用
- **WHEN** 探针失败或被拒绝（连接被拒 / 认证失败 / 超时）
- **THEN** 返回 **503** + `{ ok: false, data: { status: "degraded", db: "down", ... } }`
- **AND** 输出一行 `[health] DB 不可用: <message>`，只记 message 不记堆栈（探针每分钟跑一次）

#### Scenario: 探针慢于超时
- **WHEN** 数据库既不响应也不拒绝（连接挂起）
- **THEN** 探针在 **3 秒**内以 `DB_PROBE_TIMEOUT` 判定为不可用并返回 503
- **AND** 理由：postgres-js 在库失联时可能挂住不 reject；容器 healthcheck 的 `timeout` 为 10 秒，
      必须大于该值，否则 Docker 会把「慢」误判成「死」

#### Scenario: 响应体不泄漏环境信息
- **WHEN** 任意调用方请求 `/api/health`
- **THEN** 响应字段仅有 `status`/`db`/`uptimeSec`/`probeMs`/`backup`/`backupAgeHours`
      （异常时多一个 `backupDetail`），不含连接串、环境变量、版本号、文件路径

### Requirement: 备份失败必须可被探活发现
`backup-db.sh` 每次运行 SHALL 把结果落到状态文件，`GET /api/health` SHALL 读取并输出
`backup`（`fresh` / `stale` / `missing` / `invalid` / `disabled`）与 `backupAgeHours`；
该状态 MUST NOT 改变 HTTP 状态码与 `ok` 字段。

#### Scenario: 为什么不能让它影响状态码
- **WHEN** 备份连续失败超过阈值
- **THEN** `/api/health` 仍返回 200 + `ok:true`，只是 `backup=stale`
- **AND** 理由：caddy 服务是 `depends_on: app: condition: service_healthy`，
      让备份故障返 503 会把 app 容器打成 unhealthy，之后任何一次 `compose up`
      都会因为等不到 healthy 而**把静态站一起卡住** —— 备份坏了不该让站点起不来，
      两个故障不能互相掩盖

#### Scenario: 新鲜与过期
- **WHEN** `lastSuccessAt` 距现在不超过 `NUXT_BACKUP_MAX_AGE_HOURS`（默认 30）
- **THEN** `backup=fresh`，`backupAgeHours` 为小时数（保留 1 位）
- **WHEN** 超过阈值，或 `lastSuccessAt` 为 null（从未成功过一次）
- **THEN** `backup=stale`；「从未成功」时 `backupAgeHours` 为 null 而不是 0

#### Scenario: 连续失败不得抹掉上次成功时间
- **WHEN** 某次备份失败
- **THEN** 状态文件的 `lastSuccessAt` 保留上一次成功的时间，只更新 `ok=false` / `lastAttemptAt` / `error`
- **AND** 否则 ageHours 会从"很久没成功"退化成"从未成功"，把排查方向带偏

#### Scenario: 最近一次失败但仍在阈值内
- **WHEN** `ok=false` 而 `lastSuccessAt` 仍然新鲜
- **THEN** `backup=fresh` 且 `backupDetail` 带出失败原因
- **AND** 不能因为"今天还新鲜"就把连续失败藏起来

#### Scenario: 状态文件本身坏了要能看出来
- **WHEN** 配了路径但文件不存在 → `missing`；不是合法 JSON / 不是对象 / 缺 `ok` 或 `lastAttemptAt`
      / 时间不是 ISO 8601 的 `Z` 或 `±HH:MM` 形式 → `invalid`
- **THEN** 均返回 200 + 对应 `backup` 值，不抛异常（容器每 20s 探一次，报错会刷屏）
- **AND** 拒绝 `+0800` 这类无冒号偏移：`Date.parse` 会按读方本地时区解释，
      同一字符串在不同机器上算出不同时刻，静默算错年龄比直接报错危险

#### Scenario: 未配置即关闭
- **WHEN** `NUXT_BACKUP_STATUS_FILE` 为空（开发期默认）
- **THEN** `backup=disabled`、`backupAgeHours=null`，不做任何判定也不报警

### Requirement: 健康端点的路径与豁免
`/api/health` SHALL 位于 `/api/` 前缀下（Caddy 只反代 `/api/*`，裸 `/health` 会被静态站点的
`try_files` 兜成 index.html），且 MUST NOT 受频率限制与并发锁约束。

#### Scenario: 不占限流桶
- **WHEN** 请求路径为 `/api/health`
- **THEN** `getRateBucket` 返回 `null`（限流只覆盖 `/api/game/` 前缀）
- **AND** 不需要 `x-device-id` 请求头

### Requirement: 容器探活以业务状态为准
`deploy/docker-compose.deploy.yml` 的 app 服务 healthcheck MUST 判定「HTTP 200 **且** 响应体
`ok === true`」，而不是「任意 HTTP 响应即存活」。

#### Scenario: postgres 故障可被自动发现
- **WHEN** 数据库容器不可用
- **THEN** app 容器探活退出码为 1，状态转为 `unhealthy`
- **AND** 当前部署没有任何监控系统，容器状态是唯一可自动发现故障的信号面

#### Scenario: 不因探针失败重启
- **WHEN** 容器进入 unhealthy
- **THEN** 不触发重启（部署中无 autoheal；`depends_on: condition: service_healthy` 只影响启动顺序）

### Requirement: LLM 用量日志可归因到单局
各 AI 端点的 `[llm-usage]` 日志 SHALL 在可行范围内携带 `saveId` 与 `turn`，
使 `docs/ai-cost.md` 的「单局成本」口径可被真实核算；无法归因的端点 MUST 在聚合结果中显式暴露。

#### Scenario: 回合类端点携带归因维度
- **WHEN** `generate-event` / `npc-actions` / `npc-actions-finalize` / `resolve-decision` /
      `faction-negotiate` / `advisor-chat` 完成一次 LLM 调用
- **THEN** 日志 extra 含 `saveId`（与 `turn`），`npc-actions` 另含 `factionId`、重试类含 `attempt`

#### Scenario: 开局端点不伪造归因
- **WHEN** `init-factions` 记录用量
- **THEN** 日志不含 `saveId` —— 它发生在存档创建之前，硬造归因只会污染单局口径

### Requirement: 成本聚合与告警口径
系统 SHALL 提供 `pnpm cost-report`（读 stdin 的 `[llm-usage]` 日志），按端点与按天输出 token
与人民币成本，折算单局成本，并以**退出码**承载告警语义。

#### Scenario: 正常输出
- **WHEN** `docker logs --timestamps jintian-api | pnpm cost-report --daily-limit 30`
- **THEN** 打印总 token、总成本、按端点降序表、按天表、单局成本与可归因占比，退出码 0

#### Scenario: 超日阈值
- **WHEN** 任一日的成本超过 `--daily-limit`
- **THEN** 退出码为 **2**，并在 stderr 列出超限的日期（cron 据此发通知）

#### Scenario: 输入异常不得当成零成本
- **WHEN** stdin 为空，或一条 `[llm-usage]` 都没解析到
- **THEN** 退出码为 **1** 并说明「多半是 docker logs 抓取失败」
- **AND** 理由：把「抓不到日志」报成「今天没花钱」是最危险的静默失败

#### Scenario: 数据不可信时打折
- **WHEN** 存在命中标志但解析失败的行，或 `totalTokens` 为 0 的记录
- **THEN** 结果里的 `unparsed` / `emptyUsage` 计数非零，报告显式提示成本可能被低估
