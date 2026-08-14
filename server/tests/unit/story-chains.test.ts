/**
 * @file story-chains 单元测试
 *
 * 验证 14 条剧情链数据完整性：
 *   - 数量与链清单一致
 *   - 节点 nextNodeIds 引用合法（指向同链内存在的 nodeId）
 *   - isLastNode 节点的 nextNodeIds 为空数组
 *   - 前置依赖引用的 chainId 存在
 *   - 节点 event 结构合法（含 options/effects）
 */

import { describe, expect, it } from 'vitest'
import { STORY_CHAINS } from '../../server/runtime/story-chains'

describe('story-chains', () => {
  it('至少包含 14 条剧情链', () => {
    expect(STORY_CHAINS.length).toBeGreaterThanOrEqual(14)
  })

  it('14 条剧情链清单完整（chainId/title/startYear/节点数）', () => {
    const expected = [
      { chainId: 'tai-ping-tian-guo', title: '太平天国兴亡', startYear: 1851, nodeCount: 5 },
      { chainId: 'er-ci-ya-pian', title: '第二次鸦片战争', startYear: 1856, nodeCount: 3 },
      { chainId: 'nian-jun-zhi-luan', title: '捻军之乱', startYear: 1853, nodeCount: 3 },
      { chainId: 'tong-zhi-hui-luan', title: '同治回乱', startYear: 1862, nodeCount: 3 },
      { chainId: 'yang-wu-yun-dong', title: '洋务运动', startYear: 1861, nodeCount: 4 },
      { chainId: 'zuo-zong-tang-xin-jiang', title: '左宗棠收复新疆', startYear: 1865, nodeCount: 3 },
      { chainId: 'liu-qiu-tai-wan', title: '琉球台湾事件', startYear: 1871, nodeCount: 2 },
      { chainId: 'zhong-fa-zhan-zheng', title: '中法战争', startYear: 1883, nodeCount: 3 },
      { chainId: 'jia-wu-zhan-zheng', title: '甲午战争', startYear: 1894, nodeCount: 3 },
      { chainId: 'wu-xu-bian-fa', title: '戊戌变法', startYear: 1898, nodeCount: 2 },
      { chainId: 'yi-he-tuan', title: '义和团运动', startYear: 1899, nodeCount: 3 },
      { chainId: 'ri-e-zhan-zheng', title: '日俄战争', startYear: 1904, nodeCount: 2 },
      { chainId: 'qing-mo-xin-zheng', title: '清末新政', startYear: 1901, nodeCount: 3 },
      { chainId: 'xin-hai-ge-ming', title: '辛亥革命', startYear: 1911, nodeCount: 3 }
    ]
    const byId = new Map(STORY_CHAINS.map((c) => [c.chainId, c]))
    for (const exp of expected) {
      const chain = byId.get(exp.chainId)
      expect(chain, `缺失剧情链 ${exp.chainId}`).toBeDefined()
      expect(chain!.title).toBe(exp.title)
      expect(chain!.startYear).toBe(exp.startYear)
      expect(chain!.nodes.length).toBe(exp.nodeCount)
    }
  })

  it('前置依赖引用合法（prerequisiteChainIds 指向存在的 chainId）', () => {
    const ids = new Set(STORY_CHAINS.map((c) => c.chainId))
    const expectedPrereqs: Record<string, string[]> = {
      'jia-wu-zhan-zheng': ['yang-wu-yun-dong'],
      'yi-he-tuan': ['wu-xu-bian-fa'],
      'qing-mo-xin-zheng': ['yi-he-tuan'],
      'xin-hai-ge-ming': ['qing-mo-xin-zheng']
    }
    for (const chain of STORY_CHAINS) {
      if (chain.prerequisiteChainIds) {
        expect(expectedPrereqs[chain.chainId], `前置依赖未在预期表中：${chain.chainId}`).toBeDefined()
        for (const pre of chain.prerequisiteChainIds) {
          expect(ids.has(pre), `前置链不存在：${chain.chainId} -> ${pre}`).toBe(true)
        }
      }
    }
    // 校验上述 4 条必须有前置
    for (const [chainId, prereqs] of Object.entries(expectedPrereqs)) {
      const chain = STORY_CHAINS.find((c) => c.chainId === chainId)!
      expect(chain.prerequisiteChainIds).toEqual(prereqs)
    }
  })

  it('每条链首节点 triggerTurnOffset 为 0，节点递增', () => {
    for (const chain of STORY_CHAINS) {
      expect(chain.nodes[0].triggerTurnOffset).toBe(0)
      for (let i = 1; i < chain.nodes.length; i++) {
        expect(chain.nodes[i].triggerTurnOffset).toBeGreaterThan(chain.nodes[i - 1].triggerTurnOffset)
      }
    }
  })

  it('节点 nextNodeIds 引用合法，isLastNode 节点的 nextNodeIds 为空', () => {
    for (const chain of STORY_CHAINS) {
      const nodeIds = new Set(chain.nodes.map((n) => n.nodeId))
      const lastIndex = chain.nodes.length - 1
      chain.nodes.forEach((node, idx) => {
        // 每个节点（除最后）必须恰好有 1 个下一节点（线性链）
        if (idx < lastIndex) {
          expect(node.isLastNode).toBe(false)
          expect(node.nextNodeIds.length).toBe(1)
          expect(nodeIds.has(node.nextNodeIds[0]), `nextNodeId 不存在：${chain.chainId}/${node.nodeId}`).toBe(true)
        } else {
          // 最后节点
          expect(node.isLastNode).toBe(true)
          expect(node.nextNodeIds).toEqual([])
        }
      })
    }
  })

  it('每个节点 event 结构合法（2-4 选项，含 effects）', () => {
    const attrKeys = ['military', 'economy', 'politics', 'people', 'diplomacy', 'reputation']
    for (const chain of STORY_CHAINS) {
      for (const node of chain.nodes) {
        const e = node.event
        expect(typeof e.title).toBe('string')
        expect(e.title.length).toBeGreaterThan(0)
        expect(typeof e.description).toBe('string')
        expect(e.description.length).toBeGreaterThanOrEqual(10)
        expect(e.eventType).toBe('历史剧情')
        expect(e.options.length).toBeGreaterThanOrEqual(2)
        expect(e.options.length).toBeLessThanOrEqual(4)
        for (const opt of e.options) {
          expect(typeof opt.id).toBe('string')
          expect(typeof opt.label).toBe('string')
          expect(opt.label.length).toBeGreaterThan(0)
          expect(typeof opt.effects).toBe('object')
          const values = Object.values(opt.effects)
          expect(values.some((v) => v !== 0)).toBe(true)
          for (const [k, v] of Object.entries(opt.effects)) {
            if (attrKeys.includes(k)) {
              expect(Math.abs(v as number)).toBeLessThanOrEqual(15)
            } else {
              // silver/troops/food 资源类
              expect(Math.abs(v as number)).toBeLessThanOrEqual(500)
            }
          }
        }
      }
    }
  })

  it('chainId 全局唯一', () => {
    const ids = STORY_CHAINS.map((c) => c.chainId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
