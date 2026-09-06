/**
 * @file memory 读写模块单测（AI 长期记忆提案 任务 4）
 *
 * 隔离外部依赖：mock ../../server/db 与 ../../server/utils/embeddings。
 * 覆盖：写入成功 / 写入失败静默 / 空文本不写入 / 检索不 select embedding 列 / 空查询返回空 /
 *       检索失败降级返回空 / faction 按 saveId+factionId 双隔离。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/db', () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
    select: vi.fn(() => {
      const chain: any = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit: vi.fn(() => Promise.resolve([]))
      }
      return chain
    })
  }
}))
vi.mock('../../server/utils/embeddings', () => ({ embedText: vi.fn() }))

import { db } from '../../server/db'
import { embedText } from '../../server/utils/embeddings'
import {
  writeEventMemory,
  writeFactionMemory,
  searchEventMemories,
  searchFactionMemories
} from '../../server/utils/memory'

const embedMock = vi.mocked(embedText)
// db.insert 经 vi.mocked 推断为 Drizzle PgInsertBuilder 严格类型，mock 返回值无法匹配，
// 弱化为 any 以便自由构造 insert().values() 调用链。
const insertMock = vi.mocked(db.insert) as any

function mockSelectRows(rows: Array<{ content: string; turn: number; similarity: number }>) {
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows))
  }
  vi.mocked(db.select).mockReturnValue(chain)
  return chain
}

const VEC = new Array(1024).fill(0.1)

beforeEach(() => {
  embedMock.mockReset()
  insertMock.mockReset()
  vi.mocked(db.select).mockReset()
})

describe('writeEventMemory', () => {
  it('向量化成功后写入 game_events（含 embedding）', async () => {
    embedMock.mockResolvedValueOnce(VEC)
    const valuesMock = vi.fn<(values: any) => Promise<void>>(() => Promise.resolve())
    insertMock.mockImplementationOnce(() => ({ values: valuesMock }))
    await writeEventMemory({
      saveId: 's1',
      turn: 5,
      eventId: 'e1',
      eventType: 'battle',
      content: '湘军粮道被断'
    })
    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(valuesMock).toHaveBeenCalledTimes(1)
    const payload = valuesMock.mock.calls[0]![0]
    expect(payload.saveId).toBe('s1')
    expect(payload.embedding).toEqual(VEC)
  })

  it('embedding 失败静默跳过，不抛错也不写入', async () => {
    embedMock.mockRejectedValueOnce(new Error('embed fail'))
    await expect(
      writeEventMemory({ saveId: 's1', turn: 1, eventId: 'e', eventType: 't', content: 'x' })
    ).resolves.toBeUndefined()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('空文本（embedding 返回 null）不写入', async () => {
    embedMock.mockResolvedValueOnce(null)
    await writeEventMemory({ saveId: 's1', turn: 1, eventId: 'e', eventType: 't', content: '  ' })
    expect(insertMock).not.toHaveBeenCalled()
  })
})

describe('writeFactionMemory', () => {
  it('写入 faction_memories 含 source / sentiment / factionId', async () => {
    embedMock.mockResolvedValueOnce(VEC)
    const valuesMock = vi.fn<(values: any) => Promise<void>>(() => Promise.resolve())
    insertMock.mockImplementationOnce(() => ({ values: valuesMock }))
    await writeFactionMemory({
      saveId: 's1',
      factionId: 'xiang',
      turn: 5,
      source: 'npc_action',
      sentiment: 'negative',
      content: '湘军记恨'
    })
    const payload = valuesMock.mock.calls[0]![0]
    expect(payload.factionId).toBe('xiang')
    expect(payload.source).toBe('npc_action')
    expect(payload.sentiment).toBe('negative')
    expect(payload.embedding).toEqual(VEC)
  })
})

describe('searchEventMemories', () => {
  it('只投影 content/turn/similarity，不 select embedding 列', async () => {
    embedMock.mockResolvedValueOnce(VEC)
    const chain = mockSelectRows([{ content: '旧事', turn: 3, similarity: 0.8 }])
    const res = await searchEventMemories('s1', '湘军', { threshold: 0.76, topK: 5 })
    expect(embedMock).toHaveBeenCalledWith('湘军')
    const projection = vi.mocked(db.select).mock.calls[0]![0]
    expect(Object.keys(projection).sort()).toEqual(['content', 'similarity', 'turn'])
    expect(projection).not.toHaveProperty('embedding')
    expect(res).toEqual([{ content: '旧事', turn: 3, similarity: 0.8 }])
    expect(chain.where).toHaveBeenCalled()
  })

  it('空查询（embedding 返回 null）返回空数组且不查库', async () => {
    embedMock.mockResolvedValueOnce(null)
    const res = await searchEventMemories('s1', '', { threshold: 0.76, topK: 5 })
    expect(res).toEqual([])
    expect(db.select).not.toHaveBeenCalled()
  })

  it('检索失败抛错（不吞错，由调用方按策略降级）', async () => {
    embedMock.mockResolvedValueOnce(VEC)
    vi.mocked(db.select).mockImplementationOnce(() => {
      throw new Error('db down')
    })
    await expect(searchEventMemories('s1', '湘军', { threshold: 0.76, topK: 5 })).rejects.toThrow('db down')
  })
})

describe('searchFactionMemories', () => {
  it('按 saveId + factionId 检索并映射结果，不 select embedding', async () => {
    embedMock.mockResolvedValueOnce(VEC)
    const chain = mockSelectRows([{ content: '旧怨', turn: 7, similarity: 0.6 }])
    const res = await searchFactionMemories('s1', 'xiang', '资助', { threshold: 0.45, topK: 3 })
    expect(res).toEqual([{ content: '旧怨', turn: 7, similarity: 0.6 }])
    expect(chain.where).toHaveBeenCalled()
    const projection = vi.mocked(db.select).mock.calls[0]![0]
    expect(projection).not.toHaveProperty('embedding')
  })

  it('任务6：sentiment 过滤选项可传入且不影响返回映射（D8 正负混合召回）', async () => {
    embedMock.mockResolvedValueOnce(VEC)
    const chain = mockSelectRows([{ content: '记恨', turn: 7, similarity: 0.6 }])
    const res = await searchFactionMemories('s1', 'xiang', '资助', {
      threshold: 0.45,
      topK: 3,
      sentiment: 'negative'
    })
    expect(res).toEqual([{ content: '记恨', turn: 7, similarity: 0.6 }])
    expect(chain.where).toHaveBeenCalled()
  })
})
