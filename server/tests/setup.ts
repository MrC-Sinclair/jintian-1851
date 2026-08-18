import { vi } from 'vitest'

// Nuxt3 后端测试环境 mock：模拟 Nuxt 自动导入的全局 API
// 在 vitest 中无法使用 Nuxt 的自动导入，需要手动 mock
// 注意：Nuxt 的 .nuxt/types.d.ts 已声明这些全局类型，这里只赋值不重新声明

// mock useRuntimeConfig：返回与 nuxt.config.ts 一致的配置结构
;(globalThis as any).useRuntimeConfig = () => ({
  openaiApiKey: 'test-api-key',
  openaiBaseUrl: 'https://api.siliconflow.cn/v1',
  llmModel: 'Qwen/Qwen3-8B',
  databaseUrl: 'postgresql://test:test@localhost:5434/test',
  enableBriefing: true
})

// mock defineEventHandler：直接返回 handler
;(globalThis as any).defineEventHandler = (handler: unknown) => handler

// mock createError：返回标准 Error
;(globalThis as any).createError = (options: {
  statusCode?: number
  statusMessage?: string
  message?: string
  data?: unknown
}) => {
  const err = new Error(options.message || 'Unknown error') as Error & {
    statusCode?: number
    statusMessage?: string
    data?: unknown
  }
  err.statusCode = options.statusCode || 500
  err.statusMessage = options.statusMessage
  err.data = options.data
  return err
}

// mock readBody：返回空对象（具体测试用例可覆盖）
;(globalThis as any).readBody = vi.fn(async () => ({}))

// mock setResponseHeader / setResponseStatus / setHeader：空操作
;(globalThis as any).setResponseHeader = vi.fn()
;(globalThis as any).setResponseStatus = vi.fn()
;(globalThis as any).setHeader = vi.fn()

// mock getHeader：默认无特殊请求头（E2E 测试模式等由具体用例按需覆盖返回值）
;(globalThis as any).getHeader = vi.fn(() => undefined)

// mock getQuery / getRouterParam
;(globalThis as any).getQuery = vi.fn(() => ({}))
;(globalThis as any).getRouterParam = vi.fn(() => undefined)
