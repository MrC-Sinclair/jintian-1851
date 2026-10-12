import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'

/**
 * 跨项目 import 的转换前提。
 *
 * tests/unit 的三个镜像守卫用例（mirror-consistency / sim-chain-mirror / story-chains-meta）
 * 会 `import '../../../server/server/runtime/story-chains'`。vite 转换该文件时是按**文件所在位置**
 * 去找 tsconfig 的，于是命中 server/tsconfig.json，而它 `extends ./.nuxt/tsconfig.json`——
 * 那是 `nuxi prepare` 的生成物、被 gitignore。只有跑过 server 的 dev / typecheck 的机器上才有它。
 * 全新 checkout 与 CI 的 game-web job（不装 server 依赖）都没有，结果三个用例以
 * TSConfckParseError 整文件挂掉，且**本地永远复现不出来**。
 *
 * 只在缺失时写最小桩：`nuxi prepare` 生成的完整版存在时直接返回，不覆盖真实产物。
 * 桩只用于满足 esbuild 的 extends 解析，不参与类型检查（typecheck 由 server 子项目自己跑）。
 */
const serverDir = resolve(__dirname, '../../server')
const nuxtDir = resolve(serverDir, '.nuxt')
const stubPath = resolve(nuxtDir, 'tsconfig.json')

export default function setup(): void {
  // server 子项目不存在时什么都不做，避免在仓库外凭空造目录
  if (!existsSync(serverDir) || existsSync(stubPath)) return
  mkdirSync(nuxtDir, { recursive: true })
  writeFileSync(stubPath, '{\n  "compilerOptions": {}\n}\n', 'utf8')
}
