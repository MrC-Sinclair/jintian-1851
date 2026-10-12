# 提案：存档归属鉴权（把 deviceId 从「自声明即凭证」换成服务端签发的设备凭据）

> 状态：代码与测试已完成，`db:push` 与线上部署待执行（见 tasks.md 未勾项）。

## 为什么 / Why

**数据归属只靠客户端自己报的一个字符串。** `deviceId` 由前端
[utils/device-id.ts](file:///d:/code/codeWork/jintian-1851/game-web/src/utils/device-id.ts) 用
`crypto.randomUUID()` 生成、存 localStorage，[schema.ts:12](file:///d:/code/codeWork/jintian-1851/server/server/db/schema.ts)
的注释自己写着「MVP 占位，后续接登录系统」。三个存档端点把它当权限凭证：

| 端点 | 原属主逻辑 | 问题 |
|---|---|---|
| `GET /api/game/saves` | `WHERE device_id = 请求的 deviceId` | 连「比对」都没有，报谁的 ID 就列谁的档 |
| `GET /api/game/sync-save` | `WHERE save_id AND device_id = 请求值` | 同上，可读任意他人全量存档 |
| `DELETE /api/game/saves` | 双条件原子删除 | 同上，可删任意他人存档 |

拿到他人 `deviceId` 即可列出、读取、删除其全部存档。且 `deviceId` 在三个 GET/DELETE 端点上
以明文 query 传输，会落进浏览器历史与 Referer。

**顺带发现两个同源缺陷**（读代码时定位，非原任务列出）：

1. `POST /api/game/sync-save` 首插时把 **body 自声明的 `deviceId`** 直接写进 `game_saves.device_id`，
   所以不止能读删，还能**造出一行「归属任意他人」的存档**。
2. `saves.delete.ts` 把 `game_events` / `faction_memories` 的清理放在属主校验**之前**，
   而这两张表没有 `device_id` 列，属主只能由存档主删除的返回行数证明——
   于是知道他人 `saveId` 的人能擦掉对方的记忆行，响应还返回 404 假装拒绝了请求。

## 改什么 / What Changes

- **数据库**：新增 `device_credentials(device_id PK, secret_hash UNIQUE, revoked_at, created_at)`。
  存量 `game_saves` 一行都不用改——只是「写入 device_id」这个动作从此必须先通过凭据校验。
- **服务端**：新增 `utils/device-auth.ts`（凭据生成/哈希/属主反查）+ `POST /api/game/device-credential`；
  三个存档端点与 sync-save POST 的写入值改用**反查出的属主**；`saves.delete.ts` 调整清理顺序。
- **限流**：新增 `auth` 桶（5 次/分钟）给注册端点——它每成功一次就插一行，且首绑即锁，
  不限流等于给人扫注 deviceId 的机会。
- **前端**：`utils/device-credential.ts` 换取并持久化凭据（并发去重、被拒后停止重试）；
  `utils/api.ts` 注入 `x-device-token`；`useSaveList` / `useSaveSync` 拿到凭据后不再在 URL 里声明 deviceId。
- **文档**：`docs/API.md`（新端点、请求头约定、三个桶、错误码表）、`docs/db-schema.md`（新表 + 存量表描述纠偏）。

## 关键决策与被排除的方案

| 决策 | 理由 |
|---|---|
| 选「服务端注册换发凭据」而非「HMAC 短期 token」 | **纯 token 方案不解决越权**：签发接口的唯一入参就是 deviceId，攻击者拿到 deviceId 照样能换 token，收益只是「不进 URL」+「泄露有期限」。要真防住必须有「首绑即锁」的**状态** |
| 凭据用 bearer 头而非请求签名（`HMAC(secret, method+path+nonce)`） | 小程序端没有 Web Crypto——`device-id.ts:50-60` 为 `crypto.randomUUID` 写 Math.random 兜底就是证据。做签名要引 crypto-js，而防重放在此场景价值低（存档写本身幂等覆盖） |
| 库里存 `sha256(凭据)` 而非明文 | 凭据只在注册响应里下发一次，之后仅作等值比对；拖库拿不到可用凭据。成本一行 |
| 不建到 `game_saves` 的外键 | 吊销是「封禁访问」不是「删数据」，存档行必须能在凭据吊销后留存；2C2G 单实例下 FK 的迁移/删除顺序约束不值得 |
| 注册用 `INSERT ... ON CONFLICT DO NOTHING RETURNING` 裁决 | 不读后写：并发注册由主键约束裁决，无 Read-Modify-Write 窗口（AGENTS.md 数据安全规则） |
| 凭据无效一律 401，**不**降级到自声明 deviceId | 若降级，冒领尝试会被兼容逻辑静默吞掉，既攻不破也排查不到 |
| 排除「微信登录（openid 为属主）」 | 唯一能解决「清缓存即丢档」的路径，但 H5/App 拿不到微信身份，仍需本方案兜底；且小程序接入卡在无备案域名。定位为**叠在本方案之上的 linking 层**，非替代 |
| 排除「只改 header 不改属主来源」 | 等于没修。deviceId 仍是唯一凭证，只是换了个不透进 URL 的位置 |

**已知残余风险（接受并记录）**：兼容期为让存量玩家无损进入，必须允许「未注册的 deviceId 首次访问即完成注册」，
所以**首个声明者**仍能替他人绑走一个从未注册过的 deviceId。收窄手段是 `DEVICE_AUTH_ALLOW_FIRST_BIND=false`
关注册（迁移完成后执行），以及 `auth` 桶限流。另外 `deviceId` 在非安全上下文由 Math.random 生成、
熵不足，本方案不再依赖它的保密性，但存量设备的标识仍可能被猜测——注册关闭后此路失效。

## 影响 / Impact

| 影响面 | 改动 |
|---|---|
| 数据库 | 新增 1 表（**需 `pnpm db:push`**，本地库当前不可达，未执行）；存量数据零迁移 |
| 后端 `server` | `db/schema.ts`、`db/index.ts`、新增 `utils/device-auth.ts` + `api/game/device-credential.post.ts`、`saves.get.ts`、`saves.delete.ts`、`sync-save.ts`、`utils/rate-limit.ts`、`nuxt.config.ts` |
| 前端 `game-web` | 新增 `utils/device-credential.ts`；`utils/device-id.ts`（凭据存取）、`utils/api.ts`（注入头）、`composables/useSaveList.ts`、`composables/useSaveSync.ts` |
| API | 新增 `POST /api/game/device-credential`；三个存档端点 `deviceId` 由必填转可选；新增 401/409/403 错误码。**部署顺序：先发后端再发前端**（新后端认老客户端，老后端不认新客户端的无 deviceId 请求） |
| 配置 | 新增 `DEVICE_AUTH_ENFORCED` / `DEVICE_AUTH_ALLOW_FIRST_BIND` 两个运行时开关（`NUXT_` 前缀可覆盖），已进 `.env.example` 与 compose。**无需签名密钥**——凭据是服务端随机数，不存在密钥轮换问题 |
| 测试 | 服务端 +2 文件（device-auth 13 例 / device-credential 8 例）、3 个既有用例文件改写（saves-delete 顺序、saves / sync-save 凭据分支）；前端 +1 文件（device-credential 12 例）+3 处既有用例扩展。全绿：server api 134、server unit 192、game-web unit 440 |
| 不破坏现有存档 | ✅ 老客户端在兼容期行为完全不变；`save_data` blob 内的 `deviceId` 退化为快照，不改写 |

## 能力 / Capabilities

### Modified Capabilities
- `cloud-sync` - 新增「设备凭据注册与属主反查」要求；上传/拉取存档的属主由凭据反查值决定（delta 见 `specs/cloud-sync/spec.md`）
- `save-management` - 列表/删除的属主来源改为凭据反查；删除的记忆行清理必须晚于属主证明（delta 见 `specs/save-management/spec.md`）
