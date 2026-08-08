> **状态：已归档（代码已交付，2026-07-23）**
> 归档方式：原地标记完成，目录保持原位作历史记录
> 代码交付：8 阶段全部落地，709 测试通过，H5 + 小程序构建成功
> 残余任务（非代码，已提取到 `openspec/pre-launch-checklist.md` 跟踪）：
>   - T8.0 部署前置（域名 / SSL / Nginx，微信小程序生产环境必需）
>   - T8.1 三端真机测试（H5 浏览器 / 微信小程序 iOS+Android / App）
>   - `.env` 配置（OPENAI_API_KEY、DATABASE_URL 等生产环境密钥）

## Why

当前 `d:\code\codeWork\GAME` 仅有 `.trae/rules` 与 `AGENTS.md`，无任何代码。需要从零搭建一款参考【重振模拟器】的近代背景策略模拟游戏：玩家自定义身份（文官/武将/商贾/士绅等）+ 所属势力（由 AI 基于历史与玩家身份动态生成可选列表），通过回合制决策发展实力，AI 全包扮演军师（玩家可对话的谋士）、事件生成器、以及 NPC 势力决策者。技术栈采用 uni-app Vue3 CLI（H5+微信小程序+App 三端发布）+ 自建后端（参考 `d:\code\codeWork\my-chat` 的 `chat.post.ts` + 模型配置 + Drizzle + PostgreSQL）+ Vercel AI SDK + 硅基流动 SiliconFlow。本 change 完成 MVP 可玩版本：开局选身份与势力 → 进入回合循环 → AI 军师对话 + AI 事件 + NPC 势力演化 → 本地存档 + 云端同步。

## What Changes

- **uni-app Vue3 CLI 脚手架**：使用 `npx degit dcloudio/uni-preset-vue#vite-ts` 创建 Vue3 + TS + Vite 工程（**非** `pnpm create vite`，后者创建的是纯 Vite 项目，不含 uni-app 编译器与运行时），配置 H5/微信小程序/App 三端构建入口，集成 ESLint + Prettier + Stylelint + Vitest（参考 my-chat 的 lint/test 工具链）
- **自建后端服务**：在 `GAME/server/` 子工程中用 Nuxt3（或独立 Nitro）+ Drizzle ORM + PostgreSQL，复用 my-chat 的 `server/config/models.ts` 模型配置模式、`server/api/chat.post.ts` 流式调用模式；新增 `server/api/game/` 路由组（开局生成势力、回合事件、NPC 决策、军师对话、存档同步）
- **AI 模型集成**：参考 my-chat 的硅基流动 + Vercel AI SDK 方案，`server/config/models.ts` 复用 4 个模型。**严格沿用 my-chat 的 `value` 字段（含 `Qwen/`、`deepseek-ai/`、`THUDM/`、`Qwen/Qwen3.5-4B` 等完整 vendor 前缀）**，不得简化：
  - `Qwen/Qwen3-8B`：label "Qwen3-8B"，可切换思考，支持工具调用
  - `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`：label "DeepSeek-R1-0528-Qwen3-8B"，强制思考（`enable_thinking` 传了被忽略），**不支持工具调用**
  - `THUDM/GLM-Z1-9B-0414`：label "GLM-Z1-9B-0414"，强制思考（**传 `enable_thinking` 会 400 报错**），**不支持工具调用**
  - `Qwen/Qwen3.5-4B`：label "Qwen3.5-4B"，原生多模态（视觉+工具调用），可切换思考，256K 上下文（**MVP 不用视觉能力，仅做备用模型**）
- **AI 全包架构**：单次回合内 AI 调用最多 4 次——①军师对话（流式，可选）②事件生成（结构化 JSON）③决策判定（结构化 JSON，仅自由输入时触发）④NPC 势力决策（结构化 JSON）；通过 Vercel AI SDK `streamText()` + `generateObject()` 组合实现；服务端做并发锁（同一存档同一回合串行）+ 5 分钟事件缓存（同输入同输出）+ 流式回传避免阻塞；token 成本通过「势力摘要压缩」+「仅活跃势力参与决策」控制
- **开局流程**：玩家先选身份（文官/武将/商贾/士绅/宗室 5 类，每类有初始属性偏移）→ 服务端 `POST /api/game/init-factions` 调用 LLM 基于玩家身份 + 近代历史生成 6-8 个可选势力（含历史名臣势力如曾国藩湘军、李鸿章淮军、太平天国、清廷、北洋、革命党等，附带势力简介与初始状态）→ 玩家选定后进入游戏
- **回合制核心循环**：每回合包含「局势展示 → AI 生成事件（含选项）→ 玩家决策（选项卡片 或 自由输入）→ 状态演化 → NPC 势力行动」五段；玩家选择事件选项时，前端直接应用选项内预定义的 effects（无需额外 API）；自由输入场景调用 `POST /api/game/resolve-decision` 由 AI 判定效果；状态包含 5 维属性（军事/经济/政治/民心/外交）+ 资源（银两/兵力/粮草/声望）+ 时间（按月推进，起始 1851 年至 1912 年止）
- **军师对话**：每回合决策前/后玩家可与 AI 军师自由对话（流式输出），军师基于当前局势与玩家所选身份/势力给出策略建议；对话历史保存在本地存档的 `advisor_messages` 字段（每回合自动截断保留最近 20 条防止无限增长）
- **AI 事件生成**：每回合由 `POST /api/game/generate-event` 调用 LLM `generateObject()` 返回结构化事件（标题 + 描述 + 2-4 个选项 + 每个选项的状态影响）；服务端 5 分钟缓存同输入结果（基于局势快照，不依赖玩家决策）；事件类型按权重分布（民生/军事/外交/随机/历史剧情 5 类）；玩家选择选项后前端直接应用选项内预定义 effects；若玩家自由输入则调用 `POST /api/game/resolve-decision` 由 AI 判定效果
- **NPC 势力 AI**：每回合 `POST /api/game/npc-actions` 让 LLM 扮演其他势力的决策者，基于自身目标做出行动（扩张/结盟/备战/休养），返回结构化行动列表；玩家在下回合局势展示时看到 NPC 行动结果
- **本地存档**：使用 `uni.setStorage` 保存游戏状态（玩家身份/势力/属性/资源/时间/历史事件/军师对话/回合数），单存档设计（MVP 不做多存档槽），存档结构版本化（`saveVersion` 字段）便于后续迁移
- **云端存档同步**：`POST /api/game/sync-save` 上传本地存档到 PostgreSQL `game_saves` 表（按 `save_id` 唯一约束），`GET /api/game/sync-save` 拉取云端最新存档；同步采用**服务端权威 `updated_at` 方案**（服务端 `defaultNow()` 唯一生成，zod `.strict()` 模式拒绝客户端 `updatedAt` 字段，从源头消除两设备并发 race），客户端按 `|local - cloud| < 1000ms` 阈值判断是否同步
- **数据库 Schema**：`game_saves` 表（id, user_id, save_data jsonb, save_version, updated_at, created_at），MVP 阶段 user_id 用设备指纹（前端生成 UUID 存 localStorage）占位，后续接入正式登录系统

## Capabilities

### New Capabilities

- `game-bootstrap`: 项目脚手架与基础设施——uni-app Vue3 CLI 工程、自建后端骨架（Nuxt3/Nitro + Drizzle + PostgreSQL）、AI 模型配置（复用 my-chat 4 模型方案）、ESLint/Prettier/Stylelint/Vitest 工具链
- `character-creation`: 开局身份/势力选择——玩家从 5 类身份中选一，AI 基于玩家身份 + 近代历史动态生成 6-8 个可选势力（含简介与初始状态），玩家选定后初始化游戏状态
- `turn-engine`: 回合制核心循环——AI 事件生成（含选项）→ 玩家决策（选选项 或 自由输入）→ 状态演化 → NPC 势力行动；按月推进时间，1851-1912 年范围；5 维属性 + 4 资源
- `ai-advisor`: 军师对话——玩家可在每回合决策前/后与 AI 军师流式对话，军师基于当前局势与玩家身份/势力给策略建议；本地保留最近 20 条对话
- `ai-event-engine`: AI 事件生成——每回合由 LLM `generateObject()` 返回结构化事件（标题+描述+2-4 选项+状态影响），5 分钟服务端缓存；事件按 5 类权重分布
- `ai-npc-faction`: NPC 势力 AI——每回合 LLM 扮演其他势力决策者返回结构化行动列表，下回合局势展示时玩家可见
- `local-save`: 本地存档——`uni.setStorage` 保存完整游戏状态，存档结构版本化便于迁移
- `cloud-sync`: 云端存档同步——上传/拉取存档到 PostgreSQL `game_saves` 表，按最后修改时间戳合并，冲突时提示

### Modified Capabilities

无。本变更新增独立能力，无既有 spec 需修改。

## Impact

| 层级 | 影响 |
| --- | --- |
| 基础设施 | `docker-compose.yml` 启动 PostgreSQL 18（端口 5534 避开 my-chat 的 5434，便于两个项目同时开发）；uni-app 工程与 Nuxt3/Nitro 后端在同一仓库的 `game-web/` 与 `server/` 子目录 |
| 前端 | uni-app Vue3 CLI 工程，pages 包含 `index`（首页）、`character-create`（开局）、`game-main`（回合主界面）、`advisor-chat`（军师对话抽屉）、`settings`（设置/同步）；components 包含 `FactionCard`、`EventCard`、`DecisionButton`、`StatusPanel`、`AdvisorDrawer`、`TurnTimeline`；composables 包含 `useGameState`、`useTurn`、`useAdvisor`、`useSaveSync` |
| 后端 | `server/api/game/` 新增 6 个路由：`init-factions.post.ts`、`generate-event.post.ts`、`resolve-decision.post.ts`、`npc-actions.post.ts`、`advisor-chat.post.ts`（SSE 流式）、`sync-save.{get,post}.ts`；`server/config/models.ts` 复用 my-chat 4 模型配置；`server/utils/ai-cache.ts` 5 分钟事件缓存；`server/utils/concurrency-lock.ts` 同存档同回合串行锁；`server/middleware/rate-limit.ts` 简易频率限制；`server/db/schema.ts` 新增 `game_saves` 表 |
| 数据库 | `game_saves` 表（id UUID PK, save_id UUID UNIQUE, device_id TEXT, save_data JSONB, save_version INT, updated_at TIMESTAMP, created_at TIMESTAMP）；device_id 设备指纹占位，后续接登录系统 |
| AI 调用 | 单回合最多 4 次 LLM 调用（军师+事件+决策判定+NPC）；事件选项预定义 effects 前端本地应用不调 AI；仅自由输入时触发 resolve-decision；事件/NPC 用 `generateObject()` 结构化输出；军师用 `streamText()` SSE 流式；服务端做并发锁 + 5 分钟缓存 + 势力摘要压缩控成本；**单回合 3-8K tokens**（按 `Qwen/Qwen3-8B` 0.35 元/百万 tokens 计 ≈ 0.003 元/回合）；**开局 init-factions 1 次 6-10K tokens**（用 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` 推理模型 ≈ 0.02 元，独立计费） |
| 多端兼容 | H5 直接 fetch SSE；微信小程序用 `uni.request` + `RequestTask.onChunkReceived` 处理流式（小程序原生不支持 SSE，需用分块响应或降级为非流式）；**iOS 微信部分版本 chunked 不回调**，需 `useSSE` 启动时自动探测（2 秒无首 chunk 降级 `?stream=false` 非流式）；阶段 2 前先做 SSE 兼容性预验证 demo（覆盖 iOS + Android + 开发者工具三端） |
| 依赖 | `@dcloudio/uni-app`、`@dcloudio/uni-h5`、`@dcloudio/uni-mp-weixin`、`@dcloudio/vite-plugin-uni`；后端复用 my-chat 的 `ai@^5`、`@ai-sdk/openai@^2`、`drizzle-orm@^0.36`、`postgres@^3.4`、`zod@^3.25` |
| 文档 | 需同步创建 `docs/API.md`（6 个游戏 API 路由规格）、`docs/db-schema.md`（game_saves 表结构）、`docs/ai-cost.md`（token 成本与缓存策略说明）、`docs/game-design.md`（近代历史背景、5 类身份设计、回合循环规则、势力体系） |
| 测试 | 单元测试覆盖状态演化逻辑、事件缓存命中、服务端权威同步策略（含 `|差值| < 1000ms` 边界、客户端 body 携带 `updatedAt` 字段被拒）；API 测试覆盖 6 路由参数校验与错误响应；E2E 覆盖开局→1 回合→存档同步全流程 |
