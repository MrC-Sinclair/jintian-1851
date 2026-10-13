# 任务清单（势力覆灭补记）

本 change 是对已上线行为的事后补记，落地在 commit `1b9a92d`。

## 1. 状态机收口

- [x] `stores/game.ts` 新增 `applyFactionSurvival()`：`power ≤ 0` 的 active 势力转 `destroyed`
- [x] 只对 active 生效，allied / destroyed 不重复处理
- [x] `composables/useTurn.ts` 在 `endTurn` 结算末尾调用（覆盖本回合所有 power 来源）
- [x] 覆灭写入时间线事件（`SYSTEM_EVENT.factionDestroyed`「势力覆灭」）

## 2. 下游一致性

- [x] 服务端 `npc-actions` 按 `status === 'active'` 过滤，覆灭势力不再行动（无需改服务端）
- [x] `DiplomacyPanel` 的覆灭角标 / 禁用外交 / 禁用谈判信三个分支由死代码变为可达
- [x] 外交与离间对 destroyed 势力不可选

## 3. 文档

- [x] `docs/game-design.md` 的 destroyed 触发方式改为「回合结算末尾收口判定」并注明与原设计的差异
- [x] `allied` 由 LLM 结盟触发的部分仍未实现，文档中已标出

## 4. 验证

- [x] `pnpm lint` / `pnpm typecheck` / `pnpm test:unit` 通过
- [x] `openspec validate --all --strict` 通过

## 5. 遗留

- [ ] 「先灭后盟」的顺序语义未定义：若某势力本回合既被结盟又被打到 power 0，当前按
      allied 处理（不判灭）。是否应当判灭属产品设计，另议。
