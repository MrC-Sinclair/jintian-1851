# 写端点限流分桶补记（sync-save 独立 save 桶）

## Why

`sync-save` 此前被 `shouldRateLimit` 显式排除，是**所有写端点里唯一没有任何频率上限的**：
每次带一个新 `saveId` 就插入一行，可被用来把 44G 系统盘写满。落地在 `069fd17`，
此前没有提案，本 change 是补记。

限制本身不难，难的是**不能并进现有的 `ai` 桶**：正常一回合客户端就要发
`generate-event` + `advisor-briefing` + `npc-actions` + `resolve-decision` + `sync-save`
共 4-5 个请求，共用 10 次/分钟会让手快的玩家两三个回合就被 429 卡住 —— 那是为了
堵一个滥用口而把正常玩法限死。

## What Changes

- `shouldRateLimit(path): boolean` → `getRateBucket(path): RateBucket | null`：
  布尔值表达不了"进哪个桶"，而中间件必须知道。
- 按 `deviceId` 分桶独立计数：`ai` 10 次/分钟（7 个 AI 端点 + 存档读写 `saves`）、
  `save` 30 次/分钟（`sync-save`）。
- 新增写端点 MUST 显式归桶，MUST NOT 落入"默认不限"。

## Impact

| 层级 | 影响 |
|---|---|
| 后端 | `utils/rate-limit.ts`（桶类型与映射）、`middleware/rate-limit.ts`（按桶计数与 429） |
| 前端 | 无（429 处理沿用既有 `RATE_LIMITED` 分支） |
| 数据库 | 无 |
| 文档 | `docs/API.md` 限流章节已列两桶口径；本 change 把它同时写进规格 |

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cloud-sync`：新增「写端点必须有频率上限且按端点分桶」，明确 sync-save 的 `save` 桶配额，
  以及桶之间互不影响。

## 被排除的方案

- **直接并入 `ai` 桶**：如上，会把正常回合流限死。
- **保持 sync-save 不限流**：它是唯一无上限的写路径，风险不对称（攻击者成本极低、
  盘被打满影响整台机器）。
- **按 IP 而非 deviceId 分桶**：H5 与小程序共享出口 IP 的情况会把多个玩家并成同一个桶，
  与本项目既有的按 `deviceId` 归属模型也不一致。
- **只限制请求体大小不限制频率**：挡不住"多次小请求插很多行"这种写满方式。
