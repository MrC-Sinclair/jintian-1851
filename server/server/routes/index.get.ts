/**
 * 根路由健康检查
 *
 * GET / 返回 {"ok":true}
 * 用于 T1.3 验证：cd server && pnpm dev 启动后访问 localhost:3000/
 */

export default defineEventHandler(() => {
  return { ok: true }
})
