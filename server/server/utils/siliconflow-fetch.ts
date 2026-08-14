/**
 * @file 硅基流动 SiliconFlow 自定义 fetch
 *
 * 简化版 customFetch，仅做两件事：
 *   1. developer → system 角色修复（硅基流动不支持 developer 角色）
 *   2. enable_thinking 注入（在 fetch 层注入请求体顶层字段）
 *
 * 不复用 my-chat 的 reasoning-provider.ts：
 *   - 军师对话走 enable_thinking: false，不产生 reasoning_content
 *   - 事件/NPC/决策用 generateObject，不展示 reasoning
 *   - 后续若开启深度思考再引入完整版（含 reasoning_content → content 映射）
 *
 *  ⚠️ @ai-sdk/openai v2 的 providerOptions zod schema 严格校验不支持透传 enable_thinking
 *    （会被静默剥离），必须在 fetch 层注入请求体顶层字段
 */

// 使用 globalThis.fetch 的类型推断，避免显式引用 undici（Node 18+ 内置但 TS 默认不识别）
type FetchType = typeof globalThis.fetch

/**
 * 创建硅基流动自定义 fetch
 * @param enableThinking - 是否启用思考模式，undefined 表示不注入（让模型走默认行为）
 *                         仅对 toggleableThinking 模型生效（Qwen3-8B、Qwen3.5-4B）
 *                         强制思考模型（DeepSeek-R1、GLM-Z1）传了也会被忽略或报错
 */
export function createSiliconFlowFetch(enableThinking?: boolean): FetchType {
  return (async (url: Parameters<FetchType>[0], options?: Parameters<FetchType>[1]) => {
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
      } catch {
        // JSON 解析失败透传，不阻塞请求
      }
    }
    return globalThis.fetch(url, options)
  }) as FetchType
}
