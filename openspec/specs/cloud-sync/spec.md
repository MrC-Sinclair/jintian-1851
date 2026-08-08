# cloud-sync Specification

## Purpose
通过 `POST /api/game/sync-save` 把本地 `GameSave` 全量上传 PostgreSQL（按 `saveId` 唯一约束 upsert），`updatedAt` 由服务端 `NOW()` 生成、不接受客户端值。实现跨设备/跨端存档同步与结局状态回写。
## Requirements
### Requirement: 上传存档接口

`POST /api/game/sync-save` MUST 接收完整 `GameSave` 对象（**不含 `updatedAt` 字段**），按 `saveId` 唯一约束写入或覆盖 PostgreSQL。

#### Scenario: 首次上传存档

WHEN 前端发送 `POST /api/game/sync-save` body 含完整 `GameSave`（**不**含 `updatedAt` 字段）
THEN 服务端用 zod schema（`.strict()` 模式）校验存档结构
AND 校验 `saveId` 格式为 UUID
AND 校验 `deviceId` 非空
AND `INSERT INTO game_saves (...) ON CONFLICT (save_id) DO NOTHING`
AND 返回 `{ "ok": true, "data": { "saveId": <UUID>, "updatedAt": <服务端 NOW()>, "endedAt": ..., "endedReason": ... } }`
AND `updatedAt` 是**服务端生成**的时间戳（不是客户端传入）

#### Scenario: 重复上传覆盖

WHEN 同一 `saveId` 已存在记录
THEN 服务端用 `INSERT ... ON CONFLICT (save_id) DO UPDATE SET save_data = EXCLUDED.save_data, updated_at = NOW(), ended_at = EXCLUDED.ended_at, ended_reason = EXCLUDED.ended_reason`
AND `updated_at` 强制刷新为**服务端** `NOW()`（不接受客户端值）
AND 返回 `{ "ok": true, "data": { "saveId": <UUID>, "updatedAt": <新的服务端 NOW()>, ... } }`

#### Scenario: 客户端携带 updatedAt 字段被拒绝

WHEN 前端 body 包含 `updatedAt` 字段
THEN zod `.strict()` 模式校验失败
AND 返回 HTTP 400 + `{ "ok": false, "error": { "code": "INVALID_PARAMS", "message": "updatedAt is not allowed (server-authoritative)", "detail": zodErrors } }`
AND 不写入数据库

#### Scenario: 参数校验失败

WHEN body 不符合 `GameSave` zod schema 或 `saveId` 不是 UUID
THEN 返回 HTTP 400 + `{ "ok": false, "error": { "code": "INVALID_PARAMS", "message": "...", "detail": zodErrors } }`

### Requirement: 拉取存档接口

`GET /api/game/sync-save?saveId=xxx` MUST 返回云端最新存档。

#### Scenario: 拉取存在的存档

WHEN 前端发送 `GET /api/game/sync-save?saveId=xxx`
AND 数据库中存在该 `saveId`
THEN 返回 `{ "ok": true, "data": { "save": <GameSave> } }`
AND `save` 字段为完整存档对象

#### Scenario: 拉取不存在的存档

WHEN 数据库中不存在该 `saveId`
THEN 返回 HTTP 404 + `{ "ok": false, "error": { "code": "SAVE_NOT_FOUND", "message": "云端未找到此存档" } }`

#### Scenario: 参数校验失败

WHEN `saveId` 参数缺失或非 UUID 格式
THEN 返回 HTTP 400 + `{ "ok": false, "error": { "code": "INVALID_PARAMS", "message": "saveId must be a UUID" } }`

### Requirement: 同步策略（服务端权威方案）

前端 MUST 按「时间戳比较」策略决定上传或拉取。**服务端为 `updated_at` 唯一权威生成者**。

#### Scenario: 本地新于云端上传

WHEN 玩家触发「同步」
AND 本地 `save.updatedAt` 比云端 `updatedAt` 严格大于 1 秒（`local - cloud > 1000ms`）
THEN 前端调用 `POST /api/game/sync-save` 上传（**body 不含 `updatedAt`**）
AND 成功后服务端返回新的 `updatedAt`，前端用它**覆盖**本地 `save.updatedAt`
AND toast「同步成功」

#### Scenario: 云端新于本地拉取

WHEN 玩家触发「同步」
AND 云端 `updatedAt` 比本地 `save.updatedAt` 严格大于 1 秒（`cloud - local > 1000ms`）
THEN 前端弹 `useConfirmDialog`「云端存档较新（更新时间 X），是否拉取覆盖本地？」
AND 玩家点击「确认」后调用 `GET /api/game/sync-save` 拉取
AND 用返回的 `save` 完整覆盖本地存储
AND toast「已拉取云端存档」

#### Scenario: 时间戳相等无操作

WHEN 本地与云端 `updatedAt` 差值 ≤ 1000ms（`|local - cloud| < 1000`）
THEN toast「本地与云端已是最新」
AND 不发起任何 POST/GET 请求

#### Scenario: 云端无存档首次上传

WHEN 玩家触发「同步」
AND `GET /api/game/sync-save` 返回 404
THEN 前端自动调用 `POST /api/game/sync-save` 上传本地存档
AND 用服务端返回的 `updatedAt` 写回本地
AND toast「首次同步，已上传本地存档」

### Requirement: 同步 UI 反馈

同步过程 MUST 显示加载状态，禁止重复点击。

#### Scenario: 同步中显示 loading

WHEN 玩家点击「同步」按钮
THEN 按钮变 disabled + 显示 spinner
AND 文案变「同步中...」
AND 完成后恢复 enabled + 隐藏 spinner
AND 整个过程禁止重复触发

#### Scenario: 同步失败 toast 提示

WHEN 同步过程网络错误 或 服务端返回非 2xx
THEN toast.error 显示错误信息
AND 不影响本地存档
AND 用户可重试

### Requirement: 数据库表结构

`game_saves` 表 MUST 按 design.md 定义的字段与约束创建。

#### Scenario: 表字段完整

WHEN 检查 `server/db/schema.ts` 中 `gameSaves` 定义
THEN 含字段：
  - `id: UUID PK DEFAULT random_uuid()`
  - `saveId: UUID UNIQUE NOT NULL`
  - `deviceId: TEXT NOT NULL`
  - `saveData: JSONB NOT NULL`
  - `saveVersion: INT NOT NULL DEFAULT 1`
  - `createdAt: TIMESTAMP NOT NULL DEFAULT NOW()`
  - `updatedAt: TIMESTAMP NOT NULL DEFAULT NOW()`

#### Scenario: 索引创建

WHEN 执行 `pnpm db:push`
THEN 数据库创建：
  - `save_id` 上的 UNIQUE 约束（自动建唯一索引）
  - `device_id` 上的普通索引（便于按设备查列表，MVP 暂不使用但预留）

### Requirement: 同步防重提交

同步请求 MUST 有前端守卫，防止并发触发。

#### Scenario: 同步按钮防抖

WHEN 玩家快速点击「同步」按钮 2 次
THEN 第 2 次点击被忽略
AND 不发起第 2 个请求

#### Scenario: 同步失败后守卫重置

WHEN 同步请求失败（任何错误）
THEN `isSyncing` 标志位重置为 false
AND 按钮恢复 enabled
AND 用户可重试

### Requirement: 自动同步（可选）

玩家 MAY 在设置中开启「每回合后自动同步」，开启后前端 MUST 在每回合结束后自动触发同步。

#### Scenario: 开启自动同步

WHEN 玩家在 `pages/settings/index.vue` 开启「自动同步」开关
THEN `uni.setStorage('auto_sync', true)`
AND 每回合结束后前端自动触发同步流程
AND 同步失败不阻断游戏

#### Scenario: 关闭自动同步

WHEN 玩家关闭开关
THEN `uni.setStorage('auto_sync', false)`
AND 不再自动同步
AND 玩家仍可手动触发

