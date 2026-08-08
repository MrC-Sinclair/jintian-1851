# 乱世抉择：1851 MVP — 技术设计

## Goals

- **三端可发布**：uni-app Vue3 CLI 一套代码同时构建 H5（Web 浏览器）、微信小程序、App（Android/iOS），MVP 验证阶段优先保证 H5 与微信小程序可用
- **AI 全包闭环**：单回合内串行完成「军师建议（流式）→ 事件生成（结构化）→ NPC 决策（结构化）」三段 AI 调用，整体延迟 < 15 秒（含流式首 token 1-3 秒），单回合 token 成本控制在 3-8K
- **本地优先 + 云端备份**：游戏存档以 `uni.setStorage` 为主，自建后端做 AI 密钥代理与云端同步；离线可玩，在线可同步
- **可重玩性**：5 类身份 × AI 动态生成 6-8 个势力组合，重玩体验差异明显
- **遵循 my-chat 模式**：后端代码结构、模型配置、流式调用方式直接复用 my-chat 已验证方案，降低技术风险

## Non-Goals

- **不做**：多存档槽（MVP 单存档），成就系统、多结局、CG 立绘、BGM 音效、战斗动画
- **不做**：用户登录注册系统（MVP 用设备指纹占位，后续接正式登录）
- **不做**：实时多人/对战（纯单机 + AI 对手）
- **不做**：iOS App Store / Google Play 上架发布（MVP 阶段仅做 H5 与微信小程序发布，App 端打 APK 包本地测试）
- **不做**：i18n 国际化（中文唯一语言）
- **不做**：管理员后台、内容审核后台
- **不做**：付费/内购系统

## Architecture

```
d:\code\codeWork\GAME\
├── game-web/                    # uni-app Vue3 CLI 前端工程
│   ├── src/
│   │   ├── pages/
│   │   │   ├── index/index.vue                 # 首页（开始游戏/继续/同步存档）
│   │   │   ├── character-create/index.vue       # 开局身份+势力选择
│   │   │   ├── game-main/index.vue              # 回合主界面
│   │   │   └── settings/index.vue               # 设置/同步/关于
│   │   ├── components/
│   │   │   ├── FactionCard.vue                  # 势力卡片
│   │   │   ├── EventCard.vue                    # 事件卡片
│   │   │   ├── DecisionButton.vue               # 决策按钮
│   │   │   ├── StatusPanel.vue                  # 5 维属性 + 资源面板
│   │   │   ├── AdvisorDrawer.vue                # 军师对话抽屉
│   │   │   ├── TurnTimeline.vue                 # 回合时间轴
│   │   │   └── NpcActionList.vue                # NPC 行动列表
│   │   ├── composables/
│   │   │   ├── useGameState.ts                  # 全局游戏状态
│   │   │   ├── useTurn.ts                       # 回合循环逻辑
│   │   │   ├── useAdvisor.ts                    # 军师对话
│   │   │   ├── useSaveSync.ts                   # 存档同步
│   │   │   └── useSSE.ts                        # 流式响应封装（H5/小程序兼容）
│   │   ├── stores/
│   │   │   └── game.ts                          # Pinia 游戏状态
│   │   ├── utils/
│   │   │   ├── api.ts                           # $fetch 封装（uni.request 适配）
│   │   │   ├── storage.ts                       # uni.setStorage 封装
│   │   │   └── device-id.ts                    # 设备指纹生成
│   │   ├── types/
│   │   │   └── game.ts                         # 游戏状态/事件/势力等类型
│   │   ├── App.vue
│   │   ├── main.ts
│   │   ├── pages.json                          # uni-app 页面注册
│   │   └── manifest.json                       # uni-app 三端配置
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── eslint.config.js
│   └── .env.example
├── server/                      # Nuxt3/Nitro 后端工程（参考 my-chat）
│   ├── api/
│   │   └── game/
│   │       ├── init-factions.post.ts           # 开局生成势力
│   │       ├── generate-event.post.ts           # 回合事件生成（基于局势，不含玩家决策）
│   │       ├── resolve-decision.post.ts          # 自由输入决策判定
│   │       ├── npc-actions.post.ts              # NPC 势力决策
│   │       ├── advisor-chat.post.ts             # 军师对话（SSE 流式）
│   │       ├── sync-save.post.ts                # 上传存档
│   │       └── sync-save.get.ts                 # 拉取存档
│   ├── config/
│   │   └── models.ts                           # 复用 my-chat 4 模型配置
│   ├── tools/                                  # AI 工具定义（如需 tool calling）
│   ├── utils/
│   │   ├── ai-cache.ts                         # 5 分钟事件缓存
│   │   ├── concurrency-lock.ts                  # 同存档同回合串行锁
│   │   ├── faction-summary.ts                   # 势力摘要压缩
│   │   └── prompts/                            # AI 提示词
│   │       ├── init-factions.ts
│   │       ├── generate-event.ts
│   │       ├── npc-actions.ts
│   │       └── advisor-chat.ts
│   ├── db/
│   │   ├── schema.ts                           # Drizzle schema（含 game_saves 表）
│   │   └── index.ts                            # db 连接
│   ├── runtime/
│   │   └── game-prompts.ts                     # 内置系统提示词常量
│   ├── package.json
│   ├── nuxt.config.ts (或 nitro.config.ts)
│   ├── drizzle.config.ts
│   └── .env.example
├── docs/
│   ├── API.md
│   ├── db-schema.md
│   ├── ai-cost.md
│   └── game-design.md                          # 游戏数值/势力/事件设计文档
├── tests/                       # 测试（在 server 工程内运行 vitest）
├── docker-compose.yml           # PostgreSQL 5534
├── openspec/                    # 本目录
├── AGENTS.md
└── README.md
```

**数据流**：

```
开局：玩家选身份 → POST /api/game/init-factions → LLM 生成势力列表 → 玩家选定 → 本地存档初始化

每回合：
  1. 前端展示当前局势（从本地存档读取）
  2. 玩家可选「咨询军师」→ SSE /api/game/advisor-chat → 流式军师建议
  3. POST /api/game/generate-event（仅传局势快照，不传玩家决策）→ LLM 返回结构化事件 + 2-4 个选项（每个选项含预定义 effects）
  4. 玩家决策：
     a. 选择事件选项 → 前端直接应用该选项的 effects（无需额外 API）
     b. 自由输入行动 → POST /api/game/resolve-decision → LLM 判定效果
  5. POST /api/game/npc-actions → LLM 返回其他势力行动
  6. 前端合并状态演化 → 本地存档更新 → 进入下一回合

同步：
  玩家手动触发「同步」→ 比较本地与云端 updated_at → 上传或拉取
```

## Decisions

### D1: uni-app Vue3 CLI（非 uni-app x，非 HBuilderX 可视化）

- **理由**：用户需求明确要发 H5 + 微信小程序 + App。uni-app x 暂不支持微信小程序（仅 Android/iOS/鸿蒙/Web），HBuilderX 可视化强依赖 IDE、CI/CD 与类型支持弱
- **CLI 优势**：pnpm 管理、Vite 构建、TS 类型推断完整、可接入 ESLint/Prettier/Stylelint/Vitest 与 my-chat 工具链一致
- **代价**：需手动配置 `pages.json` / `manifest.json`，无 IDE 可视化编辑器，但可通过 `@uni-helper/vite-plugin-uni-pages` 等社区插件缓解

### D2: 自建 Nuxt3/Nitro 后端（非 uniCloud，非纯前端）

- **理由**：① AI 密钥必须服务端代理（前端直连会暴露 OPENAI_API_KEY）；② 复用 my-chat 的 `chat.post.ts` 流式模式与 `models.ts` 配置可直接复制改造，降低开发风险；③ PostgreSQL + Drizzle 与 my-chat 同栈，DBA 经验可复用
- **uniCloud 不选原因**：API 与 my-chat 后端代码不能直接复用，需学习 unicloud-db 与云函数 API；小程序云开发虽方便但锁定 uniCloud 生态
- **方案选择**：优先 Nuxt3（含 Nitro），与 my-chat 完全一致；若 Nuxt3 与 uni-app 前端在同一仓库产生构建冲突，则 server 工程独立用 `nitropack/cli` 启动

### D3: AI 全包四段拆分 + 串行调用

- **拆分理由**：单次 LLM 调用同时生成事件+选项+效果+NPC 决策会导致输出过长、JSON 解析失败率高、单点失败整回合崩溃
- **四段调用**：①generate-event（基于局势生成事件+选项，选项含预定义 effects）→ ②resolve-decision（仅自由输入时触发，判定效果）→ ③npc-actions（NPC 决策）→ ④advisor-chat（流式军师对话，可选）。其中①②③为串行（有逻辑依赖），④可在任意时刻独立触发
- **选项预定义 effects**：事件选项中的 effects 由 AI 在 generate-event 阶段预生成，玩家选择后前端直接应用，无需额外 API 调用。这大幅减少了 AI 调用次数（多数回合只需 2 次：event + npc）
- **降级策略**：任一段失败不阻断回合——事件失败用预置事件池兜底、NPC 失败跳过本回合 NPC 行动、军师失败显示「军师沉默」、决策判定失败用默认效果（±3 全属性）
- **延迟控制**：军师走流式（首 token 1-3 秒可见），事件与 NPC 走 `generateObject()` 非流式（5-10 秒），决策判定同上；整体 < 15 秒可接受
- **effects 应用顺序**（评审补充 2026-07-20）：单回合内严格按以下顺序应用 effects，避免 NPC 基于过期状态决策：
  1. 玩家决策（选项 或 自由输入）→ 应用事件 effects 到 `state` → 状态演化（属性数字滚动动画 300ms）
  2. 调用 `POST /api/game/npc-actions`（**传演化后的新 stateSnapshot**，让 NPC 基于玩家决策后的状态决策）
  3. 应用 NPC effects 到 `state` → 状态演化
  4. `state.turn +1`、`date.month +1` → 写入本地存档
  5. 检查结局条件（属性 ≤ 0 或 综合实力 ≥ 90 或 year > 1912）

  **注**：步骤 1 与步骤 2 之间 NPC 接口调用期间，前端 `StatusPanel` 应显示「事件 effects 已应用，NPC 正在决策...」过渡文案，避免玩家误以为卡死。

### D4: AI 模型分配（复用 my-chat 4 模型方案）

> ⚠️ **modelId 必须严格沿用 my-chat `server/config/models.ts` 的 `value` 字段（含完整 vendor 前缀）**。下表「API modelId」列即为 LLM API 请求体的 `model` 参数值。`label` 仅用于前端展示。

| 调用场景 | label | API modelId（必须完整） | 调用方式 | capabilities 关键点 |
|---|---|---|---|---|
| 军师对话（玩家可读） | Qwen3-8B | `Qwen/Qwen3-8B` | `streamText()` SSE → 自定义 `{"delta":"..."}` 协议 | `toggleableThinking: true` · `toolCalling: true` |
| 事件生成（结构化 JSON） | Qwen3-8B | `Qwen/Qwen3-8B` | `generateObject()` + zod schema | 同上，结构化输出强制 `enable_thinking: false` |
| 决策判定（结构化 JSON，自由输入） | Qwen3-8B | `Qwen/Qwen3-8B` | `generateObject()` | 同上 |
| NPC 势力决策（结构化 JSON） | Qwen3-8B | `Qwen/Qwen3-8B` | `generateObject()` | 同上 |
| 开局生成势力（结构化 JSON + 历史分析） | DeepSeek-R1-0528-Qwen3-8B | `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` | `generateObject()`（60s 超时） | `deepThinking: true` · `toggleableThinking: false`（**不传** `enable_thinking`，传了被忽略） · `toolCalling: false` |
| 视觉场景（远期预留，MVP 不启用） | Qwen3.5-4B | `Qwen/Qwen3.5-4B` | 多模态 | MVP 不启用，`caps.vision` 标 true 但路由不调用 |
| 备选（暂未分配场景） | GLM-Z1-9B-0414 | `THUDM/GLM-Z1-9B-0414` | — | `toggleableThinking: false`（**传 `enable_thinking` 会 400 报错**） · `toolCalling: false` |

**关键约束**（来自 my-chat 实测）：

1. **`getModelCapabilities()` 必须在调用 LLM 前取一次**，根据 `caps.toggleableThinking` 决定是否传 `enable_thinking`（参见 [reasoning-provider.ts](file:///d:/code/codeWork/my-chat/server/utils/reasoning-provider.ts) L196-209）：
   - `toggleableThinking === true` → 注入 `enable_thinking`（取自前端设置或默认 `true`）
   - `toggleableThinking === false`（强制思考）→ **不传** `enable_thinking`（GLM-Z1 传了会 400，R1 传了被忽略）
2. **GAME 项目军师对话强制不展示 reasoning 链**（避免破坏古风体验 + 节省 token），AI 流式响应中 `reasoning-delta` 事件必须在前端 `useSSE` 中丢弃，**不能写入 UI 也不能存档**。事件/NPC/决策三个 `generateObject` 路径**全部不传 `enable_thinking`**（强制非推理输出，保证 JSON 解析成功率）。
3. **providerOptions 必须设置 `openai.structuredOutputs: false`**（硅基流动不支持 strict 模式，参见 my-chat [chat.post.ts](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts) L530-534）。
4. **`THUDM/GLM-Z1-9B-0414` 与 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` 都没有 `toolCalling`**，本设计全 AI 流程走 `generateObject` 不依赖 tool calling，符合该约束。
5. **统一通过 `runtimeConfig` + `process.env` 注入**：`LLM_MODEL` 默认 `Qwen/Qwen3-8B`，`OPENAI_BASE_URL` 默认 `https://api.siliconflow.cn/v1`，`OPENAI_API_KEY` 必填。模型白名单由 `AVAILABLE_MODELS` + `ALLOWED_MODEL_VALUES` 双重校验，与 my-chat 一致。
6. **T1.5 验证**增加一项：在 `server/scripts/check-models.ts` 中调用 `/v1/models` 接口确认 4 个 modelId 均存在且可访问（非 404），失败则阻断后续任务。

### D5: 5 分钟事件缓存 + 同存档同回合串行锁

> ⚠️ **本节缓存键定义已被 D6 替代**——上一轮评审修复「generate-event 拆分」时统一了缓存键不依赖 playerDecision（事件生成与玩家决策解耦，详见 D6）。本节仅描述**串行锁与缓存存储**，键的定义严格按 D6。

- **串行锁**：同 `saveId + turn` 的请求排队执行，防止玩家快速点击导致同一回合多次 AI 调用浪费 token。**锁粒度为 `saveId + turn`（非仅 `saveId`）**，避免上一回合的锁阻塞下一回合的首个请求（前端已有 `isProcessingTurn` 防抖，服务端锁仅作为兜底）
- **锁实现**：进程内 `Map<saveId:turn, Promise>`，请求到达时若已有进行中 Promise 则 await 它（不重新调用）；完成后删除 key；锁超时 30 秒自动释放（防止死锁）
- **缓存存储**：进程内 `Map`（MVP 单实例够用），后续可换 Redis
- **缓存失效**：TTL 5 分钟 + 进程重启清空（不持久化）
- **缓存键定义（以 D6 为准）**：
  - `generate-event`：`sha256(saveId + turn + sha256(stateSnapshot))`，**不包含 playerDecision**（因为该接口不接收玩家决策）
  - `resolve-decision`：`sha256(saveId + turn + sha256(playerDecision) + sha256(stateSnapshot))`，**包含玩家输入**（相同输入才复用结果）

#### stateSnapshot 定义

`stateSnapshot` 是传给 AI 接口的局势快照，**仅包含以下字段**（不含 `events`、`advisorMessages`、`factions` 等变化频繁或体积大的数据）：

```typescript
interface StateSnapshot {
  turn: number
  date: { year: number; month: number }
  attributes: {
    military: number
    economy: number
    politics: number
    people: number
    diplomacy: number
  }
  resources: {
    silver: number
    troops: number
    food: number
    reputation: number
  }
}
```

**理由**：
- `events` 数组每回合新增事件后内容变化，若包含在 `stateSnapshot` 中会导致缓存永远不命中
- `advisorMessages` 同理，玩家随时可能咨询军师
- `factions` 信息通过独立的 `factions` 参数传递（NPC 决策接口需要）
- 历史事件上下文通过 `recentEventTitles: string[]`（最近 5 条事件标题）单独传递，不计入 `stateSnapshot`

### D6: 本地存档结构（版本化）

```typescript
interface GameSave {
  saveVersion: 1                    // 存档结构版本，便于后续迁移
  saveId: string                    // UUID，云端同步主键
  deviceId: string                  // 设备指纹
  createdAt: number                 // 存档创建时间戳
  updatedAt: number                 // 最后修改时间戳

  // 玩家身份与势力
  character: {
    background: '文官' | '武将' | '商贾' | '士绅' | '宗室'
    backgroundPerks: Record<string, number>   // 身份带来的初始属性偏移
    factionId: string
    factionName: string
    factionSummary: string          // 势力简介（AI 生成）
  }

  // 游戏状态
  state: {
    turn: number                    // 当前回合数（从 1 开始）
    date: { year: number; month: number }   // 游戏内时间，起始 1851-1
    attributes: {
      military: number              // 军事
      economy: number               // 经济
      politics: number              // 政治
      people: number                // 民心
      diplomacy: number             // 外交
    }
    resources: {
      silver: number                // 银两
      troops: number                // 兵力
      food: number                  // 粮草
      reputation: number            // 声望
    }
  }

  // 其他势力（NPC）
  factions: Array<{
    id: string
    name: string
    summary: string
    power: number                   // 综合实力 0-100
    relationship: number            // 与玩家关系 -100~100
    status: 'active' | 'destroyed' | 'allied'
  }>

  // 历史
  events: Array<{                   // 历史事件（最近 50 条）
    turn: number
    eventType: '民生' | '军事' | '外交' | '随机' | '历史剧情' | 'npc'  // 事件类型（zod schema 强约束）
    title: string
    description: string
    playerChoice: string             // 玩家最终选择（resolve-decision 返回的选项 title）
    effects: Record<string, number>  // 玩家决策应用的最终 effects
  }>

  // 军师对话（最近 20 条）
  advisorMessages: Array<{
    role: 'user' | 'assistant'
    content: string
    turn: number
    timestamp: number
  }>

  // 结局标记（评审补充 2026-07-20：与 endedAt/endedReason 同步设置）
  ended: boolean                      // false=进行中，true=已结束（endedAt != null 时必为 true）
  endedAt?: number                    // 游戏结束时间戳（仅 ended=true 时有值）
  endedReason?: string                // 结局原因（如 'military_collapse'、'victory'、'time_up'）
}
```

- **`ended` 字段说明**（评审补充 2026-07-20）：`ended` 是冗余布尔字段，可由 `endedAt != null` 推断，但保留独立字段便于前端 `v-if="!save.ended"` 守卫与 DB 查询过滤。**写入时三者必须同步**：触发结局时同时设置 `ended=true` + `endedAt=Date.now()` + `endedReason=...`。DB `game_saves` 表不设 `ended` 列（由 `ended_at IS NOT NULL` 推断），仅 `endedAt` 与 `endedReason` 作为独立列便于 SQL 查询。
- **存档大小估算**：50 事件 × 平均 200 字 + 20 军师对话 × 平均 100 字 + 元数据 ≈ 15-25 KB，远小于 `uni.setStorage` 10MB 上限
- **截断策略**：事件超过 50 条保留最新 50；军师对话超过 20 条保留最新 20

### D7: 云端同步合并策略（服务端权威 updated_at 方案）

> ⚠️ **决策：选服务端权威 updated_at 方案**（评审 R2 选 A）。原因：原方案存在 Read-Modify-Write race（两设备同 saveId 间隔 < 100ms 同时 POST 会同时通过版本检查后写者覆盖），与 AGENTS.md「数据安全规则 > 服务端数据库避免 Read-Modify-Write」直接冲突。让服务端成为 `updated_at` 的唯一写入者，从源头消除 race。

#### 同步语义

- **服务端权威 `updated_at`**：存档的 `updated_at` 列由 `defaultNow()` 在数据库层生成，**POST 端不接收客户端 `updatedAt`**（API 也不返回 `updatedAt` 作为可信时间戳；客户端 `updatedAt` 仅作为本地排序与 UI 显示用）
- **写入策略**（POST sync-save）：
  - DB **唯一约束**（`saveId` + `(userId, saveId)` 复合唯一，参见 [specs/cloud-sync/spec.md](file:///d:/code/codeWork/GAME/openspec/changes/add-qing-revival-mvp/specs/cloud-sync/spec.md)）
  - **INSERT**：`onConflictDoNothing()` —— 首次上传直接写入
  - **UPDATE**：`onConflictDoUpdate()` 用 `save_data`、`endedAt`、`endedReason` —— 二次上传覆盖。**服务端自己生成 `updated_at`**，不依赖客户端
- **读取策略**（GET sync-save）：返回服务端 `save_data` + 服务端 `updated_at` + `endedAt` + `endedReason`
- **客户端决策**（前端 `useSaveSync`）：
  - 启动时 GET，404 → 本地存档首次上传
  - 本地与云端 `updatedAt` **都**在 1 秒误差范围内（`|local - cloud| < 1000ms`）：无操作
  - 本地 `updatedAt` < 云端：拉取云端覆盖本地
  - 本地 `updatedAt` > 云端：上传本地（POST 携带 `save_data` 即可，**不带 updatedAt**）
  - **不引入客户端冲突 UI**：服务端权威后无 race，客户端只需"谁更新用谁"即可
- **不引入 OT/CRDT**：MVP 单设备游玩为主

#### 与原方案的关键区别

| 项 | 原方案（评审前） | 当前方案（评审后） |
|---|---|---|
| `updatedAt` 写入方 | 客户端传入 | 服务端 `defaultNow()` 权威生成 |
| 冲突检测 | `if (uploadedAt >= db)` 读后写（race） | 唯一约束 + onConflict 原子操作（无 race） |
| 1 秒误差 | "允许 1 秒误差"模糊描述 | 明确 `|local - cloud| < 1000ms` 数值 |
| 客户端冲突 UI | 提示用户三选一 | 删除（服务端权威后不需要） |
| POST 响应 | 409 SYNC_CONFLICT | 不需要，POST 永远 200 OK，客户端 GET 校验 |

#### 实现细节

- Drizzle schema 中 `saves.updatedAt` 用 `timestamp({ withTimezone: true }).defaultNow().notNull()`（**不要**让 API 写入）
- API 接收的 body **不**含 `updatedAt` 字段（zod schema 拒绝 `updatedAt` 字段，zod `z.object(...).strict()` 模式）
- POST sync-save 总是返回 `{ saveId, updatedAt: <server_now>, endedAt, endedReason }`
- 客户端 `useSaveSync` 拿服务端的 `updatedAt` 写回本地

#### 阶段 7 测试覆盖

- `tests/api/sync-save.test.ts` 必须覆盖：
  - 首次上传 → 200 OK，DB 写入
  - 二次同 saveId 上传 → 200 OK，DB 覆盖（**两次都用服务端时间，不接受客户端时间**）
  - 两次 POST 间隔 < 100ms（用 `setTimeout(0)` 模拟） → 两次都 200，**最后一次写入的服务端时间为最终值**（用 Drizzle 返回值校验）
  - 客户端 body 携带 `updatedAt` 字段 → 422 校验错误（被 strict 模式拒绝）

### D8: SSE 流式三端兼容方案

> ✅ **风险已降级**：微信开放社区 2024.12.31 公告 + 2025.02.18 稳定版已修复 iOS `onChunkReceived` 回调丢失问题（基础库 8.0.56+）。当前（2026-07）`enableChunked` 在 iOS/Android 双端已稳定可用。**自动探测降级从「必须实现」降级为「可选防御」**，MVP 阶段 `useSSE` 可直接走 chunked 流式，保留 `?stream=false` 非流式降级作为紧急熔断即可。

#### 三端基础方案

- **H5**：原生 `EventSource` 不支持 POST body，改用 `fetch` + `ReadableStream` 读取（与 my-chat `useChat` 一致）
- **微信小程序**：用 `uni.request` + `enableChunked: true` + `responseType: 'arraybuffer'` + `RequestTask.onChunkReceived` 监听分块响应，前端用 `TextDecoder('utf-8')` 解码（**不用 `String.fromCharCode`**，避免中文乱码），拼接跨 chunk 的 SSE 数据按 `\n\n` 切分
- **App 端**：同小程序方案

#### SSE 协议选择：手写简单协议 vs 复用 `createUIMessageStreamResponse`（评审补充 2026-07-20）

**决策**：advisor-chat 走**手写简单 SSE 协议** `data: {"delta":"..."}\n\n` + `data: [DONE]\n\n`，**不复用** my-chat 的 `createUIMessageStream` + `createUIMessageStreamResponse` 高层抽象。

**理由**：
1. my-chat 的 UIMessageStream 协议含多种 chunk 类型（`start` / `text-start` / `text-delta` / `text-end` / `reasoning-start` / `reasoning-delta` / `reasoning-end` / `finish` 等），小程序端 `onChunkReceived` 跨 chunk 拼接时需要完整 JSON.parse 每一帧，复杂 chunk 类型解析失败率高
2. GAME 项目军师对话**强制 `enable_thinking: false`**（不产生 reasoning），不需要 UIMessageStream 的 reasoning chunk 类型
3. 简单 `{delta}` 协议三端解析逻辑一致（按 `\n\n` 切分 + `data: ` 前缀剥离 + JSON.parse 取 `delta` 字段），小程序端跨 chunk 拼接只需保留最后一段不完整 JSON
4. my-chat 用高层抽象是因为它需要在前端展示 reasoning 思考过程（`ThinkingProcess` 组件），GAME 军师对话明确不需要

**代价**：偏离 my-chat 复用模式，但 advisor-chat 是唯一流式接口，复杂度可控。

#### `useSSE` composable 统一三端 API

```ts
useSSE().connect(url, body, {
  onChunk: (delta: string) => {},   // 单个 text delta
  onDone: () => {},                  // 收到 [DONE] 或流关闭
  onError: (code: string) => {},     // AI_CALL_FAILED / NETWORK 等
  firstChunkTimeoutMs?: number       // 默认 3000ms
})
```

#### 自动探测降级逻辑（可选防御，兼容低版本微信）

> 注：微信 8.0.56+（2025.02.18 稳定版）已修复 iOS `onChunkReceived` 回调丢失问题，探测大概率成功。但为兼容低版本微信用户，自动探测降级仍保留。

1. **iOS 微信探测**：`uni.getSystemInfoSync().platform === 'ios' && uniPlatform === 'mp-weixin'` 时**先发 1 个 1 字节探测请求**（设置 `firstChunkTimeoutMs = 2000ms`），2 秒内未收到首个 chunk 判定为不支持 chunked
2. **探测失败处理**：
   - 调 `requestTask.abort()` 取消探测
   - 标记 `_chunkedAvailable = false`，本次会话**直接走非流式方案 B**（同 URL 加 `?stream=false` query，服务端 `sync-save` 风格的开关）—— 服务端 `advisor-chat` 路由判断 `stream=false` 时走 `streamText().then(r => r.text)` 非流式一次性返回完整 JSON `{ delta: <full text>, done: true }`
3. **探测成功**：正常走流式，`firstChunkTimeoutMs` 后续请求复用 3000ms
4. **缓存探测结果**：`uni.setStorage('sse_chunked_available', bool)`，避免每次请求都探测

#### 跨 chunk 拼接关键代码（小程序端）

```ts
let lastText = ''
requestTask.onChunkReceived((res) => {
  const text = lastText + new TextDecoder('utf-8').decode(new Uint8Array(res.data))
  lastText = ''
  const arr = text.split('\n\n').filter(Boolean)
  const lastIdx = arr.length - 1
  try {
    arr.every(item => JSON.parse(item.replace(/^data: /, '')))
  } catch {
    // 最后一段不完整，保留到下次拼接
    lastText = arr[lastIdx]
    arr = arr.filter((_, i) => i !== lastIdx)
  }
  for (const msg of arr) {
    if (msg === 'data: [DONE]') { onDone(); continue }
    const json = JSON.parse(msg.replace(/^data: /, ''))
    if (json.delta) onChunk(json.delta)
    if (json.error) onError(json.error)
  }
})
```

#### 降级开关

- 服务端 `server/config` 暴露 `streamingDisabled` 环境变量（默认 `false`）
- 服务端 `advisor-chat` 路由读取此开关，`true` 时**全部请求**走非流式（紧急熔断用）
- 前端 `useSSE` 启动时 `GET /api/game/config` 读取该开关（**MVP 暂不实现**，运行时仅靠自动探测 + 用户手动 `setting.streamingDisabled` 本地开关）

#### 阶段 2 前置验证

- **T2.11 SSE 兼容性预验证**：三端真机测试（iOS 微信 + Android 微信 + 微信开发者工具）
- 验证矩阵（微信 8.0.56+）：
  - 微信开发者工具：chunked ✅
  - Android 微信 8.0.56+：chunked ✅
  - iOS 微信 8.0.56+：chunked ✅（2025.02.18 稳定版已修复回调丢失问题）
  - 低版本微信（< 8.0.56）：自动探测降级到非流式

### D9: 设备指纹生成

> ⚠️ **同 origin 限制**：H5 的 `localStorage` 仅在**同 origin（协议+域名+端口）**内共享；MVP 不支持跨子域（例如 `a.example.com` 与 `b.example.com` 不同 localStorage）。后续如需跨子域，改用 `uni.setStorageSync`（uni-app 跨端统一抽象）或服务端 `Cookie`。
> MVP 部署建议主域名 + 单一 origin 部署，避免此限制。

- **H5**：`crypto.randomUUID()` + `localStorage` 持久化（同 origin）
- **小程序**：`uni.getStorageSync('deviceId')` 不存在时生成 UUID 写入
- **App**：同小程序
- **统一封装** `utils/device-id.ts`，启动时获取/生成，存入 Pinia store 与每次同步请求 header
- **不同端指纹不互通**（H5 / 微信小程序 / App 是不同指纹），同一玩家在 3 端是 3 个独立存档（云端同步也是独立的 3 份）；MVP 不做跨端账号合并，**这是已知限制，不是 bug**

### D10: 数值平衡（MVP 简化）

- 起始属性：每项 50（0-100 范围），身份偏移 ±10
- 起始资源：银两 1000、兵力 500、粮草 800、声望 10
- 单回合事件影响：每项属性 ±5~15，资源 ±50~200
- 失败条件：任一属性 ≤ 0 触发「势力崩溃」结局
- 胜利条件：存活至 1912 年 或 综合实力 ≥ 90（MVP 不实现多结局，仅判定存活/崩溃）

## UI/UX 适配方案

### 三端断点（uni-app 标准）

- 手机竖屏：默认布局，单列，触摸优先
- 平板横屏：`uni.getSystemInfoSync().windowWidth >= 768` 时启用双栏（左侧状态面板 + 右侧主内容）

### 触摸目标尺寸（遵循 AGENTS.md 规则）

- 决策按钮：`min-w-[44px] min-h-[44px]`，全宽时高度 ≥ 56px
- 势力卡片：整张可点击，最小高度 96px
- 军师对话发送按钮：`min-w-[44px] min-h-[44px]`
- 关闭抽屉按钮：`min-w-[36px] min-h-[36px]`
- 状态面板属性条：高度 ≥ 12px（点击可查看详情时 ≥ 36px）

### 动画与过渡

- 回合切换：`<transition>` + `fade` 200ms
- 事件卡片入场：`translateY(12px)` + `opacity` 300ms
- 军师抽屉：从右侧滑入 300ms
- 状态属性变化：数字滚动 + 颜色闪烁（绿↑红↓）
- AI 加载：spinner + 文案「军师沉思中...」「事件生成中...」+ 进度指示

### 字体与颜色

- 主色：晚清朱红 `#8B1A1A` + 墨黑 `#1C1C1C` + 宣纸米 `#F5E6C8`
- 字体：思源宋体（serif，体现古风）作为标题字体，正文用系统默认无衬线
- 状态色：军事红、经济金、政治紫、民心绿、外交蓝

## API 设计与错误处理

### 通用响应格式

```typescript
// 成功
{ "ok": true, "data": T }
// 失败
{ "ok": false, "error": { "code": string, "message": string, "detail"?: unknown } }
```

### 路由规格

| 路由 | 方法 | 入参 | 出参 | 校验 |
|---|---|---|---|---|
| `/api/game/init-factions` | POST | `{ background: string }` | `{ factions: Faction[] }` | background 必填且 ∈ 5 类 |
| `/api/game/generate-event` | POST | `{ saveId, turn, stateSnapshot }` | `{ event: GameEvent }`（含 2-4 个带预定义 effects 的选项） | saveId UUID、turn ≥ 1、stateSnapshot 结构校验 |
| `/api/game/resolve-decision` | POST | `{ saveId, turn, playerDecision, stateSnapshot, event }` | `{ effects: Effects }` | 同上 + playerDecision 非空（1-200 字） |
| `/api/game/npc-actions` | POST | `{ saveId, turn, factions, stateSnapshot }` | `{ actions: NpcAction[] }` | 同上 |
| `/api/game/advisor-chat` | POST (SSE) | `{ saveId, turn, messages, stateSnapshot }` | SSE stream | messages 数组、最后一条为 user |
| `/api/game/sync-save` | POST | `{ save: GameSave }`（**不含 `updatedAt`**） | `{ ok: true, data: { saveId, updatedAt, endedAt, endedReason } }` | zod `.strict()` 模式拒绝 `updatedAt` 字段 |
| `/api/game/sync-save` | GET | `?saveId=xxx` | `{ save: GameSave }` 或 404 | saveId UUID |

### 错误处理

- **参数校验失败**：返回 400 + `{ code: 'INVALID_PARAMS', message, detail: zodErrors }`
- **AI 调用失败**：返回 500 + `{ code: 'AI_CALL_FAILED', message }`；前端 toast 提示并降级（事件用兜底池、NPC 跳过、军师显示沉默）
- **AI 超时**：服务端 30 秒超时；前端 35 秒超时；超时返回 504
- **并发锁冲突**：返回 429 + `{ code: 'CONCURRENT_REQUEST', message: '本回合正在处理中' }`；前端提示「请稍候」
- **频率限制**：返回 429 + `{ code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' }`；按 deviceId 每分钟最多 10 次 AI 调用
- **同步冲突**（D7 服务端权威方案）：**已废弃**。`/api/game/sync-save` POST 不返回 409，POST 永远 200 OK；客户端靠 GET 拿服务端 `updatedAt` 决定是否覆盖本地
- **未授权**：401（MVP 不强制，预留中间件位）
- **未找到存档**：404

### 参数校验实现

- 全部用 `zod` 定义 schema，路由入口 `schema.parse(body)` 失败抛 `createError({ statusCode: 400, ... })`
- 与 my-chat 的 `chat.post.ts` 校验风格一致

## 多端兼容方案

### 共用一份代码

- 业务逻辑（composables、stores、utils、types）三端共用
- 页面与组件 95% 共用，少数平台差异用 `#ifdef MP-WEIXIN` / `#ifdef H5` / `#ifdef APP-PLUS` 条件编译

### 关键差异处理

| 能力 | H5 | 微信小程序 | App |
|---|---|---|---|
| 流式响应 | fetch + ReadableStream | `uni.request` + `onChunkReceived` | 同小程序 |
| 本地存储 | `uni.setStorage`（封装 localStorage） | `uni.setStorage`（wx.setStorageSync） | `uni.setStorage` |
| 设备指纹 | `crypto.randomUUID` + localStorage | `uni.getStorageSync` 生成 | 同小程序 |
| 网络请求 | `uni.request`（统一） | `uni.request` | `uni.request` |
| 路由 | `uni.navigateTo` | `uni.navigateTo` | `uni.navigateTo` |
| 字体加载 | `@font-face` 远程 | 小程序不支持远程字体，需 base64 或 `wx.loadFontFace` | 同 H5 |
| 图标 | SVG inline | 小程序不支持 inline SVG，改用 iconfont 字体或图片 | SVG inline |

### 小程序包大小限制

- 主包 ≤ 2MB，分包 ≤ 20MB（微信小程序）
- MVP 单包设计，预估 < 1MB（无大图资源，AI 图远期才接入）
- 若超出：分包加载 `game-main` 页面

## AI 调用策略

### 流式输出

- 军师对话：`streamText()` + SSE，前端逐字渲染（参考 my-chat 的 `chat.post.ts` 流式实现）
- 事件生成/NPC 决策：`generateObject()` 非流式（结构化输出必须等完整 JSON），但前端显示 spinner + 阶段文案
- SSE 协议：参考 my-chat `chat.post.ts` 的 `data: ` 前缀格式

### 缓存

- 事件缓存：5 分钟 TTL，键 = `sha256(saveId + turn + sha256(stateSnapshot))`（不依赖玩家决策，同一局势同一事件）
- 决策判定缓存：5 分钟 TTL，键 = `sha256(saveId + turn + playerDecision + sha256(stateSnapshot))`
- NPC 缓存：不缓存（NPC 决策依赖事件后状态，每次不同）
- 军师对话：不缓存（玩家自由输入，无法复用）
- 开局势力：不缓存（玩家身份只有 5 类，未来可加 5 类身份的预生成势力缓存，MVP 不做）

### 并发控制

- 同 `saveId` 串行锁：进程内 `Map<saveId, Promise>`，请求到达时 await 已有 Promise
- 防止玩家快速点击导致重复 AI 调用
- 锁超时 30 秒自动释放（防止死锁）

### Token 成本

| 调用 | 预估 tokens | 频次 | 单回合成本 |
|---|---|---|---|
| 军师对话（含上下文 20 条） | 输入 1.5K + 输出 0.5K | 0-3 次/回合（可选） | 0-6K |
| 事件生成 | 输入 1K + 输出 0.5K | 1 次/回合 | 1.5K |
| 决策判定（自由输入） | 输入 0.5K + 输出 0.3K | 0-1 次/回合（仅自由输入） | 0-0.8K |
| NPC 决策 | 输入 1K + 输出 0.5K | 1 次/回合 | 1.5K |
| **单回合合计** | — | — | **3-9.8K tokens** |

- **势力摘要压缩**：每个 NPC 势力传给 LLM 时只传 `name + power + relationship + status`（4 字段约 50 tokens），不传完整 summary
- **历史事件压缩**：传最近 5 条事件的标题（不传 description），约 200 tokens
- **预估每月成本**：硅基流动 `Qwen/Qwen3-8B` 价格 0.35 元/百万 tokens，单回合 9K tokens ≈ 0.003 元；玩家每天 20 回合 × 30 天 = 0.6 元/月/玩家
- `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` 开局 1 次约 6-10K tokens ≈ 0.02 元（按 0.35 元/百万）

### 失败降级（不阻断回合）

- 军师失败：前端显示「军师沉默，请自行决断」+ 不影响回合推进
- 事件失败：服务端从预置事件池随机抽 1 个返回（事件池 `server/runtime/fallback-events.ts` 含 20 条预置事件）
- 决策判定失败：服务端返回默认效果 `{ military: -3, economy: -3, politics: -3, people: -3, diplomacy: -3 }`（保守惩罚），前端 toast 提示
- NPC 失败：跳过本回合 NPC 行动，下回合恢复

## 数据模型

### `game_saves` 表（Drizzle schema）

```typescript
// server/db/schema.ts
export const gameSaves = pgTable('game_saves', {
  id: uuid('id').primaryKey().defaultRandom(),
  saveId: uuid('save_id').notNull().unique(),    // 前端生成的 UUID
  deviceId: text('device_id').notNull(),
  saveData: jsonb('save_data').notNull(),         // 完整 GameSave 对象
  saveVersion: integer('save_version').notNull().default(1),
  endedAt: timestamp('ended_at'),                 // 游戏结束时间戳（可选，仅 ended=true 时有值）
  endedReason: text('ended_reason'),              // 结局原因（可选，如 'military_collapse'、'victory'、'time_up'）
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// 索引：saveId 唯一约束 + deviceId 普通索引（按设备查列表）
```

**字段说明**：
- `endedAt` 和 `endedReason` 从 `saveData` JSONB 中提取为独立列，便于 SQL 层查询已结束的游戏（如排行榜、统计）
- 这两个字段与 `saveData` 内部的 `ended`/`endedAt`/`endedReason` 保持冗余，以 DB 列为准
- `ON CONFLICT DO UPDATE` 语句需同步更新这两个列（参见 [specs/cloud-sync/spec.md](file:///d:/code/codeWork/GAME/openspec/changes/add-qing-revival-mvp/specs/cloud-sync/spec.md)）

### 不引入用户表

- MVP 用 `deviceId` 占位 `userId` 字段
- 后续接登录系统时新增 `users` 表，`game_saves.userId` 外键

## 风险与不确定性

### [不确定] 高风险点

1. **小程序流式响应兼容性**：微信 8.0.56+（2025.02.18 稳定版）已修复 iOS `onChunkReceived` 回调丢失问题，但低版本微信仍需自动探测降级。**阶段 2 前做 SSE 兼容性预验证**（T2.11），确认三端 chunked 可用
2. **`generateObject()` 结构化输出稳定性**：`Qwen/Qwen3-8B` 在复杂 schema 下偶发 JSON 解析失败（约 5%），需重试 1 次后降级到 `streamText()` + 手动 JSON 提取。**T1.5 已增加 generateObject 冒烟测试**，提前验证硅基流动可用性
3. **AI 调用延迟**：硅基流动 `Qwen/Qwen3-8B` P99 延迟可能超过 15 秒，需在前端 spinner 阶段加入「跳过 AI」按钮让玩家可选放弃本回合 AI 内容；`deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` 开局调用建议单独设置 60s 超时
4. **token 成本超预期**：若玩家每回合咨询军师 ≥ 5 次，月成本可达 3 元/玩家，需在 settings 页面增加「AI 调用次数」统计与上限设置
5. **存档迁移**：`saveVersion=1` 后续若改字段结构需写迁移脚本，MVP 不实现迁移工具，约定 v2 时补
6. **首回合无历史上下文**：回合 1 时 `events` 数组为空，`generate-event` 提示词缺少"最近 5 条事件"上下文。需在提示词中注入"游戏开场"特殊上下文（如"1851 年，金田起义爆发，太平天国运动拉开序幕..."），或使用专用首回合事件池
7. **AI 端点滥用**：无登录系统时，任何人可伪造 deviceId 无限调用 AI 端点。需加简易 rate limit 中间件（按 deviceId 每分钟最多 10 次 AI 调用）

### 验证方法

- 流式兼容性：MVP 完成后用真机测试微信小程序、Android App、H5 三端各 1 次
- `generateObject` 稳定性：单测模拟 50 次调用统计成功率
- 延迟：服务端日志记录每次 LLM 调用耗时，P50/P95/P99 上报
- token 成本：服务端日志记录每次调用 token 数，按 saveId 聚合
