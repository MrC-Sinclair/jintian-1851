# 任务拆分 — 扩充事件引擎（expand-event-engine）

任务按依赖关系排序，分六阶段独立落地。每阶段完成后必须通过对应验证命令才能进入下一阶段。所有代码任务结束前必须运行 `pnpm lint` + `pnpm typecheck`，多端兼容任务必须 H5+小程序双端验证。

> 工作目录约定：前端任务在 `d:\code\codeWork\GAME\game-web\`，后端任务在 `d:\code\codeWork\GAME\server\`。下方命令默认在对应工作目录执行。
>
> 本提案**不涉及数据库 schema 变更**（save_data 仍 jsonb），无需 `pnpm db:push`。

## 阶段 1：类型与数据基础（无副作用，可独立验证）

### T1.1 后端类型定义：StoryChain / ChainNode / PendingChainNode

- 在 `server/types/game.ts` 新增类型导出（若文件不存在则创建；若已有则追加）：
  ```typescript
  /** 剧情链节点（ChainNode） */
  export interface ChainNode {
    nodeId: string
    triggerTurnOffset: number
    event: GameEvent
    nextNodeIds: string[]
    isLastNode: boolean
  }

  /** 历史剧情链 */
  export interface StoryChain {
    chainId: string
    title: string
    description: string
    startYear: number
    endYear: number
    nodes: ChainNode[]
    prerequisiteChainIds?: string[]
  }

  /** 挂起的剧情链节点（存档中的运行时状态） */
  export interface PendingChainNode {
    chainId: string
    nodeId: string
    scheduledTurn: number
  }
  ```
- 在 `server/types/game.ts` 扩展 `GameEvent` 与 `EventOption`（若已有则追加可选字段）：
  ```typescript
  export interface GameEvent {
    /* 既有字段 */
    chainId?: string
    chainNodeId?: string
    chainProgress?: { current: number; total: number }
  }
  export interface EventOption {
    /* 既有字段 */
    nextChainNodeId?: string
  }
  ```
- **验证**：`pnpm typecheck` 通过（在 `server/` 目录执行）；`pnpm lint` 通过

### T1.2 前端类型扩展：GameEvent / GameSave v2 / HistoryEvent

- 在 [game-web/src/types/game.ts](../../game-web/src/types/game.ts) 修改：
  - `GameEvent` 增加可选字段 `chainId?`、`chainNodeId?`、`chainProgress?: { current: number; total: number }`
  - `EventOption` 增加可选字段 `nextChainNodeId?: string`
  - `HistoryEvent` 增加可选字段 `chainId?: string`、`chainNodeId?: string`
  - 新增 `PendingChainNode` 接口（与后端结构一致）
  - 新增 `StoryChain`/`ChainNode` 类型 re-export（从 `server/types/game.ts` 复用，或独立定义保持前后端解耦）
  - `GameSave` 接口修改 `saveVersion: 1` → `saveVersion: 2`，新增字段 `pendingChainNodes: PendingChainNode[]`、`completedChainIds: string[]`、`activeChainIds: string[]`
- **验证**：`pnpm typecheck` 通过（在 `game-web/` 目录执行）；`pnpm lint` 通过

### T1.3 创建 server/runtime/story-chains.ts 数据文件

- 创建 `server/server/runtime/story-chains.ts`，导出 `STORY_CHAINS: readonly StoryChain[]` 常量
- 按 [specs/ai-event-engine/spec.md](./specs/ai-event-engine/spec.md) 中"14 条剧情链清单" Scenario 实现 14 条剧情链
- 每条剧情链的节点需参考真实历史时间轴，节点 effects 数值平衡（每项属性影响 ±5~15）
- 关键节点示例（太平天国兴亡 5 节点）：
  - `node-1`（金田起义）：title="金田起义"，options 含"出兵镇压/招抚观望/联络洋枪队"3 选项，effects 范围 military ±8、troops -200
  - `node-2`（定都天京）：title="定都天京"，effects 范围 diplomacy -5、people -3
  - `node-3`（天京事变）：title="天京事变"，effects 范围 military +5、reputation +8（太平军内讧利好清方）
  - `node-4`（安庆失守）：title="安庆失守"，effects 范围 military +3、reputation +5
  - `node-5`（天京陷落，isLastNode=true）：title="天京陷落"，effects 范围 military +10、reputation +15、people +5
- 前置依赖按 spec 实现（`jia-wu-zhan-zheng` 前置 `yang-wu-yun-dong` 等 4 组）
- **验证**：`pnpm typecheck` 通过；新增 `tests/unit/story-chains.test.ts` 验证 14 条链 ID 完整性 + 节点结构合法性 + 前置依赖引用的 chainId 存在；`pnpm test:unit` 通过

### T1.4 兜底事件池扩充：20 → 60 条

- 修改 [server/server/runtime/fallback-events.ts](../../server/server/runtime/fallback-events.ts)，将 `FALLBACK_EVENTS` 数组从 20 条扩充到 60 条
- 每类型从 4 条扩到 12 条（民生/军事/外交/随机/历史剧情各 12 条）
- 新增事件参考近代历史细节，effects 数值平衡 ±5~15
- 兜底事件**不携带** `chainId` 字段（独立事件）
- **验证**：`pnpm typecheck` 通过；新增/扩展 `tests/unit/fallback-events.test.ts` 验证 60 条事件结构合法 + 每类型 12 条 + 无 chainId 字段；`pnpm test:unit` 通过

## 阶段 2：后端 API 改造（依赖阶段 1）

### T2.1 generate-event.ts 接入三层触发优先级

- 修改 [server/server/api/game/generate-event.ts](../../server/server/api/game/generate-event.ts)：
  - 在锁内、缓存检查后、LLM 调用前，新增三层触发判断：
    1. **挂起节点优先**：检查 `body.pendingChainNodes`，非空则从 `STORY_CHAINS` 查找节点，找到则直接返回（设 `X-Event-Source: pending-chain`）；找不到则 `console.error` + 清空 + 降级
    2. **时间窗口匹配**：检查 `stateSnapshot.date.year` 命中 `STORY_CHAINS` 中 `startYear` 的剧情链，过滤 `completedChainIds`/`activeChainIds`/`prerequisiteChainIds`，按 `startYear` 升序 + `chainId` 字典序选第一条，返回首节点（设 `X-Event-Source: time-window`）
    3. **LLM 自主生成**：以上都不满足时按既有逻辑调 `generateObject()`（设 `X-Event-Source: llm`）
  - 返回结构按 spec 扩展含 `chainId`/`chainNodeId`/`chainProgress` 字段（仅剧情链路径返回）
- **验证**：`pnpm typecheck` 通过；`pnpm lint` 通过；新增 `tests/api/generate-event.test.ts` 覆盖三层触发场景

### T2.2 generate-event.ts 缓存键扩展

- 修改 `computeCacheKey()` 函数：输入扩展含 `pendingChainNodes`/`completedChainIds`/`activeChainIds`
  ```typescript
  function computeCacheKey(saveId, turn, stateSnapshot, pendingChainNodes, completedChainIds, activeChainIds) {
    const stateHash = sha256(JSON.stringify(stateSnapshot))
    const chainHash = sha256(JSON.stringify({ pendingChainNodes, completedChainIds, activeChainIds }))
    return sha256(`${saveId}:${turn}:${stateHash}:${chainHash}`)
  }
  ```
- 缓存命中时直接返回（含新字段）
- **验证**：扩展 `tests/api/generate-event.test.ts` 验证同 turn 不同 pendingChainNodes 时缓存键不同；`pnpm test:unit` 通过

### T2.3 generate-event.ts zod schema 扩展

- 修改 `bodySchema`，新增三个字段：
  ```typescript
  pendingChainNodes: z.array(z.object({
    chainId: z.string().min(1),
    nodeId: z.string().min(1),
    scheduledTurn: z.number().int().positive()
  })).default([]),
  completedChainIds: z.array(z.string()).default([]),
  activeChainIds: z.array(z.string()).default([])
  ```
- 修改 `eventSchema`（LLM 自主生成路径用），新增可选字段：
  ```typescript
  chainId: z.string().optional(),
  chainNodeId: z.string().optional(),
  chainProgress: z.object({ current: z.number(), total: z.number() }).optional()
  ```
- LLM 路径不强制返回新字段（仅剧情链路径返回）
- **验证**：扩展 `tests/api/generate-event.test.ts` 验证：缺新字段时按 `[]` 处理（兼容老客户端）；新字段结构错误时返回 400 + INVALID_PARAMS；`pnpm test:unit` 通过

### T2.4 错误处理与降级

- 修改 generate-event.ts，新增错误场景：
  - 挂起节点 ID 找不到时：`console.error` 告警 + 清空 pendingChainNodes + 降级到时间窗口/LLM 路径 + 设 `X-Fallback: true`
  - 时间窗口匹配的剧情链前置条件未满足时：跳过该链，进入下一优先级（正常逻辑，不报错）
- **验证**：扩展 `tests/api/generate-event.test.ts` 覆盖错误场景；`pnpm test:unit` 通过；`pnpm lint` 通过

## 阶段 3：前端状态层改造（依赖阶段 2）

### T3.1 useGameState.ts 加载存档 v1→v2 迁移

- 修改 [game-web/src/composables/useGameState.ts](../../game-web/src/composables/useGameState.ts)：
  - 新增 `migrateSaveV1ToV2(save)` 函数，按 spec 实现迁移逻辑
  - `loadSave()` 加载存档时检查 `saveVersion`，若为 1 则迁移并写回 `uni.setStorageSync`，下次同步上传云端覆盖
  - v2 存档加载时验证字段完整性（缺 `pendingChainNodes`/`completedChainIds`/`activeChainIds` 时补 `[]`）
  - `initSave()` 初始化新存档时设 `saveVersion: 2` + 三个新字段为 `[]`
- **验证**：扩展 `tests/unit/use-game-state.test.ts` 覆盖 v1→v2 迁移 + v2 字段补全；`pnpm test:unit` 通过；`pnpm typecheck` 通过

### T3.2 useGameState.ts 选项选择时入队 pendingChainNodes

- 修改 `useGameState.ts`，新增 `applyEventOption(event, option)` 函数（或扩展现有应用 effects 的逻辑）：
  - 应用 option.effects 到 state（既有逻辑）
  - 若 `option.nextChainNodeId` 存在：将 `{ chainId: event.chainId, nodeId: option.nextChainNodeId, scheduledTurn: currentTurn + 1 }` 入队 `pendingChainNodes`
  - 若 `option.nextChainNodeId` 不存在但 `event.chainNodeId` 存在：从 `STORY_CHAINS` 查找当前节点的 `nextNodeIds[0]`，若 `isLastNode` 则完成剧情链（移除 activeChainIds + 加入 completedChainIds），否则按 `nextNodeIds[0]` 入队
  - 同时将 `event.chainId` 加入 `activeChainIds`（若尚未存在）
  - 写入 `events` 历史时携带 `chainId`/`chainNodeId` 字段
- **验证**：扩展 `tests/unit/use-game-state.test.ts` 覆盖入队逻辑 + 剧情链完成逻辑；`pnpm test:unit` 通过

### T3.3 useTurn.ts 携带新字段请求 generate-event

- 修改 [game-web/src/composables/useTurn.ts](../../game-web/src/composables/useTurn.ts)：
  - `startTurn()` 调用 `POST /api/game/generate-event` 时，body 新增 `pendingChainNodes`/`completedChainIds`/`activeChainIds` 字段（从 `useGameState` 取值）
  - 收到响应后，若 `event.chainId` 存在，标记本回合为"剧情回合"，`FocusPanel` 显示剧情待续提示
- **验证**：扩展 `tests/unit/use-turn.test.ts` 验证请求 body 含新字段；`pnpm test:unit` 通过；`pnpm lint` 通过

## 阶段 4：前端 UI 改造（依赖阶段 3）

### T4.1 EventCard.vue 剧情进度角标 + 剧情链名

- 修改 [game-web/src/components/EventCard.vue](../../game-web/src/components/EventCard.vue)：
  - 接收 `event` prop 时检查 `chainId`/`chainProgress` 字段
  - 含 `chainProgress` 时顶部右上角显示角标："剧情 2/5"（手机端）/"太平天国兴亡 · 2/5"（平板端 `sm:`）
  - 角标样式：背景 `#8B1A1A`，白字，字号 `24rpx`，圆角 `8rpx`，padding `8rpx 16rpx`
  - 含 `chainId` 时顶部左侧显示剧情链名（从 `STORY_CHAINS` 查询或后端返回 `chainTitle`），字号 `28rpx`，颜色 `#5C4030`
  - 普通 event 渲染与 MVP 一致（无角标、无剧情链名）
- **验证**：扩展 `tests/component/EventCard.test.ts` 验证角标渲染 + 普通事件无角标；`pnpm test:unit` 通过；`pnpm lint` + `pnpm typecheck` 通过

### T4.2 TurnTimeline.vue 历史标记图标

- 修改 [game-web/src/components/TurnTimeline.vue](../../game-web/src/components/TurnTimeline.vue)：
  - 渲染历史事件列表时，含 `chainId` 的事件条目左侧显示书卷图标（24×24px 内联 SVG）
  - 不含 `chainId` 的事件显示圆点图标（既有逻辑）
  - 书卷图标加 `v-tooltip` 显示剧情链名（长按/hover 触发）
- **验证**：扩展 `tests/component/TurnTimeline.test.ts` 验证图标渲染；`pnpm test:unit` 通过；`pnpm lint` 通过

### T4.3 FocusPanel.vue 剧情待续提示条

- 修改 [game-web/src/components/FocusPanel.vue](../../game-web/src/components/FocusPanel.vue)：
  - 接收 `pendingChainNodes` prop，非空时顶部显示"剧情待续"提示条
  - 提示内容："下回合将触发：太平天国兴亡 第 3/5 节"（从 `STORY_CHAINS` 查询 chainId 对应的 title + 节点序号）
  - 提示条样式：背景 `#FFF8E1`，左侧书卷图标，最小高度 `88rpx`，触摸目标 ≥44px
  - 点击提示条展开详情（剧情链 description + 下一节点 event.title）
  - 折叠/展开用 `max-height` + `overflow:hidden` + `transition`（AGENTS.md 规范）
- **验证**：扩展 `tests/component/focus-panel.test.ts` 验证提示条显隐 + 展开详情；`pnpm test:unit` 通过；`pnpm lint` 通过

### T4.4 文案常量补充

- 修改 [game-web/src/utils/copywriting.ts](../../game-web/src/utils/copywriting.ts)，新增剧情链相关文案：
  - `CHAIN_LABELS`：剧情链 ID → 中文标题映射（与 `STORY_CHAINS` 一致）
  - `CHAIN_PROGRESS_LABEL`："剧情 {current}/{total}"
  - `CHAIN_PENDING_LABEL`："下回合将触发：{chainTitle} 第 {current}/{total} 节"
  - `CHAIN_EXPAND_LABEL`："点击查看详情"
- **验证**：扩展 `tests/unit/copywriting.test.ts` 验证新映射键值；`pnpm test:unit` 通过；`pnpm lint` 通过

## 阶段 5：测试与文档（依赖阶段 4）

### T5.1 单元测试：剧情链触发优先级 + v1→v2 迁移 + 分支入队

- 扩展 `tests/unit/use-game-state.test.ts`：
  - v1 存档加载自动迁移到 v2 + 字段完整性
  - 选项含 `nextChainNodeId` 时正确入队
  - 选项不含 `nextChainNodeId` 时按 `nextNodeIds[0]` 默认推进
  - 最后节点完成时正确出队 + 加入 completedChainIds
- 扩展 `tests/api/generate-event.test.ts`：
  - 三层触发优先级（挂起 > 时间窗口 > LLM）
  - 同年份多剧情链时按 `startYear` 升序 + `chainId` 字典序
  - 前置条件未满足时跳过
  - 挂起节点 ID 找不到时降级
- 扩展 `tests/unit/story-chains.test.ts`：
  - 14 条链 ID 完整性
  - 节点 `nextNodeIds` 引用合法（指向同链内存在的 nodeId）
  - 前置依赖引用的 chainId 存在
  - `isLastNode` 节点的 `nextNodeIds` 为空数组
- **验证**：`pnpm test:unit` 全部通过；`pnpm lint` + `pnpm typecheck` 通过

### T5.2 E2E 测试：完整剧情链流程

- 新增 `tests/e2e/story-chain-flow.spec.ts`：
  - 场景：玩家身份"武将" + 势力"湘军" → 进入 1851-1 → 触发金田起义剧情 → 选择"出兵镇压" → 下回合触发"定都天京"节点 → 验证 EventCard 显示剧情进度角标 → 完成 5 节点 → 验证 `completedChainIds` 含 `tai-ping-tian-guo`
- **验证**：`pnpm test:e2e` 通过（H5 端）

### T5.3 文档同步

- 更新 [docs/game-design.md](../../docs/game-design.md)：
  - 新增"历史剧情链"章节，列出 14 条剧情链 + 节点 + 触发年份 + 前置依赖
  - 更新"事件池与权重分布"章节：兜底池从 20 条扩到 60 条
  - 更新"综合实力 UI 展示规则"章节：增加剧情进度角标展示规则
- 更新 [docs/API.md](../../docs/API.md)：
  - `POST /api/game/generate-event` 新增 body 参数（`pendingChainNodes`/`completedChainIds`/`activeChainIds`）与返回字段（`chainId`/`chainNodeId`/`chainProgress`/`nextChainNodeId`）
  - 新增 `X-Event-Source` 响应 header 说明（`pending-chain`/`time-window`/`llm`）
- **验证**：人工 review 文档完整性

## 阶段 6：多端验证（依赖阶段 5）

### T6.1 H5 浏览器验证

- `pnpm dev`（在 `game-web/` 目录）启动 H5 开发服务器
- 浏览器手动验证：
  - 首页 → 开始游戏 → 选身份"武将" + 势力"湘军" → 进入 1851-1 → EventCard 显示"金田起义"剧情角标
  - 选择"出兵镇压" → 下回合 EventCard 显示"定都天京"角标 + FocusPanel 显示"剧情待续"
  - 完成 5 节点 → TurnTimeline 历史事件显示书卷图标
  - 验证 v1 存档加载自动迁移（手动构造 v1 存档测试）
- **验证**：浏览器手动验证 + 控制台无报错

### T6.2 微信小程序真机验证

- `pnpm dev:mp-weixin`（在 `game-web/` 目录）构建小程序
- 微信开发者工具 + 真机（iOS + Android）验证：
  - 同 T6.1 流程
  - 验证 `v-tooltip` 长按显示剧情链名
  - 验证剧情待续提示条展开/收起动画
- **验证**：iOS + Android 真机各 1 次完整流程

### T6.3 全量验证

- 在 `game-web/` 目录执行：`pnpm lint` + `pnpm typecheck` + `pnpm test:all`
- 在 `server/` 目录执行：`pnpm lint` + `pnpm typecheck` + `pnpm test:all`
- **验证**：全部通过，无报错；`pnpm build` 成功（H5 + 小程序双端构建）

## 完成标准

- 14 条剧情链数据完整，前置依赖正确
- 三层触发优先级（挂起 > 时间窗口 > LLM）逻辑正确
- v1→v2 存档迁移自动执行，玩家无感知
- EventCard / TurnTimeline / FocusPanel UI 变更三端一致
- 兜底事件池 60 条，5 类型各 12 条
- 单元 + API + 组件 + E2E 测试全部通过
- 文档（game-design.md / API.md）同步更新
- H5 + 小程序双端完整流程验证通过
