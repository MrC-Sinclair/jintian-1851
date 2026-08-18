/**
 * @file 疑问句犹豫判定守卫
 *
 * 实测（Qwen3-8B，生产同款 prompt）证明 LLM 对"如何处理这个事件"等疑问句
 * 无法稳定判为决策犹豫（会被解析为最接近选项的 effects），且判定失败时
 * 还会幻觉出 factionEffects（玩家提问竟改变势力关系）。
 * 因此强疑问/求助词开头的输入在代码层确定性拦截，直接返回犹豫签名，不调 LLM。
 *
 * 边界取舍：仅拦截"怎么/如何/为什么"等明确疑问求助词开头；
 * "我想 X"类模糊句不过拦，交给 LLM 软判定——宁可放过"我想变强"被当行动解析，
 * 也不可误伤"我想资助湘军"这类具体行动（犹豫代价极小，放过成本可接受）。
 */

/** 犹豫签名 effects：极小"决策犹豫"代价，不消耗兵力（与 prompt 解析规则 1 保持一致，改动需两处同步） */
export const HESITATION_EFFECTS = { people: -1, silver: -10 } as const

/** 强疑问/求助词开头（trim 后匹配） */
const HESITATION_PREFIXES = [
  '怎么',
  '怎样',
  '如何',
  '为什么',
  '为啥',
  '帮帮我',
  '能不能',
  '能否',
  '该不该',
  '该怎么办',
  '请问'
]

/**
 * 判断玩家自由行动输入是否为疑问/求助句（应判为决策犹豫）
 */
export function isHesitationQuery(input: string): boolean {
  const text = input.trim()
  return HESITATION_PREFIXES.some((prefix) => text.startsWith(prefix))
}
