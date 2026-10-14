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
- [x] 3. 前端已发（2026-10-13）：本机 `pnpm build:h5` → 备份 `deploy/dist/h5.bak-20261013`
      → 原地解包上传 → `up -d --force-recreate caddy`。
      验证是**按产物哈希比对**的：线上 `index.html` 引用的入口是
      `assets/index-D7WNvjz8.js`，与本次构建一致；按名取懒加载 chunk
      `assets/useSaveSync.CwVwE_50.js` 返回 200 且含 `device-credential` 调用。
      之所以不只看 200：caddy 直接 serve 静态目录，旧产物同样会返回 200。
      风险面已核：注册失败时 `ensureCredential()` 返回空串并回落旧参数通道，
      `enrollmentBlocked` 只在服务端确定性判定（`CREDENTIAL_EXISTS` / `ENROLLMENT_CLOSED`）
      时置位，网络抖动与 429 会在下次同步重试 —— 最坏情况等于退回今天的行为。
- [x] 3b. 线上凭据全链路自检（2026-10-13，已当场清理）：用一次性 UUID 调
      `POST /api/game/device-credential` 注册 → 拿到 64 位凭据 → 带 `x-device-token`
      请求存档端点，按凭据反查属主成功（不再走 `[auth-compat]`）→ 删除该凭据行。
      复查 `device_credentials` 行数 = 0，`game_saves` 仍是 1 行 1 属主，线上无残留。
- [x] 3c. 401 自愈已实现并顺带修掉一个静默失效（见第 8.5 节）
- [ ] 4. 观察 `[auth-compat]` 日志直至归零（`grep '\[auth-compat\]'`，容器 stdout）
      ⚠️ **2026-10-14 10:13 计数被清零了，不是归零**：当天为了上备份可观测做了
      `--force-recreate app`，容器重建后 `docker logs` 只剩新容器的 3 行，之前的读数
      （含 10-13 演练造成的 4 条）随旧日志流一起消失。明天谁 grep 到 0 条就以为"老客户端
      走完了"，会据此误收紧 —— 这条必须写在观察项旁边。
      现在改用 `pnpm auth-report`（聚合 `[auth-event]`，见第 12 节），它至少能区分
      "没有样本"（no_data，退 2）和"真的归零"（resolved，退 0）。
      宿主机没有 node/tsx，聚合命令要在本地跑：
      `ssh root@… 'docker logs --since 24h jintian-api 2>&1' | pnpm tsx server/scripts/auth-report.ts`
- [ ] 5. 置 `NUXT_DEVICE_AUTH_ENFORCED=true` 关掉无凭据旧通道
      前置已满足（8.5/8.6：自愈 + 错误码可读，且线上演练真跑过一次）。
      仍建议先等 `[auth-compat]` 归零，否则收紧当天老玩家会读不到云端档
      （不至于丢本地档，但要重新注册才能同步）。
- [ ] 6. 确认无新设备需要首绑后置 `NUXT_DEVICE_AUTH_ALLOW_FIRST_BIND=false` 收窄抢注窗口
- [ ] 7. 两个开关都收紧后，删除前端 `ownerParam()` 回落与三处 query `deviceId` 兜底

## 8.5 收紧前必须补的两个洞（步骤 5 的前置，已完成）

- [x] **401 不自愈 = 玩家被 brick**：服务端对「带了无效 `x-device-token`」直接 401
      `INVALID_DEVICE_TOKEN`，**不**回落兼容通道（回落只留给"根本没带凭据"的老客户端）。
      本地凭据一旦被运维删行 / 将来做吊销 / 收紧意外弄脏，客户端会永远带着同一个坏凭据，
      存档读写彻底卡死。`device-id.ts` 的 `clearDeviceCredential()` 此前**零调用点**，就是这块缺口。
      修法：`game-web/src/utils/device-credential.ts` 新增 `withCredentialRetry()`
      —— 仅对 `INVALID_DEVICE_TOKEN` 清缓存并重试一次（重注册成功→新凭据；
      被判已绑定→空串→调用方按 `ownerParam` 回落），第二次再失败照抛，不循环。
      5 个存档调用点全部改走它：`useSaveList` 的 fetchList / fetchFullSave / deleteSave，
      `useSaveSync` 的 sync GET 与 uploadLocal POST。
      POST 重试安全性已核：`sync-save.ts` 的 `resolveOwnerDeviceId` 在
      `INSERT ... ON CONFLICT` 之前裁决，401 时写入尚未发生，故不会重复写。
- [x] **前端读不到服务端错误码**（本次发现的真 bug，波及面比自愈更大）：
      路由用 `createError({ data: { ok:false, error:{…} } })` 返回时，H3/Nitro 序列化把
      约定的业务错误体**嵌在顶层 `data` 下**，而 `api.ts` 只认顶层 `ok` → 一律退化成
      `ApiError('INVALID_RESPONSE')`，`code` 永远是错的。线上实测已确认
      （401 响应体：`{statusCode:401, statusMessage:'INVALID_DEVICE_TOKEN', data:{ok:false, error:{…}}}`）。
      后果：`register()` 里 `err.code === 'CREDENTIAL_EXISTS' | 'ENROLLMENT_CLOSED'` 的
      `enrollmentBlocked` 分支在生产上从未生效过 —— 已绑定的设备每次同步都白撞一次 409。
      修法：`api.ts` 加 `unwrapErrorEnvelope()`，中间件直出（顶层 `ok`）与 createError 嵌套
      两种形态都归一到 `ApiError.code`；`docs/API.md`「响应格式」补了两种封装的说明。
      未采信的替代方案：改服务端全部 `return` 而非 `createError`（要动 11 个路由 + 一批断言
      `res.data.error.code` 的 API 测试，收益不抵风险）。
- [x] 验证：`game-web` 的 `pnpm lint` / `typecheck` / `test:unit`(483) / `test:component`(354) 全绿；
      新增 5 例 `withCredentialRetry` + 4 例信封拆包单测。`tests/unit/use-save-{list,sync}.test.ts`
      原先只 mock `ensureCredential`，调用点改走后 mock 拦不住（17 例失败），已改为同时透传
      `withCredentialRetry`，401 重试语义仍由 `device-credential.test.ts` 专测。

## 8.6 上线与线上演练（2026-10-13）

- [x] 提交：`e178e83`（信封拆包）+ `f488511`（401 自愈），已推 `origin/main`
- [x] CI run #16 三个 job 全绿（game-web / server / openspec）
- [x] 前端重发（低侵入，未动服务端产物）：本机 `build:h5` → 备份
      `/root/jintian/deploy/dist/h5.bak-20261013-401fix`（不覆盖发布前的
      `h5.bak-20261013`）→ 原地解包 → `up -d --force-recreate caddy`。
      按哈希验证：线上 `index.html` 入口由 `index-D7WNvjz8.js` 变为 `index-C5gFYm65.js`；
      懒加载 chunk `assets/useSaveSync.DpOx3kHG.js` 返回 200 且含 `INVALID_DEVICE_TOKEN`。
- [x] **线上真 401 演练通过**（Playwright headless + `ignoreHTTPSErrors` 打真实站点，
      hash 路由要写 `/#/pages/settings/index`；设置页 `onMounted` 会自动 `fetchList()`）：
      1. 首绑：`200 POST device-credential` → `200 GET /saves?limit=20`（URL 里**没有** deviceId，
         属主由请求头证明）；
      2. 把 `localStorage.game_device_token` 改成格式合法但服务端没有的值 → 整页 reload：
         `401 GET /saves` → `409 POST device-credential` → `200 GET /saves?limit=20&deviceId=b5fc…`，
         本地凭据被清空，列表走兼容通道正常渲染。
      这一次同时证伪了两个此前的空白：401 自愈分支真跑通了；409 能被识别为
      `CREDENTIAL_EXISTS`（即信封拆包在真线上生效，不是只有单测）。
      演练全程只调线上接口，没有直接写数据库。
- [ ] **演练残留待清**：三轮演练各首绑了一个一次性 deviceId，线上 `device_credentials`
      现为 3 行（`84c51b2a…` / `f58e5cfe…` / `b5fc22f9…`，演练前为 0）。这些浏览器上下文
      已不存在，留着不影响玩家，但会污染「存量设备都已注册」的统计口径。清理要写线上库
      （`DELETE FROM device_credentials WHERE device_id IN (…)`），需单独授权；
      日后做吊销入口时应改为运营侧处理。

## 9. 遗留（另议）

- [ ] 清缓存 / 换浏览器 = 丢凭据且无法找回，本方案不解（需 openid 级真实身份，见 #7 域名提案）
- [ ] 「首个声明者可为未注册 deviceId 抢绑」的窗口只能靠步骤 6 关闭，不能靠凭据本身消除
- [x] 吊销入口已做（2026-10-14，见第 11 节）：`pnpm auth:revoke <deviceId> [--dry-run]`
- [x] `[auth-compat]` 之外的鉴权指标已做（2026-10-14，见第 11 节）：`[auth-event]` + `pnpm auth-report`

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

## 11. 吊销入口 + 鉴权事件观测（2026-10-14，第 5 步收紧的另一块前置）

形态选择：运维**脚本**而非 HTTP 管理接口。理由记在这儿免得日后翻案——Caddy 把 `/api/*` 全部反代给 app，
挂一个带长期密钥的吊销接口等于在公网放一个「能封掉任意玩家凭据」的入口，漏一次密钥就是事故；
而项目本就没有任何管理接口先例（运维能力全在 `server/scripts/*.ts`）。
指标同样**不常驻**：沿用 `[llm-usage]` 的单行 JSON + 离线聚合，不引 Prometheus/statsd，也不动 `/api/health`
（那里只有 `status/db/uptimeSec/probeMs` 四个字段且有测试白名单，塞计数器会把语义搞混）。

改动清单：

- [x] `server/utils/auth-event.ts`（新）：`logAuthEvent(kind, deviceIdHint)` + 8 种 kind + `maskDeviceId`
- [x] `server/utils/device-auth.ts`：`resolveOwnerDeviceId` 四条分支与 `registerDeviceCredential` 三条分支全部留痕；
      `[auth-compat]` 原样保留（上线手册按它 grep，不能换）
- [x] `server/scripts/lib/revoke.ts` + `server/scripts/revoke-credential.ts`（`pnpm auth:revoke`）：
      条件更新（`WHERE device_id=? AND revoked_at IS NULL`）不先查后改；`--dry-run`；幂等；
      缺 `DATABASE_URL` 直接退 1（**不做兜底连接串**，免得拿默认串连到别的库去写）
- [x] `server/scripts/lib/auth-report.ts` + `server/scripts/auth-report.ts`（`pnpm auth-report`）：
      占比口径只算成功裁决；`--fail-if-compat` 三态里 `pending` 与 `no_data` 都退 2（**没样本≠已归零**）；
      一行都没解析到时退 1（不把「抓日志失败」读成「零流量」）
- [x] 文档：`docs/API.md` 新增「鉴权事件日志与运维」（kind 表、聚合命令、退出码、吊销语义警告），
      并把前端 401 自愈与 `createError` 信封拆包补进 device-credential 小节；
      `docs/db-schema.md` 的 `revoked_at` 行补了唯一写入路径与兼容期限制（**表结构未变，不需 `db:push`**）
- [x] 单测：`tests/unit/auth-report.test.ts`(11) + `tests/unit/revoke-credential.test.ts`(8) +
      `tests/unit/device-auth.test.ts` 增 7 例（每条分支的事件、掩码、权威值优先于声明值、ts 可排区间）
- [x] 门禁：server 的 `lint` / `typecheck` / `test:unit`(23 文件 245 例) / `test:api`(12 文件 142 例) 全绿

**未做的**：~~这批改动只在仓库里，没有部署到线上~~ → **2026-10-14 已随备份可观测那批一起上线**，
真日志验证见第 12 节。留一句给后来人：拿 `--fail-if-compat` 的退出码当闸门之前，
先确认窗口里确有成功裁决样本——没有事件行时脚本退 1，而 1 在 cron 里容易被当成「脚本坏了」。

### 11.1 真库 dry-run（2026-10-14，只读，未写线上）

宿主机 `/root/jintian` 只有 `deploy/`（没仓库、没 node_modules），所以脚本没法在服务器上直接跑；
按 compose 里「回环映射只服务 ssh -L 隧道」的原设计，把线上 5544 隧道到本机 15545 后在本地执行。
跑完立刻杀掉隧道进程，复查 `15545` 监听数 0、无 `ssh.exe` 残留。

| 断言 | 结果 |
|---|---|
| 不存在的 deviceId → 退 1 且只打掩码 | ✅ `未找到设备 00000000***`，`exitA=1` |
| active 设备 `--dry-run` → 退 0、不写库 | ✅ `设备 f58e5cfe*** 凭据 31f40eb9*** 注册于 2026-10-13T10:21:35.395Z 当前=有效` + `--dry-run：本次将写入吊销，未写库`，`exitB=0` |
| 非 UUID → 退 1，**不连库** | ✅ 直接打 usage，`exitC=1` |
| drizzle 的 `timestamptz` 真返回 `Date`（单测里全是 mock） | ✅ `createdAt.toISOString()` / `revokedAt` 判空都按预期工作 |
| 库里那 3 行演练凭据仍是 active | ✅ `84c51b2a…` / `f58e5cfe…` / `b5fc22f9…`（清理=DELETE 才算消失，吊销只留 tombstone，仍待授权） |

聚合侧同样在本地把 5 类退出码跑了一遍真命令：全凭据→0；占比 50%→2；无成功裁决样本→2；空 stdin→1；
一条 `[auth-event]` 都没有→1。

**语义上要盯的一条**：吊销在兼容期只是「降级到 deviceId 自声明」，不是封禁。脚本输出与三份文档都写明了，
但真有人按下去时会不会读到，取决于他是否看 stdout —— 若日后做面板，这个提醒要做成二次确认而不是脚本文案。

## 12. 后端上线与真日志验证（2026-10-14 10:13）

这批 `.output` 同时带了 `[auth-event]` 埋点与备份新鲜度两件事。发布方式与 10-13 一致：
本机 `pnpm build` → 备份 `/root/jintian/deploy/dist/.output.bak-20261014` → 原地解包（不 `rm -rf`）→
`up -d --force-recreate app`（挂载变了，必须重建才吃得到）。caddy 未被重建（`Up 16 hours`），
静态站没有中断。宿主机上的 `backup-db.sh` 与 `docker-compose.deploy.yml` 也各自留了 `.bak-20261014` 副本。

| 验证 | 结果 |
|---|---|
| 产物里含新字段 | `health.get.mjs` 内 `backupAgeHours` 出现 1 次 |
| 容器内挂载与开关 | `/data/backups/` 可读；`NUXT_BACKUP_STATUS_FILE=/data/backups/health-status.json`、`MAX_AGE_HOURS=30` |
| 上线瞬间的诚实状态 | `{"ok":true,…,"backup":"missing","backupDetail":"状态文件不存在或不可读，备份任务未按新脚本跑过"}` —— **200 且容器仍 healthy**，证明"备份坏了不牵连站点"这条设计在线上成立 |
| 真跑一次备份脚本 | 产出 294172 字节 dump，状态文件 `lastSuccessAt":"2026-10-14T02:13:52Z"`（UTC `Z` 形式，判定侧只收这种） |
| 之后 health | `{"backup":"fresh","backupAgeHours":0}` |
| `[auth-event]` 真日志 | `[auth-event] {"ts":"2026-10-14T02:14:13.496Z","kind":"invalid_token","device":""}` 等两条，格式与解析器一致 |
| 聚合脚本吃真日志 | `pnpm tsx server/scripts/auth-report.ts` 正常出报告；带 `--timestamps` 的形态也能解析（时间戳前缀不影响） |
| 闸门语义 | 窗口内只有 401/400、没有成功裁决 → `--fail-if-compat` 退 **2** 并明说"无法判断（不当作已归零）" |

代价与残留（都要记账）：

- [auth-compat] 的历史读数随旧容器日志一起没了，见第 8 节步骤 4 的告警式说明。
- 本轮为造事件发了两次**不写库**的请求（坏凭据 401、缺标识 400），没有新增凭据行；
  线上 `device_credentials` 仍是第 8.6 节那 3 行演练残留。
