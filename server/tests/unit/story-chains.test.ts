/**
 * @file story-chains 单元测试
 *
 * 验证 23 条剧情链数据完整性：
 *   - 数量与链清单一致
 *   - 节点 nextNodeIds 引用合法（指向同链内存在的 nodeId）
 *   - isLastNode 节点的 nextNodeIds 为空数组
 *   - 前置依赖引用的 chainId 存在
 *   - 节点 event 结构合法（含 options/effects）
 *   - 锚点年份覆盖：1872-1882 / 1884-1893 两段断档已补齐（#4b），最大断档有界
 */

import { describe, expect, it } from 'vitest'
import { STORY_CHAINS } from '../../server/runtime/story-chains'

describe('story-chains', () => {
  it('包含 23 条剧情链', () => {
    expect(STORY_CHAINS.length).toBe(23)
  })

  it('23 条剧情链清单完整（chainId/title/startYear/节点数）', () => {
    const expected = [
      { chainId: 'tai-ping-tian-guo', title: '太平天国兴亡', startYear: 1851, nodeCount: 5 },
      { chainId: 'er-ci-ya-pian', title: '第二次鸦片战争', startYear: 1856, nodeCount: 3 },
      { chainId: 'nian-jun-zhi-luan', title: '捻军之乱', startYear: 1853, nodeCount: 3 },
      { chainId: 'tong-zhi-hui-luan', title: '同治回乱', startYear: 1862, nodeCount: 3 },
      { chainId: 'yang-wu-yun-dong', title: '洋务运动', startYear: 1861, nodeCount: 4 },
      // 1884 新疆建省为后补节点（原 3 节点链的文案已含"建省"，故先收紧 node-3 再续 node-4）
      { chainId: 'zuo-zong-tang-xin-jiang', title: '左宗棠收复新疆', startYear: 1865, nodeCount: 4 },
      // 1879 废琉置县 + 1885 台湾建省为后补节点
      { chainId: 'liu-qiu-tai-wan', title: '琉球台湾事件', startYear: 1871, nodeCount: 4 },
      { chainId: 'zhong-fa-zhan-zheng', title: '中法战争', startYear: 1883, nodeCount: 3 },
      { chainId: 'jia-wu-zhan-zheng', title: '甲午战争', startYear: 1894, nodeCount: 3 },
      { chainId: 'wu-xu-bian-fa', title: '戊戌变法', startYear: 1898, nodeCount: 2 },
      { chainId: 'yi-he-tuan', title: '义和团运动', startYear: 1899, nodeCount: 3 },
      { chainId: 'ri-e-zhan-zheng', title: '日俄战争', startYear: 1904, nodeCount: 2 },
      { chainId: 'qing-mo-xin-zheng', title: '清末新政', startYear: 1901, nodeCount: 3 },
      { chainId: 'xin-hai-ge-ming', title: '辛亥革命', startYear: 1911, nodeCount: 3 },
      // ===== 以下 9 条为 #4b「历史锚点断档」补齐（1872-1882 / 1884-1893）=====
      { chainId: 'min-yong-gong-shang', title: '民用工矿与商股', startYear: 1872, nodeCount: 3 },
      { chainId: 'tong-zhi-guang-xu', title: '同光接替', startYear: 1874, nodeCount: 3 },
      { chainId: 'yan-tai-tiao-yue', title: '滇案与烟台条约', startYear: 1875, nodeCount: 2 },
      { chainId: 'ding-wu-qi-huang', title: '丁戊奇荒', startYear: 1876, nodeCount: 3 },
      { chainId: 'ren-wu-jia-shen', title: '朝鲜壬午甲申', startYear: 1882, nodeCount: 3 },
      { chainId: 'jia-shen-yi-shu', title: '甲申易枢', startYear: 1884, nodeCount: 2 },
      { chainId: 'zhong-gu-ao-men', title: '中葡北京条约', startYear: 1887, nodeCount: 2 },
      { chainId: 'guang-xu-da-hun', title: '大婚与亲政', startYear: 1889, nodeCount: 2 },
      { chainId: 'xing-zhong-hui', title: '兴中会前夜', startYear: 1892, nodeCount: 2 }
    ]
    const byId = new Map(STORY_CHAINS.map((c) => [c.chainId, c]))
    for (const exp of expected) {
      const chain = byId.get(exp.chainId)
      expect(chain, `缺失剧情链 ${exp.chainId}`).toBeDefined()
      expect(chain!.title).toBe(exp.title)
      expect(chain!.startYear, `链 ${exp.chainId} 锚点年份`).toBe(exp.startYear)
      expect(chain!.nodes.length).toBe(exp.nodeCount)
    }
    // 防"清单外偷偷加链"：表尾新增必须同步登记上面这张表
    expect(STORY_CHAINS.length).toBe(expected.length)
  })

  it('前置依赖引用合法（prerequisiteChainIds 指向存在的 chainId）', () => {
    const ids = new Set(STORY_CHAINS.map((c) => c.chainId))
    const expectedPrereqs: Record<string, string[]> = {
      'jia-wu-zhan-zheng': ['yang-wu-yun-dong'],
      'yi-he-tuan': ['wu-xu-bian-fa'],
      'qing-mo-xin-zheng': ['yi-he-tuan'],
      'xin-hai-ge-ming': ['qing-mo-xin-zheng'],
      // 新增链的前置：刻意**不给任何既有链加前置**（改了会让已上线链的可达性变化）
      'min-yong-gong-shang': ['yang-wu-yun-dong'],
      'tong-zhi-guang-xu': ['tong-zhi-hui-luan'],
      'yan-tai-tiao-yue': ['er-ci-ya-pian'],
      'jia-shen-yi-shu': ['yang-wu-yun-dong'],
      'guang-xu-da-hun': ['jia-shen-yi-shu']
    }
    for (const chain of STORY_CHAINS) {
      if (chain.prerequisiteChainIds) {
        expect(expectedPrereqs[chain.chainId], `前置依赖未在预期表中：${chain.chainId}`).toBeDefined()
        for (const pre of chain.prerequisiteChainIds) {
          expect(ids.has(pre), `前置链不存在：${chain.chainId} -> ${pre}`).toBe(true)
        }
      }
    }
    // 校验上述各条必须有前置
    for (const [chainId, prereqs] of Object.entries(expectedPrereqs)) {
      const chain = STORY_CHAINS.find((c) => c.chainId === chainId)!
      expect(chain.prerequisiteChainIds).toEqual(prereqs)
    }
  })

  it('两段历史断档已补锚点（1872-1882 / 1884-1893）', () => {
    const years = STORY_CHAINS.map((c) => c.startYear)
    const inRange = (from: number, to: number) => years.filter((y) => y >= from && y <= to)
    // 断档前：1872-1882 零条、1884-1893 零条（表里只有 1871 与 1883 两个孤立锚点）
    expect(inRange(1872, 1882).length).toBeGreaterThanOrEqual(5)
    expect(inRange(1884, 1893).length).toBeGreaterThanOrEqual(4)
  })

  it('锚点年份最大断档有界（防"内容集中在头尾"）', () => {
    const years = [...new Set(STORY_CHAINS.map((c) => c.startYear))].sort((a, b) => a - b)
    let maxGap = 0
    let maxGapAt = ''
    for (let i = 1; i < years.length; i++) {
      const gap = years[i] - years[i - 1]
      if (gap > maxGap) {
        maxGap = gap
        maxGapAt = `${years[i - 1]}→${years[i]}`
      }
    }
    // 1904→1911 仍隔 7 年（1905-1910 废科举/同盟会/预备立宪/国会请愿/保路未成链，见提案"未做"）
    expect(maxGap, `最大锚点断档 ${maxGap} 年（${maxGapAt}）`).toBeLessThanOrEqual(7)
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
