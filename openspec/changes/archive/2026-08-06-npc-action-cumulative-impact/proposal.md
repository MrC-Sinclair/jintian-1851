> **状态：已归档（代码已落地，2026-08-06；提案事后补录，现归档）**
> 触发来源：`docs/game-design.md:571`「设计原则与平衡说明 → 5. 后续平衡方向 → NPC 行动反馈：NPC 行动 effects 累计影响玩家属性，避免 NPC 行动孤立」
> 关联提案：`2026-08-02-improve-ux-playability`（T2.8 已实现单条"对你影响"明细，本提案补其"累计总览"缺口）
> 范围：仅前端展示层（`NpcActionList.vue` + `copywriting.ts`），无后端 / 数据库 / AI 调用变更

## Why

当前「天下动静」面板（`NpcActionList.vue`）已实现 T2.8：每条 NPC 行动下方展示独立的"对你影响"行（`formatEffects(action.effects)`）。但存在体验断层：

- **孤立无总览（高）**：玩家每回合面对多条 NPC 行动（如清廷 +3 军事、湘军 -2 经济、太平天国 -1 政治…），逐条阅读后才能心算本回合整体被冲击多少。新手难以快速判断"本回合 NPC 对我到底是利好还是利空、哪维最危险"。
- **设计规则未落地（高）**：`game-design.md:571` 明确将"NPC 行动 effects **累计**影响玩家属性"列为后续平衡方向，目前仅为设计标注，代码未实现"累计"语义，NPC 行动在玩家心智中仍是孤立事件。
- **与胜利/危机路径脱节（中）**：游戏核心张力是"5 维属性 > 0 且综合实力达 90"（`game-design.md:543-544`）。NPC 行动是属性变化的重要外部来源，缺少累计反馈，玩家难将该来源与自身属性走向关联。

本变更在「天下动静」面板**顶部**新增"本回合累计对你影响"汇总卡片，聚合本回合所有 NPC 行动的 `effects`，让玩家一眼看到整体冲击与最受影响维度。

## What Changes

### 1. 新增累计汇总卡片（NpcActionList.vue 顶部）

在 `npc-action-list__header` 下方、列表项上方，新增汇总区：

- 标题：`本回合累计影响`（复用 `copywriting.ts` 常量，禁止硬编码）
- 聚合逻辑：遍历 `props.actions`，将每条 `action.effects` 按维度（Attributes & Resources 键）**数值累加**，得到 `cumulative: Partial<Attributes & Resources>`。
- 展示：对每个非零维度，复用既有 `EFFECT_LABELS` 取中文标签 + `formatEffects` 的红/绿着色（负=红、正=绿），呈现如 `军事 -3  经济 +2  银两 -50`。
- 排序：按绝对值降序，最受影响维度排前，帮助玩家抓重点。
- 空态：所有 `effects` 为空或全部为 0 时，显示 `本回合各方按兵不动，暂无累计影响`（入 `copywriting.ts`）。

> 与 T2.8 的分工：**T2.8 = 逐条明细**（看"谁对我做了什么"）；**本提案 = 聚合总览**（看"本回合我总共被影响了多少"）。两者共存，不替换。

### 2. 文案集中管理（copywriting.ts）

按 `game-design.md:522-526` 集中管理原则，新增常量（示例键名，实现时对齐现有命名风格）：

- `NPC_CUMULATIVE_IMPACT_TITLE = '本回合累计影响'`
- `NPC_CUMULATIVE_IMPACT_EMPTY = '本回合各方按兵不动，暂无累计影响'`

禁止在组件内硬编码上述文案。

### 3. 复用既有标签体系（不重复造轮子）

- 中文维度标签统一从 `EFFECT_LABELS` 取（`game-design.md:520`：统一从 `EFFECT_LABELS` 取标签，禁止局部硬编码）。
- 红/绿着色与 `formatEffects` 现有实现保持一致；如需聚合版，新增 `formatCumulativeEffects(cumulative)` 复用同一着色规则，不另写一套。

## Capabilities

### Modified Capabilities

- `npc-action-feedback`（天下动静反馈）：在 T2.8 单条"对你影响"基础上，新增本回合累计总览，落实 `game-design.md:571` 的"累计影响"设计规则
- `copywriting-governance`（文案治理）：累计面板文案纳入 `copywriting.ts` 集中管理

> 说明：capability 名称系为本提案所设；当前 `openspec/specs/` 尚未沉淀对应 spec 模块（属本提案落地后可补的范围，见 Impact / 残余不确定性）。

## Impact

| 层级 | 影响 |
| --- | --- |
| 前端组件 | 修改 `game-web/src/components/NpcActionList.vue`：新增累计汇总卡片（模板 + `computed` 聚合 `cumulative` + `formatCumulativeEffects` 复用着色）+ 对应样式 |
| 前端文案 | 修改 `game-web/src/utils/copywriting.ts`：新增 2 个常量（标题 / 空态） |
| 前端类型 | 不改类型；聚合结果类型为 `Partial<Attributes & Resources>`（已有） |
| 后端 | 无变更（仅前端读取既有 `action.effects`） |
| 数据库 | 无变更 |
| AI 调用 | 无变更 |
| 多端兼容 | 纯 Vue 模板 + CSS（rpx），不影响小程序/App 构建；无浏览器独有 API |
| 测试 | 改后需 `cd game-web && pnpm lint`；建议补充单元测试验证聚合逻辑（多行动 effects 相加、0 值过滤、绝对值排序） |
| 文档 | 本提案落地后：①在 `docs/game-design.md:571` 对应条目标注"已落地（见 2026-08-06-npc-action-cumulative-impact）"；②同步更新 `openspec/specs/turn-engine/spec.md`「NPC 行动展示」Scenario，补充"顶部展示本回合累计影响汇总"语义，保持 spec 与代码一致 |

## 残余不确定性

- `[不确定]` **聚合是否包含"决策失败"的 NPC**：`NpcActionList.vue` 有"决策失败"卡片（`T3.4`），其无 `effects`。聚合应仅基于 `props.actions` 中带 `effects` 的条目（失败项本就无影响），实现时确认不把失败项计入，且 UI 上不混淆（见 tasks T3）。
- `[不确定]` **后端 NPC 行动 effects 可能为空**：后端 AI 对"休养"等无直接影响的行动可能返回 `effects: {}`（见 `server/tests/api/npc-actions.test.ts:143`）。聚合逻辑对空 effects 天然兼容（贡献 0，不进入累计）。**需澄清一处易误读点**：`useTurn.ts:323` 的 `effects: {}` 是 **`historyEvent`（玩家决策历史记录）** 故意留空（effects 已通过 `applyEffects` 应用到属性，历史记录不重复存），**并非 NPC 行动的 effects**——NPC 行动 effects 来自 API 返回的 `res.actions`，存入 store 后原样传给组件，从未被清空。tasks 中验证方向应指向后端 AI 返回结构，而非 `useTurn.ts:323`。
- `[不确定]` **小程序/App 端渲染**：纯 CSS/rpx，理论上跨端一致，建议上线前真机补验（延续 `pre-launch-checklist.md` 双端验证）。
