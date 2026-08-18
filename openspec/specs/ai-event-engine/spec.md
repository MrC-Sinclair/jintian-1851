# ai-event-engine Specification

## Purpose
`POST /api/game/generate-event` 生成结构化回合事件（标题/描述/选项/effects），支持历史剧情链三层触发优先级（挂起节点 → 时间窗口 → LLM 自主）与短板导向软偏好。失败降级到 60 条兜底事件池，保证回合不中断。
## Requirements
### Requirement: 结构化事件生成接口

`POST /api/game/generate-event` MUST 返回结构化事件，含标题、描述、选项、状态影响；本提案扩展支持历史剧情链字段。

#### Scenario: 触发优先级 — 挂起节点优先

WHEN 前端发送 `POST /api/game/generate-event` body 含 `{ saveId, turn, stateSnapshot, pendingChainNodes, completedChainIds, activeChainIds, ... }` 且 `pendingChainNodes` 非空
THEN 服务端不调用 LLM
AND 从 `pendingChainNodes[0]` 取 `{ chainId, nodeId, scheduledTurn }`
AND 在 `server/runtime/story-chains.ts` 中查找对应节点
AND 返回结构：
  ```typescript
  {
    event: {
      title: string
      description: string
      eventType: '历史剧情'  // 挂起节点必为历史剧情类型
      options: Array<{
        id: string
        label: string
        effects: { ... }
        nextChainNodeId?: string  // 新增：选择该选项后下回合触发的节点 ID
      }>
      chainId: string             // 新增：本事件所属剧情链
      chainNodeId: string         // 新增：本节点 ID
      chainProgress: {            // 新增：剧情进度
        current: number           // 当前节点序号（1-based）
        total: number             // 总节点数
      }
    }
  }
  ```
AND 响应 header `X-Event-Source: pending-chain`

#### Scenario: 触发优先级 — 时间窗口匹配

WHEN `pendingChainNodes` 为空 且 当前游戏内时间 `stateSnapshot.date` 命中某剧情链 `startYear`（如 1851 年 1 月命中"太平天国兴亡"链 `startYear=1851`）
AND 该剧情链 `chainId` 不在 `completedChainIds` 中
AND 该剧情链 `chainId` 不在 `activeChainIds` 中
AND 该剧情链 `prerequisiteChainIds`（若有）全部在 `completedChainIds` 中
THEN 服务端不调用 LLM
AND 返回该剧情链首个节点的 event（结构同上）
AND 响应 header `X-Event-Source: time-window`

#### Scenario: 触发优先级 — LLM 自主生成兜底

WHEN `pendingChainNodes` 为空 且 无剧情链时间窗口匹配
THEN 服务端按既有逻辑调用 `Qwen/Qwen3-8B` + `generateObject()` 生成事件
AND 返回结构不含 `chainId`/`chainNodeId`/`chainProgress` 字段（普通事件）
AND `options` 中不包含 `nextChainNodeId` 字段
AND 响应 header `X-Event-Source: llm`

#### Scenario: 同一年份多个剧情链可触发

WHEN 当前游戏内时间命中多个剧情链 `startYear`（如 1851 年同时命中"太平天国兴亡"和"捻军之乱"）
THEN 按 `startYear` 升序排序（同年份时按 `chainId` 字典序）
AND 取第一个满足前置条件的剧情链触发
AND 其他剧情链在后续回合或重复触发时再判断

#### Scenario: 参数校验 — 新增字段

WHEN body 含 `pendingChainNodes` 但元素结构不正确（如缺 `chainId` 或 `nodeId` 为空字符串）
THEN 返回 HTTP 400 + `{ "ok": false, "error": { "code": "INVALID_PARAMS", "message": "pendingChainNodes 结构错误", "detail": zodErrors } }`

#### Scenario: 兼容老客户端

WHEN body 不含 `pendingChainNodes`/`completedChainIds`/`activeChainIds` 字段
THEN 服务端按 `.default([])` 处理为空数组
AND 走"时间窗口匹配 > LLM 自主生成"路径
AND 不返回错误

#### Scenario: 挂起节点 ID 找不到

WHEN `pendingChainNodes[0]` 的 `{ chainId, nodeId }` 在 `story-chains.ts` 中找不到匹配节点
THEN 服务端记录 `console.error` 告警
AND 清空 `pendingChainNodes`（避免死循环）
AND 降级到 LLM 自主生成路径
AND 响应 header `X-Fallback: true`

#### Scenario: zod schema 强约束返回值（既有，扩展）

WHEN LLM 自主生成路径中 LLM 返回的 JSON 不符合 schema
THEN `generateObject()` 抛错（既有逻辑）
AND 服务端自动重试 1 次（既有逻辑）
AND 重试仍失败则从 `fallback-events.ts` 随机抽 1 个事件返回（既有逻辑，但池扩充到 60 条）
AND 响应 header `X-Fallback: true`（既有逻辑）

### Requirement: 5 分钟事件缓存

服务端 MUST 缓存 `generate-event` 结果，缓存键扩展含剧情链状态字段，5 分钟内同输入不重复调 LLM 或重新匹配剧情链。

#### Scenario: 缓存键计算（扩展）

WHEN 计算缓存键时
THEN 输入 = `saveId + turn + sha256(stateSnapshot) + sha256(pendingChainNodes + completedChainIds + activeChainIds)`
AND 输出 = `sha256(input)`
AND 同一存档同一回合，若 `pendingChainNodes` 不同（如玩家选了不同选项触发不同后续节点），缓存键不同

#### Scenario: 缓存命中（既有）

WHEN 同一缓存键在 5 分钟内再次请求
THEN 服务端直接返回缓存的 event 对象（含 `chainId`/`chainProgress` 等新字段）
AND 不调用 LLM、不重新匹配剧情链
AND 响应 header `X-Cache: HIT`

#### Scenario: 缓存未命中（既有）

WHEN 首次请求 或 TTL 过期 或 输入不同
THEN 服务端按三层触发优先级生成
AND 响应 header `X-Cache: MISS`
AND 结果写入缓存

### Requirement: 事件类型权重分布

事件类型分布 MUST 按以下规则调整：历史剧情类型由时间窗口触发，其他类型仍由 LLM 自主决定。

#### Scenario: 历史剧情类型不再依赖权重

WHEN 当前游戏内时间命中某剧情链 `startYear` 或 `pendingChainNodes` 非空
THEN 事件类型固定为 `历史剧情`（不调用 LLM 决定类型）
AND 不走既有权重分布逻辑

#### Scenario: 其他类型仍按权重

WHEN 无剧情链触发（走 LLM 自主生成路径）
THEN 提示词仍按既有权重表选 1 个事件类型（民生 30%/军事 25%/外交 20%/随机 15%/历史剧情 10%）
AND 历史剧情类型在 LLM 自主生成路径中仍可被选中（用于无时间窗口匹配但 LLM 觉得应该生成历史剧情的边界场景）

### Requirement: 自由输入决策判定接口

`POST /api/game/resolve-decision` MUST 接收玩家自由输入文本，返回 AI 判定的效果。

当前事件存在时，玩家除事件选项外，可通过"自由行动"输入自然语言决策（最多 200 字）。后端调 LLM 将文本解析为结构化 `effects`（属性/资源变更）。请求体可携带 `factions`（6 势力精简信息），LLM 可额外返回 `factionEffects`，使自然语言决策能对各势力产生「软性关系/实力微调」（`relationshipDelta` 限 ±20、`powerDelta` 限 ±30，不改 `status`）。`factionId` 必须为传入 factions 之一，后端 sanitize 丢弃无效 id（防幻觉）。降级（X-Fallback）或旧客户端未传 `factions` 时，`factionEffects` 返回空数组 `[]`，仅应用普通 `effects`，游戏照常进行。

#### Scenario: 正常判定自由输入

WHEN 前端发送 `POST /api/game/resolve-decision` body 含 `{ saveId, turn, playerDecision, stateSnapshot, event }`
THEN 服务端使用 `Qwen/Qwen3-8B` 模型调用 `generateObject()` + zod schema
AND 提示词包含：玩家身份/势力、当前局势、本回合事件、玩家自由输入内容
AND 返回结构 `{ effects: { military?, economy?, politics?, people?, diplomacy?, silver?, troops?, food?, reputation? } }`
AND 每项属性影响范围 ±5~15
AND 未携带 `factions` 时 `factionEffects` 恒为空数组（向后兼容旧客户端）

#### Scenario: 自由输入校验

WHEN `playerDecision` 长度 > 200 或为空字符串
THEN 返回 HTTP 400 + `{ "ok": false, "error": { "code": "INVALID_PARAMS", "message": "..." } }`

#### Scenario: 自由输入触发势力关系变化

WHEN 玩家输入"我想暗中资助湘军"，且请求体携带 `factions`（含 `xiang-jun` 当前 `relationship`）
THEN 后端返回 `factionEffects:[{factionId:'xiang-jun', relationshipDelta:>0}]` 与 `effects`（如 `silver:-50`）
AND 前端分别经 `applyFreeFactionEffects` 与 `applyEffects` 应用，湘军 `relationship` 上升且最终 clamp(-100,100)

#### Scenario: 仅软性微调，禁止改 status

WHEN 玩家自由输入"与湘军结盟"
THEN LLM 仅可在 `factionEffects` 返回 `relationshipDelta`（受 ±20 约束），不得返回 `status` 变更
AND 正式结盟仍须走确定性外交按钮（relationship≥50 且 setStatus='allied'）

#### Scenario: 幻觉防护（sanitize）

WHEN LLM 返回 `factionEffects` 含不在 `factions` 列表中的 `factionId`
THEN 后端 sanitize 丢弃该条，仅保留有效 `factionId` 的变更，不抛出错误

#### Scenario: 判定失败降级（factionEffects 恒空）

WHEN `generateObject()` 重试 1 次后仍失败
THEN 服务端返回默认效果 `{ military: -3, economy: -3, politics: -3, people: -3, diplomacy: -3 }`
AND `factionEffects` 返回空数组 `[]`（降级不得改动任何势力）
AND 响应 header `X-Fallback: true`
AND 前端 toast 提示「AI 判定失败，已应用默认效果」

#### Scenario: 疑问句判为犹豫（factionEffects 恒空）

WHEN 玩家以"怎么/怎样/如何/为什么/为啥/帮帮我/能不能/能否/该不该/该怎么办/请问"等疑问求助词开头，或仅表达诉求无具体行动（由 LLM 软判定兜底）
THEN 疑问求助词开头者由后端代码层确定性拦截（不调 LLM，响应含 `hesitation: true`），返回唯一犹豫签名 effects `{ people: -1, silver: -10 }` 且 `factionEffects` 恒为空数组（提问不得改变势力关系）
AND 前端检测到犹豫签名时提示玩家应去问军师
AND "我想 + 具体动作"（如"我想暗中资助湘军"）是行动决策，不判犹豫

#### Scenario: 并发锁防重复

WHEN 同一 `saveId` 已有进行中的 resolve-decision 请求
THEN 返回 HTTP 429 + `{ "ok": false, "error": { "code": "CONCURRENT_REQUEST", "message": "本回合决策正在判定中" } }`

### Requirement: 兜底事件池

服务端 MUST 维护至少 60 条预置事件作为兜底，覆盖 5 类型各 12 条。

#### Scenario: 兜底事件池内容（扩充）

WHEN 检查 `fallback-events.ts`
THEN 至少包含 60 条事件，覆盖 5 类型（民生/军事/外交/随机/历史剧情各 12 条）
AND 每条事件含 `title, description, options(2-4 个), effects`
AND effects 数值平衡（每项属性影响 ±5~15）
AND 兜底事件**不携带** `chainId` 字段（独立事件，不进入剧情链）

#### Scenario: LLM 完全失败时返回兜底事件（既有）

WHEN `generateObject()` 重试 1 次后仍失败
THEN 服务端从 `fallback-events.ts` 随机抽 1 个事件
AND 该事件类型与请求的 `eventType` 匹配（若池中无匹配则随机）
AND 返回 `{ event, effects, fallback: true }`

### Requirement: 并发锁防重复

同一 `saveId` 同时 MUST 只能有一个 generate-event 请求进行中。

#### Scenario: 同存档并发请求被拒绝

WHEN 同一 `saveId` 已有进行中的 generate-event 请求
AND 新请求到达且不命中缓存
THEN 服务端返回 HTTP 429 + `{ "ok": false, "error": { "code": "CONCURRENT_REQUEST", "message": "本回合正在处理中" } }`
AND 不调用 LLM

### Requirement: generate-event 工具结果注入

`generate-event` LLM 自主生成路径 MUST 在调用 LLM 前通过 `get-recent-events` 工具丰富上下文。

#### Scenario: 工具结果注入 prompt

WHEN 服务端构造 `generateObject` 的 prompt 时
THEN `recentEvents` 字段使用 `get-recent-events` 工具返回的 10 条事件（而非 body 中的 5 条）
AND prompt 中事件列表格式："最近 10 起事件：1. {title1} - {description1 摘要}\n2. ..."

#### Scenario: 工具结果不传 LLM 上下文

WHEN `get-recent-events` 工具返回结果
THEN 服务端仅将事件列表注入到 prompt 中
AND 不将工具调用过程暴露给 LLM（LLM 不知道有工具调用，只看到 prompt 中的事件列表）
AND 避免引入 `maxSteps` 复杂度（与 ai-advisor 的 Agent 模式不同）

#### Scenario: get-recent-events 工具复用

WHEN `generate-event` 调用 `get-recent-events` 工具
THEN 工具定义复用 `server/server/tools/get-recent-events.ts`（与 ai-advisor 共享）
AND `ToolContext` 从请求 body 构造
AND 工具调用方式为服务端主动调用（非 LLM 自主调用）
AND 工具失败时按"工具调用失败降级" Scenario 处理

### Requirement: 历史剧情链数据文件

服务端 MUST 维护 `server/server/runtime/story-chains.ts`，导出 14 条预定义历史剧情链。

#### Scenario: 剧情链数据结构

WHEN 检查 `story-chains.ts` 的 `STORY_CHAINS` 导出
THEN 至少包含 14 条剧情链，覆盖 1851-1912 关键历史节点
AND 每条剧情链结构：
  ```typescript
  {
    chainId: string              // 唯一 ID，如 'tai-ping-tian-guo'
    title: string                // 剧情链名，如"太平天国兴亡"
    description: string          // 剧情链简介
    startYear: number            // 触发起始年份（如 1851）
    endYear: number              // 触发结束年份（如 1864）
    nodes: ChainNode[]           // 节点列表，至少 2 个
    prerequisiteChainIds?: string[]  // 前置剧情链 ID（可选）
  }
  ```

#### Scenario: 节点数据结构

WHEN 检查 `ChainNode` 结构
THEN 每节点含：
  ```typescript
  {
    nodeId: string               // 节点 ID，剧情链内唯一
    triggerTurnOffset: number    // 相对剧情链首节点的回合偏移（首节点为 0）
    event: GameEvent             // 节点事件（含 title/description/options/effects）
    nextNodeIds: string[]        // 下一节点 ID 数组（MVP 阶段为单元素数组）
    isLastNode: boolean          // 是否为最后节点（用于标记剧情链完成）
  }
  ```
AND `event.options[].nextChainNodeId`（可选）—— 选择该选项后下回合触发的节点 ID，若不填则按 `nextNodeIds[0]` 默认推进

#### Scenario: 14 条剧情链清单

WHEN 检查 `STORY_CHAINS` 数组
THEN 必须包含以下 14 条剧情链（chainId → title → startYear → 节点数）：
  - `tai-ping-tian-guo` → 太平天国兴亡 → 1851 → 5 节点
  - `er-ci-ya-pian` → 第二次鸦片战争 → 1856 → 3 节点
  - `nian-jun-zhi-luan` → 捻军之乱 → 1853 → 3 节点
  - `tong-zhi-hui-luan` → 同治回乱 → 1862 → 3 节点
  - `yang-wu-yun-dong` → 洋务运动 → 1861 → 4 节点
  - `zuo-zong-tang-xin-jiang` → 左宗棠收复新疆 → 1865 → 3 节点
  - `liu-qiu-tai-wan` → 琉球台湾事件 → 1871 → 2 节点
  - `zhong-fa-zhan-zheng` → 中法战争 → 1883 → 3 节点
  - `jia-wu-zhan-zheng` → 甲午战争 → 1894 → 3 节点
  - `wu-xu-bian-fa` → 戊戌变法 → 1898 → 2 节点
  - `yi-he-tuan` → 义和团运动 → 1899 → 3 节点
  - `ri-e-zhan-zheng` → 日俄战争 → 1904 → 2 节点
  - `qing-mo-xin-zheng` → 清末新政 → 1901 → 3 节点
  - `xin-hai-ge-ming` → 辛亥革命 → 1911 → 3 节点

#### Scenario: 前置剧情链依赖

WHEN 检查 `prerequisiteChainIds` 字段
THEN 以下剧情链必须有前置依赖：
  - `jia-wu-zhan-zheng` 前置 `yang-wu-yun-dong`（甲午战败需要洋务运动先发生）
  - `yi-he-tuan` 前置 `wu-xu-bian-fa`（义和团兴起与戊戌变法失败有关）
  - `qing-mo-xin-zheng` 前置 `yi-he-tuan`（庚子后变法是辛丑条约的直接后果）
  - `xin-hai-ge-ming` 前置 `qing-mo-xin-zheng`（皇族内阁失望引发革命）

### Requirement: 剧情链分支字段处理

服务端与前端 MUST 正确处理 `options[].nextChainNodeId` 字段，实现"决策→后果"闭环。

#### Scenario: 玩家选择带 nextChainNodeId 的选项

WHEN 玩家在剧情链节点选择某选项，该选项含 `nextChainNodeId: "node-3"`
THEN 前端 `useGameState` 将 `{ chainId, nodeId: "node-3", scheduledTurn: currentTurn + 1 }` 入队 `pendingChainNodes`
AND 同时将该 `chainId` 加入 `activeChainIds`（若尚未存在）
AND 下回合 `generate-event` 请求时携带 `pendingChainNodes`，服务端优先返回该节点

#### Scenario: 玩家选择不带 nextChainNodeId 的选项

WHEN 玩家选择某选项，该选项不含 `nextChainNodeId` 字段
THEN 前端按 `currentNode.nextNodeIds[0]`（默认下一节点 ID）入队 `pendingChainNodes`
AND 若 `currentNode.isLastNode === true`，则不入队，而是将该 `chainId` 从 `activeChainIds` 移除并加入 `completedChainIds`

#### Scenario: 自由输入决策不触发分支

WHEN 玩家在剧情链节点选择自由输入（调用 `resolve-decision`）而非选项
THEN 前端按 `currentNode.nextNodeIds[0]` 默认推进
AND 不允许自由输入改变后续节点（保证历史走向可控）

#### Scenario: 剧情链完成

WHEN 玩家完成剧情链的最后节点（`isLastNode: true`）
THEN 前端将该 `chainId` 从 `activeChainIds` 移除
AND 加入 `completedChainIds`
AND 不入队 `pendingChainNodes`
AND 下回合若时间窗口匹配其他剧情链则触发新链

### Requirement: 存档结构 v2 迁移

前端 `useGameState` MUST 在加载存档时检查 `saveVersion`，自动将 v1 迁移到 v2。

#### Scenario: 加载 v1 存档自动迁移

WHEN `useGameState.loadSave()` 加载存档，`save.saveVersion === 1`
THEN 执行迁移逻辑：
  ```typescript
  const migratedSave = {
    ...save,
    saveVersion: 2,
    pendingChainNodes: [],
    completedChainIds: [],
    activeChainIds: [],
    events: save.events.map(e => ({ ...e, chainId: undefined, chainNodeId: undefined }))
  }
  ```
AND 写回本地存储（`uni.setStorageSync`）
AND 标记存档为已迁移（下次同步上传云端覆盖 v1）
AND 返回迁移后的 v2 存档

#### Scenario: 加载 v2 存档直接使用

WHEN `useGameState.loadSave()` 加载存档，`save.saveVersion === 2`
THEN 直接使用，不执行迁移
AND 验证字段完整性（缺 `pendingChainNodes`/`completedChainIds`/`activeChainIds` 时补 `[]`）

#### Scenario: 云端同步冲突处理

WHEN 云端存档为 v1，本地存档已迁移为 v2
THEN 同步时本地 v2 覆盖云端 v1（既有 `updated_at` 服务端权威方案）
AND 不需要额外的版本冲突处理

WHEN 云端存档为 v2，本地存档为 v1（如用户在另一台设备已迁移）
THEN 同步时云端 v2 覆盖本地 v1
AND 本地加载时按 v2 处理（不重复迁移）

### Requirement: 剧情链 UI 展示

前端 MUST 在 EventCard / TurnTimeline / FocusPanel 组件中展示剧情链信息。

#### Scenario: EventCard 展示剧情进度角标

WHEN `event` 含 `chainId` 与 `chainProgress` 字段
THEN `EventCard` 顶部右上角显示剧情进度角标
AND 角标内容："剧情 2/5"（手机端简化）或"太平天国兴亡 · 2/5"（平板端完整）
AND 角标背景 `#8B1A1A`，白字，字号 `24rpx`，圆角 `8rpx`
AND `EventCard` 顶部左侧显示剧情链名（如"太平天国兴亡"），字号 `28rpx`，颜色 `#5C4030`

#### Scenario: EventCard 普通事件无角标

WHEN `event` 不含 `chainId` 字段（LLM 自主生成的普通事件）
THEN `EventCard` 不显示剧情进度角标
AND 不显示剧情链名
AND 渲染与 MVP 一致

#### Scenario: TurnTimeline 历史标记

WHEN `TurnTimeline` 渲染历史事件列表
THEN 含 `chainId` 的事件条目左侧显示书卷图标（24×24px）
AND 不含 `chainId` 的事件显示圆点图标
AND 点击书卷图标显示剧情链名 tooltip

#### Scenario: FocusPanel 剧情待续提示

WHEN `useGameState.pendingChainNodes` 非空
THEN `FocusPanel` 顶部显示"剧情待续"提示条
AND 提示内容："下回合将触发：太平天国兴亡 第 3/5 节"（取 `pendingChainNodes[0]` 的 chainId 查询剧情链名 + 节点序号）
AND 提示条背景 `#FFF8E1`，左侧书卷图标，最小高度 `88rpx`
AND 点击提示条展开详情（剧情链简介 + 下一节点标题）

### Requirement: 事件短板导向生成（2026-08-07-event-weight-dynamic-adjust）

`generate-event` 接口 MUST 支持接收客户端计算的玩家属性短板信号，并在提示词中注入"补短板 +20%"的软性偏好，引导 LLM 优先生成弥补短板类型的事件。

WHEN 请求体携带 `attributeShortfall: [{ dimension, value }]`（维度值 < 30 的玩家属性）
THEN `buildGenerateEventPrompt` 在提示词中拼接「短板导向」段，要求 LLM 优先生成能弥补这些短板的事件类型（相对基线约 +20% 倾向）
AND `attributeShortfall` 不影响 `computeCacheKey`（由 `stateSnapshot` 派生，冗余，避免重复计入缓存键）

WHEN 请求体缺失 `attributeShortfall`（老客户端/无短板）
THEN 跳过「短板导向」段，提示词退化为原自由选类型行为（向后兼容）

#### Scenario: 短板信号透传

WHEN 前端 `useTurn.startTurn()` 组装请求
THEN 请求体包含 `attributeShortfall: calcAttributeShortfall(attributes)`（基于 `CRISIS_THRESHOLD=30` 复用，不另建常量）
AND `server` zod `bodySchema` 将其定义为可选字段，不阻断老客户端

