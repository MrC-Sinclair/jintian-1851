/**
 * @file init-factions 提示词
 *
 * 输入：玩家身份 background
 * 输出：要求 LLM 生成 6-8 个近代势力（含 id/name/summary/initialPower/initialRelationship）
 */

import type { Background } from '@/types/game'

/**
 * 构造 init-factions 提示词
 * @param background 玩家身份（文官/武将/商贾/士绅/宗室）
 * @returns 完整提示词字符串
 */
export function buildInitFactionsPrompt(background: Background): string {
  return `你是一位近代历史专家与游戏设计师。请为以下玩家生成 6-8 个近代历史势力。

【玩家身份】${background}

【时代背景】近代晚清（1851-1912），内有太平天国、捻军起义，外有列强环伺，中央集权衰落，地方势力崛起。

【势力要求】
1. 势力名称必须符合近代历史真实情况（如湘军、淮军、太平天国、清廷、北洋、革命党等）
2. 每个势力含：
   - id: 唯一英文标识（如 'qing-ting'、'xiang-jun'）
   - name: 中文名称
   - summary: 30-60 字简介，说明势力背景与特点
   - initialPower: 初始实力 0-100（80 以上为顶尖势力，60-80 为强势，40-60 为中等）
   - initialRelationship: 与玩家势力的初始关系 -100 到 100（负数=敌对，0=中立，正数=友好）
3. 至少包含 1 个推荐势力（与玩家身份契合度高，initialRelationship ≥ 30）
4. ${background} 身份开局推荐：
   - 文官 → 清廷（朝廷正统）
   - 武将 → 湘军（书生领兵）
   - 商贾 → 淮军（重商重洋务）
   - 士绅 → 清廷（既有利益者）
   - 宗室 → 清廷（皇族本位）

【输出格式】返回 JSON：
{
  "factions": [
    { "id": "qing-ting", "name": "清廷", "summary": "...", "initialPower": 70, "initialRelationship": 50 }
  ]
}

请生成 6-8 个势力，确保历史感强、势力间张力明显。`
}
