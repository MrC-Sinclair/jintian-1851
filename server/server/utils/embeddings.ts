/**
 * @file 文本向量化封装（AI 长期记忆提案）
 *
 * 统一封装 SiliconFlow embedding 调用，模型为 `BAAI/bge-large-zh-v1.5`（免费档 ¥0/M tokens，1024 维）。
 * 设计约束见 design.md D3 / D5 / D6：
 *   - 512 token 硬上限：超长直接 400，故写入前截断到 `EMBEDDING_MAX_CHARS` 字符
 *   - 空文本不入调用（返回 null）
 *   - 失败 / 超时（10s）抛可捕获错误，由调用方按降级策略处理（不阻断主流程）
 */

import { createOpenAI } from '@ai-sdk/openai'
import { embed } from 'ai'
import { EMBEDDING_MODEL_ID, EMBEDDING_DIMENSIONS, EMBEDDING_MAX_CHARS } from '../config/models'

/** 维度与截断上限再导出，便于调用方与测试统一从此模块引用（design.md D3） */
export { EMBEDDING_DIMENSIONS, EMBEDDING_MAX_CHARS }

const apiKey = process.env.OPENAI_API_KEY
const baseURL = process.env.OPENAI_BASE_URL || 'https://api.siliconflow.cn/v1'

/**
 * 懒初始化 embedding model（首次调用 embedText 时才构造）。
 * 禁止在模块顶层构造：顶层执行 createOpenAI().textEmbeddingModel() 会产生导入副作用，
 * 任何 mock 了 @ai-sdk/openai（仅提供 chat）的测试文件导入本模块链路时都会直接崩溃。
 */
let cachedModel: ReturnType<
  ReturnType<typeof createOpenAI>['textEmbeddingModel']
> | null = null
function getEmbeddingModel() {
  if (!cachedModel) {
    cachedModel = createOpenAI({ apiKey, baseURL }).textEmbeddingModel(EMBEDDING_MODEL_ID)
  }
  return cachedModel
}

/**
 * 将文本向量化为 1024 维 `number[]`。
 * @returns 向量数组；空文本（或纯空白）返回 `null`（不入调用）
 * @throws 调用失败 / 超时（10s）时抛出可捕获错误，供调用方降级
 */
export async function embedText(text: string): Promise<number[] | null> {
  const trimmed = text?.trim()
  if (!trimmed) return null

  // bge-large-zh-v1.5 的 512 token 为硬上限，超长直接 400；截断到 750 字符（≈500 token 安全余量）
  const truncated =
    trimmed.length > EMBEDDING_MAX_CHARS ? trimmed.slice(0, EMBEDDING_MAX_CHARS) : trimmed

  const { embedding } = await embed({
    model: getEmbeddingModel(),
    value: truncated,
    abortSignal: AbortSignal.timeout(10_000)
  })

  return embedding
}
