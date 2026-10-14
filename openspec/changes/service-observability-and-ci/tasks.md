# 任务：CI 门禁 + /api/health + 成本观测口径

> 验证命令与结果如实记录，未执行的项标注为未做而非打勾。

## 1. CI

- [x] 新增 `.github/workflows/ci.yml`：两个 job
      - `server`：install(--frozen-lockfile) → lint → typecheck → test:unit → test:api
      - `game-web`：install → lint → typecheck → test:unit → test:component
- [x] Node 固定 `22`（对齐线上 `node:22-alpine`），缓存按各自 lockfile 路径
- [x] `concurrency` 取消同引用旧运行；`timeout-minutes: 15`
- [x] YAML 语法校验：用 js-yaml 解析核对 → jobs=[server,game-web,openspec]，triggers=[pull_request,push]
- [ ] **未做：把四个 job 名勾进分支保护的 Required status checks**（2026-10-14 起是四个，
      新增 `game-web e2e (mock-backed)`）—— 这是仓库设置而非文件，
      且属于改动共享状态。名称与路径写在 ci.yml 末尾注释。
      ⚠ job 改名会让旧的勾选项静默失效（本仓库已踩过一次：加 build 后改了 job 名），
      所以改名后必须回仓库设置里重新搜、重新勾、并确认列表里没有灰色的失效项
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
      → **备份这一路已在 2026-10-14 改成可观测**（见第 6 节），但仍是"查得到"不是"被通知"；
      cost-report 那条更麻烦：宿主机上既没有 node 也没有 tsx，脚本压根跑不起来

## 6. 备份失败可被探活发现（2026-10-14）

出发点仍然是那句：**没有监控系统，能自动发现故障的信号面只有容器状态**。备份 cron 的失败
只体现在退出码和 `backups/backup.log` 里，没人读日志 = 没有告警。把它搬进 `/api/health`
的字段，任何一次探活（人 curl / 将来的监控 / 事后回看）都能撞到。

- [x] `deploy/backup-db.sh`：每次运行落 `backups/health-status.json`
      （`{ok, lastAttemptAt, lastSuccessAt, file, bytes, error}`，先写 `.tmp` 再 `mv`，
      免得 health 每 20s 读到半截 JSON）。`--list` / `--restore` 不参与判定
- [x] **顺手修掉一个真实缺口**：原来写的是 `pg_dump | gzip`，管道退出码取最后一个命令，
      pg_dump 失败被 gzip 的成功盖掉，只能靠体积猜、报成"字节过小"。dash 没有 `pipefail`，
      所以改成「裸 SQL 落 `.part` → 单独 gzip → 两步各自判退出码」，失败信息终能说清是谁挂了
- [x] `server/utils/backup-status.ts`（新，纯函数）+ `api/health.get.ts` 输出
      `backup` / `backupAgeHours` / 异常时的 `backupDetail`
- [x] `runtimeConfig.backupStatusFile`（`NUXT_BACKUP_STATUS_FILE`）与
      `backupMaxAgeHours`（默认 30，cron 每日 03:17 留 6 小时余量）；compose 里以 `:-` 给默认值
- [x] compose 的 app 服务新增只读挂载 `../backups:/data/backups:ro`
      —— **挂目录不挂文件**：文件还不存在时 Docker 会在宿主路径上建一个同名目录，
      备份脚本写不进去、health 永远读到一个目录，属于静默失效
- [x] 关键设计：**备份状态不参与 HTTP 状态码**。caddy 是 `depends_on: app: service_healthy`，
      让 stale 返 503 会让 app 转 unhealthy，之后 `compose up` 因为等不到 healthy 把整个静态站卡住
      —— 备份坏了反而让站点起不来，比原问题更糟。DB 故障与备份过期同时发生时仍按 DB 走 503，
      两个故障不互相掩盖
- [x] 文档：`docs/API.md` 的 health 字段表与探活说明、`deploy/.env.example` 新增阈值项、
      `openspec/pre-launch-checklist.md` 两条相关项改写为"可观测已做 / 推送通道未做"
- [x] 单测：`tests/unit/backup-status.test.ts`（15 例：五种状态、阈值边界、失败保住上次成功、
      时钟回拨算出负年龄仍 fresh、非法阈值回落 30 而不是"全都 stale"）
      + `tests/api/health.test.ts` 增 5 例（disabled/missing/fresh/stale 不改状态码/两个故障并存）
- [x] 用假 `docker` 命令把脚本在临时目录里真跑过：成功、pg_dump 失败、空产物、容器未运行、
      `--list` 不改动状态文件，五个路径的退出码与 JSON 内容逐条核对
      （测出的两处真问题：`+0800` 时间戳 `Date.parse` 按本地时区猜 → 脚本改落 UTC `Z`、
      health 端点读到 `null` 会抛 TypeError → 加非对象守卫）
- [x] **已部署并线上实测**（2026-10-14 10:13）：`pnpm build` → 宿主机 `dist/.output.bak-20261014`
      → 原地解包 → `up -d --force-recreate app`（挂载变了必须重建）。caddy 未重建、静态站无中断；
      宿主机 `backup-db.sh` 与 `docker-compose.deploy.yml` 各留 `.bak-20261014` 副本。三条关键实测：
      ① 状态文件还不存在时 health 报 `backup=missing` 但**仍是 200 且容器 healthy**
        —— 「备份坏了不牵连站点」这条设计在线上成立，不是纸面推理；
      ② 真跑一次脚本后 `{"backup":"fresh","backupAgeHours":0}`，落的是 UTC `Z` 时间戳；
      ③ 容器内 `/data/backups/health-status.json` 与宿主机那份一致（只读挂载生效）。
      逐条记录见 `save-ownership-auth/tasks.md` 第 12 节
- [ ] 推送通道仍未接。且要注意：宿主机没有 node/tsx，`cost-report` / `auth-report`
      这类聚合脚本**当前无法在服务器上运行**，只能在本地或 CI 里跑。已验证可用的形态：
      `ssh root@… 'docker logs --since 24h jintian-api 2>&1' | pnpm tsx server/scripts/auth-report.ts`
      —— 真日志实测：带不带 `--timestamps` 都能解析；窗口内只有 401/400、没有成功裁决时
      `--fail-if-compat` 退 2 而不是退 0，「没样本」不会被当成「已归零」
- [x] `advisor-briefing` 的 saveId 归因缺口已补（2026-10-14）：`parseResult.data` 里本来就有
      `saveId`，只是没解构进作用域 → 现在 `logLlmUsage('advisor-briefing', usage, { saveId, turn })`，
      并补了两条 API 测试钉住（正常路径必须带 saveId+turn+totalTokens；降级路径不得产日志）
- [x] **CI 已覆盖 Playwright e2e（mock-backed）**（2026-10-14，第 4 个 job `game-web e2e (mock-backed)`）：
      `pnpm exec playwright test --grep-invert "real-backend"`，浏览器用
      `playwright install --with-deps chromium` 装，dev server 由 config 的 webServer 起。
      决策依据是先测不是猜：本机**不起后端、无 LLM key** 跑一遍，42 例 / 29 秒全绿，
      所以敢占一个 job；剩下 3 条依赖真后端 + AI key 的用例统一在标题打 `[real-backend]`
      标记排除（`full-journey-real` / `faction-negotiation` / `free-action-faction-effects`），
      它们带 LLM 非确定性的软跳过 `test.skip`，进 CI 只会产出随机红。
      失败时上传 `playwright-report` + `test-results` 产物，否则那一红只能靠重跑碰运气
      —— CI 首跑（run #23，`45f6e11`）该 job success，全程 107s。
      ⚠️ 这个"绿"单独看是不可信的：如果 `--grep-invert` 一条都没匹配到，job 也可能照样绿，
      那就成了假门禁。所以补了一条本地证据：故意用匹配不到的 `--grep` 跑一次，
      Playwright 报 `Error: No tests found` 并退 **1** ⇒ 零匹配不可能伪装成功，
      107s 那次确实跑了 42 例
      （顺带纠正我自己先写下的一个错数：第一次量到 4 分 23 秒，其实是管道 `| tail` 让
      `time` 把等待算错了地方，重测两次都是 29–30s。耗时是给这个 job 定价的依据，写错就等于骗自己）
- [ ] 那 3 条 `[real-backend]` 用例仍未被任何自动化覆盖：要么给 CI 配一套带 DB 与
      （或 mock 掉）LLM 的后端服务，要么定一条"人工发版前跑一次"的固定动作并记录结果，
      现在两头都没有 —— 别把上面那个 e2e job 当成端到端已经全覆盖了
- [x] CI 已覆盖 `build`：game-web 跑 `build:h5`、server 跑 `nuxi build`（`6250cb7`）。
      runner 实测：game-web job 85s、server job 39s 均 success，job 名已同步带上 / build
- [ ] 长期成本趋势需要落库或接 Loki/Prometheus；当前设计只保证日志格式可被直接消费
