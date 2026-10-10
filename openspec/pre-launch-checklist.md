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
- [ ] 微信小程序后台配置 request 合法域名 → **阻塞中**：微信要求备案域名 + 受信任证书，
      自签 IP 证书过不了校验，小程序端目前无法直连该后端
- [x] 验证接口可达 → 项目**没有 `/health` 路由**（本清单原假设存在），改用
      `curl -sk https://122.51.97.106:8443/api/game/saves` 与容器 healthcheck（任意 HTTP 响应即存活）
- [x] 验证 SSE：`POST /api/game/generate-event?stream=1` 首包实测 **830ms / 1024ms**，
      单次生成收到 68–72 个 delta 帧后给出完整事件对象；缓存命中 140ms
- [ ] 微信开发者工具关闭「不校验合法域名」后请求成功 → 同上，待域名

### 生产环境配置

- [x] `OPENAI_API_KEY`（硅基流动）→ 写在服务器 `/root/jintian/deploy/.env`（不入库），
      以 `NUXT_OPENAI_API_KEY` **和** 无前缀 `OPENAI_API_KEY` 两种形式注入
- [x] `DATABASE_URL` → 指向 compose 内网 `postgres:5432`，**不再是 localhost:5534**；
      宿主机仅 `127.0.0.1:5544` 回环映射（供 SSH 隧道跑 `db:push`），**不对公网暴露**
- [ ] `IMGBB_API_KEY` → 未配置（图片对话按需再开）
- [x] `docker compose up -d` 启动 PostgreSQL 并验证 healthy（`jintian-db`）
- [x] `pnpm db:push` 同步 schema：经 SSH 隧道执行，建 `game_saves` / `game_events` / `faction_memories`
      + pgvector 扩展 + 13 索引；玩家存档与事件向量记忆均已实测落库

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
