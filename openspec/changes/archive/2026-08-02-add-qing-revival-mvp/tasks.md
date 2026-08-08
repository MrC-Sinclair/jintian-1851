# 任务拆分 — 乱世抉择：1851 MVP

任务按依赖关系排序，每阶段完成后必须通过对应验证命令才能进入下一阶段。所有代码任务结束前必须运行 `pnpm lint` + `pnpm typecheck`，数据库 schema 变更必须 `pnpm db:push`，多端兼容任务必须 H5+小程序双端验证。

## 阶段 1：基础脚手架与基础设施

### T1.1 创建 uni-app Vue3 CLI 前端工程

- 在 `d:\code\codeWork\GAME\game-web\` 用 `npx degit dcloudio/uni-preset-vue#vite-ts .` 创建 Vue3+TS 工程（**禁止** `pnpm create vite`，后者不含 uni-app 编译器/运行时，无法构建小程序）
- 配置 `src/pages.json` 注册 4 个页面（`index`、`character-create`、`game-main`、`settings`）
- 配置 `src/manifest.json` 三端入口（H5/微信小程序/App）
- `vite.config.ts` 已集成 `@dcloudio/vite-plugin-uni`（模板自带），无需额外配置
- **验证**：`pnpm install && pnpm dev:h5` 启动后浏览器显示「乱世抉择：1851」标题；`pnpm build:mp-weixin` 产物可被微信开发者工具加载

### T1.0 部署前置准备（域名 / HTTPS / Nginx）—— ⚠️ 已推迟到阶段 8（T8.0）

> 📌 **评审调整 2026-07-20**：本任务原在阶段 1，会阻塞 T2.11 SSE 兼容性预验证。MVP 开发期统一用 `localhost` + 微信开发者工具「不校验合法域名」绕过，**阶段 1-7 跳过本任务**，上线前在阶段 8 新增 T8.0 执行。下方内容保留作为 T8.0 实施参考。

> ⚠️ **微信小程序生产环境强制 HTTPS** + **iOS 微信 chunked 必须 Nginx 不缓冲**——这是独立于代码之外的部署前置任务，**建议在 T1.2 之前完成**（T2.11 SSE 兼容性预验证需要真机访问 HTTPS 后端）。开发期可使用 `*.dev` 自签名证书 + 微信开发者工具勾选「不校验合法域名」绕过。

- **购买 + 备案域名**（如 `api.qing-revival.example.com`）：国内服务器必须备案，海外服务器可跳过但**小程序仍需 HTTPS**
- **申请 SSL 证书**：Let's Encrypt（免费，自动续签）或云厂商免费证书
- **Nginx 反向代理配置**（关键）：
  ```nginx
  location /api/chat {
      proxy_pass http://127.0.0.1:3000;  # Nuxt3 监听 3000
      proxy_http_version 1.1;
      proxy_buffering off;              # 关键：SSE 必须关闭缓冲
      proxy_cache off;                   # 关键：禁止缓存 SSE 响应
      proxy_set_header Connection '';    # 关键：禁用 keep-alive 改 chunked
      proxy_set_header X-Accel-Buffering no;  # 关键：双重保险
      proxy_read_timeout 65s;            # 大于 AI 调用超时 60s
      chunked_transfer_encoding on;      # 关键：开启分块传输
  }
  ```
- **开发期绕过**：微信开发者工具 → 详情 → 「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」（**仅开发用**）
- **生产期微信小程序后台**配置 request 合法域名：`https://api.qing-revival.example.com`
- **验证**：
  - `curl -I https://api.qing-revival.example.com/health` 返回 200
  - `curl -N https://api.qing-revival.example.com/api/game/advisor-chat?probe=1` 立即收到首个 chunk（`<1s`）
  - 微信开发者工具请求 backend 成功
  - 真机 iOS 微信可访问 backend

### T1.2 配置前端工具链

- 安装 ESLint + Prettier + Stylelint + Vitest，配置文件参考 `d:\code\codeWork\my-chat\`
- `package.json` 添加 scripts：`lint`、`lint:fix`、`format`、`typecheck`、`test`、`test:unit`、`dev:h5`、`dev:mp-weixin`、`build:h5`、`build:mp-weixin`
- **验证**：`pnpm lint` 退出码 0；`pnpm typecheck` 通过；`pnpm test:unit` 通过空测试

### T1.3 创建 server/ Nuxt3 后端工程

- 在 `d:\code\codeWork\GAME\server\` 用 `pnpm dlx nuxi@latest init` 创建 Nuxt3 工程（`pnpm dlx` 确保用项目内 `nuxi` 版本，不污染全局）
- **不**使用全局 `nuxi init`（Nuxt 4 起 `nuxi` CLI 包名变更，全局命令可能装错版本）
- 复用 my-chat 依赖：`ai@^5`、`@ai-sdk/openai@^2`、`drizzle-orm@^0.36`、`postgres@^3.4`、`zod@^3.25`
- 配置 `nuxt.config.ts` runtimeConfig（openaiApiKey、openaiBaseUrl、llmModel、databaseUrl）
- **⚠️ 评审补充 2026-07-20：Nuxt3 `srcDir` 限定**：Nuxt3 默认 `srcDir` 为工程根，会扫描 `.vue` 文件作为页面/组件。由于 `server/` 与 `game-web/` 同仓库，必须在 `server/nuxt.config.ts` 显式配置：
  ```ts
  export default defineNuxtConfig({
    srcDir: '.',          // 限定 server/ 工程根，不向上扫描到 game-web/
    rootDir: __dirname,   // 明确工程根
    components: false,    // Nuxt3 后端纯 API 服务，不需要自动注册组件
    pages: false,         // 不启用 pages/ 目录扫描
    app: { rootDir: false }  // 禁用 app/ 目录
  })
  ```
  **T1.3 跑 demo 验证**：创建后 `pnpm dev` 启动，确认 `localhost:3000` 正常且终端无「Found .vue file in game-web/」类警告。若仍冲突，回退用 `nitropack/cli` 独立启动（与 my-chat 结构偏离但避免冲突）—— 此回退需在 design.md D2 补说明
- 复制并调整 `.env.example`
- **验证**：`cd server && pnpm install && pnpm dev` 在 `localhost:3000` 启动，根路由返回 `{"ok":true}`

### T1.4 配置 docker-compose.yml

- 在 `d:\code\codeWork\GAME\docker-compose.yml` 配置 PostgreSQL 18 端口 5534
- 用户 `sw_game` / 密码 `YOUR_DB_PASSWORD` / 数据库 `sw_game`
- **验证**：`docker compose up -d` 启动；`docker compose ps` healthy；`psql` 可连接

### T1.5 实现 server/config/models.ts

- **严格按 my-chat `server/config/models.ts` 复制**（不是按"展示名"简化）：
  - `Qwen3-8B` → `value: 'Qwen/Qwen3-8B'`，capabilities `{ vision: false, deepThinking: true, toggleableThinking: true, toolCalling: true }`
  - `DeepSeek-R1-0528-Qwen3-8B` → `value: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B'`，capabilities `{ vision: false, deepThinking: true, toggleableThinking: false, toolCalling: false }`
  - `GLM-Z1-9B-0414` → `value: 'THUDM/GLM-Z1-9B-0414'`（**不是 zai-org/**），capabilities `{ vision: false, deepThinking: true, toggleableThinking: false, toolCalling: false }`
  - `Qwen3.5-4B` → `value: 'Qwen/Qwen3.5-4B'`，capabilities `{ vision: true, deepThinking: true, toggleableThinking: true, toolCalling: true }`
- 同步复制 my-chat 的 `ModelCapabilities` interface、`AVAILABLE_MODELS` 数组、`ALLOWED_MODEL_VALUES` Set、`getModelCapabilities()` 函数
- **新增验证脚本** `server/scripts/check-models.ts`：
  - 调用 `GET /v1/models` 校验 4 个 modelId 都在返回列表中，缺失则 `process.exit(1)` 阻断后续任务
  - **新增 generateObject 冒烟测试**：对 `Qwen/Qwen3-8B` 发送一次 `generateObject()` 调用 + 简单 zod schema（如 `{ title: z.string(), value: z.number() }`），验证硅基流动返回可解析为合法 JSON。失败则 `process.exit(2)` 并输出错误详情（此测试验证 `providerOptions: { openai: { structuredOutputs: false } }` 在硅基流动上的可用性，因 my-chat 未使用 generateObject，需提前验证）
- **新增 `server/utils/siliconflow-fetch.ts`**（评审补充 2026-07-20：原提案说"暂不引入 reasoning-provider.ts"，但 T2.13 又要"注入 enable_thinking: false"——这是矛盾）。`@ai-sdk/openai v2` 的 `providerOptions` zod schema 严格校验**不支持透传 `enable_thinking`**（会被静默剥离，见 my-chat [reasoning-provider.ts#L191-L209](file:///d:/code/codeWork/my-chat/server/utils/reasoning-provider.ts#L191-L209)）。**必须**在 fetch 层注入请求体顶层字段。引入简化版 `siliconflow-fetch.ts`（**不**复用 my-chat 的 `reasoning-provider.ts`，因军师对话走 `enable_thinking: false` 不产生 reasoning_content，无需 reasoning_content → content 映射逻辑）：
  ```ts
  // server/utils/siliconflow-fetch.ts
  // 简化版 customFetch：仅做 enable_thinking 注入 + developer→system 角色修复
  // 不含 reasoning_content 处理（advisor-chat 走 enable_thinking:false 不产生 reasoning）
  import type { RequestInit, Response, RequestInfo } from 'undici'

  export function createSiliconFlowFetch(enableThinking?: boolean) {
    return async (url: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
      if (options?.body && typeof options.body === 'string') {
        try {
          const body = JSON.parse(options.body)
          // 1. developer → system 角色修复（硅基流动不支持 developer）
          if (Array.isArray(body.messages)) {
            for (const msg of body.messages) {
              if (msg.role === 'developer') msg.role = 'system'
            }
          }
          // 2. enable_thinking 注入（仅 toggleableThinking 模型传，调用方决定）
          if (enableThinking !== undefined) {
            body.enable_thinking = enableThinking
          }
          options = { ...options, body: JSON.stringify(body) }
        } catch { /* JSON 解析失败透传 */ }
      }
      return globalThis.fetch(url, options)
    }
  }
  ```
- **不复制** my-chat 的 `reasoning-provider.ts`（含 `REASONING_PREFIX`/`REASONING_END`/`reasoning_content` 处理逻辑）——GAME 项目军师走 `enable_thinking: false` 不产生 reasoning，事件/NPC/决策用 `generateObject` 也不展示 reasoning。后续若开启深度思考再引入完整版
- **验证**：`pnpm typecheck` 通过；`tests/unit/models.test.ts` 验证 4 模型存在与 capabilities 正确；`pnpm tsx server/scripts/check-models.ts` 退出码 0（含 generateObject 冒烟测试）

### T1.6 实现 server/db/schema.ts 与 game_saves 表

- 用 Drizzle 定义 `gameSaves` 表（id/saveId/deviceId/saveData/saveVersion/createdAt/updatedAt）
- 实现 `server/db/index.ts` 连接（postgres driver + Drizzle）
- 配置 `drizzle.config.ts`
- **验证**：`pnpm db:push` 成功；`\d game_saves` 显示完整字段；`pnpm typecheck` 通过

### T1.7 实现 game-web/src/utils/device-id.ts

- 实现 `getDeviceId()`：H5 用 `localStorage` + `crypto.randomUUID`；小程序与 App 用 `uni.getStorageSync('game_device_id')` 不存在时生成
- **验证**：`tests/unit/device-id.test.ts` mock 三端环境验证 UUID 格式；`pnpm typecheck` + `pnpm lint` 通过

### T1.8 实现 game-web/src/utils/storage.ts 与 stores/game.ts

- 实现 `useSaveSync().save/load/clear` 封装 `uni.setStorage`/`uni.getStorage`/`uni.removeStorage`
- 实现 Pinia store `useGameStore` 含 `currentSave` 状态
- 定义 `types/game.ts` 含 `GameSave`、`Faction`、`GameEvent`、`NpcAction`、`AdvisorMessage` 类型
- **验证**：`tests/unit/storage.test.ts` 覆盖 save/load/clear；`pnpm typecheck` 通过

### T1.9 阶段 1 全量验证

- 前端：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit`
- 后端：`cd server && pnpm lint && pnpm typecheck && pnpm test:unit`
- **验证**：所有命令退出码 0

## 阶段 2：后端 AI 路由与工具

### T2.1 实现 server/utils/ai-cache.ts

- 进程内 `Map<key, { result, expireAt }>`，`getCached(key)`/`setCached(key, result, ttlMs)`，TTL 默认 5 分钟
- **验证**：`tests/unit/ai-cache.test.ts` 覆盖命中/未命中/过期

### T2.2 实现 server/utils/concurrency-lock.ts

- `Map<saveId, Promise>` 锁，`acquireLock(saveId)`/`releaseLock(saveId)`，30 秒超时释放
- **验证**：`tests/unit/concurrency-lock.test.ts` 模拟并发验证只调一次

### T2.3 实现 server/utils/faction-summary.ts

- `compressFactions(factions)` 仅返回 `{ id, name, power, relationship, status }`
- **验证**：`tests/unit/faction-summary.test.ts` 验证 summary 字段被剔除

### T2.4 实现 server/runtime/fallback-events.ts

- 20 条预置事件，覆盖 5 类型各 4 条，每条含 `title/description/options(2-4)/effects`
- 导出 `getRandomFallbackEvent(type?: string)`
- **验证**：`tests/unit/fallback-events.test.ts` 验证总数 ≥ 20 与类型分布

### T2.5 实现 server/runtime/fallback-factions.ts

- 6 个预置势力（湘军、淮军、太平天国、清廷、北洋、革命党），按 `background` 调整推荐
- 导出 `getFallbackFactions(background)`
- **验证**：`tests/unit/fallback-factions.test.ts` 验证 5 类 background 均返回 6 势力

### T2.6 实现 server/utils/prompts/* 提示词模块

- 创建 `init-factions.ts`、`generate-event.ts`、`resolve-decision.ts`、`npc-actions.ts`、`advisor-chat.ts` 5 个模块
- 每模块导出纯函数返回字符串
- **验证**：`pnpm typecheck` 通过；`tests/unit/prompts.test.ts` 验证函数返回非空字符串且包含关键变量

### T2.7 实现 POST /api/game/init-factions

- zod 校验 body：`{ background: z.enum(['文官','武将','商贾','士绅','宗室']) }`
- **⚠️ 评审补充 2026-07-20：开局换 `Qwen/Qwen3-8B`**（原提案用 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`，但 R1 是强制思考模型，延迟 10-30 秒，玩家首次进入游戏就等 30 秒流失率高）。改用 `Qwen/Qwen3-8B` + `enable_thinking: true`（延迟 3-8 秒），通过 `siliconflow-fetch.ts` 的 `createSiliconFlowFetch(true)` 注入。`DeepSeek-R1` 留作后续「深度推演」可选功能（如玩家点击「请军师深度推演天下大势」按钮时调用）
- 调用 `Qwen/Qwen3-8B` + `generateObject()` 返回 `{ factions: Faction[] }`，超时设为 30s（与 T2.8/T2.9 一致）
- 前端 loading 文案「军师正在推演天下大势...」+ 显示进度（不能用 R1 的 60s 超时，玩家会流失）
- 失败降级 `fallback-factions.ts`，响应 header `X-Fallback: true`
- **验证**：`tests/api/init-factions.test.ts` 覆盖正常/参数错误/LLM 失败降级

### T2.8 实现 POST /api/game/generate-event

- zod 校验 body：`{ saveId, turn, stateSnapshot }`（不接收 playerDecision）
- 缓存键 `sha256(saveId + turn + sha256(stateSnapshot))`，命中直接返回（header `X-Cache: HIT`）
- 否则获取 `saveId` 锁，调用 `Qwen/Qwen3-8B` + `generateObject()` 返回含 2-4 个选项的事件（每个选项含预定义 effects）
- 首回合（turn=1）提示词注入"游戏开场"上下文（1851 年金田起义等历史背景）
- 失败重试 1 次后降级 `fallback-events.ts`
- 并发锁冲突返回 429 + CONCURRENT_REQUEST
- **验证**：`tests/api/generate-event.test.ts` 覆盖正常/缓存命中/参数错误/首回合特殊处理/并发锁/降级

### T2.9 实现 POST /api/game/resolve-decision

- zod 校验 body：`{ saveId, turn, playerDecision, stateSnapshot, event }`，playerDecision 非空且 ≤ 200 字
- 调用 `Qwen/Qwen3-8B` + `generateObject()` 返回 `{ effects }`
- 失败重试 1 次后降级返回默认效果 `{ military: -3, economy: -3, politics: -3, people: -3, diplomacy: -3 }`（header `X-Fallback: true`）
- 并发锁冲突返回 429 + CONCURRENT_REQUEST
- **验证**：`tests/api/resolve-decision.test.ts` 覆盖正常/参数错误/降级/并发锁

### T2.10 实现 server/middleware/rate-limit.ts 简易频率限制

- 进程内 `Map<deviceId, { count, resetAt }>`，按 deviceId 每分钟最多 10 次 AI 调用
- 超限返回 429 + `{ "ok": false, "error": { "code": "RATE_LIMITED", "message": "请求过于频繁，请稍后再试" } }`
- 仅对 `/api/game/` 下 AI 端点生效（init-factions、generate-event、resolve-decision、npc-actions、advisor-chat），sync-save 不限制
- **验证**：`tests/unit/rate-limit.test.ts` 覆盖正常/超限/重置

### T2.11 SSE 兼容性预验证（最小化 demo）

- 在 `game-web/` 创建临时 demo 页面，实现 H5 + 小程序端的最小化 SSE 调用
- H5 端：`fetch` + `ReadableStream` 测试流式响应
- **⚠️ 评审补充 2026-07-20：MVP 降级真机要求**（原要求"必须真机覆盖 iOS + Android + 微信开发者工具"门槛过高，MVP 阶段可能无真机条件）。MVP 阶段降级为：
  - **必须**：H5 浏览器 + 微信开发者工具双端验证（开发期足够）
  - **可选**：若有真机条件，追加 iOS 微信 + Android 微信真机测试
  - 真机完整覆盖合并到 T8.1（多端真机测试）阶段执行
- 小程序端：`uni.request({ enableChunked: true })` + `onChunkReceived` 测试
- 验证微信 8.0.56+ 版本的兼容性（iOS `onChunkReceived` 回调丢失问题已在 2025.02.18 稳定版修复）
- 若小程序开发者工具端不稳定，提前确认降级方案（非流式 或 仅 H5/App 端支持流式）
- **验证**：H5 + 微信开发者工具双端均能收到完整流式响应；**demo 验证完成后删除临时 demo 页面**（避免污染主工程）

### T2.12 实现 POST /api/game/npc-actions

- zod 校验 body：`{ saveId, turn, factions, stateSnapshot }`
- 过滤 `status === 'active'`，压缩为 4 字段
- 调用 `Qwen/Qwen3-8B` + `generateObject()` 返回 `{ actions: NpcAction[] }`
- 失败降级返回 `{ actions: [], fallback: true }`
- **验证**：`tests/api/npc-actions.test.ts` 覆盖正常/参数错误/降级/锁冲突

### T2.13 实现 POST /api/game/advisor-chat（SSE 流式）

- zod 校验 body：`{ saveId, turn, messages, stateSnapshot }`，最后一条 role === 'user'
- 截断 `messages` 保留最后 20 条
- 调用 `Qwen/Qwen3-8B` + `streamText()`（**注意：完整 vendor 前缀**）
- **providerOptions 必须设** `openai.structuredOutputs: false`（硅基流动不支持 strict 模式，参见 my-chat [chat.post.ts](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L530-L534)）
- **thinking 控制**：`getModelCapabilities('Qwen/Qwen3-8B').toggleableThinking === true` → 注入 `enable_thinking: false`（军师对话**不展示 reasoning**，避免破坏古风体验 + 节省 token；reasoning 阶段必须从流中过滤掉）
- **响应头**（Nitro 路由入口）：
  ```ts
  setResponseHeader(event, 'Content-Type', 'text/event-stream')
  setResponseHeader(event, 'Cache-Control', 'no-cache, no-transform')
  setResponseHeader(event, 'Connection', 'keep-alive')
  setResponseHeader(event, 'X-Accel-Buffering', 'no')  // 防 Nginx 缓冲
  ```
- **SSE 写入方式**（不走 `toUIMessageStreamResponse`，走自定义协议）：遍历 `result.fullStream`，仅取 `text-delta` 事件，**丢弃 `reasoning-delta` 事件**（R3 关键）
  ```ts
  for await (const chunk of result.fullStream) {
    if (chunk.type === 'text-delta') {
      await event.node.res.write(`data: ${JSON.stringify({ delta: chunk.text })}\n\n`)
    }
    // reasoning-delta / tool-call / finish / start 等全部跳过
  }
  await event.node.res.write('data: [DONE]\n\n')
  event.node.res.end()
  ```
- **错误处理**：LLM 异常时先发 `data: {"error":"AI_CALL_FAILED"}\n\n` 再 `event.node.res.end()`，**不** throw `createError`（否则破坏流式响应体）
- **并发锁冲突**：返回 429（**在响应头设置前**检查锁，避免写一半再 429）
- **onFinish**：保存完整 `assistant` 文本到 `save.advisorMessages`（注意是从 SSE 累加的完整文本，不是 chunk 片段）
- **验证**：`tests/api/advisor-chat.test.ts` 覆盖正常流式/参数错误/锁冲突/LLM 失败/reasoning 过滤

> **关键参考**：my-chat 的 [reasoning-provider.ts](file:///d:/code/codeWork/my-chat/server/utils/reasoning-provider.ts) 在 fetch 层把 `reasoning_content` 注入到 `text-delta` 的 `REASONING_PREFIX` 标记中。GAME 项目的 advisor-chat 既然要丢弃 reasoning，**两种实现任选其一**：
> - **方案 A（推荐，简单）**：advisor-chat 用 `Qwen/Qwen3-8B` + `enable_thinking: false`，LLM 根本不产生 reasoning，**无需 `reasoning-provider.ts`**，直接 `for await (const chunk of result.fullStream)` 即可
> - 方案 B：复用 my-chat 的 `reasoning-provider.ts`，在 `for await` 循环里检测 `REASONING_PREFIX`/`REASONING_END` 标记跳过 reasoning 段
>
> 选 A 即可（军师对话默认非思考），`reasoning-provider.ts` 暂不引入（GAME 项目无此需求）

### T2.14 实现 POST/GET /api/game/sync-save（服务端权威 updated_at 方案）

- **POST**（design D7 / spec cloud-sync 新版）：
  - zod schema 用 `.strict()` 模式（拒绝 `updatedAt` 字段，422 错误提示 `updatedAt is not allowed (server-authoritative)`）
  - 校验 `GameSave` 结构 + `saveId` UUID
  - Drizzle 用 `INSERT ... ON CONFLICT (save_id) DO UPDATE SET save_data = EXCLUDED.save_data, updated_at = NOW(), ended_at = EXCLUDED.ended_at, ended_reason = EXCLUDED.ended_reason`
  - **`updated_at` 强制服务端 `NOW()`**（不接受客户端值，DB 层生成）
  - 返回 `{ ok: true, data: { saveId, updatedAt: <server now>, endedAt, endedReason } }`
  - **不返回** 409 路径（服务端权威后无 race，POST 永远 200 OK）
- **GET**：query `saveId` UUID 校验，存在返回 `{ ok: true, data: { save: <GameSave> } }`，不存在返回 404 + `SAVE_NOT_FOUND`
- **验证**：`tests/api/sync-save.test.ts` 覆盖：
  - 首次上传 → 200 OK，DB 写入
  - 二次同 saveId 上传 → 200 OK，DB 覆盖
  - **两次 POST 间隔 < 100ms** → 两次都 200，最后一次写入的服务端时间为最终值（**用 Drizzle `returning()` 校验 DB 中 updated_at 是服务端时间**）
  - 客户端 body 携带 `updatedAt` 字段 → 422 校验错误（被 strict 模式拒绝）
  - 拉取存在/不存在/参数错误

### T2.15 阶段 2 全量验证

- `cd server && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:api`
- 确认 SSE 兼容性预验证通过（T2.11）
- **验证**：所有测试通过

## 阶段 3：前端基础页面与组件

### T3.1 实现 game-web/src/utils/api.ts 网络请求封装

- 封装 `request<T>(method, url, body?)` 基于 `uni.request` 统一三端
- 统一处理 `ok`/`error` 响应格式，失败抛错
- 自动注入 `x-device-id` header
- **验证**：`tests/unit/api.test.ts` mock `uni.request` 验证成功/失败场景

### T3.2 实现 composables/useSSE.ts 流式响应封装

- `useSSE()` 暴露 `connect(url, body, { onChunk, onDone, onError, firstChunkTimeoutMs? })` 方法
- **三端实现**：
  - H5：`fetch` + `ReadableStream`，按 `data: ` 前缀切分
  - 小程序/App：`uni.request({ enableChunked: true, responseType: 'arraybuffer' })` + `RequestTask.onChunkReceived`，用 `new TextDecoder('utf-8').decode(new Uint8Array(res.data))` 解码（**不用** `String.fromCharCode`，避免中文乱码）
- **跨 chunk 拼接**：维护 `lastText` 变量，按 `\n\n` 切分，**最后一段 JSON.parse 失败时保留到下次拼接**（D8 关键代码）
- **自动探测降级**（D8 R2）：
  - 启动时检查 `uni.getStorageSync('sse_chunked_available')`：未探测过且 `platform === 'ios' && uniPlatform === 'mp-weixin'` 时发探测请求
  - 探测超时 2000ms 内未收到首个 chunk → `requestTask.abort()`，标记 `_chunkedAvailable = false` 写入 storage
  - 探测成功 → `_chunkedAvailable = true`，后续请求 `firstChunkTimeoutMs = 3000ms`
  - `_chunkedAvailable === false` 时 `connect()` 自动在 URL 追加 `?stream=false`，改走非流式
- **首 chunk 超时**：默认 3000ms，超时触发 `onError('TIMEOUT')` 并 `requestTask.abort()`
- **验证**：`tests/unit/use-sse.test.ts` 模拟 H5/小程序/降级三路径，覆盖：
  - H5 fetch + ReadableStream 正常流
  - 小程序 chunked 正常流 + 跨 chunk 拼接
  - iOS 微信探测失败 → 降级到非流式
  - 探测成功缓存到 storage

### T3.3 实现 stores/game.ts 完整状态

- Pinia store 含 `currentSave`、`currentTurn`、`isProcessingTurn`、`isAdvisorStreaming`、`isSyncing` 状态
- actions：`setSave`、`updateState`、`appendEvent`、`appendAdvisorMessage`、`markEnded`
- **验证**：`tests/unit/game-store.test.ts` 覆盖 actions

### T3.4 实现 composables/useGameState/useTurn/useAdvisor/useSaveSync

- `useGameState`：initSave/save/load/clear
- `useTurn`：playTurn(playerDecision) 编排完整回合流程（决策→事件→状态演化→NPC→存档）
- `useAdvisor`：send(content) 调用 SSE 并追加消息到存档
- `useSaveSync`：sync() 时间戳策略合并 + 冲突处理
- **验证**：`tests/unit/use-turn.test.ts` mock API 验证流程编排

### T3.5 实现 components/ 基础组件

- `FactionCard.vue`：势力卡片，最小高度 96px，点击 active:scale-95
- `StatusPanel.vue`：5 维属性 + 4 资源面板，属性条高度 ≥ 12px
- `EventCard.vue`：事件卡片，含标题/描述/选项
- `DecisionButton.vue`：决策按钮，min-w/min-h 44px
- `TurnTimeline.vue`：最近 5 条历史事件标题
- `NpcActionList.vue`：NPC 行动列表，对玩家影响标红/标绿
- `AdvisorDrawer.vue`：右侧滑入抽屉 300ms
- **验证**：`pnpm lint` + `pnpm typecheck` 通过；`tests/component/*.test.ts` 渲染快照

### T3.6 实现首页 pages/index/index.vue

- 显示标题「乱世抉择：1851」
- 4 个按钮：「开始游戏」「继续游戏」「同步存档」「设置」
- 「开始游戏」检测本地存档存在时弹 `useConfirmDialog`
- 「继续游戏」无存档时禁用
- **验证**：H5 浏览器打开显示完整 UI；`pnpm lint` + `pnpm typecheck` 通过

### T3.7 阶段 3 全量验证

- `cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:component`
- H5 端 `pnpm dev:h5` 浏览器手动验证首页渲染
- **验证**：所有测试通过，UI 渲染无错

## 阶段 4：开局流程

### T4.1 实现 pages/character-create/index.vue

- 步骤 1：5 张身份卡片（文官/武将/商贾/士绅/宗室），点击高亮 + 下一步 enabled
- 步骤 2：调用 `POST /api/game/init-factions`，loading spinner，显示 AI 生成势力列表
- 步骤 3：势力卡片选择，点击弹 `useConfirmDialog` 确认
- 确认后调用 `useGameState().initSave()` 初始化存档并跳转 `game-main`
- **验证**：H5 端完整流程跑通；`tests/e2e/character-create.spec.ts` Playwright 覆盖

### T4.2 实现 useGameState().initSave() 存档初始化

- 构建 `GameSave` 对象（参考 design.md D6 结构）
- `saveId` = `crypto.randomUUID()` 或 `Date.now() + random`
- 起始 5 维属性 50 ± 身份偏移
- 起始资源 `{ silver: 1000, troops: 500, food: 800, reputation: 10 }`
- `state.date = { year: 1851, month: 1 }`、`turn = 1`
- 写入本地存储 + 更新 store
- **验证**：`tests/unit/use-game-state.test.ts` 验证存档结构与初始值

### T4.3 阶段 4 全量验证

- `cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e`
- H5 + 微信小程序双端验证：开局流程完整跑通
- **验证**：E2E 通过

## 阶段 5：回合主界面

### T5.1 实现 pages/game-main/index.vue 主界面布局

- 顶部：回合数 + 游戏内日期 + 同步按钮
- 中部：`StatusPanel` + `TurnTimeline`
- 事件区：`EventCard` 显示当前回合 AI 生成的事件（含标题、描述、2-4 个选项）
- 决策区：`DecisionButton` 渲染事件选项（点击后前端本地应用 effects）或「自由行动」按钮展开 textarea
- 底部：「咨询军师」按钮（可选，打开 `AdvisorDrawer`）+ 「确认决策」按钮
- 「下一回合」按钮（决策完成后显示，触发下一回合的 generate-event）
- **验证**：H5 渲染完整布局；`pnpm lint` + `pnpm typecheck` 通过

### T5.2 实现 useTurn 完整回合循环

- `startTurn()` 编排回合开始：
  1. 调用 `POST /api/game/generate-event`（仅传局势快照，不传玩家决策）→ 返回事件含 2-4 个选项
  2. 渲染 `EventCard` 展示事件
- `makeDecision(optionId?)` 编排玩家决策：
  1. 若 optionId 存在：从事件选项中取对应 effects，前端直接应用（不调 API）
  2. 若为自由输入：调用 `POST /api/game/resolve-decision` → 返回 effects
- `endTurn()` 编排回合结束：
  1. 调用 `POST /api/game/npc-actions`
  2. 应用 NPC effects 到 state
  3. `state.turn +1`、`date.month +1`（溢出则 year +1）
  4. 写入本地存档 + 更新 store
  5. 检查结局条件
- 整个流程显示阶段 spinner：「事件生成中」「判定中」「NPC 行动中」
- 任一步失败降级不阻断
- **验证**：`tests/unit/use-turn.test.ts` mock API 验证流程与降级

### T5.3 实现状态演化与属性变化动画

- `StatusPanel` 监听 `attributes` 变化，数字滚动到新值
- 属性条颜色短暂闪烁（绿色↑、红色↓）300ms
- 资源数字同步动画
- **验证**：H5 浏览器手动验证动画效果

### T5.4 实现结局判定

- `checkEndConditions(save)` 返回 `'continue' | 'military_collapse' | 'economy_collapse' | 'politics_collapse' | 'people_collapse' | 'diplomacy_collapse' | 'victory' | 'time_up'`
- 5 维属性任一 ≤ 0 触发对应崩溃
- 综合实力 ≥ 90 触发胜利
- `date.year > 1912` 触发时光尽头
- 触发结局后 `save.ended = true`、跳转结局页面
- **验证**：`tests/unit/end-conditions.test.ts` 覆盖 8 个分支

### T5.5 实现结局页面

- 显示结局原因、存活年数、最终状态快照
- 按钮「返回首页」与「重新开始」
- 「重新开始」清空本地存档后跳转 `character-create`
- **验证**：H5 浏览器手动验证

### T5.6 阶段 5 全量验证

- `cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e`
- H5 + 微信小程序双端：完整一回合 + 触发结局
- **验证**：E2E 通过

## 阶段 6：军师对话

### T6.1 实现 AdvisorDrawer 抽屉组件

- 右侧滑入 300ms
- 顶部：关闭按钮（min-w/min-h 36px）+ 标题「军师对话」
- 中部：消息列表（user 右对齐、assistant 左对齐），流式逐字渲染
- 底部：textarea 自动增高 + 发送按钮（min-w/min-h 44px）
- 发送时 disabled + spinner
- **验证**：H5 浏览器手动验证抽屉动画与交互

### T6.2 实现 useAdvisor 流式对话逻辑

- `send(content)` 调用 `useSSE().connect('/api/game/advisor-chat', { saveId, turn, messages, stateSnapshot }, callbacks)`
- `onChunk(delta)` 追加到当前流式消息
- `onDone()` 把完整消息追加到 `save.advisorMessages`
- `onError()` 显示「军师沉默」占位
- `advisorMessages` 超过 20 条自动截断
- **验证**：`tests/unit/use-advisor.test.ts` mock SSE 验证流程

### T6.3 阶段 6 全量验证

- `cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit`
- H5 + 微信小程序双端：与军师对话 3 轮，验证流式与截断
- **验证**：流式响应正常，截断生效

## 阶段 7：存档同步

### T7.1 实现 pages/settings/index.vue 设置页面

- 「手动同步」按钮：触发 `useSaveSync().sync()`
- 「自动同步」开关：`uni.setStorage('auto_sync', bool)`
- 「清除本地存档」按钮：弹 `useConfirmDialog` 确认后 `useGameState().clear()`
- 「关于」：版本号与说明
- **验证**：H5 浏览器手动验证

### T7.2 实现 useSaveSync.sync() 同步策略（服务端权威方案）

- 调用 `GET /api/game/sync-save?saveId=xxx`
  - 404：自动 `POST` 上传本地存档（**body 不含 `updatedAt` 字段**），用服务端返回的 `updatedAt` 写回本地
  - 200：比较本地 `save.updatedAt` 与云端 `updatedAt`（`updatedAt` 是**毫秒数**或**ISO 字符串**，需统一 `new Date(...).getTime()` 后比较）：
    - `|local - cloud| < 1000ms`（1 秒误差）：toast「本地与云端已是最新」，**不发任何请求**
    - `local - cloud > 1000`：本地新 → `POST` 上传本地（不含 `updatedAt`），用服务端返回的 `updatedAt` 写回本地
    - `cloud - local > 1000`：云端新 → 弹 `useConfirmDialog`「云端存档较新（更新时间 X），是否拉取覆盖本地？」，确认后 `GET` 拉取并用返回的 `save` 完整覆盖本地存储
- 全程显示 loading（`isSyncing` 状态），禁止重复点击
- 失败 toast.error 不影响本地，**`isSyncing` 必须在 catch 中重置**
- **POST 失败重试**：`pnpm` 内的 `api.post()` 已经会处理；本 composable 只关心业务逻辑
- **验证**：`tests/unit/use-save-sync.test.ts` 覆盖 5 个分支 + `|差值| < 1000ms` 边界
  - mock api.get 404 → 触发 POST
  - mock 本地>云端 > 1 秒 → 触发 POST
  - mock 本地<云端 > 1 秒 → 弹 confirmDialog → 确认后 GET
  - mock `|差值| < 1000ms` → 不发请求，toast「已是最新」
  - mock POST 失败 → isSyncing 重置 + toast.error

### T7.3 实现自动同步

- `useTurn.playTurn()` 完成后检查 `uni.getStorage('auto_sync')`
- 为 true 时自动调用 `useSaveSync().sync()`（失败不阻断游戏）
- **验证**：`tests/unit/use-turn.test.ts` 验证 auto_sync 触发 sync

### T7.4 阶段 7 全量验证

- `cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e`
- H5 + 微信小程序双端：手动同步 + 自动同步验证
- **验证**：E2E 通过

## 阶段 8：多端验证与文档

### T8.0 部署前置准备（域名 / HTTPS / Nginx）—— 上线前必做

> 📌 本任务从 T1.0 推迟而来。MVP 开发期用 `localhost` + 微信开发者工具「不校验合法域名」绕过，**上线前必须完成本任务**，否则微信小程序生产环境无法访问后端、iOS 微信 SSE 流式会被中间代理缓冲。

- **购买 + 备案域名**（如 `api.qing-revival.example.com`）：国内服务器必须备案，海外服务器可跳过但**小程序仍需 HTTPS**
- **申请 SSL 证书**：Let's Encrypt（免费，自动续签）或云厂商免费证书
- **Nginx 反向代理配置**（关键）：
  ```nginx
  location /api/game {
      proxy_pass http://127.0.0.1:3000;  # Nuxt3 监听 3000
      proxy_http_version 1.1;
      proxy_buffering off;              # 关键：SSE 必须关闭缓冲
      proxy_cache off;                   # 关键：禁止缓存 SSE 响应
      proxy_set_header Connection '';    # 关键：禁用 keep-alive 改 chunked
      proxy_set_header X-Accel-Buffering no;  # 关键：双重保险
      proxy_read_timeout 65s;            # 大于 AI 调用超时 60s
      chunked_transfer_encoding on;      # 关键：开启分块传输
  }
  ```
- **微信小程序后台**配置 request 合法域名：`https://api.qing-revival.example.com`（生产期必须，开发期可勾选「不校验合法域名」绕过）
- **验证**：
  - `curl -I https://api.qing-revival.example.com/health` 返回 200
  - `curl -N https://api.qing-revival.example.com/api/game/advisor-chat -X POST -H "Content-Type: application/json" -d '{"saveId":"00000000-0000-4000-8000-000000000000","turn":1,"messages":[{"role":"user","content":"测试","turn":1,"timestamp":1}],"character":{"background":"文官","backgroundPerks":{},"factionId":"qing-ting","factionName":"清廷","factionSummary":"测试"},"stateSnapshot":{"turn":1,"date":{"year":1851,"month":1},"attributes":{"military":50,"economy":50,"politics":50,"people":50,"diplomacy":50},"resources":{"silver":1000,"troops":500,"food":800,"reputation":10}},"recentEvents":[]}'` 立即收到首个 chunk（`<1s`）
  - 微信开发者工具关闭「不校验合法域名」后请求 backend 成功
  - 真机 iOS 微信可访问 backend 且 SSE 流式正常

### T8.1 实现 H5 + 微信小程序 + App 三端真机测试

- H5：Chrome + Firefox + Safari 验证流式、动画、布局
- 微信小程序：iOS + Android 真机验证 `uni.request` chunked 流式（验证不同微信版本兼容性）
- App：Android APK 真机验证
- **验证**：每端至少 1 次完整开局→1 回合→同步流程

### T8.2 编写 docs/API.md

- 6 个游戏 API 路由规格（init-factions、generate-event、resolve-decision、npc-actions、advisor-chat、sync-save）
- 含请求/响应示例、错误码表
- **验证**：与 `server/api/game/` 实现完全对应

### T8.3 编写 docs/db-schema.md

- `game_saves` 表字段说明、索引、约束
- **验证**：与 `server/db/schema.ts` 一致

### T8.4 编写 docs/ai-cost.md

- token 成本与缓存策略说明
- 单回合预估成本表
- 降级策略说明
- **验证**：与 design.md 一致

### T8.5 编写 docs/game-design.md

- 游戏数值平衡：5 维属性、4 资源、身份偏移、起始值
- 势力列表与初始关系
- 5 类事件权重分布
- 结局判定规则
- **验证**：与 `fallback-events.ts`/`fallback-factions.ts` 实现一致

### T8.6 全量最终验证

- 前端：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:component && pnpm test:e2e`
- 后端：`cd server && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:api`
- 构建验证：`cd game-web && pnpm build:h5 && pnpm build:mp-weixin`
- **验证**：所有命令通过；H5 产物可部署；小程序产物可上传体验版
