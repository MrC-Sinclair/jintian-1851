/**
 * @file CHAIN_META 前端元数据镜像一致性测试
 *
 * 校验 game-web/src/data/story-chains.ts 与后端 STORY_CHAINS 的关键不变量保持一致：
 *   - 链数与链 ID 清单与后端一致（清单直接从后端取，**不再硬编码条数**——
 *     上一版把 14 写死在这里，后端补链时这里静默过期，是真实踩过的坑）
 *   - 每条链 ≥ 2 个节点，节点 ID 在链内唯一且有序
 *   - 线性链拓扑（getNextNodeId / isLastNode）自洽
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
import { STORY_CHAINS as SERVER_CHAINS } from '../../../server/server/runtime/story-chains'

const EXPECTED_CHAIN_IDS = SERVER_CHAINS.map((c) => c.chainId)

describe('CHAIN_META 元数据完整性', () => {
  it('链条数与链 ID 清单与后端一致（不硬编码条数）', () => {
    expect(Object.keys(CHAIN_META)).toHaveLength(SERVER_CHAINS.length)
    expect(Object.keys(CHAIN_META).sort()).toEqual([...EXPECTED_CHAIN_IDS].sort())
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
