# 上线前检查清单

> 本文件跟踪两个已归档提案中**未完成的非代码任务**（运维 / 真机 / 配置）。
> 源提案已原地标记归档，代码与测试均交付（709 测试全绿，H5 + 小程序构建成功）。

## 来源：add-qing-revival-mvp（MVP 主提案）

### T8.0 部署前置准备（域名 / HTTPS / Nginx）— 2026-10-10 已上线（形态与原计划不同，见下）

实际部署形态：CVM `122.51.97.106`（ap-shanghai，2C2G）上的**独立 compose 项目 `jintian`**，
编排文件 `deploy/docker-compose.deploy.yml` + `deploy/Caddyfile`，入口 **https://122.51.97.106:8443**。
同机另一项目 mychat 独占 80/443，故本项目改用 8443（HTTPS）/ 8081（跳转）。

- [x] ~~购买 + 备案域名~~ → **未做**：当前只有裸 IP，访问必须带 `:8443`
- [x] ~~申请 SSL 证书~~ → **自签证书（含 IP SAN）**，在服务器上生成、不入库。ACME 不给裸 IP 签发；
      用 HTTPS 的目的是拿到「安全上下文」（`crypto.randomUUID` 等在 `http://IP` 下为 undefined）
- [x] 反向代理：**Caddy 2**（非 Nginx）。SSE 关键项为 `flush_interval -1`（等价于 `proxy_buffering off`），
      且 `/api/*` 的 handle 必须排在静态 handle 之前，否则接口被 `try_files` 兜成 index.html
- [ ] ~~微信小程序后台配置 request 合法域名~~ → **2026-10-11 决定：不做小程序接入**。
      接入需 ICP 备案域名（唯一硬门槛），且 `game-web/src/manifest.json` 的 `mp-weixin.appid` 仍是空串、
      游戏类目资质未核实（个人主体大概率走不通）。方案与核实项存档见
      [deploy/domain-https-plan.md](file:///d:/code/codeWork/jintian-1851/deploy/domain-https-plan.md)
- [x] 验证接口可达 → 已新增 `GET /api/health`（真查 DB，不可用返 503），
      容器 healthcheck 改为「HTTP 200 且响应体 `ok===true`」。实测：DB 正常 200 / `probeMs=1ms`；
      DB 不可达 503 + `db:"down"`，同款探活命令退 1（会正确翻 unhealthy）
- [x] 备份失败**变成可观测状态**：`backup-db.sh` 每次运行落 `backups/health-status.json`，
      `GET /api/health` 读出 `backup`（fresh/stale/missing/invalid/disabled）与 `backupAgeHours`。
      刻意**不让它影响状态码**：caddy `depends_on: app: service_healthy`，备份过期返 503 会让
      整站起不来（备份坏了 ≠ 服务死，两个故障不能互相掩盖）
- [ ] 推送通道仍未接：cron 的失败退出码、`/api/health` 的 `backup=stale`、`cost-report` 退 2
      三处都只有"可被查"，没有"主动通知"。且宿主机上没有 node/tsx，
      `cost-report` 类聚合脚本目前**无法在服务器上运行**（要么装依赖，要么让日志聚合在本机/CI 侧跑）
- [x] 验证 SSE：`POST /api/game/generate-event?stream=1` 首包实测 **830ms / 1024ms**，
      单次生成收到 68–72 个 delta 帧后给出完整事件对象；缓存命中 140ms
- [ ] ~~微信开发者工具关闭「不校验合法域名」后请求成功~~ → 同上，随小程序接入一并搁置

#### 2026-10-11 复核：原计划里的两处认知纠正

1. **「借用 mychat 的域名」不成立** —— mychat 同样没有域名。
   `my-chat/deploy/Caddyfile` 自述「线上只有公网 IP，ACME 不给 IP 签发证书」，站点按 `:443` 端口建、
   用含 `IP:122.51.97.106` SAN 的自签证书。两个项目都是裸 IP + 自签，无域名可借。
2. **`:8443` 本身不阻碍微信接入** —— 微信官方网络文档明确「对于 https 域名，可以配置端口，
   如 `https://myserver.com:8080`」。因此不必迁 443、不必与 mychat 做 SNI 分流、不必新增安全组端口。
   真正的门槛只有「备案域名 + 受信任证书」。

### 生产环境配置

- [x] `OPENAI_API_KEY`（硅基流动）→ 写在服务器 `/root/jintian/deploy/.env`（不入库），
      以 `NUXT_OPENAI_API_KEY` **和** 无前缀 `OPENAI_API_KEY` 两种形式注入
- [x] `DATABASE_URL` → 指向 compose 内网 `postgres:5432`，**不再是 localhost:5534**；
      宿主机仅 `127.0.0.1:5544` 回环映射（供 SSH 隧道跑 `db:push`），**不对公网暴露**
- [ ] `IMGBB_API_KEY` → 未配置（图片对话按需再开）
- [x] `docker compose up -d` 启动 PostgreSQL 并验证 healthy（`jintian-db`）
- [x] `pnpm db:push` 同步 schema：经 SSH 隧道执行，建 `game_saves` / `game_events` / `faction_memories`
      + pgvector 扩展 + 13 索引；玩家存档与事件向量记忆均已实测落库

### 数据库备份（2026-10-11 建立）

- [x] 备份脚本 `deploy/backup-db.sh`：容器内 `pg_dump`（走本地 socket 的 trust 认证，
      **不把密码写进脚本或命令行**）→ gzip → `/root/jintian/backups/`，按文件名时间戳轮转保留 14 份
- [x] 每日 cron：`17 3 * * * …/backup-db.sh >> backups/backup.log 2>&1`（`crond` active；
      安装时保留了机器原有的腾讯云 stargate 条目，未覆盖整个 crontab）
- [x] **恢复已演练**：把 dump 导入临时库 `restore_drill` 验证通过——3 张表、1 存档、1 事件，
      `game_events.embedding`（pgvector 列）也完整回来；演练库已删除，未触碰线上数据。
      只验证「能备份」而不验证「能恢复」的备份等于没有备份
- [ ] ⚠️ **未解决的局限**：备份与数据库在**同一块系统盘**上，整机丢失 / 误删卷会同时带走数据和备份。
      真正可靠需要以下任一：腾讯云 COS 异地转储、CVM 自动快照策略、或独立云硬盘挂载给 `/root/jintian/backups`
- [x] 备份已可被探活发现：`backup-db.sh` 每次运行都落 `backups/health-status.json`，
      `GET /api/health` 据此输出 `backup` / `backupAgeHours`（阈值 `NUXT_BACKUP_MAX_AGE_HOURS`，默认 30h）。
      cron 连续失败不再只藏在 `backup.log` 里 —— 但仍是"查得到"而不是"有人被通知"，
      见本节开头那条未勾项

> ⚠️ 踩坑记录（务必保留）：`server/db/index.ts` 读 `process.env.DATABASE_URL`、
> `server/utils/embeddings.ts` 读 `process.env.OPENAI_API_KEY`，而 **runtimeConfig 不会反向写回
> `process.env`**（`db/index.ts` 顶部注释的假设是错的）。只注入 `NUXT_` 前缀时接口全部返回 200，
> 但存档写不进库、向量记忆静默跳过 —— 属于无声故障，部署时两类变量都要给。

### T8.1 三端真机测试

- [ ] H5：Chrome + Firefox + Safari 验证流式、动画、布局
      → 2026-10-10 已在**线上**用 Chrome（390×844 视口）走通开局 → 3 回合 → 事件流式 → 决策 → 同步，
      控制台零报错、底栏可点；Firefox / Safari 仍未测
- [ ] 微信小程序：iOS + Android 真机验证 `uni.request` chunked 流式
- [ ] App：Android APK 真机验证
- [ ] 每端至少 1 次完整流程：开局 → 1 回合 → 同步

参考：`openspec/changes/add-qing-revival-mvp/tasks.md` T8.1

## 来源：improve-ux-playability（体验优化提案）

### T4.4 第 4 项：双端完整流程浏览器手动验证

- [ ] H5 端：首页 → 如何游戏 → 开始游戏 → 引导 → 回合（焦点/事件/选项两步/军师简报/危机预警）→ 折叠展开 → 结局
- [ ] 微信小程序端：同上完整流程

参考：`openspec/changes/improve-ux-playability/tasks.md` T4.4

## 来源：free-action-faction-effects（自由行动势力影响提案）

### 多端冒烟遗留：微信小程序人工走查

- [ ] 微信开发者工具中走查自由行动含势力变化：输入"暗中资助湘军"类决策 → 反馈区出现"关系 +N"提示、资源扣减正常（H5 端已由 `tests/e2e/free-action-faction-effects.spec.ts` 覆盖；逻辑层三端共用，无浏览器 API 依赖）

参考：`openspec/changes/archive/2026-08-17-free-action-faction-effects/tasks.md` 第 5 节

## 完成标准

所有项打勾后，两个提案可视为完全交付，可移除本清单文件。
