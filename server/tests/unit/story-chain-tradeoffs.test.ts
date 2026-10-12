/**
 * @file 剧情链选项「必须有取舍」守卫（新增内容专用）
 *
 * 与 fallback-events.test.ts 里的同名守卫同一口径：一个选项若在**所有维度上都不劣于**另一个、
 * 且至少一个维度严格更优，就是严格占优选项 —— 那等于给玩家一道假选择题。
 *
 * 范围刻意只覆盖本次新增的 9 条链与 3 个后补节点。
 * 已知既有债（不修，修它会动到已上线链的数值与平衡基线）：
 *   - `liu-qiu-tai-wan/node-1`「遣使诘问日本」占优于「隐忍回避争端」
 */
import { describe, expect, it } from 'vitest'
import { STORY_CHAINS } from '../../server/runtime/story-chains'

/** 本次新增的链：整条都在守卫范围内 */
const NEW_CHAIN_IDS = [
  'min-yong-gong-shang',
  'tong-zhi-guang-xu',
  'yan-tai-tiao-yue',
  'ding-wu-qi-huang',
  'ren-wu-jia-shen',
  'jia-shen-yi-shu',
  'zhong-gu-ao-men',
  'guang-xu-da-hun',
  'xing-zhong-hui'
]

/** 既有链里本次后补的节点（chainId → 新增 nodeId） */
const NEW_NODE_IDS: Record<string, string[]> = {
  'zuo-zong-tang-xin-jiang': ['node-4'],
  'liu-qiu-tai-wan': ['node-3', 'node-4']
}

/** a 是否严格占优于 b：所有共有维度 a ≥ b，且至少一个维度 a > b */
function strictlyDominates(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  let hasStrict = false
  for (const k of keys) {
    const av = a[k] ?? 0
    const bv = b[k] ?? 0
    if (av < bv) return false
    if (av > bv) hasStrict = true
  }
  return hasStrict
}

describe('剧情链新增选项不得严格占优', () => {
  it('新链全部节点 + 既有链的后补节点，逐节点两两比较', () => {
    const violations: string[] = []
    for (const chain of STORY_CHAINS) {
      const wholeChain = NEW_CHAIN_IDS.includes(chain.chainId)
      const extraNodes = NEW_NODE_IDS[chain.chainId] ?? []
      if (!wholeChain && extraNodes.length === 0) continue

      for (const node of chain.nodes) {
        if (!wholeChain && !extraNodes.includes(node.nodeId)) continue
        const effects = node.event.options.map((o) => o.effects as Record<string, number>)
        for (let i = 0; i < effects.length; i++) {
          for (let j = 0; j < effects.length; j++) {
            if (i === j) continue
            if (strictlyDominates(effects[i], effects[j])) {
              violations.push(
                `${chain.chainId}/${node.nodeId}: ` +
                  `「${node.event.options[i].label}」占优于「${node.event.options[j].label}」`
              )
            }
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('守卫本身有效（自造一道占优题，必须被抓到）', () => {
    expect(strictlyDominates({ military: 5, people: 1 }, { military: 4 })).toBe(true)
    // 各有得失 → 不算占优
    expect(strictlyDominates({ military: 5, people: -2 }, { military: 4, people: 3 })).toBe(false)
    // 完全相同 → 不算严格占优
    expect(strictlyDominates({ military: 5 }, { military: 5 })).toBe(false)
    // 缺维度按 0 参与比较
    expect(strictlyDominates({ military: 5 }, { military: 5, people: -1 })).toBe(true)
  })
})
