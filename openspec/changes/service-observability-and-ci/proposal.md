# 提案：CI 门禁 + /api/health + LLM 成本观测口径

## 为什么 / Why

三件事都源于同一个缺口：**这个仓库没有任何自动化反馈回路**。

1. **无 CI**：仓库没有 `.github/`（`.gitlab-ci.yml` 等也没有），AGENTS.md 规定的
   「每次提交前必须通过 lint + typecheck + test:unit」全靠人和 AI 助手自觉执行。
   本次会话里就真实踩到一次：`pnpm typecheck 2>&1 | tail` 拿到的是 **tail 的退出码**，
   2 个类型错误被误报成「typecheck 通过」。这类错误正是 CI 该挡的。
2. **无 /health**：`deploy/docker-compose.deploy.yml` 的容器探活原先打 `/api/game/saves`，
   而该请求在 `middleware/rate-limit.ts` 里因缺 `x-device-id` 直接返 400 —— **连数据库都没碰到**。
   postgres 挂掉时容器依然 healthy。原 compose 注释自己写着「产物里没有 /health 路由，
   这里只判进程是否在监听」，属于明知是凑合。
3. **成本无口径**：`docs/ai-cost.md` 全是纸面估算；`utils/llm-usage.ts` 已在每个 AI 端点输出
   `[llm-usage]` 单行 JSON，其注释写着「后续接入监控」，但没有任何东西消费它。
   而且**只有 2 个端点的日志带 saveId**，导致文档里最关键的「单局成本 ¥0.111」这个口径根本无法核算。

## 改什么 / What Changes

- **CI**：新增 `.github/workflows/ci.yml`，两个 job 分别覆盖 `server/`（lint + typecheck + test:unit + test:api）
  与 `game-web/`（lint + typecheck + test:unit + test:component）。Node 固定 **22**（线上镜像是
  `node:22-alpine`，本地是 24/25，用线上版本跑才有意义）。
- **/api/health**：新增探针，真查一次 `select 1`（3s 超时），DB 不可用返回 **503 + `db:"down"`**；
  容器 healthcheck 改为要求「HTTP 200 且响应体 `ok===true`」，`timeout` 抬到 10s 以包住 3s 探针。
- **成本口径**：`logLlmUsage` 的 extra 统一补上 `saveId`/`turn`（npc-actions / npc-actions-finalize /
  resolve-decision / faction-negotiate / generate-event 非流式分支）；新增
  `server/scripts/llm-cost-report.ts` + `scripts/lib/llm-cost.ts` 聚合日志，按端点/按天出成本表、
  折算单局成本，并用**退出码**承载告警语义（0 正常 / 1 输入异常 / 2 超日阈值）；
  `docs/ai-cost.md` 新增「成本观测与告警口径」一节写明阈值推导。

## 关键决策与被排除的方案

| 决策 | 理由 |
|---|---|
| 探针**要**查 DB（原计划倾向不查） | 不查就只能测「node 在监听」，而那正是现有 healthcheck 的问题：postgres 挂了依然 healthy。当前没有任何监控系统，**容器 unhealthy 是唯一能自动发现故障的信号面**，不能浪费 |
| DB 故障返 503 而不是 200+body 标记 | 让 Docker 真的把状态翻成 unhealthy。不会引发重启风暴：部署里没有 autoheal，`depends_on: service_healthy` 只作用于启动顺序 |
| 路径用 `/api/health` 而非 `/health` | Caddy 只反代 `/api/*`，裸 `/health` 会被静态站点的 `try_files` 兜成 index.html —— 容器内能过、外部探活拿不到真实状态 |
| 探针 3s 超时 < healthcheck 10s | 否则 postgres-js 在库失联时可能**挂住不 reject**，Docker 会把「慢」判成「死」，误报比不报更糟 |
| 成本脚本走 **stdin**，不连 docker daemon、不写库 | 与 `deploy/backup-db.sh` 同一取向：2C2G 上不新增常驻服务、不引依赖，日志是既有唯一数据源，脚本无状态可随时删 |
| 告警用**退出码**而非推送 | 没有通知渠道可接；cron 判退出码是零依赖的最小可用形态，接监控后同一格式可直接复用 |
| 阈值 MVP 定 **日 ¥30** | 文档预估 MVP < ¥333/月 ≈ 日均 ¥11.1，取约 2.7 倍留足自然波动——阈值天天误报等于把告警喊废 |
| 排除「新增 llm_usage 表 + 端点写库」 | 写库要每请求多一次 INSERT（2C2G 上不值），且日志已经结构化；等真要图表/长期趋势时再落库 |
| 排除「CI 里跑 Playwright e2e」 | 需要装浏览器 + 起 dev server，额度与时长都翻倍；本次范围按任务定义只到 unit/api/component |
| 排除 `init-factions` 补 saveId | 它发生在**存档创建之前**（角色创建页），逻辑上没有 saveId 可归，硬造一个只会污染归因 |

**已知缺口（接受并记录）**：`advisor-briefing` 未把 saveId 解构进作用域，其成本计入总量但不计入单局；
报告里用 `attributableShare` 显式暴露这类归因缺口，而不是假装成本变低了。

## 影响 / Impact

| 影响面 | 改动 |
|---|---|
| CI | 新增 `.github/workflows/ci.yml`。**注意：本仓库当前领先 origin/main 若干提交未推送，GitHub 上看不到任何运行**；PR 门禁还需在仓库设置里把两个 job 名勾进 Required status checks（文件末尾写了具体名称与路径） |
| 后端 `server` | 新增 `server/api/health.get.ts`、`server/scripts/llm-cost-report.ts`、`server/scripts/lib/llm-cost.ts`；4 个 AI 端点的 `logLlmUsage` extra 增字段；`package.json` 新增 `cost-report` |
| 数据库 | 无变更 |
| 部署 | `deploy/docker-compose.deploy.yml` 的 app healthcheck 换成打 `/api/health` 且要求 `ok===true`；`timeout` 5s→10s、`interval` 15s→20s、`start_period` 20s→30s |
| 文档 | `docs/API.md` 新增 GET /api/health 章节与目录项；`docs/ai-cost.md` 新增观测与告警口径；`openspec/pre-launch-checklist.md` 纠正「没有 /health 路由」的旧表述 |
| 测试 | 新增 `tests/api/health.test.ts`（4 例，含 DB 拒绝与探针超时两条降级路径）、`tests/unit/llm-cost.test.ts`（10 例）；`server/tests/unit/rate-limit.test.ts` 此前已有 `getRateBucket('/api/health') === null` 断言，正好覆盖新路径不受限流 |

## 能力 / Capabilities

### New Capabilities
- `service-observability` - 服务健康探针与 LLM 成本可观测（健康语义、按天成本聚合与告警口径）
