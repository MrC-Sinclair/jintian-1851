import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

// https://vitejs.dev/config/
// H5 开发期通过 Vite proxy 将 /api 转发到 Nuxt3 后端（localhost:3000），
// 避免浏览器 CORS 拦截。生产期通过 Nginx 反向代理或同源部署。
//
// 端口策略：
//   - 默认 5173（uni-app H5 默认端口），允许 fallback 避免端口冲突阻断开发
//   - Playwright E2E 运行时（PLAYWRIGHT_E2E=1）固定 5180 + strictPort，
//     避免 dev server 端口漂移导致 webServer url 匹配失败
const isPlaywright = process.env.PLAYWRIGHT_E2E === '1'
export default defineConfig({
  plugins: [uni()],
  define: {
    // 注入 E2E 标志给前端运行时，用于在测试模式下给 API 请求附加 x-e2e-test-mode 头，
    // 触发后端 NPC 行动加速 / 自由行动强力负值兜底（仅 PLAYWRIGHT_E2E=1 时为真）。
    __E2E__: JSON.stringify(isPlaywright ? '1' : '0')
  },
  server: {
    port: isPlaywright ? 5180 : 5173,
    strictPort: isPlaywright,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
