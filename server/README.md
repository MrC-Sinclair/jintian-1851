# 金田：1851 — 后端服务（server）

> GAME 项目的后端 **纯 API 服务**（不渲染前端页面）。基于 Nuxt 3 + Vercel AI SDK + Drizzle ORM + PostgreSQL（pgvector），为大清晚期策略抉择游戏提供 AI 事件生成、势力/NPC 决策、军师对话与存档同步能力。

所属 monorepo 见根目录 [`../README.md`](../README.md)。前端仓库位于 [`../game-web`](../game-web)。

---

## 🧱 技术栈

| 类别 | 选型 | 说明 |
|---|---|---|
| 框架 | Nuxt 3 | 纯 API 服务，`components: false` / `pages: false`，仅用 `server/api/` 路由 |
| AI | Vercel AI SDK v5（`ai` / `@ai-sdk/openai`） | 工具调用、流式、多步推理 |
| 数据库 | PostgreSQL 18（pgvector） + Drizzle ORM | `drizzle-kit` 管理迁移 |
| LLM Provider | 硅基流动 SiliconFlow（OpenAI 兼容） | 通过 `OPENAI_BASE_URL` / `OPENAI_API_KEY` 接入 |
| 校验 | Zod | 接口入参 / AI 输出 schema 校验 |
| 测试 | Vitest | 单元 / API 集成分层 |

> `nuxt.config.ts` 将 `srcDir` / `rootDir` 显式限定为 `server/` 根，避免 Nuxt 向上扫描到 `../game-web` 的 `.vue` 文件。

---

## 🚀 快速开始

### 前置要求

- **Node.js** ≥ 18（建议 20+）
- **pnpm** 11（`corepack enable` 后按 `packageManager` 字段锁定）
- **Docker**（运行本地 PostgreSQL，见 [`../docker-compose.yml`](../docker-compose.yml)）
- 一个 **硅基流动（SiliconFlow）** API Key：<https://cloud.siliconflow.cn>

### 1. 启动数据库

```bash
# 在仓库根目录执行：开发库 sw_game 映射 5534，测试库 sw_game_test 映射 5533
cd ..
docker compose up -d
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，至少填入 OPENAI_API_KEY；其余已有默认值
```

| 变量 | 说明 | 默认值 |
|---|---|---|
| `OPENAI_API_KEY` | SiliconFlow（OpenAI 兼容）API Key | 必填 |
| `OPENAI_BASE_URL` | LLM 网关地址 | `https://api.siliconflow.cn/v1` |
| `LLM_MODEL` | 默认模型 | `Qwen/Qwen3-8B` |
| `DATABASE_URL` | 数据库连接串 | `postgresql://sw_game:YOUR_DB_PASSWORD@localhost:5534/sw_game` |
| `ENABLE_BRIEFING` | 局势简报开关 | `true` |

> 敏感字段仅通过 Nuxt `runtimeConfig` 的非 public 字段注入（`nuxt.config.ts`），不会暴露到前端。

### 3. 安装依赖并启动

```bash
pnpm install
pnpm db:push      # 首次 / 修改 schema 后，将 Drizzle Schema 同步到数据库
pnpm dev          # 启动开发服务，默认 http://localhost:3000
```

---

## 🧪 常用命令

> ⚠️ 本目录是**独立 pnpm 工作区**，命令须在此目录执行。完整纪律见 [`../AGENTS.md`](../AGENTS.md)。

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动开发服务（3000） |
| `pnpm build` / `pnpm preview` | 生产构建 / 本地预览 |
| `pnpm typecheck` | `nuxt typecheck` 类型检查 |
| `pnpm lint` | ESLint + Stylelint |
| `pnpm test:unit` | 单元测试 |
| `pnpm test:api` | API 集成测试（使用 5533 测试库，数据隔离） |
| `pnpm db:push` | 推送 Schema 到数据库（改 `server/db/schema.ts` 后**必须**执行） |
| `pnpm db:generate` | 生成 Drizzle 迁移文件 |
| `pnpm db:studio` | 打开 Drizzle Studio |
| `pnpm check-models` | 检查可用 LLM 模型（`server/scripts/check-models.ts`） |

### 提交前检查

修改代码后须通过：`pnpm typecheck` + `pnpm lint` + `pnpm test:unit`；动接口后补 `pnpm test:api`；发版前跑 `pnpm build`。

---

## 🔌 API 概览

核心接口位于 [`server/api/game/`](./server/api/game/)，完整定义见 [`../docs/API.md`](../docs/API.md)：

| 方法 & 路径 | 说明 |
|---|---|
| `POST /api/game/init-factions` | 初始化势力（LLM 生成，失败回退 6 个预置势力） |
| `POST /api/game/generate-event` | 生成本回合事件（三层触发：挂起剧情链 > 时间窗口 > LLM 生成） |
| `POST /api/game/resolve-decision` | 结算玩家决策，应用属性 / 资源 effects |
| `POST /api/game/npc-actions` | 活跃势力 AI 自主行动 |
| `POST /api/game/advisor-briefing` | 军师局势简报 |
| `POST /api/game/advisor-chat` | 军师自由对话 |
| `POST /api/game/sync-save` | 云端存档同步 |

### 目录结构

```
server/
├── server/
│   ├── api/game/      # 7 个核心 HTTP 接口
│   ├── db/            # Drizzle Schema 与查询（schema 唯一来源见 ../docs/db-schema.md）
│   ├── runtime/       # 兜底数据：fallback-factions / fallback-events / story-chains
│   ├── tools/         # Agent 工具（init-factions / npc 等）
│   ├── middleware/    # 频率限制、并发锁等
│   ├── config/        # 运行时配置
│   ├── utils/         # 通用工具
│   └── scripts/       # 脚本（如模型检查）
├── drizzle.config.ts  # drizzle-kit 配置
├── nuxt.config.ts     # Nuxt 配置（纯 API 服务）
└── .env.example       # 环境变量模板
```

---

## 📚 相关文档

- [`../docs/API.md`](../docs/API.md) — HTTP 接口定义（**唯一接口来源**）
- [`../docs/db-schema.md`](../docs/db-schema.md) — 数据库表结构（**唯一 Schema 来源**）
- [`../docs/game-design.md`](../docs/game-design.md) — 游戏设计文档（数值 / 势力 / 事件 / 结局）
- [`../docs/ai-cost.md`](../docs/ai-cost.md) — AI 调用成本约束
- [`../AGENTS.md`](../AGENTS.md) — AI 编程助手执行纪律（必读）
- [`../openspec/`](../openspec) — 需求 / 规格 / 变更 / 上线清单

---

## 🔐 数据安全与规范（要点）

- **防重复提交**：所有写操作入口须有并发守卫（标志位 / disabled / debounce），异步完成（成功 + 失败）后重置。
- **原子读写**：服务端优先用 `db.update().set().where()` / `INSERT ... ON CONFLICT`，避免 Read-Modify-Write 竞态。
- **密钥管理**：仅放 `.env` 或 `runtimeConfig` 非 public 字段，禁止暴露到前端。
- **文档同步**：改 `server/db/schema.ts` 须 `pnpm db:push` 并同步 `../docs/db-schema.md`；改接口须同步 `../docs/API.md`。
