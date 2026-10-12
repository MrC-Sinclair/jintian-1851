/**
 * @file 模拟底盘剧情链镜像 vs 服务端真值 的一致性测试（跨项目守卫）
 *
 * balance-sim 刻意**不 import** 服务端的 STORY_CHAINS，以保持「自包含存放、
 * 回归基线不随服务端内容漂移」的设计意图。但自包含的代价是镜像会烂掉——
 * 服务端改了某个节点的 effects，模拟会悄悄量出一个不再对应真实游戏的基线。
 *
 * 本测试就是那根警戒线：链结构或任一节点选项的 effects 漂移 → 测试红 →
 * 逼着人有意识地重新标定基线，而不是让 200 局的数字悄悄变质。
 *
 * 可行性同 mirror-consistency.test.ts：story-chains.ts 仅 `import type`，
 * type-only import 会被编译器擦除，无 server 运行时依赖泄漏进前端测试。
 */
import { describe, expect, it } from 'vitest'
import { STORY_CHAINS as SERVER_CHAINS } from '../../../server/server/runtime/story-chains'
import { SIM_CHAINS_FOR_TEST } from '../sim/balance-sim'

describe('模拟底盘剧情链镜像一致性（balance-sim SIM_CHAINS vs 服务端 STORY_CHAINS）', () => {
  it('链条数一致', () => {
    expect(SIM_CHAINS_FOR_TEST.length).toBe(SERVER_CHAINS.length)
  })

  it('每条链的 chainId / startYear / 节点数 / 前置链一致', () => {
    for (const server of SERVER_CHAINS) {
      const mirror = SIM_CHAINS_FOR_TEST.find((c) => c.chainId === server.chainId)
      expect(mirror, `模拟底盘缺少链 ${server.chainId}`).toBeDefined()
      if (!mirror) continue
      expect(mirror.startYear, `链 ${server.chainId} 锚点年份漂移`).toBe(server.startYear)
      expect(mirror.nodeCount, `链 ${server.chainId} 节点数漂移`).toBe(server.nodes.length)
      expect(mirror.nodes.length, `链 ${server.chainId} 镜像节点数组长度与 nodeCount 不符`).toBe(
        mirror.nodeCount
      )
      expect([...(mirror.prerequisiteChainIds ?? [])].sort()).toEqual([
        ...(server.prerequisiteChainIds ?? [])
      ].sort())
    }
  })

  it('每个节点每个选项的 effects 深比较一致（数值漂移必须显式结账）', () => {
    for (const server of SERVER_CHAINS) {
      const mirror = SIM_CHAINS_FOR_TEST.find((c) => c.chainId === server.chainId)
      if (!mirror) continue
      server.nodes.forEach((node, i) => {
        const mirrorNode = mirror.nodes[i]
        expect(mirrorNode, `链 ${server.chainId} 缺第 ${i + 1} 个节点`).toBeDefined()
        if (!mirrorNode) return
        expect(mirrorNode.length, `链 ${server.chainId} 第 ${i + 1} 节选项数漂移`).toBe(
          node.event.options.length
        )
        node.event.options.forEach((opt, j) => {
          expect(mirrorNode[j].effects, `链 ${server.chainId} 第 ${i + 1} 节选项 ${opt.id} effects 漂移`).toEqual(
            opt.effects
          )
        })
      })
    }
  })
})
