import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E 配置（金田：1851 H5 端）
 *
 * 端口策略：
 *   uni-app H5 默认端口 5173，但当前环境 5173-5175 被其他 dev server 占用。
 *   固定用 5180 + strictPort 避免端口漂移导致 Playwright webServer url 匹配失败。
 *   不修改 vite.config.ts（保持用户开发端口不变），通过命令行 --port 透传给 Vite。
 *
 * webServer：
 *   - reuseExistingServer: true 允许复用已启动的 dev server（用户可先 pnpm dev:h5 启动）
 *   - timeout: 120000（uni-app 首次编译较慢）
 *
 * 测试范围：
 *   仅扫描 tests/e2e 目录（.spec.ts），与 vitest 的 tests/unit + tests/component 隔离。
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // uni-app H5 dev server 单进程，避免并发编译冲突
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // 单 worker，dev server 编译按需，并发会触发重复编译
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5180',
    trace: 'on-first-retry',
    actionTimeout: 10_000,
    // uni-app H5 按需编译，首次访问页面可能需 10-30s
    navigationTimeout: 60_000
  },
  expect: {
    timeout: 30_000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    // PLAYWRIGHT_E2E=1 让 vite.config.ts 固定端口 5180 + strictPort
    // （uni 命令不透传 --port 给 Vite，改用环境变量 + vite.config.ts 条件配置）
    command: 'pnpm dev:h5',
    url: 'http://localhost:5180',
    reuseExistingServer: true,
    timeout: 120_000,
    env: { PLAYWRIGHT_E2E: '1' },
    stdout: 'pipe',
    stderr: 'pipe'
  }
})
