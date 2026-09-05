/**
 * @file E2E 测试模式开关（服务端后门防护）
 *
 * x-e2e-test-mode 请求头原本仅凭头部切换（放大/压缩 effects、压步数），
 * 生产环境任何人可伪造触发。现统一收口：非生产环境（dev/test）且头部为 1 才生效，
 * 生产环境（NODE_ENV=production）恒为 false，防止后门被滥用。
 *
 * 用法：调用点先自行 getHeader(event, 'x-e2e-test-mode') 取值再传入
 * （与项目惯例一致：h3 helper 走 Nitro 自动导入，测试经 tests/setup.ts 的 globalThis mock 提供）。
 */

/**
 * 判断 E2E 测试模式是否生效
 * @param headerValue 请求头 x-e2e-test-mode 的原始值（可为 undefined）
 */
export function isE2eTestMode(headerValue: unknown): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return headerValue === '1'
}
