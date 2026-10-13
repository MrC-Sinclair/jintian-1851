# 任务清单（写端点限流分桶）

本 change 是对已上线行为的事后补记，落地在 commit `069fd17`。

## 1. 机制

- [x] `shouldRateLimit(path): boolean` 替换为 `getRateBucket(path): RateBucket | null`
- [x] `RateBucket = 'ai' | 'save'`（本 change 引入两桶；后续 `auth` 桶由存档归属提案带来）
- [x] `LIMITS = { ai: 10, save: 30 }`，窗口 60 秒，按 `deviceId` 独立计数
- [x] 中间件按桶取限额、超限返回 429 + `RATE_LIMITED`

## 2. 归属

- [x] `sync-save` 单独归 `save` 桶（按路径判定，去掉 query 后比较）
- [x] 7 个 AI 端点与存档读写 `saves` 留在 `ai` 桶
- [x] 未匹配任何规则的写端点 MUST 显式归 `ai` 桶，不允许"默认不限"

## 3. 线上实测（该 commit 记录的结果）

- [x] sync-save 连打 32 次：30×400（参数错误）后两发 429，即第 31 次起限流
- [x] `save` 桶打满后，同设备 `GET /api/game/saves` 仍返回 400 而非 429 —— 桶互不影响
- [x] `generate-event` 在第 10 次触发 429（中途一次 `saves` 探测同属 `ai` 桶，占了 1 次配额）

## 4. 验证

- [x] server `lint` / `typecheck` / `test:unit`（rate-limit 用例覆盖分桶映射）通过
- [x] `docs/API.md` 限流章节口径一致
- [x] `openspec validate --all --strict` 通过

## 5. 遗留

- [ ] 限流是**进程内 Map**，多实例部署下各算各的（与并发锁同一限制），横向扩容前要换存储。
- [ ] 未按成本加权计费：一次 `npc-actions`（多 Agent）与一次 `advisor-chat` 在 `ai` 桶里同价。
