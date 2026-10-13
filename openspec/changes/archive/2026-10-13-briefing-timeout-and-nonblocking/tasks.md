# 任务清单（局势简报超时与非阻塞）

本 change 是对已上线行为的事后补记，落地在 commit `232dcf3`。

## 1. 超时预算

- [x] 超时由 10s 提到 20s（`BRIEFING_TIMEOUT_MS`）
- [x] 依据写入代码注释：实测线上 10s 会 100% 命中超时（连续 8 次调用 8/8 卡在 10.09s）
- [x] `docs/API.md` 同步该数值与理由

## 2. 前端非阻塞

- [x] `startTurn` 发起简报后**不 await**，事件就绪即交还玩家
- [x] 简报回来后异步落地，触发 `onBriefing(briefing)`
- [x] 请求序号 `briefingSeq`：只接受当前回合的响应，丢弃迟到的旧回合简报
- [x] 失败/超时降级为 `null`，不阻断回合开始、不抛错

## 3. 一致性

- [x] 后端降级语义不变：200 + `{ summary:'', suggestion:'' }` + `X-Fallback: true`
- [x] 简报仍走 `ai` 限流桶，不新增桶

## 4. 验证

- [x] `pnpm lint` / `pnpm typecheck` / `pnpm test:unit`（前端）通过
- [x] server `test:api`（advisor-briefing 各分支）通过
- [x] `openspec validate --all --strict` 通过

## 5. 遗留

- [ ] 简报的 `saveId` 成本归因仍有缺口（见 `service-observability-and-ci` 的未勾项），
      本 change 不动它。
- [ ] 20s 是否偏大待真实延迟分布复核：若 P95 明显低于 20s，可回落；当前依据只有 8 次线上样本。
