# 任务：CI 门禁 + /api/health + 成本观测口径

> 验证命令与结果如实记录，未执行的项标注为未做而非打勾。

## 1. CI

- [x] 新增 `.github/workflows/ci.yml`：两个 job
      - `server`：install(--frozen-lockfile) → lint → typecheck → test:unit → test:api
      - `game-web`：install → lint → typecheck → test:unit → test:component
- [x] Node 固定 `22`（对齐线上 `node:22-alpine`），缓存按各自 lockfile 路径
- [x] `concurrency` 取消同引用旧运行；`timeout-minutes: 15`
- [x] YAML 语法校验：用 js-yaml 解析核对 → jobs=[server,game-web,openspec]，triggers=[pull_request,push]
- [ ] **未做：把三个 job 名勾进分支保护的 Required status checks** —— 这是仓库设置而非文件，
      且属于改动共享状态。名称与路径写在 ci.yml 末尾注释
- [x] **推送验证 CI 真跑**：run #5（`37e7ef7`）、#6（`684fb9c`）、#7（`fe5403b`）三个 job 全 success，
      逐 step 结论已核（不是只看 run 级结论）。首跑（run #1，`cb5c9c0`）是红的，红在三个
      「本地全绿、CI 必红」的不对称上，均已定位并单独修复：
      1. `pnpm/action-setup@v4` 读**仓库根** package.json 的 `packageManager`，而根目录刻意不是
         workspace、没有该文件 → 两个 job 止步第一步、lint/测试一行没跑（修：显式 `package_json_file`，`eb0cd9b`）
      2. `lint:css` 的 `customSyntax` 依赖 `postcss-html` / `postcss-scss` 未声明为直接依赖，
         npm hoist 布局能解析、pnpm 隔离布局不能；且本地 hoist 到的是 `postcss-html@1.8.1`，
         它对 `<style lang="scss">` 静默跳过 —— 这道 gate 从未真正生效过（修：`6510c4c` + 整改 195 条 `88de72f`）
      3. 三个镜像守卫用例跨项目 import `server/*.ts`，esbuild 按文件位置解析 `server/tsconfig.json`，
         其 extends 指向被 gitignore 的 `.nuxt/tsconfig.json` → 只有跑过 server dev/typecheck 的机器能过
         （修：`tests/global-setup.ts` 缺失时补桩，`37e7ef7`；附带 4 条 200 局模拟用例的 30s 超时 `8d5e0a3`）
- [x] 新增第三个 job：`openspec validate --all --strict`（openspec 不是子项目依赖，
      本地为 nvm 全局的 `@fission-ai/openspec@1.5.0`，CI 用 `npx --yes` 钉同一版本）

## 2. /api/health

- [x] 新增 `server/server/api/health.get.ts`：`select 1` 探针 + 3s `Promise.race` 超时；
      DB 不可用 → `setResponseStatus(503)` + `{ ok: false, data: { status: 'degraded', db: 'down' } }`；
      失败只记 message 不记堆栈（探针高频）
- [x] 响应字段仅 `status`/`db`/`uptimeSec`/`probeMs`，不含连接串与环境变量
- [x] `deploy/docker-compose.deploy.yml` app healthcheck 改为要求 HTTP 200 **且** `ok===true`；
      `interval` 15s→20s、`timeout` 5s→10s（必须包住 3s 探针）、`start_period` 20s→30s
- [x] compose 语法校验：`docker compose -f deploy/docker-compose.deploy.yml config -q` 退 0 ✅
- 验证：`cd server && pnpm test:api` ✅（新增 `tests/api/health.test.ts` 4 例：DB 正常 / DB 拒绝 /
      探针超时（fake timers）/ 响应体字段集合与不泄漏）
- **真机验证（连真实数据库）**：
  - [x] DB 正常：`GET /api/health` → 200 + `{"status":"ok","db":"up","probeMs":1}`
  - [x] DB 不可达（另起实例把 `DATABASE_URL` 指向死端口 5999，不影响共享库）：
        → **HTTP 503** + `db:"down"`，日志 `WARN [health] DB 不可用: connect ECONNREFUSED 127.0.0.1:5999`
  - [x] 把 compose 里那条 node 探活命令原样跑一遍 → 退出码 **1**（证明 postgres 故障确实会把容器翻成 unhealthy）
  - [x] 限流豁免：`tests/unit/rate-limit.test.ts` 既有断言 `getRateBucket('/api/health') === null` 覆盖

## 3. LLM 成本观测口径

- [x] `logLlmUsage` 的 extra 补 `saveId`/`turn`：`npc-actions`、`npc-actions-finalize`（取自 `ctx`）、
      `resolve-decision`、`faction-negotiate`、`generate-event` 非流式分支
      —— 此前只有 `advisor-chat` 与 `generate-event-stream` 带 saveId，「单局成本」根本无法核算
- [x] `init-factions` **刻意不带** saveId：它发生在存档创建之前，硬造归因会污染口径
- [x] 新增 `server/server/scripts/lib/llm-cost.ts`（纯函数：解析 / 聚合 / 报告 / 阈值）
      与 `server/server/scripts/llm-cost-report.ts`（CLI：读 stdin、`--price-per-mtok`、`--daily-limit`、`--json`）
- [x] `package.json` 注册 `"cost-report": "tsx server/scripts/llm-cost-report.ts"`
- [x] 退出码语义：0 正常 / 1 输入或用法异常（**不把「抓不到日志」报成「零成本」**）/ 2 超日阈值
- [x] `docs/ai-cost.md` 新增「成本观测与告警口径」：端点×归因维度表、核算命令、阈值推导
      （MVP 日均 ¥11.1 → 告警 ¥30；1000 DAU 日均 ¥111 → 告警 ¥300）、
      两个结构性异常信号（单局 > ¥0.30、init-factions/generate-event 占比异常）、
      三个「数据不可信」信号（unparsed / emptyUsage / attributableShare）
- 验证：`cd server && pnpm test:unit` ✅（新增 `tests/unit/llm-cost.test.ts` 10 例）
- **CLI 真跑验证**（喂入样例日志，含 docker 时间戳行与坏 JSON）：
  - [x] 正常报告：按端点降序 / 单局口径 `¥0.0011 每局` / 按天分桶 / `提示：1 行解析失败` → 退 0
  - [x] `--daily-limit 0.00001` → 退 **2**
  - [x] 空 stdin → 退 **1**
  - [x] `--json` → 结构化输出含 `games`/`costPerGameCny`/`attributableShare`/`overDailyLimit`

## 4. 文档同步

- [x] `docs/API.md`：新增 `GET /api/health` 章节（响应两态字段表、为何放 `/api/` 前缀、
      为何要查 DB、容器探活命令与 timeout 约束）与目录项
- [x] `docs/ai-cost.md`：见第 3 节
- [x] `openspec/pre-launch-checklist.md`：纠正「项目没有 /health 路由」的旧表述，
      并新增一条**未完成**项：cron 侧尚未接任何告警通知

## 5. 遗留（本提案未覆盖，另议）

- [ ] cron 报警通道（备份失败、health 转 unhealthy、cost-report 退 2 三处都只有退出码，无人接收）
- [ ] `advisor-briefing` 的 saveId 归因缺口
- [ ] CI 未覆盖 Playwright e2e（需装浏览器 + 起 dev server；另有 `full-journey-real` /
      `faction-negotiation` / `free-action-faction-effects` 三条依赖真实后端与 AI key，
      接进 CI 前要先决定它们怎么跑或怎么标退）
- [ ] CI 未覆盖 `build`（game-web `build:h5` 与 server `nuxi build` 本地退 0，runner 上未验）
- [ ] 长期成本趋势需要落库或接 Loki/Prometheus；当前设计只保证日志格式可被直接消费
