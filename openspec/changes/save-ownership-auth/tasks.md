# 任务：存档归属鉴权（设备凭据）

> 验证命令与结果如实记录，未执行的项标注为未做而非打勾。

## 1. 数据库：新增 device_credentials 表

- [x] `server/server/db/schema.ts`：新增 `deviceCredentials`（`device_id` PK / `secret_hash` UNIQUE /
      `revoked_at` / `created_at`），`secret_hash` 建唯一索引；与 `game_saves` **不建外键**
- [x] 文件头「当前含」清单与 `deviceId` 字段注释同步（原文「MVP 占位，后续接登录系统」已不准确）
- [x] `server/server/db/index.ts`：把新表注册进 `drizzle({ schema })` 并导出
- [x] **建表已执行**（原计划 `pnpm db:push`，实际走了更安全的路径，原因见下）：
      `drizzle-kit generate` 产出 DDL → 审阅（全 `CREATE TABLE/INDEX IF NOT EXISTS`，零 DROP/ALTER）→
      在开发库容器内 `psql -f` 执行 → `\d device_credentials` 核对结构
      - 为什么不用 `pnpm db:push`：`drizzle-kit push` 会按 schema.ts **对齐全部四张表**，
        而本机 5534 端口被前身项目 `D:\code\codeWork\GAME` 的 `game-postgres` 占用，
        对齐动作会波及另一个项目的库。手工执行只新增一张表，风险可控且可单条回滚
      - 已核对漂移为零：GAME 库三表的列与索引与本仓库 schema **完全一致**，只差这张新表；
        `server/.env` 指向 5534，即本仓库开发时连的一直就是它
      - 执行后复核：`game_saves` 仍 2 行、`faction_memories` 仍 23 行（未受影响）
      - 回滚方式（如需）：`DROP TABLE device_credentials;`
- [x] 线上 CVM 已执行同一迁移（2026-10-13）：只跑 `CREATE TABLE device_credentials` +
      唯一索引这 2 条（`drizzle-kit generate` 出来的文件含**全部四张表**，虽然都是
      `IF NOT EXISTS`，但索引名若与线上不同会给已有表造重复索引，故手工摘取）。
      线上表清单复验：device_credentials / faction_memories / game_events / game_saves ✓

## 2. 服务端：凭据与属主解析

- [x] 新增 `server/server/utils/device-auth.ts`：
      `hashDeviceSecret`（sha256）/ `generateDeviceSecret`（`randomBytes(32)`，256bit）/
      `registerDeviceCredential`（`INSERT ... ON CONFLICT DO NOTHING RETURNING` 裁决，无读后写）/
      `resolveOwnerDeviceId`（凭据优先 → 无效凭据 401 不降级 → 收紧 401 → 兼容期回落 + `[auth-compat]` 日志）
- [x] 新增 `server/server/api/game/device-credential.post.ts`：zod `.strict()` + `deviceId` 必须 UUID；
      409 `CREDENTIAL_EXISTS` / 403 `ENROLLMENT_CLOSED` / 405 / 500 分支齐备
- [x] `server/server/utils/rate-limit.ts`：新增 `auth` 桶（5 次/分钟）并接入 `getRateBucket`
- [x] `server/nuxt.config.ts`：新增 `deviceAuthEnforced` / `deviceAuthAllowFirstBind` 两个开关（默认关/开）
- [x] `server/.env.example`：写入两个开关与「收紧分两步、顺序不能反」的说明
- [x] `deploy/docker-compose.deploy.yml`：app 服务运行时注入 `NUXT_DEVICE_AUTH_ENFORCED` /
      `NUXT_DEVICE_AUTH_ALLOW_FIRST_BIND`（带 `:-false` / `:-true` 默认，未改线上 .env）
- 验证：`cd server && pnpm lint && pnpm typecheck` ✅（均 exit 0）

## 3. 服务端：三个存档端点改用反查属主

- [x] `saves.get.ts`：`deviceId` 转可选（1-64），查询条件用 `owner.deviceId`；
      文件头「deviceId 即归属凭证」表述改掉
- [x] `saves.delete.ts`：**把记忆行清理移到主删除成功之后**（`game_events`/`faction_memories` 无
      `device_id` 列，属主只能由主删除返回行数证明）；0 行命中直接 404，不再触碰记忆行
- [x] `sync-save.ts` GET：只强制 `saveId`，属主用 `owner.deviceId`
- [x] `sync-save.ts` POST：`values.deviceId` 与 `setWhere` 都改用 `owner.deviceId`
      —— 封掉「首插造出一行归属任意他人 deviceId」的注档口
- [x] 三处「不受 rate-limit 限制」的过时注释一并纠正（`saves` 一直在 `ai` 桶里）
- 验证：`cd server && pnpm test:api` ✅（134 passed，新增 15 例）

## 4. 服务端：测试

- [x] 新增 `server/tests/unit/device-auth.test.ts`（13 例）：哈希稳定性 / 凭据形态 / 首绑成功落 hash 不落明文 /
      重复注册 409 / 关闭注册不碰库 / 有效凭据反查 / 无效凭据不降级 / 收紧 401 / 兼容期放行且日志只记前 8 位
- [x] 新增 `server/tests/api/device-credential.test.ts`（8 例）：首绑 / 409 / 400（非 UUID、多余字段）/
      403 / 400 解析失败 / 405 / 500
- [x] `server/tests/api/saves-delete.test.ts`：顺序断言由 `events→memories→saves` 改为
      `saves→events→memories`；**新增两条回归护栏**：404 与主删除失败时 `deleteMock` 只被调用 1 次
      （不得清理记忆行）。属**预期内行为变更**（修 bug），故改用例不改断言方向
- [x] `server/tests/api/saves.test.ts`：链式 mock 的 `whereMock` 同时返回 `orderBy` 与 `limit`
      （凭据反查与列表查询共用）；新增凭据 4 例（有凭据免 deviceId / 凭据下 query 无效 / 无效凭据不进入查询 / 收紧 401）
- [x] `server/tests/api/sync-save.test.ts`：新增凭据 3 例，其中断言 `values.deviceId` 取凭据反查值
      而非 body 声明（攻击者用合法凭据 + 受害者 deviceId 的场景）
- [x] `server/tests/setup.ts`：`useRuntimeConfig` mock 补两个新开关（默认兼容期取值）
- [x] `server/tests/unit/rate-limit.test.ts`：新增 `auth` 桶分桶与 5 次/分钟断言
- 验证：`cd server && pnpm test:unit` ✅（192 passed）

## 5. 前端：换取凭据并注入请求头

- [x] `game-web/src/utils/device-id.ts`：新增凭据的同步读写 `getDeviceCredential` /
      `setDeviceCredential` / `clearDeviceCredential`（含内存副本，防隐私模式存不下）；
      只放存储、不放换取流程，避免与 `utils/api.ts` 形成循环 import
- [x] 新增 `game-web/src/utils/device-credential.ts`：`ensureCredential()`（模块级 in-flight 去重、
      409/403 置 `enrollmentBlocked` 停止重试、网络失败保留重试）+ `ownerParam()`（兼容期回落参数）
- [x] `game-web/src/utils/api.ts`：注入 `x-device-token`（读缓存，不同步阻塞在异步注册上）
- [x] `game-web/src/composables/useSaveList.ts`：`fetchList` / `fetchFullSave` / `deleteSave`
      先 `await ensureCredential()`，有凭据则 URL 不带 `deviceId`
- [x] `game-web/src/composables/useSaveSync.ts`：`sync()` 的 GET 同上；POST body 的 `deviceId`
      保留（zod strict 必填 + blob 快照），归属由服务端凭据裁决
- [x] 防重复提交：`ensureCredential` 的 in-flight 复用在 `finally` 重置（数据安全规则）
- 验证：`cd game-web && pnpm lint && pnpm typecheck` ✅（均 exit 0）

## 6. 前端：测试

- [x] 新增 `game-web/tests/unit/device-credential.test.ts`（12 例）：换取与持久化 / 已有缓存不请求 /
      并发只发一次 / 409 与 403 停止重试 / 网络失败可重试 / 畸形凭据不落缓存 / `ownerParam` 五种组合
- [x] `game-web/tests/unit/device-id.test.ts`：新增「设备凭据存取」4 例（H5 与小程序两条存储通道、
      格式校验拒绝脏数据、clear 同时清内存与持久化）；`beforeEach` 显式清两条通道
      （`getSystemInfoSync` 的 spy 会跨用例残留，只清当前平台那条会漏）
- [x] `game-web/tests/unit/api.test.ts`：新增 2 例（有凭据注入 `x-device-token` / 无凭据不带该头）
- [x] `game-web/tests/unit/use-save-list.test.ts`、`use-save-sync.test.ts`：mock `device-credential`
      （setup 的 `uni.request` 是空 `vi.fn()`，真注册会永久挂住），默认无凭据保持旧 URL 契约，
      另加「有凭据时 URL 不含 deviceId」断言
- 验证：`cd game-web && pnpm test:unit` ✅（440 passed，28 个文件全绿）
- 验证：`cd game-web && pnpm exec playwright test`（5 个 stub 了 sync-save 的 spec）✅ 19/19 passed
      —— 注意这些用例用 `page.route` 桩掉网络，**不经过真实鉴权链路**，只证明没把现有交互改坏

## 7. 文档同步

- [x] `docs/db-schema.md`：表清单 3→4 张；新增 `device_credentials` 完整小节
      （字段/索引/关键约束/Drizzle 定义）；纠正 `game_saves.device_id` 说明与
      `idx_game_saves_device_id`「MVP 暂不使用，预留」的过时表述
- [x] `docs/API.md`：新增 `POST /api/game/device-credential` 章节与目录项（并补上此前漏掉的
      `DELETE /api/game/saves` 目录项）；通用约定新增「请求头」小节；频率限制改为三个桶；
      sync-save GET/POST、saves GET/DELETE 四处参数表与错误表同步；错误码表补 5 个新码并纠偏 3 处旧描述
- [x] `openspec/changes/save-ownership-auth/`：proposal + tasks + `specs/cloud-sync` 与 `specs/save-management` 两份 delta

## 8. 迁移与收紧（本提案未覆盖，需按序执行）

- [x] 1. 开发库与线上库均已建表（线上于 2026-10-13 执行，见第 2 节）
- [x] 2. **后端已上线**（2026-10-13，走兼容期：线上不设 `NUXT_DEVICE_AUTH_*`，
      即 `enforced=false` / `allowFirstBind=true`，与代码默认一致，所以没改任何 env）。
      发布方式：本机 `pnpm build` → 上传 `/root/jintian/deploy/dist/.output`
      （原地解包覆盖，不 `rm -rf`，避开 bind-mount inode 陷阱）→
      `up -d --force-recreate app`。上线后实测三件：
      ① 老客户端形态（`x-device-id` 头 + query `deviceId`）返回 200 `{"saves":[]}`；
      ② 容器日志出现 `[auth-compat] deviceId=legacy-p*** 走无凭据旧通道` 且自动打码；
      ③ `/api/health` ok、`db: up`、api 内存 41MiB/512MiB。
      回滚副本：`/root/jintian/deploy/dist/.output.bak-20261013`（发布前 cp -a 留的）。
      另记一条：既无 token 又无 `deviceId` 的请求由 `resolveOwnerDeviceId` 拒为
      400 `INVALID_PARAMS`（消息「缺少 x-device-token 请求头或 deviceId 参数」），
      新老客户端都不会撞上，属预期。
- [ ] 3. 再发前端（新客户端开始注册换凭据）——**本次未做**，所以线上仍无真实设备走凭据通道
- [ ] 4. 观察 `[auth-compat]` 日志直至归零（`grep '\[auth-compat\]'`，容器 stdout）
- [ ] 5. 置 `NUXT_DEVICE_AUTH_ENFORCED=true` 关掉无凭据旧通道
- [ ] 6. 确认无新设备需要首绑后置 `NUXT_DEVICE_AUTH_ALLOW_FIRST_BIND=false` 收窄抢注窗口
- [ ] 7. 两个开关都收紧后，删除前端 `ownerParam()` 回落与三处 query `deviceId` 兜底

## 9. 遗留（另议）

- [ ] 清缓存 / 换浏览器 = 丢凭据且无法找回，本方案不解（需 openid 级真实身份，见 #7 域名提案）
- [ ] 「首个声明者可为未注册 deviceId 抢绑」的窗口只能靠步骤 6 关闭，不能靠凭据本身消除
- [ ] 未做吊销管理入口（`revoked_at` 列已留，但没有运营接口/CLI）
- [ ] 未做 `[auth-compat]` 之外的鉴权指标（谁在走旧通道、401 分布），可与 #8 CI/可观测性提案合并考虑

## 10. 真库端到端探针（补单元测试的空白：Drizzle 链式调用在单测里全是 mock）

对开发库（5534，PostgreSQL 18）+ `pnpm dev` 起的服务跑 13 项 HTTP 断言，全部通过；另加 3 项 SQL 侧断言：

| 断言 | 结果 |
|---|---|
| 首绑返回 200 + 64 位十六进制凭据；重复注册 409 | ✅ 真实主键约束裁决 |
| `deviceId` 非 UUID → 400 且不写库 | ✅ |
| 凭据属主为 A、body 声明为受害者 → 存档仍归属 A | ✅ SQL：`device_id=a66a9114…`，`registered=1`，`is_victim_declared=f` |
| 只带凭据、不带 deviceId 也能列出存档 | ✅ |
| 伪造凭据 + 合法 deviceId → 401 不降级 | ✅ |
| B 读 A 的档 → 404；B 覆盖上传 A 的档 → 403 `SAVE_FORBIDDEN` | ✅ `setWhere` 真实生效 |
| B 删 A 的档 → 404，且该 saveId 的 `game_events` 探针行**未被擦除** | ✅ SQL：`probe_memory_rows_left=1`（改造前此处会被清零） |
| 兼容通道（无凭据 + deviceId）放行；无凭据且无 deviceId → 400 | ✅ |
| `[auth-compat]` 日志只记前 8 位 | ✅ 实测 `deviceId=11111111*** 走无凭据旧通道` |
| 库里只存 sha256 | ✅ `length(secret_hash)=64`，无明文凭据行 |

探针数据已清理（删 1 存档 / 1 记忆行 / 5 凭据行），库回到探针前状态 `2 saves / 23 memories / 0 credentials`；
临时探针脚本与 `drizzle/` generate 产物均已删除（项目只用 push，不保留迁移文件）。
