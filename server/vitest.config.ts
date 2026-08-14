import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// Nuxt3 后端纯 API 服务的 Vitest 配置
// 纯 API 服务无 .vue 组件测试需求，移除 @vitejs/plugin-vue 避免 vite 版本类型冲突
// （Nuxt 3.21 内部用 vite 7，@vitejs/plugin-vue 5.x 依赖 vite 5，类型不兼容）
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 70,
        functions: 65,
        branches: 60
      }
    },
    setupFiles: ['./tests/setup.ts']
  },
  resolve: {
    alias: {
      '~': resolve(__dirname, '.'),
      '@': resolve(__dirname, '.'),
      '~~': resolve(__dirname, '.'),
      '@@': resolve(__dirname, '.')
    }
  }
})
