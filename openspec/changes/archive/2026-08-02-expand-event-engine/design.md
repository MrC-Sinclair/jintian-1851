# 设计文档 — 扩充事件引擎（expand-event-engine）

> 关联：[proposal.md](./proposal.md)
> 设计原则遵循 [AGENTS.md](../../AGENTS.md)「Agent 架构设计规范」「UI/UX 设计规范」「SSR 水合规则」

## Goals

- **G1 剧情代入感**：玩家能感知"我在改写近代史"，每局至少触发 3-5 条历史剧情链，节点之间有明确因果
- **G2 时间轴推进感**：游戏内时间推进到 1851/1856/1861/1894/1898/1911 等关键年份时，对应历史剧情**必然触发**（而非 LLM 随机决定）
- **G3 选择后果链**：玩家选项可携带 `nextChainNodeId`，下回合必定触发指定后续节点，实现"决策→后果"闭环
- **G4 重玩差异化**：14 条剧情链覆盖 1851-1912 全期，不同身份/势力玩家因不同时间窗口与前置条件，触发顺序与体验差异显著
- **G5 零 LLM 成本增量**：剧情链节点是预定义数据，触发与返回不调用 LLM；LLM 自主生成路径调用次数与 MVP 一致
- **G6 向后兼容**：v1 存档加载时自动迁移到 v2，老玩家无感知继续游戏
- **G7 三端一致**：H5/小程序/App 三端 UI 渲染与交互一致，剧情角标/进度提示/历史标记全部覆盖

## Non-Goals

- **NG1 DAG 多分支**：MVP 阶段 `nextNodeIds` 仍为单元素数组（线性链），DAG 多分支留待后续提案。理由：14 条链 × 平均 3 节点 = 42 节点，DAG 分支会让节点组合爆炸，难以保证历史走向合理性
- **NG2 LLM 参与剧情链触发判断**：触发与否由代码 + 时间窗口 + 前置条件预编排（Workflow），不让 LLM 自主决定。理由：历史剧情必须按时间轴触发，让 LLM 决策会偏离历史；符合 AGENTS.md「安全/合规护栏允许 Workflow」例外
- **NG3 剧情链节点 LLM 生成**：节点数据全部预定义在 `story-chains.ts`，不让 LLM 生成节点内容。理由：保证历史准确性 + 零 token 成本
- **NG4 剧情链入数据库**：剧情链是静态数据，不入 `game_saves` 表，不入新表。理由：避免数据库 schema 变更与迁移成本
- **NG5 玩家自定义剧情链**：不开放玩家创建/编辑剧情链的能力
- **NG6 跨存档剧情链进度共享**：每个存档独立维护 `pendingChainNodes`/`completedChainIds`，不跨存档同步
- **NG7 剧情链跳过/快进**：玩家不能跳过历史剧情，必须按节点依次体验
- **NG8 剧情链难度调节**：剧情链 effects 不随玩家身份/势力动态调整，所有玩家面对同一历史节点的 effects 一致（选项 effects 已在数据中预定义）

## Decisions

### D1：触发优先级 = 挂起节点 > 时间窗口 > LLM 自主生成

**选择**：三层优先级判断，挂起节点（`pendingChainNodes` 非空）最高，时间窗口匹配（当前年份命中某剧情链 `startYear`）次之，LLM 自主生成兜底。

**理由**：
- **挂起节点最高**：玩家上回合选了带 `nextChainNodeId` 的选项，相当于"承诺"下回合触发该节点，必须兑现，否则破坏决策→后果闭环
- **时间窗口次之**：游戏内时间推进到 1851-1 必须触发金田起义，这是历史剧本的核心体验，不能被 LLM 自主生成覆盖
- **LLM 自主生成兜底**：剧情链节点之间或无剧情链触发的回合，LLM 仍自主生成事件，保留 MVP 的灵活性

**苏格拉底质询**：
- 质疑：如果玩家在 1851-1 同时有挂起节点（上回合选项指定）和金田起义时间窗口，哪个优先？
- 回应：挂起节点优先。理由：玩家选择是显式契约，时间窗口是隐式触发，显式 > 隐式。但若挂起节点本身属于某剧情链（如"天京事变"挂起中），则不重复触发新链
- 质疑：如果玩家在 1864 同时命中"太平天国兴亡尾节点"和"捻军之乱首节点"，如何处理？
- 回应：先检查挂起节点（如果太平天国链未完成且有挂起节点，优先完成太平天国），否则触发时间窗口匹配。同一年份多个新链可触发时，按 `startYear` 升序 + `chainId` 字典序选择第一个

### D2：分支字段 `nextNodeIds: string[]` 数组而非单值

**选择**：`nextNodeIds` 设计为数组，MVP 阶段始终为单元素数组（线性链），DAG 多分支留待后续提案。

**理由**：
- 类型签名 `string[]` 比 `string` 更通用，未来扩展 DAG 不需要破坏性变更存档结构
- MVP 阶段在 `useGameState` 中取 `nextNodeIds[0]` 即可，逻辑简单
- 避免引入"分支选择策略"（如根据玩家属性选不同分支）的复杂度

### D3：剧情链数据存为静态 TS 文件，不入库

**选择**：`server/server/runtime/story-chains.ts` 导出 `STORY_CHAINS: readonly StoryChain[]` 常量，类似 [fallback-events.ts](../../server/server/runtime/fallback-events.ts) 模式。

**理由**：
- 剧情链是静态设计数据，不需要运行时增删改
- TS 文件支持类型检查，编辑时 IDE 自动补全 + lint 校验
- 避免数据库 schema 变更与迁移成本（与 NG4 一致）
- 与现有 `fallback-events.ts`/`fallback-factions.ts` 模式一致，降低团队认知负担

### D4：存档迁移 v1 → v2 自动执行，无需用户操作

**选择**：`useGameState.loadSave()` 加载存档时检查 `saveVersion`，若为 1 则补齐新字段并升级到 2，写回本地存储 + 下次同步上传云端。

**迁移逻辑**：
```ts
function migrateSaveV1ToV2(save: GameSaveV1): GameSaveV2 {
  return {
    ...save,
    saveVersion: 2,
    pendingChainNodes: [],
    completedChainIds: [],
    activeChainIds: [],
    events: save.events.map(e => ({ ...e, chainId: undefined, chainNodeId: undefined }))
  }
}
```

**理由**：
- 玩家无感知继续游戏，避免"必须重开新存档"的体验断裂
- v1 存档的 `events` 数组保持不变，新增 `chainId` 字段为 undefined（向后兼容）
- 云端存档同步时，v2 存档会覆盖 v1（`updated_at` 服务端权威方案已存在，无需变更）

### D5：兜底池扩充不注入 prompt 作为参考样例

**选择**：兜底事件池从 20 条扩充到 60 条，但仍仅作为 LLM 失败降级使用，不注入 prompt。

**理由**：
- 注入 60 条样例到 prompt 会增加约 6-8K tokens/请求，单回合成本上涨 50%+
- 现有 prompt 工程已通过 `recentEvents`（最近 5 条事件标题）保证生成多样性
- 兜底池的扩充目的是降低降级时的重复感，不是引导 LLM 生成

### D6：缓存键扩展含新字段

**选择**：缓存键计算从 `sha256(saveId + turn + sha256(stateSnapshot))` 扩展为 `sha256(saveId + turn + sha256(stateSnapshot) + sha256(pendingChainNodes + completedChainIds + activeChainIds))`。

**理由**：
- 同一存档同一回合，若 `pendingChainNodes` 不同（如玩家选了不同选项触发不同后续节点），缓存应区分
- 不扩展会导致玩家选 A 选项后下回合命中缓存返回 B 选项触发的节点，破坏分支逻辑
- `stateSnapshot` 本身不含剧情链状态，必须单独扩展

### D7：触发优先级用代码预编排（Workflow），不让 LLM 决策

**选择**：三层触发优先级由代码 if/else 判断，不让 LLM 决定"是否触发剧情链"。

**理由**：
- 符合 AGENTS.md「Agent 架构设计规范」中"安全/合规护栏允许 Workflow"的例外条款——历史剧情必须按时间轴触发，是确定性约束，不应由 LLM 自主决策
- 决策点：「何时触发剧情链」= 确定性触发（时间窗口）+ 玩家显式契约（挂起节点）→ Workflow
- LLM 仍参与：「生成事件选项的 effects」「自由输入决策判定」「军师对话」等需要语义理解的环节 → Agent

## 多端适配方案

### 手机端（默认，<640px）

- **剧情进度角标**：`EventCard` 顶部右上角，背景 `#8B1A1A`（与项目主色一致），白字"剧情 2/5"，字号 `24rpx`，圆角 `8rpx`，padding `8rpx 16rpx`
- **剧情名标题**：`EventCard` 顶部左侧，"太平天国兴亡"，字号 `28rpx`，颜色 `#5C4030`（棕色，区别于普通事件标题黑色）
- **剧情待续提示**：`FocusPanel` 顶部，浅黄色背景 `#FFF8E1`，左侧书卷图标 + "剧情待续：太平天国兴亡 第 3/5 节下回合触发"
- **历史标记图标**：`TurnTimeline` 事件条目左侧，含 `chainId` 的事件显示书卷图标（24×24px），无 `chainId` 显示圆点

### 平板端（sm: ≥640px）

- 同手机端，但剧情进度角标可显示完整"太平天国兴亡 · 2/5"（增加剧情名）
- 剧情待续提示可显示更详细文案"下回合将触发：天京事变 — 描述..."

## 触摸目标尺寸

- **剧情进度角标**：本身不交互，但作为视觉元素，最小尺寸 `48rpx × 36rpx`（约 24×18px），保证清晰可读
- **剧情待续提示条**：整条可点击展开详情，最小高度 `88rpx`（约 44px），符合 AGENTS.md「输入区按钮 ≥ 44px」规范
- **历史标记图标**：非交互元素，仅展示，尺寸 `48rpx × 48rpx`（约 24×24px），不参与触摸目标判定

## API 参数校验与错误处理策略

### `POST /api/game/generate-event` 新增 body 参数

```ts
const bodySchema = z.object({
  saveId: z.string().uuid(),
  turn: z.number().int().positive(),
  stateSnapshot: z.object({ /* 既有结构 */ }),
  character: z.object({ /* 既有结构 */ }),
  factions: z.array(/* 既有结构 */),
  recentEvents: z.array(z.any()).default([]),
  // 新增字段（v2 存档必传，v1 存档迁移后也会有）
  pendingChainNodes: z.array(z.object({
    chainId: z.string().min(1),
    nodeId: z.string().min(1),
    scheduledTurn: z.number().int().positive()
  })).default([]),
  completedChainIds: z.array(z.string()).default([]),
  activeChainIds: z.array(z.string()).default([])
})
```

**校验策略**：
- 三个新字段都用 `.default([])`，兼容老客户端不传时按空数组处理（向后兼容）
- `pendingChainNodes` 元素结构严格校验，缺字段返回 400 + `INVALID_PARAMS`
- `chainId`/`nodeId` 必须是非空字符串，防止 LLM 注入恶意 ID

### 错误处理

| 场景 | HTTP | code | 处理 |
| --- | --- | --- | --- |
| body 解析失败 | 400 | INVALID_PARAMS | 既有逻辑 |
| zod 校验失败 | 400 | INVALID_PARAMS | 既有逻辑 + detail |
| 挂起节点 ID 在 story-chains.ts 中找不到 | 500 | CHAIN_NODE_NOT_FOUND | 兜底降级到 LLM 自主生成 + 日志告警 + `X-Fallback: true` |
| 时间窗口匹配的剧情链前置条件未满足 | — | （正常逻辑） | 跳过该链，进入下一优先级 |
| 同一年份多个剧情链可触发 | — | （正常逻辑） | 按 `startYear` 升序 + `chainId` 字典序选第一个 |
| 缓存命中 | 200 | X-Cache: HIT | 既有逻辑 |
| 并发锁冲突 | 429 | CONCURRENT_REQUEST | 既有逻辑 |

## 多端兼容方案（H5/小程序/App）

### 数据层（完全一致）

剧情链触发逻辑、字段处理、存档迁移都在 `useGameState` composable 与 `generate-event` API 中，三端共用同一份 TS 代码，无平台分支。

### UI 层（uni-app 跨端组件）

- `EventCard`/`TurnTimeline`/`FocusPanel` 均为 uni-app Vue3 组件，三端渲染一致
- 剧情角标用 `view` + `text` 元素，不依赖 HTML 特定标签
- 图标用内联 SVG（AGENTS.md「统一使用 SVG 图标」规范），三端通用

### 兼容性测试

- H5：Chrome/Firefox/Safari 验证剧情角标渲染 + 触摸目标
- 微信小程序：iOS + Android 真机验证 `v-tooltip` 长按提示剧情信息
- App：Android APK 验证剧情待续提示条展开/收起动画

## AI 调用策略

### 流式输出

本提案**不涉及流式输出变更**。剧情链节点是预定义数据，直接 JSON 返回；LLM 自主生成路径仍用 `generateObject()`（非流式），与 MVP 一致。

### 缓存

- 缓存键扩展含 `pendingChainNodes`/`completedChainIds`/`activeChainIds`（D6）
- 缓存 TTL 仍为 5 分钟
- 命中缓存时直接返回（含 `chainId`/`chainProgress` 等新字段）
- `X-Cache: HIT/MISS` header 不变

### 并发控制

- 既有 `acquireLock(saveId)` 串行锁不变
- 剧情链触发判断在锁内执行，避免同一存档并发请求时重复触发同一剧情链
- 挂起节点返回、时间窗口匹配、LLM 自主生成三种路径都受同一锁保护

### Token 成本

| 路径 | 调用 LLM | Token 成本 |
| --- | --- | --- |
| 挂起节点触发 | ❌ 不调用 | 0 |
| 时间窗口匹配触发 | ❌ 不调用（节点数据预定义） | 0 |
| LLM 自主生成（无剧情链触发的回合） | ✅ 调用 | 与 MVP 一致（约 3-8K tokens/回合） |
| 兜底降级 | ❌ 不调用 | 0 |

**结论**：本提案**不增加** LLM 调用次数与 token 成本，反而因剧情链节点触发减少 LLM 调用而**降低**成本（粗估每局降低 30-50% LLM 调用）。
