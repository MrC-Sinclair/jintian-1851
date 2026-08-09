/**
 * @file CHAIN_META 前端元数据镜像一致性测试
 *
 * 校验 game-web/src/data/story-chains.ts 与后端 STORY_CHAINS 的关键不变量保持一致：
 *   - 共 14 条剧情链
 *   - 每条链 ≥ 2 个节点，节点 ID 在链内唯一且有序
 *   - 已知 chainId 存在（与设计文档"14 条剧情链清单"对应）
 *
 * 说明：本测试不复制后端完整 effects，仅校验元数据拓扑，避免前后端节点拓扑漂移。
 */

import { describe, expect, it } from 'vitest'
import {
  CHAIN_META,
  getChainMeta,
  getNextNodeId,
  isLastNode
} from '../../src/data/story-chains'

const EXPECTED_CHAIN_IDS = [
  'tai-ping-tian-guo',
  'er-ci-ya-pian',
  'nian-jun-zhi-luan',
  'tong-zhi-hui-luan',
  'yang-wu-yun-dong',
  'zuo-zong-tang-xin-jiang',
  'liu-qiu-tai-wan',
  'zhong-fa-zhan-zheng',
  'jia-wu-zhan-zheng',
  'wu-xu-bian-fa',
  'yi-he-tuan',
  'ri-e-zhan-zheng',
  'qing-mo-xin-zheng',
  'xin-hai-ge-ming'
]

describe('CHAIN_META 元数据完整性', () => {
  it('共 14 条剧情链', () => {
    expect(Object.keys(CHAIN_META)).toHaveLength(14)
  })

  it('已知 chainId 全部存在', () => {
    for (const id of EXPECTED_CHAIN_IDS) {
      expect(getChainMeta(id), `缺少剧情链 ${id}`).not.toBeNull()
    }
  })

  it('每条链节点 ≥ 2 且节点 ID 链内唯一有序', () => {
    for (const meta of Object.values(CHAIN_META)) {
      expect(meta.nodes.length, `${meta.chainId} 节点数应 ≥ 2`).toBeGreaterThanOrEqual(2)
      const ids = meta.nodes.map((n) => n.nodeId)
      expect(new Set(ids).size, `${meta.chainId} 节点 ID 应唯一`).toBe(ids.length)
      // 每个节点应带标题
      for (const n of meta.nodes) {
        expect(n.title).toBeTruthy()
      }
    }
  })

  it('线性链：getNextNodeId 指向下一个节点，末节点为 null', () => {
    for (const meta of Object.values(CHAIN_META)) {
      const nodes = meta.nodes
      for (let i = 0; i < nodes.length; i++) {
        if (i < nodes.length - 1) {
          expect(getNextNodeId(meta.chainId, nodes[i].nodeId)).toBe(nodes[i + 1].nodeId)
          expect(isLastNode(meta.chainId, nodes[i].nodeId)).toBe(false)
        } else {
          expect(getNextNodeId(meta.chainId, nodes[i].nodeId)).toBeNull()
          expect(isLastNode(meta.chainId, nodes[i].nodeId)).toBe(true)
        }
      }
    }
  })
})
