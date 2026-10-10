/**
 * @file event-json — 事件 JSON 的容错解析工具
 *
 * 流式生成（generate-event?stream=1）下会拿到「尚未生成完的 JSON 片段」，
 * 需要两类能力：
 *   1. extractPartialField：从未闭合的 JSON 里尽力读出某个字符串字段（用于渐进显示）
 *   2. extractEventJson：从完整输出里容错解析出事件对象（容忍 markdown 代码块 / 前后杂文）
 *
 * 与 npc-actions / faction-negotiate 里的 extractXxxJson 属同款逻辑，
 * 这里单独成模块是因为它需要被单元测试覆盖（流式解析的正确性直接影响事件可用性）。
 */

/**
 * 从「尚未生成完的 JSON 片段」中尽力提取某个字符串字段的当前值
 *
 * 容错点：
 *   - 值可能未闭合（缺结尾引号），正则里结尾引号设为可选
 *   - 值内可能含转义字符（\"、\\、\n），用 JSON.parse 还原；还原失败退化为去转义原文
 *
 * @param partial 已收到的部分 JSON 文本
 * @param field 字段名（如 title / description）
 * @returns 字段当前值（未匹配到时返回空串）
 */
export function extractPartialField(partial: string, field: string): string {
  const re = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"?`, 'm')
  const m = partial.match(re)
  if (!m || m[1] == null) return ''
  try {
    return JSON.parse(`"${m[1]}"`) as string
  } catch {
    // 转义序列不完整时的兜底：仅用于渐进显示，不参与最终解析
    return m[1].replace(/\\(.)/g, '$1')
  }
}

/**
 * 从 LLM 输出文本中容错解析出事件 JSON 对象
 *
 * 容忍：markdown 代码块包裹、前后杂文、JSON 前后空白。
 * 与 npc-actions 的 extractNpcActionJson 策略一致（取首个 { 到末个 }）。
 *
 * @param text LLM 完整输出
 * @returns 解析出的对象；无法解析时返回 null
 */
export function extractEventJson(text: string): Record<string, unknown> | null {
  if (!text || !text.trim()) return null
  const cleaned = text.replace(/```json|```/g, '').trim()
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first === -1 || last === -1 || last < first) return null
  try {
    return JSON.parse(cleaned.slice(first, last + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}
