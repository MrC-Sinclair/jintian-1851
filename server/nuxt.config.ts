/**
 * @file Nuxt3 后端服务配置
 *
 * GAME 项目后端是纯 API 服务（不渲染前端页面），复用 my-chat 的 LLM/DB 技术栈。
 *
 * 关键配置说明：
 *   - srcDir: '.' 限定工程根，避免 Nuxt 向上扫描到 game-web/ 的 .vue 文件
 *   - components: false 关闭自动组件注册（纯 API 服务不需要）
 *   - pages: false 关闭 pages/ 目录扫描（不需要页面路由）
 *   - runtimeConfig 注入 LLM/DB 凭据，敏感字段不放 public
 */

export default defineNuxtConfig({
  // 兼容性日期：决定 Nuxt 特性的默认行为
  compatibilityDate: '2026-07-15',

  // 后端纯 API 服务，不需要 devtools
  devtools: { enabled: false },

  // ⚠️ 评审补充 2026-07-20：srcDir 限定
  // Nuxt3 默认 srcDir 为工程根，会扫描 .vue 文件作为页面/组件
  // 由于 server/ 与 game-web/ 同仓库，必须显式限定避免冲突
  srcDir: '.',
  rootDir: '.',

  // 后端纯 API 服务，不需要自动注册组件
  components: false,

  // 不启用 pages/ 目录扫描（API 路由走 server/api/）
  pages: false,

  // 运行时配置：敏感字段（非 public）仅服务端可用
  // 环境变量优先级：NUXT_OPENAI_API_KEY > runtimeConfig.openaiApiKey
  runtimeConfig: {
    // LLM Provider 配置（硅基流动 SiliconFlow）
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.siliconflow.cn/v1',
    llmModel: process.env.LLM_MODEL || 'Qwen/Qwen3-8B',

    // 数据库连接（PostgreSQL 18，端口 5534 避开 my-chat 的 5434）
    // ⚠️ 凭据仅来自 .env 的 DATABASE_URL，不写带真实密码的硬编码兜底
    databaseUrl:
      process.env.DATABASE_URL ||
      'postgresql://sw_game:CHANGE_ME@localhost:5534/sw_game',

    // 局势简报开关（T1.14）：默认 true，可通过 ENABLE_BRIEFING=false 关闭
    enableBriefing: process.env.ENABLE_BRIEFING !== 'false'
  }
})
