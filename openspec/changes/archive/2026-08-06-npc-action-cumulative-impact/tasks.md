# 任务拆分 — NPC 行动累计影响反馈

> 状态：待实现。本提案落实 `docs/game-design.md:571` 的"NPC 行动 effects 累计影响玩家属性"设计规则，补 `improve-ux-playability` T2.8 的"累计总览"缺口。

## T1 文案常量（copywriting.ts）

- 在 `game-web/src/utils/copywriting.ts` 新增（键名对齐现有风格）：
  - `NPC_CUMULATIVE_IMPACT_TITLE = '本回合累计影响'`
  - `NPC_CUMULATIVE_IMPACT_EMPTY = '本回合各方按兵不动，暂无累计影响'`
- 禁止在组件中硬编码上述文案（遵守 `game-design.md:522-526`）
- **验证**：`pnpm lint` 无报错；常量可被组件 import

## T2 聚合逻辑（NpcActionList.vue）

- 新增 `computed cumulative`：遍历 `props.actions`，按维度累加 `action.effects` 数值，得到 `Partial<Attributes & Resources>`（空 effects 跳过，对应 D2 决策）
- 新增 `computed sortedCumulative`：对 `cumulative` entries 按绝对值降序重建为有序对象（0 值过滤交给 `formatEffects`，对应 design D3 复用路径）
- 展示复用：模板中对 `sortedCumulative` 直接调用既有 `formatEffects(sortedCumulative)`，取 `{key, text, cls}[]` 渲染 chips——**不新增着色函数**，杜绝复制标签/着色逻辑（对应 design D3）
- **验证**：新增单元测试覆盖 `aggregate`（多行动相加 / 0 值过滤 / 决策失败项不计入）、`sortedCumulative` 绝对值降序

## T3 汇总卡片 UI（NpcActionList.vue 模板 + 样式）

- 在 `npc-action-list__header` 下方、列表项上方，新增汇总区，**显示前提为 `props.actions.length > 0`**（对应 design D6，避免与既有整面板空态 `EMPTY_TEXT.npcActions` 重复 / 与决策失败卡片语义冲突）：
  - 标题：`NPC_CUMULATIVE_IMPACT_TITLE`（来自 copywriting）
  - 遍历 `formatEffects(sortedCumulative)` 渲染维度 chips（复用既有 `--positive`/`--negative` 类，负红 / 正绿，格式 `军事 -3`）
  - 卡内空态：`sortedCumulative` 全 0 或 `formatEffects` 返回空数组时显示 `NPC_CUMULATIVE_IMPACT_EMPTY`（对应 D5）
- 样式：浅色背景块、圆角、内联 chips，视觉层级低于"天下动静"主标题（见 design 视觉规格）
- **验证**：`pnpm lint`；Playwright 进入含多 NPC 行动的回合，截图确认顶部汇总卡片展示累计值、着色正确、与逐条明细（T2.8）数值一致；另测 `actions` 为空但 `failedFactionIds` 非空场景，确认**不出现**累计卡（仅有失败卡片）

## T4 数据可行性验证

- 验证后端 `/api/game/npc-actions` 正常回合返回的 `NpcAction.effects` 含有效数值（后端 AI 对"休养"等无直接影响行动可能返回 `effects: {}`，见 `server/tests/api/npc-actions.test.ts:143`，属正常，聚合逻辑天然兼容）
- **澄清易误读点**：`useTurn.ts:323` 的 `effects: {}` 是 **`historyEvent`（玩家决策历史记录）** 故意留空，**非 NPC 行动 effects**——NPC 行动 effects 来自 `res.actions`，存入 store 原样传给组件，从未清空。验证时勿在 `useTurn.ts:323` 处寻找空 effects 根因
- 若发现正常回合汇总卡恒为空（后端 AI 几乎不产出 effects），记录到提案残余不确定性并反馈（不擅自改后端）
- **验证**：Playwright 实测至少 1 个含有效 effects 的回合，汇总卡片非空且数值正确

## T5 文档回标 + spec 同步 + 全量验证

- 在 `docs/game-design.md:571` 对应条目标注"已落地（见 2026-08-06-npc-action-cumulative-impact）"，保持文档与代码一致
- 同步更新 `openspec/specs/turn-engine/spec.md`「NPC 行动展示」Scenario，补充"顶部展示本回合累计影响汇总"语义（NpcActionList 渲染内容已变，spec 须同步）
- 前端：`cd game-web && pnpm lint` + `pnpm typecheck`（新增 computed 涉及 TS 类型）
- `pnpm test:unit`（T2 新增聚合单测，核心逻辑变更须补测）
- **验证**：lint / typecheck / 单测退出码均为 0；Playwright 多视口（320/375/1280px）汇总卡片无溢出/错位
