/**
 * @file LLM token 用量观测（成本校准数据源）
 *
 * docs/ai-cost.md 的成本模型为纸面估算：全链路此前无 usage 记录，无法校准。
 * 各 AI 端点在 LLM 调用完成后调用 logLlmUsage 输出单行 JSON 日志，便于：
 *   - 校准单回合/单局真实 token 消耗
 *   - 发现成本异常放大（如 npc-actions 势力数失控）
 * 后续接入持久化统计表或监控时，可直接消费该日志格式。
 */

/** AI SDK LanguageModelUsage 的宽松形态（字段均可选，向后兼容） */
interface LlmUsageLike {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

/**
 * 记录一次 LLM 调用的 token 用量
 * @param endpoint 端点标识（如 'generate-event'）
 * @param usage AI SDK 返回的 usage 对象（缺省时跳过，避免噪音）
 * @param extra 附加维度（如 npc-actions 的 factionId、多步 Agent 的步数）
 */
export function logLlmUsage(
  endpoint: string,
  usage: LlmUsageLike | undefined,
  extra?: Record<string, unknown>
): void {
  if (!usage) return
  console.log(
    `[llm-usage] ${JSON.stringify({
      endpoint,
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      totalTokens: usage.totalTokens ?? null,
      ...extra
    })}`
  )
}
