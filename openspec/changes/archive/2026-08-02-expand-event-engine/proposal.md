# 提案：扩充事件引擎 — 历史剧情链 + 事件池扩充 + 分支连锁

> **状态：已审批（实施中，2026-08-02）**
> 创建：2026-07-27
> 关联：[add-qing-revival-mvp](../add-qing-revival-mvp/proposal.md)（已归档，本提案修改其 `ai-event-engine` 能力）

## Why

MVP + UX 已交付（709 测试全绿），但事件引擎存在 4 个可观测的留存痛点：

1. **剧情碎片化**：当前 `generate-event` 每回合 LLM 自主生成孤立事件，无跨回合剧情线。玩家反馈"玩 10 回合后觉得事件之间没关系，没有'我在改写历史'的代入感"。
2. **历史感稀薄**：[fallback-events.ts](../../server/server/runtime/fallback-events.ts) 仅 20 条兜底事件，5 类型各 4 条，覆盖 1851-1912 关键历史节点稀疏。LLM 生成虽灵活但缺乏"必须按真实历史时间轴推进"的约束。
3. **选择无后果**：[ai-event-engine spec](../add-qing-revival-mvp/specs/ai-event-engine/spec.md) 现有 `options` 仅含 `effects`（即时属性影响），无 `nextEventId`/`chainContext` 字段，玩家选择不会触发后续事件，"决策→后果"链条断裂。
4. **重玩价值低**：每局事件流近似随机，玩家二刷时无新内容，缺乏"换个身份/势力能遇到不同剧情"的差异化体验。

本提案**不引入 LLM 调用增量**（单回合仍 4 次调用上限），通过预定义历史剧情链数据 + 时间轴触发 + 分支字段，将事件引擎从"无状态随机"升级为"有状态剧情驱动"。

## What Changes

### 1. 历史剧情链系统（核心新增）

- **新增数据文件** `server/server/runtime/story-chains.ts`：定义 14 条历史剧情链，覆盖 1851-1912 关键历史事件，每条剧情链含：
  - `chainId`、`title`、`description`、`startYear`/`endYear`（触发时间窗口）
  - `nodes: ChainNode[]` —— 节点列表，每节点含 `nodeId`、`triggerTurn`（相对剧情链起始的回合偏移）、`event: GameEvent`（含标题/描述/选项/effects）、`nextNodeIds?: string[]`（分支字段，MVP 阶段为单元素数组即线性链，预留 DAG 扩展）
  - `prerequisiteChainIds?: string[]` —— 前置剧情链（如"甲午战争"需"洋务兴起"已完成）
- **预定义 14 条剧情链**（覆盖 1851-1912 关键历史节点，按时间排序）：
  - 太平天国兴亡（1851-1864，5 节点）：金田起义 → 定都天京 → 天京事变 → 安庆失守 → 天京陷落
  - 第二次鸦片战争（1856-1860，3 节点）：亚罗号事件 → 大沽口之战 → 北京条约
  - 捻军之乱（1853-1868，3 节点）：捻军起事 → 曾国藩督师 → 捻军覆灭
  - 同治回乱（1862-1873，3 节点）：陕甘回乱起 → 左宗棠平乱 → 收复西北
  - 洋务运动（1861-1895，4 节点）：总理衙门设立 → 江南制造局 → 北洋水师成军 → 甲午战败
  - 左宗棠收复新疆（1865-1878，3 节点）：阿古柏入侵 → 海防塞防之争 → 收复伊犁
  - 琉球台湾事件（1871-1874，2 节点）：牡丹社事件 → 北京专条
  - 中法战争（1883-1885，3 节点）：越南冲突 → 马尾海战 → 镇南关大捷
  - 甲午战争（1894-1895，3 节点）：朝鲜东学党 → 黄海海战 → 马关条约
  - 戊戌变法（1898，2 节点）：明定国是 → 戊戌政变
  - 义和团运动（1899-1901，3 节点）：义和团兴起 → 八国联军 → 辛丑条约
  - 日俄战争（1904-1905，2 节点）：旅顺攻防 → 朴茨茅斯和约
  - 清末新政（1901-1911，3 节点）：庚子后变法 → 立宪运动 → 皇族内阁
  - 辛亥革命（1911-1912，3 节点）：武昌起义 → 南北议和 → 清帝退位

### 2. `generate-event` 接口增强（MODIFIED）

- **触发优先级**（从高到低）：
  1. **挂起节点**：检查 `pendingChainNodes` 队列，有挂起节点直接返回该节点 event（不调 LLM）
  2. **时间窗口匹配**：当前游戏内时间命中某剧情链 `startYear` 且该链未在 `completedChainIds` 中、前置链已完成 → 触发该链首个节点
  3. **LLM 自主生成**：以上都不满足时按现有逻辑调 `generateObject()` 生成
- **新增 body 参数**：`pendingChainNodes: PendingChainNode[]`、`completedChainIds: string[]`、`activeChainIds: string[]`（当前进行中的剧情链 ID，避免重复触发）
- **新增返回字段**：
  - `event.chainId?: string` —— 本事件所属剧情链
  - `event.chainNodeId?: string` —— 本节点 ID
  - `event.chainProgress?: { current: number; total: number }` —— 剧情进度（如 2/5）
  - `event.options[].nextChainNodeId?: string` —— 选择该选项后下回合触发的节点 ID（分支字段）
- **缓存键不变**：仍为 `sha256(saveId + turn + sha256(stateSnapshot))`，但 `stateSnapshot` 扩展含 `pendingChainNodes`/`completedChainIds`/`activeChainIds` 字段

### 3. 兜底事件池扩充（MODIFIED）

- [fallback-events.ts](../../server/server/runtime/fallback-events.ts) 从 20 条扩充到 **60 条**（每类型 12 条），覆盖更多近代历史细节
- 兜底池事件**不携带** `chainId`（独立事件，不进入剧情链）
- 兜底池仍仅作为 LLM 失败降级使用，不注入 prompt 作为参考样例（避免 token 成本上涨）

### 4. 存档结构升级 v1 → v2（MODIFIED）

- [GameSave](../../game-web/src/types/game.ts) 新增字段：
  - `pendingChainNodes: PendingChainNode[]` —— 挂起的剧情链节点（玩家选择带 `nextChainNodeId` 的选项后入队）
  - `completedChainIds: string[]` —— 已完成剧情链 ID
  - `activeChainIds: string[]` —— 进行中剧情链 ID（首个节点触发后入队，最后一个节点完成出队并加入 completedChainIds）
  - `events: HistoryEvent[]` 增加可选字段 `chainId?: string`、`chainNodeId?: string`
- `saveVersion` 升级 `1 → 2`
- **迁移逻辑**（`useGameState` 加载存档时自动迁移）：v1 存档加载时补 `pendingChainNodes=[]`、`completedChainIds=[]`、`activeChainIds=[]`，`events` 数组元素按无 chainId 处理（向后兼容）

### 5. 前端 UI 变更（MODIFIED）

- [EventCard.vue](../../game-web/src/components/EventCard.vue) 新增"剧情进度"角标：当 event 含 `chainProgress` 时显示"太平天国兴亡 · 2/5"（剧情名 + 节点进度）
- [TurnTimeline.vue](../../game-web/src/components/TurnTimeline.vue) 历史事件条目增加剧情链图标标记（含 `chainId` 的事件用书卷图标区分）
- [FocusPanel.vue](../../game-web/src/components/FocusPanel.vue) 当 `pendingChainNodes` 非空时显示"剧情待续"提示

## Capabilities

### New Capabilities

无（本提案不新增独立能力，所有改动归入既有 `ai-event-engine` 能力下）

### Modified Capabilities

- `ai-event-engine`（事件引擎）：新增历史剧情链数据 + 触发优先级机制 + 分支字段；兜底事件池扩充 3 倍；存档结构 v1→v2 迁移

## Impact

| 层级 | 影响 |
| --- | --- |
| 后端数据 | 新增 `server/server/runtime/story-chains.ts`（8 条剧情链数据）；[fallback-events.ts](../../server/server/runtime/fallback-events.ts) 扩充 20→60 条 |
| 后端 API | [generate-event.ts](../../server/server/api/game/generate-event.ts) 新增 body 参数（`pendingChainNodes`/`completedChainIds`/`activeChainIds`）+ 返回字段（`chainId`/`chainNodeId`/`chainProgress`/`nextChainNodeId`）；触发优先级三层判断；缓存键计算含新字段 |
| 后端类型 | `server/types/game.ts` 新增 `StoryChain`、`ChainNode`、`PendingChainNode` 类型 |
| 前端类型 | [game-web/src/types/game.ts](../../game-web/src/types/game.ts) `GameEvent` 增加 `chainId?`/`chainNodeId?`/`chainProgress?`/`options[].nextChainNodeId?`；`GameSave` 升级 `saveVersion: 2` + 新字段；`HistoryEvent` 增加可选 `chainId?`/`chainNodeId?`；新增 `PendingChainNode` 类型 |
| 前端状态 | [useGameState.ts](../../game-web/src/composables/useGameState.ts) 加载存档时执行 v1→v2 迁移；`startTurn` 处理 `pendingChainNodes` 入队/出队；选择带 `nextChainNodeId` 的选项时入队 |
| 前端组件 | [EventCard.vue](../../game-web/src/components/EventCard.vue) 剧情进度角标；[TurnTimeline.vue](../../game-web/src/components/TurnTimeline.vue) 剧情链图标；[FocusPanel.vue](../../game-web/src/components/FocusPanel.vue) 剧情待续提示 |
| 数据库 | **无变更**（save_data 仍是 jsonb，schema 不变） |
| AI 调用 | **无增量**（剧情链节点是预定义数据不调 LLM；LLM 自主生成路径调用次数不变；token 成本与 MVP 一致） |
| 多端兼容 | 数据层变更对 H5/小程序/App 三端透明；UI 变更需三端验证剧情角标渲染 + 触摸目标 ≥36px |
| 测试 | 单元测试覆盖：剧情链触发优先级、v1→v2 迁移、分支入队逻辑、兜底池扩充后随机性；API 测试覆盖 generate-event 新参数校验与三层触发；E2E 覆盖 1851-1 触发金田起义剧情 → 选选项 → 下回合触发定都天京节点 |
| 文档 | 同步更新 [docs/game-design.md](../../docs/game-design.md)（新增"历史剧情链"章节，列出 8 条链 + 节点 + 触发年份）、[docs/API.md](../../docs/API.md)（generate-event 新参数与返回字段） |
