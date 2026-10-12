import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// uni-app Vue3 CLI 工程的 Vitest 配置
// 参考 my-chat/vitest.config.ts，移除 unplugin-auto-import（uni-app 不用自动导入）
export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    // E2E 测试由 Playwright 运行（playwright.config.ts），vitest 不扫描
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 70,
        functions: 65,
        branches: 60
      }
    },
    setupFiles: ['./tests/setup.ts'],
    // 见 tests/global-setup.ts：镜像守卫用例跨项目 import server 的 .ts，
    // 转换时需要 server/.nuxt/tsconfig.json 存在，否则整文件 TSConfckParseError
    globalSetup: ['./tests/global-setup.ts']
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '~': resolve(__dirname, 'src')
    }
  }
})
