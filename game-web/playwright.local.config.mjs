// 临时 E2E 配置：复用已安装的 chromium-1234（完整 chrome.exe），
// 绕过 @playwright/test@1.61.1 对 chromium_headless_shell-1228 的版本校验。
// 跑完即删除，不改动项目原有 playwright.config.ts。
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5180',
    headless: true,
    launchOptions: {
      executablePath: 'D:/code/nvm4w/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
    },
    trace: 'on-first-retry',
    actionTimeout: 10_000,
    navigationTimeout: 60_000,
  },
  expect: {
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev:h5',
    url: 'http://localhost:5180',
    reuseExistingServer: true,
    timeout: 120_000,
    env: { PLAYWRIGHT_E2E: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
