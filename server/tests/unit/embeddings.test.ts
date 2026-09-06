/**
 * @file embeddings 封装单测（AI 长期记忆提案 任务 3）
 *
 * 通过 mock @ai-sdk/openai 与 ai 模块隔离外部 embedding 调用，验证：
 *   - 空文本返回 null，且不发起调用
 *   - 正常文本返回 1024 维向量
 *   - 超长文本截断到 EMBEDDING_MAX_CHARS 后再向量化
 *   - 调用失败抛错（供调用方降级）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({ textEmbeddingModel: vi.fn(() => 'mocked-embedding-model') }))
}))
vi.mock('ai', () => ({ embed: vi.fn() }))

import { embed } from 'ai'
import { embedText, EMBEDDING_DIMENSIONS, EMBEDDING_MAX_CHARS } from '../../server/utils/embeddings'

const embedMock = vi.mocked(embed)

function fakeEmbedding() {
  return { embedding: new Array(EMBEDDING_DIMENSIONS).fill(0.01) } as Awaited<ReturnType<typeof embed>>
}

beforeEach(() => {
  embedMock.mockClear()
})

describe('embedText', () => {
  it('空文本返回 null 且不发起调用', async () => {
    expect(await embedText('')).toBeNull()
    expect(await embedText('   ')).toBeNull()
    expect(await embedText('\n\t')).toBeNull()
    expect(embedMock).not.toHaveBeenCalled()
  })

  it('正常文本返回 1024 维向量', async () => {
    embedMock.mockResolvedValueOnce(fakeEmbedding())
    const result = await embedText('湘军粮道被断，士卒哗变')
    expect(result).toHaveLength(EMBEDDING_DIMENSIONS)
    expect(embedMock).toHaveBeenCalledTimes(1)
    const callValue = embedMock.mock.calls[0]![0].value as string
    expect(callValue).toBe('湘军粮道被断，士卒哗变')
  })

  it('超长文本截断到 EMBEDDING_MAX_CHARS 后再向量化', async () => {
    embedMock.mockResolvedValueOnce(fakeEmbedding())
    const long = '兵'.repeat(5000)
    await embedText(long)
    const callValue = embedMock.mock.calls[0]![0].value as string
    expect(callValue.length).toBe(EMBEDDING_MAX_CHARS)
  })

  it('embedding 调用失败抛错（供调用方降级）', async () => {
    embedMock.mockRejectedValueOnce(new Error('400 Bad Request'))
    await expect(embedText('任意文本')).rejects.toThrow()
  })
})
