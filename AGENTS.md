# AGENTS.md

金田：1851（jintian-1851）— 多子项目仓库，包含 `game-web/`（uni-app 前端，H5 + 微信小程序）和 `server/`（Nuxt 3 + Vercel AI SDK 后端）两个独立子项目（各自用 pnpm 管理，根目录非 pnpm workspace）。**项目业务架构、设计文档、任务清单等详见 `docs/` 与 `openspec/`，修改任何业务模块前必须先查阅对应文档。**

> 本文件只承载「跨工具通用的 AI 编程助手纪律」，与具体业务无关。项目特定的目录约定、命令、陷阱等由各子项目的 `package.json`、`docs/`、`openspec/` 提供，AI 助手在动手前应主动查阅。

## AI Agent 执行纪律

> ⚠️ **本章规则优先级最高**，所有 AI 编程助手（Trae、Cursor、Qoder、CodeBuddy 等）必须无条件遵守，不因任务简单而豁免。

### 强制验证规则

- **验证规则触发条件**：每次对任何 `.vue`、`.ts`、`.js` 文件执行编辑操作后，无论改动多小（包括仅修改注释、文案、CSS 类名、格式调整），任务结束前都必须在所在子项目目录运行 `pnpm lint`；涉及类型定义的变更必须额外运行 `pnpm typecheck`；核心逻辑变更必须额外运行 `pnpm test:unit`
- **禁止以改动简单为由跳过验证（硬性禁令）**：严禁以"改动太小不会出错""只改了一行""只是文案调整""只改了格式"等任何理由跳过验证步骤。任何代码变更都必须通过对应的验证命令，违反此规则视为严重执行失误
- **命令必须在对应子项目目录执行**：`game-web/` 和 `server/` 是两个独立的 pnpm 子项目，命令各自独立，禁止在仓库根目录直接运行 `pnpm dev`/`pnpm build`/`pnpm test`
- **pnpm 不可用时的兜底**：若运行环境无法使用 pnpm（例如 Windows 上因"不受信任挂载点"导致 corepack 按 `packageManager` 字段切换版本失败），可用 `npm install --no-package-lock` 安装依赖，并以 `npm run lint` / `npm run typecheck` / `npm run test:unit` 等价替代对应验证命令

### 多方案确认模式

- **多方案确认模式（强制）**：遇到多种技术实现路径、需求描述有模糊空间、需分步骤执行、或结束了需要我验证是否符合预期时，必须使用 `AskUserQuestion` 工具弹框列出 3-4 个清晰选项（注明推荐理由），最后一列选择一定是让用户主动输入方案，等待用户勾选回复后方可继续，严禁手写 checkbox 纯文本或直接编写完整代码结束对话

### 基本执行纪律

- **模型声明（强制）**：在每个任务或步骤的开始，**必须**声明模型信息，格式为：`模型：{名称} | 大小：{参数规模} | 类型：{模型类型} | 版本：{修订版本/更新日期}`。尽力声明已知信息，无法获取的字段标注"未知"。此要求不可协商，必须毫无例外地遵守
- **禁止未执行就标记完成**：每个操作必须实际执行并验证成功，才能标记完成。禁止基于假设或推断跳过执行步骤
- **关键操作必须验证**：每个有副作用的操作（启动服务、安装依赖、修改文件等）执行后必须验证结果，不能假设成功。验证方式取决于操作类型：检查退出码、检查终端输出无报错、检查服务是否可达等
- **交叉验证原则**：当工具返回的结果会影响后续决策时，必须用另一种工具交叉验证。例如：文件搜索工具说文件不存在时，用其他方式再确认；命令输出看似成功时，检查退出码是否为 0
- **文件存在性检查不能依赖单一搜索工具**：文件搜索工具对隐藏文件（以 `.` 开头）和目录的匹配可能不可靠，会返回空结果导致误判。当搜索工具报告文件不存在时，必须用其他方式（如直接路径检测、目录列表等）交叉确认
- **修改文件前重新读取**：距上次读取超过 3 条消息，或编辑操作连续失败 2 次，必须重新读取文件内容，禁止基于过时上下文继续操作
- **搜索无结果禁止单次下结论**：搜索代码内容或关键词无结果时，禁止直接判定"项目中没有此功能/代码"。必须换关键词、换正则表达式重试至少 1 次，或用目录列表交叉确认
- **大文件分批读取**：超过 500 行的文件，使用行号范围分批读取（如先读 1-200 行），避免一次性加载导致上下文丢失

### 反思与不确定性标注

> 以下规则仅在满足触发条件时生效，不影响日常简单任务效率。

- **苏格拉底式自我质询**：**修改核心逻辑（AI 调用链/数据库 Schema/状态机/流式处理）时**，必须扮演"对手"角色，对每个假设进行多轮自我辩驳，再给出最终方案
- **置信度评分**：**涉及多端兼容差异（H5 vs 微信小程序 vs 桌面浏览器）时**，推理的每一步必须给出高/中/低置信度评估，并说明理由
- **公开残余不确定性**：任务完成时，在最终报告中列出当前无法确认的信息、潜在风险及验证方法，用 `[不确定]` 标签格式便于扫描
- **多级对抗性深化**：**复杂改动提交前**，必须进行层层深化分析并交叉验证，用外部视角审查初稿中的每一点，核查矛盾和遗漏

## 文档查询规则（context7 MCP）

> 涉及下列「高频更新 / AI 相关」库的核心 API 时，**必须**先用 context7 MCP 拉取最新文档，禁止仅凭训练数据内置知识写代码。规则优先级同「AI Agent 执行纪律」。

### 强制查询的库

| 库 | Context7 ID | 触发场景 |
|---|---|---|
| Vercel AI SDK | `/vercel/ai` | `streamText` / `tool()` / `maxSteps` / `stopWhen` / `onFinish` / `onStepFinish` / 多模态 content parts / provider 配置 / `stepCountIs` |
| Nuxt 3 | `/websites/nuxt_3_x` | `useFetch` / `useAsyncData` / `defineEventHandler` / `runtimeConfig` / SSR 相关 API / 路由约定 / Nitro |
| Drizzle ORM | `/drizzle-team/drizzle-orm-docs` | `schema` 定义 / `db.select/insert/update/delete` / 关联查询 / `drizzle-kit` 配置 / 迁移 |
| uni-app | 需 `resolve-library-id` 查询 | `@dcloudio/uni-app` 跨端 API / `uni.request` / `pages.json` / `manifest.json` / 条件编译 / 平台差异 |

### 调用流程

1. 先用 `resolve-library-id` 拿库 ID（上表已知 ID 可跳过此步，直接进入第 2 步）
2. 再用 `query-docs` 查具体 API，`query` 参数必须聚焦单一概念（如 "streamText tool calling maxSteps"），不要一次问多个不相关主题
3. 每个工具每个问题最多调用 3 次；若 3 次仍查不到所需信息，回退到内置知识 + WebSearch 兜底
4. 调用结果须与项目现有代码交叉对照，避免引入与项目版本不兼容的 API

### 例外（可不调用）

- 修改业务逻辑、CSS、文案、组件模板结构等与上述库 API 无关的任务
- 上述库的 Vue 模板基础语法（`ref`、`computed`、`watch`、`v-if`/`v-for` 等）等稳定 API
- 已在项目代码中有大量同类用法可参照时

### 注意事项

- Vercel AI SDK 有多个版本（`ai_5_0_0`、`ai_6.0.0-beta` 等），如项目 `package.json` 锁定具体版本，用 `/vercel/ai/<version>` 形式查询（如 `/vercel/ai/ai_5_0_0`）
- Drizzle ORM 优先用 `/drizzle-team/drizzle-orm-docs`（官方文档源），避免用社区镜像
- context7 库 ID 偶有失效，如查询返回空，重新 `resolve-library-id` 获取新 ID

## 代码规范

- Vue 组件：`<script setup lang="ts">`，禁止 Options API
- 文件名：kebab-case（`game-main/index.vue`、`advisor-chat.ts`）
- 组件名：PascalCase（`EventCard`、`FactionCard`）
- 常量：UPPER_SNAKE_CASE（`MAX_STEPS`）
- 数据库列：snake_case（`created_at`、`session_id`）
- 前端 API 调用：`game-web` 用 uni-app 的 `uni.request`（封装在 `src/utils/api.ts`）；`server` 内部用 Nuxt 的 `$fetch` / `useFetch`，禁止原生 `fetch`
- 注释规则：复杂逻辑、非显而易见的业务约束、容易踩坑的地方**必须加中文注释**；简单自解释的代码不需要注释

## SSR 水合规则（适用于 server 子项目）

Nuxt 3 使用 SSR，服务端和客户端必须渲染出相同的 HTML，否则产生水合不匹配（Hydration Mismatch）警告或错误。以下规则防止此类问题：

- **禁止在模板或 computed 中使用不确定值**：`Date.now()`、`new Date()`、`Math.random()`、`crypto.randomUUID()` 等在 SSR 和客户端会产生不同结果，必须放在 `onMounted` 内或用 `<ClientOnly>` 包裹
- **浏览器 API 必须守卫**：`window`、`document`、`navigator`、`localStorage` 等仅在客户端存在，访问前必须用 `import.meta.client` 或 `process.client` 守卫，或放在 `onMounted` 内
- **客户端条件渲染用 `<ClientOnly>`**：依赖浏览器 API 或客户端状态的组件（如地图、图表、富文本编辑器）必须用 `<ClientOnly>` 包裹，或使用 `client:only` 指令跳过 SSR
- **ref 初始值必须 SSR 安全**：`ref()` 的初始值在 SSR 和客户端必须一致。需要客户端才能确定的值（如屏幕宽度、用户偏好），应在 `onMounted` 中延迟赋值，初始值用安全的默认值
- **禁止 onMounted 后直接修改 SSR 渲染的 DOM**：`onMounted` 中直接操作 DOM（如 `createElement`、`replaceChild`）会破坏 Vue 的水合节点匹配。如需动态渲染，用 `<ClientOnly>` 包裹整个区域

> `game-web` 是 uni-app 项目（非 SSR），不适用本章；但若引入 SSR 渲染模式（`dev:h5:ssr` / `build:h5:ssr`），同样需要遵守。

## 测试策略

- 每次提交前必须通过对应子项目的 `pnpm typecheck` + `pnpm lint` + `pnpm test:unit`；修改渲染或交互逻辑后跑 `pnpm test:e2e`（仅 `game-web` 有 Playwright）或 `pnpm test:api`（仅 `server` 有 API 测试），发版前跑 `pnpm build`
- 修改核心逻辑时必须补充对应的单元测试
- **修改业务逻辑后必须进行测试**：测试失败时先判断根因再行动
  - 预期内的行为变更 → 同步更新测试用例
  - 意外的回归（测试作为安全网抓住了 bug） → 修复代码，不改测试
- **修改 `server/server/db/schema.ts` 后必须运行 `pnpm db:push`**（在 `server/` 目录），并同步更新 `docs/db-schema.md`（表结构唯一文档来源，禁止代码与文档脱节）
- **修改 HTTP 接口（入参/返回值/业务逻辑）后必须同步更新 `docs/API.md`**（接口定义唯一文档来源，禁止代码与文档脱节）

## 数据安全规则

- **异步写操作必须防重复提交**：任何修改数据的异步操作（API 路由、HTTP 请求、数据库写入），入口必须有守卫阻止并发重复调用，异步完成后（success + fail 分支）必须重置守卫。实现方式因场景而异：标志位 / disabled 属性 / debounce 均可
- **服务端数据库避免 Read-Modify-Write**：先查后改的模式存在竞态窗口。优先使用原子操作（如 `UPDATE ... WHERE`、Drizzle 的 `db.update().set().where()`、`INSERT ... ON CONFLICT`），除非业务逻辑必须基于旧值做判断
- **多数据源同步注意一致性**：同一数据写入多个存储时，确保所有路径以相同顺序写入，避免旧数据覆盖新数据
- **密钥只能放在 `runtimeConfig` 的非 public 字段或 `.env` 文件中**，禁止暴露到前端；前端所需的 token/密钥需通过后端代理

## 任务执行前置查阅

修改任何业务模块前，AI 助手必须先查阅以下文档，避免破坏既有设计约定：

- `docs/game-design.md` — 游戏设计文档
- `docs/db-schema.md` — 数据库表结构
- `docs/API.md` — HTTP 接口定义
- `docs/ai-cost.md` — AI 调用成本约束
- `openspec/changes/` — 各功能模块的 spec / design / tasks
- `openspec/pre-launch-checklist.md` — 上线前检查清单
- 各子项目的 `package.json` — 实际可用命令与依赖版本
