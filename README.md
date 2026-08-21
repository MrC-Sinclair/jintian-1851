# 金田：1851

> 一款以晚清（1851–1912）为背景的 **AI 驱动文字策略抉择游戏**。玩家选择身份与势力，运筹军事、经济、政治、民心、外交五维，在太平天国、洋务运动、甲午战争等真实历史洪流中做出抉择，改写国运。

- 前端：[`game-web/`](./game-web) —— uni-app（Vue 3 + TS），一套代码同时构建 **H5** 与 **微信小程序**
- 后端：[`server/`](./server) —— Nuxt 3 纯 API 服务，基于 **Vercel AI SDK** + **Drizzle ORM** + **PostgreSQL（pgvector）**
- 设计文档 / 接口文档 / 数据库 Schema / AI 成本约束：见 [`docs/`](./docs)
- 需求与变更规格：见 [`openspec/`](./openspec)

---

## ✨ 功能特性

- **多身份开局**：文官 / 武将 / 商贾 / 士绅 / 宗室 5 类身份，各有属性偏移与推荐势力
- **五维 + 四资源体系**：军事、经济、政治、民心、外交（0–100），银两、兵员、粮草、名望（资源）
- **AI 动态事件**：`generate-event` 调用大模型生成贴合局势的事件与选项，含风险-收益权衡
- **14 条脚本化历史剧情链**：太平天国兴亡、洋务运动、甲午战争、辛亥革命……零 LLM 成本的线性历史剧情，与 AI 事件互补
- **势力与 NPC 博弈**：6 个历史势力（清廷 / 湘军 / 淮军 / 太平天国 / 北洋 / 革命党）由 LLM 自主决策行动
- **军师系统（AI Advisor）**：局势简报 + 自由对话，提供决策建议
- **多种结局**：5 种属性崩溃 / 中兴胜利 / 时光尽头，共 7 类结局判定
- **本地存档 + 云端同步**：`local-save` 与 `cloud-sync` 双轨

---

## 🧱 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | uni-app 3.0 / Vue 3 / TypeScript | H5 + 微信小程序双端；Pinia 状态管理，vue-i18n 国际化 |
| 后端 | Nuxt 3 | 纯 API 服务（`components: false` / `pages: false`），SSR 仅作 API 层 |
| AI | Vercel AI SDK v5（`ai` / `@ai-sdk/openai`） | 工具调用、流式、多步推理；默认模型 `Qwen/Qwen3-8B` |
| 数据库 | PostgreSQL 18（pgvector） + Drizzle ORM | 向量能力预留；`drizzle-kit` 管理迁移 |
| LLM Provider | 硅基流动 SiliconFlow（OpenAI 兼容协议） | 通过 `OPENAI_BASE_URL` / `OPENAI_API_KEY` 接入 |
| 包管理 | pnpm 11 | `game-web` 与 `server` 为**两个独立子项目，各自用 pnpm 管理** |
| 测试 | Vitest + Playwright | 单元 / 组件 / API / E2E 分层 |
| 基础设施 | Docker Compose | 一键拉起开发 / 测试数据库 |

---

## 📁 目录结构

```
jintian-1851/
├── game-web/              # 前端：uni-app（H5 + 微信小程序）
│   ├── src/
│   │   ├── components/    # 事件卡、势力卡、进度条等 UI 组件
│   │   ├── composables/   # 游戏状态、回合、危机等组合式函数
│   │   ├── stores/        # Pinia 状态仓库
│   │   ├── utils/         # 结局判定、数值计算、文案等
│   │   ├── data/          # 剧情链 / 势力 前端元数据镜像
│   │   └── types/         # 全局类型定义（与后端 Schema 对齐）
│   └── tests/             # unit / component / e2e
├── server/                # 后端：Nuxt 3 纯 API 服务
│   └── server/
│       ├── api/game/      # 8 个核心接口（见下方 API 概览）
│       ├── db/            # Drizzle Schema 与查询
│       ├── runtime/       # 兜底势力 / 事件 / 剧情链
│       ├── tools/         # Agent 工具（init-factions / npc 等）
│       └── scripts/       # 如模型可用性检查
├── docs/                  # 项目权威文档（代码与文档不可脱节）
│   ├── game-design.md     # 数值 / 势力 / 事件池 / 结局（唯一数值来源）
│   ├── db-schema.md       # 数据库表结构（唯一 Schema 来源）
│   ├── API.md             # HTTP 接口定义（唯一接口来源）
│   └── ai-cost.md         # AI 调用成本约束
├── openspec/              # 需求 / 规格 / 变更 / 上线清单
├── docker/                # docker-compose 初始化脚本（pgvector 扩展）
├── docker-compose.yml     # Postgres 18（pgvector）开发 & 测试库
└── AGENTS.md              # AI 编程助手纪律与执行规则（必读）
```

---

## 🚀 快速开始

### 前置要求

- **Node.js** ≥ 18（建议 20+）
- **pnpm** 11（`corepack enable` 后自动按 `packageManager` 字段锁定）
- **Docker**（用于本地 PostgreSQL）
- 一个 **硅基流动（SiliconFlow）** API Key：<https://cloud.siliconflow.cn>

### 1. 启动数据库

```bash
# 开发库 sw_game 映射 5534，测试库 sw_game_test 映射 5533
docker compose up -d
```

> 数据库默认用户/密码均为 `sw_game`。请确保 `server/.env` 的 `DATABASE_URL` 中密码与之相同；如需修改，可在仓库根目录 `.env` 设置 `POSTGRES_PASSWORD` 覆盖默认值。

### 2. 配置后端环境变量

```bash
cd server
cp .env.example .env
# 编辑 .env，至少填入 OPENAI_API_KEY；其余已有默认值
```

`server/.env` 关键变量（详见 [`server/.env.example`](./server/.env.example)）：

| 变量 | 说明 | 默认值 |
|---|---|---|
| `OPENAI_API_KEY` | SiliconFlow（OpenAI 兼容）API Key | 必填 |
| `OPENAI_BASE_URL` | LLM 网关地址 | `https://api.siliconflow.cn/v1` |
| `LLM_MODEL` | 默认模型 | `Qwen/Qwen3-8B` |
| `DATABASE_URL` | 数据库连接串 | `postgresql://sw_game:YOUR_DB_PASSWORD@localhost:5534/sw_game` |
| `ENABLE_BRIEFING` | 局势简报开关 | `true` |

> 后端默认监听 `http://localhost:3000`。

### 3. 安装依赖并运行后端

```bash
cd server
pnpm install
pnpm db:push      # 首次需将 Drizzle Schema 同步到数据库
pnpm dev          # 启动 Nuxt 开发服务（端口 3000）
```

### 4. 安装依赖并运行前端

```bash
cd game-web
pnpm install
pnpm dev:h5        # 启动 H5 开发（浏览器预览）
# 或
pnpm dev:mp-weixin # 启动微信小程序开发（需用微信开发者工具打开）
```

> 前端通过 `uni.request` 调用后端 `/api/game/*`，API Base URL 在 `src/utils/api.ts` 中配置（联调时指向 `http://localhost:3000`）。

### 构建产物

```bash
# 前端
cd game-web && pnpm build:h5            # 产出 H5 静态包
cd game-web && pnpm build:mp-weixin     # 产出微信小程序包

# 后端
cd server && pnpm build && pnpm preview # 生产构建与预览
```

---

## 🧪 常用命令

> ⚠️ `game-web/` 与 `server/` 是**两个独立的 pnpm 子项目**，命令须各自在对应目录执行，**禁止在仓库根目录直接运行** `pnpm dev/build/test`。

### 后端 `server/`

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动开发服务（3000） |
| `pnpm build` / `pnpm preview` | 生产构建 / 预览 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm lint` | ESLint + Stylelint |
| `pnpm test:unit` | 单元测试 |
| `pnpm test:api` | API 集成测试 |
| `pnpm db:push` | 推送 Schema 到数据库（改 `server/server/db/schema.ts` 后必须执行） |
| `pnpm db:studio` | 打开 Drizzle Studio |
| `pnpm check-models` | 检查可用 LLM 模型 |

### 前端 `game-web/`

| 命令 | 作用 |
|---|---|
| `pnpm dev:h5` / `pnpm dev:mp-weixin` | H5 / 微信小程序开发 |
| `pnpm build:h5` / `pnpm build:mp-weixin` | H5 / 小程序构建 |
| `pnpm typecheck` | `vue-tsc` 类型检查 |
| `pnpm lint` | ESLint + Stylelint |
| `pnpm test:unit` | 单元测试 |
| `pnpm test:component` | 组件测试 |
| `pnpm test:e2e` | Playwright 端到端测试 |

---

## 🔌 API 概览

后端 `server/server/api/game/` 下提供 8 个核心接口（完整定义见 [`docs/API.md`](./docs/API.md)）：

| 方法 & 路径 | 说明 |
|---|---|
| `POST /api/game/init-factions` | 初始化势力（LLM 生成，失败回退 6 个预置势力） |
| `POST /api/game/generate-event` | 生成本回合事件（三层触发：挂起剧情链 > 时间窗口 > LLM 生成） |
| `POST /api/game/resolve-decision` | 结算玩家决策，应用属性 / 资源 effects |
| `POST /api/game/npc-actions` | 活跃势力 AI 自主行动 |
| `POST /api/game/faction-negotiate` | 势力谈判（写信议价 / 还价裁定，Agent 两阶段处理） |
| `POST /api/game/advisor-briefing` | 军师局势简报 |
| `POST /api/game/advisor-chat` | 军师自由对话 |
| `POST /api/game/sync-save` | 云端存档同步 |

---

## 📚 文档索引

- [`docs/game-design.md`](./docs/game-design.md) — 游戏设计文档（数值、势力、事件池、结局判定的**唯一来源**）
- [`docs/db-schema.md`](./docs/db-schema.md) — 数据库表结构（**唯一 Schema 来源**）
- [`docs/API.md`](./docs/API.md) — HTTP 接口定义（**唯一接口来源**）
- [`docs/ai-cost.md`](./docs/ai-cost.md) — AI 调用成本约束
- [`openspec/`](./openspec) — 各功能模块规格（`specs/`）、变更记录（`changes/`）、[上线前检查清单](./openspec/pre-launch-checklist.md)
- [`AGENTS.md`](./AGENTS.md) — **AI 编程助手必读**：执行纪律、验证规则、文档查询约定、SSR 水合规则、数据安全规则

> 项目纪律要求「代码与文档不可脱节」：修改逻辑 / Schema / 接口后，须同步更新对应 `docs/` 文档。

---

## 🤝 开发规范（要点）

- **AI Agent 纪律**：每次改 `.vue` / `.ts` / `.js` 后必须跑 `pnpm lint`（类型变更加 `pnpm typecheck`，核心逻辑变更加 `pnpm test:unit`）；技术路径歧义时用 `AskUserQuestion` 多方案确认。
- **文档先行**：修改业务模块前先查阅 `docs/` 与 `openspec/`。
- **SSRF / 水合**：前端非 SSR；后端为纯 API 服务，`window`/`localStorage` 等浏览器 API 须守卫。
- **数据安全**：异步写操作须防重复提交；服务端读写优先原子操作，避免 Read-Modify-Write 竞态。
- **密钥**：仅放在 `server/.env` 或 Nuxt `runtimeConfig` 非 public 字段，禁止暴露到前端。

详见 [`AGENTS.md`](./AGENTS.md)。

---

## 🧩 设计理念

- **降本增效**：所有「脚本化、可预测」的历史剧情通过 14 条剧情链实现，**零 LLM 成本**；仅常规事件与 NPC 决策调用大模型。
- **沉浸感**：6 个势力与 4 个历史剧情锚点对应真实历史人物与事件，时间跨度覆盖晚清主要节点。
- **风险-收益权衡**：每个事件选项遵循「高收益必伴随资源消耗、低风险选项效果温和、拖延选项常带负面」的设计，引导玩家权衡取舍。

---

## 📄 License

内部项目，仅供学习与研究使用。
