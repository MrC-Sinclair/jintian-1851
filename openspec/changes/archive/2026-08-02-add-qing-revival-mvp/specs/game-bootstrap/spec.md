# game-bootstrap — 项目脚手架与基础设施

## ADDED Requirements

### Requirement: uni-app Vue3 CLI 工程初始化

工程 MUST 使用 `npx degit dcloudio/uni-preset-vue#vite-ts` 创建（**禁止** `pnpm create vite`，后者不含 uni-app 编译器与运行时），使用 pnpm + Vite + TypeScript，支持 H5、微信小程序、App 三端构建。

#### Scenario: 首次安装依赖后可启动 H5 开发服务器

WHEN 开发者执行 `pnpm install` 后执行 `pnpm dev:h5`
THEN H5 开发服务器在 `localhost:5173` 启动
AND 浏览器打开首页 `pages/index/index.vue` 显示「乱世抉择：1851」标题
AND 控制台无 TypeScript 报错

#### Scenario: 微信小程序构建产物可被微信开发者工具加载

WHEN 开发者执行 `pnpm build:mp-weixin`
THEN `dist/build/mp-weixin/` 目录生成完整小程序产物
AND 用微信开发者工具打开后可正常预览首页

### Requirement: 后端服务骨架与 AI 模型配置

后端工程 MUST 复用 my-chat 的 `server/config/models.ts` 模型配置模式与 `chat.post.ts` 流式调用模式，集成 4 个 LLM 模型（API modelId 严格使用 vendor 前缀：`Qwen/Qwen3-8B` · `Qwen/Qwen3.5-4B` · `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` · `THUDM/GLM-Z1-9B-0414`）。

#### Scenario: 后端服务启动且模型配置可读

WHEN 开发者在 `server/` 目录执行 `pnpm dev`
THEN Nitro/Nuxt 服务在 `localhost:3000` 启动
AND `server/config/models.ts` 导出 `AVAILABLE_MODELS` 数组含 4 个模型
AND `runtimeConfig.openaiApiKey`、`runtimeConfig.openaiBaseUrl`、`runtimeConfig.llmModel` 已从 `.env` 注入

#### Scenario: 数据库连接与 schema 同步

WHEN 开发者执行 `docker compose up -d` 启动 PostgreSQL（端口 5534）
AND 执行 `pnpm db:push`
THEN `game_saves` 表在数据库中创建
AND 字段含 `id UUID PK`、`save_id UUID UNIQUE`、`device_id TEXT`、`save_data JSONB`、`save_version INT DEFAULT 1`、`created_at`、`updated_at`

### Requirement: 工具链与代码规范

工程 MUST 集成 ESLint + Prettier + Stylelint + Vitest，与 my-chat 工具链一致。

#### Scenario: 代码检查命令可用

WHEN 开发者执行 `pnpm lint`
THEN ESLint 与 Stylelint 同时运行
AND 退出码为 0 时无任何 error 与 warning

WHEN 开发者执行 `pnpm typecheck`
THEN `vue-tsc` 类型检查通过

WHEN 开发者执行 `pnpm test:unit`
THEN Vitest 运行所有 `*.test.ts` 单元测试
AND 全部通过

### Requirement: 环境变量配置模板

工程根目录与 `server/` 子目录 MUST 各提供 `.env.example`，列出所有必需环境变量。

#### Scenario: 复制 .env.example 后填写真实值可启动

WHEN 开发者将 `.env.example` 复制为 `.env`
AND 填入真实的 `OPENAI_API_KEY` 与 `DATABASE_URL`
THEN `pnpm dev` 可正常启动前端
AND `cd server && pnpm dev` 可正常启动后端
AND 后端可成功调用硅基流动 API

### Requirement: 设备指纹生成工具

前端 MUST 提供 `utils/device-id.ts` 在三端生成并持久化设备唯一标识。

#### Scenario: H5 首次启动生成并持久化 deviceId

WHEN 用户首次打开 H5 页面
THEN `crypto.randomUUID()` 生成 UUID
AND 写入 `localStorage` 键 `game_device_id`
AND 后续访问读取同一值

#### Scenario: 微信小程序首次启动生成并持久化 deviceId

WHEN 用户首次打开小程序
THEN `uni.getStorageSync('game_device_id')` 为空时生成 UUID
AND `uni.setStorageSync('game_device_id', uuid)` 持久化
AND 后续启动读取同一值

#### Scenario: App 端行为与小程序一致

WHEN 用户首次启动 App
THEN 行为与微信小程序场景一致
