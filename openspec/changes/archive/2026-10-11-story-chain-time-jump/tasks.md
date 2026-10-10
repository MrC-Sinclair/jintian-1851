# 任务：剧情链时光跳跃

> 交付于 2026-10-11。验证命令与结果如实记录，未执行的项标注为未做而非打勾。

## 1. 服务端：触发判定与跳跃下发

- [x] `server/server/api/game/generate-event.ts`：`matchTimeWindow` → `matchNextChain`（`startYear >= 当前年`，按 `startYear` 升序 + `chainId` 字典序取第一条）
- [x] `buildChainEvent` 增 `currentYear` 参数；仅 `source === 'time-window'` 且 `chain.startYear > currentYear` 时下发 `eventDate: { year: startYear, month: 1 }` 并改写描述为 `【cur—anchor 年间】+ chain.description + node.event.description`
- [x] `eventSchema` 增可选 `eventDate`（zod 校验 year 整数 / month 1-12）
- [x] 文件头三层触发优先级注释同步（原「时间窗口匹配」表述已不准确）
- 验证：`cd server && pnpm lint && pnpm typecheck && pnpm test:api` ✅（API 119 passed）

## 2. 服务端：API 测试

- [x] `server/tests/api/generate-event.test.ts` 新增/改写 3 用例：
      前置未满足改取后一条并跳跃、锚点晚于当前年下发 `eventDate` 且带过场文案、`pending-chain` 路径不下发 `eventDate`
- [x] 测试基准年 `makeStateSnapshot` 默认值 1850 → 1912，并在注释写明原因：
      旧语义下 1850 表示「不命中任何链」，新语义下 1850~1911 任何年份都有未来锚点可跳，
      只有晚于最后一条链（1911）的年份才落到 LLM 分支
- 验证：`cd server && pnpm exec vitest run tests/api/generate-event.test.ts` ✅（24 passed）

## 3. 前端：应用日历跳跃

- [x] `game-web/src/composables/useTurn.ts`：`GenerateEventResponse.event` 增 `eventDate`；`startTurn` 在 `setEvent` 后比较并 `updateState({ date })`，仅当新日期**晚于**当前日期才改（不回拨）
- [x] `game-web/src/types/game.ts` 与 `server/types/game.ts` 的 `GameEvent` 同步增 `eventDate?`
- [x] `game-web/tests/unit/use-turn.test.ts` 新增 3 用例：应用跳跃、`eventDate` 早于当前日历时不回拨、普通事件日历不变
- 验证：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:component` ✅（419 / 354 passed）

## 4. 文档同步

- [x] `docs/API.md`：`generate-event` 章节新增「流式模式（?stream=1）」与「时光跳跃」两节，含帧协议、`eventDate` 字段表、触发优先级改写
- [x] `docs/game-design.md`：回合机制一节写明跳跃规则与"为什么必须跳"的实测数据

## 5. 线上验证（部署于 CVM `jintian` 项目）

- [x] 直连已部署后端做三场景探测：1851-12（太平链已完成）→ 捻军 + `eventDate 1853-01` + 描述含 `【1851—1853 年间】`；1853-06 → 亚罗号事件 + `1856-01`；1861-03（锚点即当年）→ **无** `eventDate`、无过场前缀
- [x] 流式与跳跃共存验证：`?stream=1` 下剧情链路径正常推 `{event}` + `[DONE]`
- [x] e2e 全量 37/37 通过，其中 `story-chain-flow.spec.ts` 第 4 条跑完 5 节点链并经 `endTurn` 结算（覆盖本次改动的前后端链路）
- [ ] 未做：长局实测（把一局真的玩到 1900 年以后确认 12 条链逐条可达）——模拟底盘不建模剧情链，无法替代

## 6. 遗留（本提案未覆盖，另议）

- [ ] 1872-1882、1884-1893 等区间无任何历史锚点，跳跃会直接跨过这些年份
- [ ] 剧情链全线性，无 DAG 分支（`expand-event-engine` 设计文档 NG1 明示留待后续）
- [ ] 结局仍完全由属性/时间决定，与剧情链完成度无关（走完「太平天国兴亡」五节点不影响结局）
