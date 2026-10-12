/**
 * @file 前后端镜像数据一致性测试（跨项目守卫）
 *
 * 此前的 story-chains-meta.test.ts 只校验前端数据自身结构，
 * 后端加链/改标题/改兑换表区间不会导致任何测试失败——镜像靠注释约定维系。
 * 本测试直接跨项目导入 server 端数据源做逐项比对：
 *   - 剧情链：chainId / title / description / 节点顺序与标题（server 为真值来源）
 *   - 谈判兑换表：四条 deal 的 id / label / cost / effect / requires 深比较
 *
 * 可行性：server 两个模块均为纯数据（story-chains 仅 import type，negotiation-deals 零依赖），
 * type-only import 会被编译器擦除，无 server 运行时依赖泄漏进前端测试。
 */
import { describe, expect, it } from 'vitest'
import { STORY_CHAINS as SERVER_CHAINS } from '../../../server/server/runtime/story-chains'
import { NEGOTIATION_DEALS as SERVER_DEALS } from '../../../server/server/utils/negotiation-deals'
import { REPUTATION_BANDS } from '../../../server/server/utils/reputation-bands'
import { CHAIN_META } from '../../src/data/story-chains'
import { HISTORY_RATINGS, NEGOTIATION_DEALS as WEB_DEALS } from '../../src/utils/constants'

describe('镜像一致性：剧情链元数据（前端 CHAIN_META vs 后端 STORY_CHAINS）', () => {
  it('链数量一致且每条链的 chainId 一一对应', () => {
    expect(Object.keys(CHAIN_META).length).toBe(SERVER_CHAINS.length)
    for (const serverChain of SERVER_CHAINS) {
      expect(CHAIN_META[serverChain.chainId], `前端缺少链 ${serverChain.chainId}`).toBeDefined()
    }
  })

  it('每条链的 title / description / startYear 与后端一致', () => {
    for (const serverChain of SERVER_CHAINS) {
      const meta = CHAIN_META[serverChain.chainId]
      expect(meta.title, `链 ${serverChain.chainId} title 漂移`).toBe(serverChain.title)
      expect(meta.description, `链 ${serverChain.chainId} description 漂移`).toBe(
        serverChain.description
      )
      // startYear 是结局页「终局年份前可达链数」的分母来源，漂移会让完成度分级算错
      expect(meta.startYear, `链 ${serverChain.chainId} startYear 漂移`).toBe(serverChain.startYear)
    }
  })

  it('每条链的节点顺序 / nodeId / 节点标题与后端一致', () => {
    for (const serverChain of SERVER_CHAINS) {
      const meta = CHAIN_META[serverChain.chainId]
      expect(
        meta.nodes.length,
        `链 ${serverChain.chainId} 节点数漂移（前端 ${meta.nodes.length} vs 后端 ${serverChain.nodes.length}）`
      ).toBe(serverChain.nodes.length)

      meta.nodes.forEach((webNode, i) => {
        const serverNode = serverChain.nodes[i]
        expect(webNode.nodeId, `链 ${serverChain.chainId} 第 ${i + 1} 节 nodeId 漂移`).toBe(
          serverNode.nodeId
        )
        expect(webNode.title, `链 ${serverChain.chainId} 节点 ${webNode.nodeId} 标题漂移`).toBe(
          serverNode.event.title
        )
      })
    }
  })
})

describe('镜像一致性：谈判兑换表（前端 vs 后端 NEGOTIATION_DEALS）', () => {
  it('兑换表逐条深比较一致（id / label / cost / effect / requires）', () => {
    expect(WEB_DEALS).toEqual(SERVER_DEALS)
  })
})

describe('镜像一致性：名望档位表（前端 HISTORY_RATINGS vs 后端 REPUTATION_BANDS）', () => {
  it('档位逐条深比较一致（min / label / remark / npcStance）', () => {
    // 后端 prompt 注入用的就是这份副本；前端结局页读 HISTORY_RATINGS。
    // 划线一旦漂移，NPC 态度档位与结局史评会各说各话，而两边单测都不会失败。
    expect(HISTORY_RATINGS).toEqual(REPUTATION_BANDS)
  })

  it('档位按 min 降序且末档兜底（find 依赖这个顺序）', () => {
    for (let i = 1; i < REPUTATION_BANDS.length; i++) {
      expect(REPUTATION_BANDS[i - 1].min).toBeGreaterThan(REPUTATION_BANDS[i].min)
    }
    expect(REPUTATION_BANDS[REPUTATION_BANDS.length - 1].min).toBe(-Infinity)
  })
})
