/**
 * @file 预置兜底势力
 *
 * 6 个近代历史势力（湘军、淮军、太平天国、清廷、北洋、革命党）。
 * 当 LLM init-factions 失败时返回，按 background 调整推荐（initialRelationship）。
 */

import type { Background } from '@/types/game'

export interface FallbackFaction {
  id: string
  name: string
  summary: string
  initialPower: number
  initialRelationship: number
  /** 是否为该身份的推荐势力（前端可高亮） */
  recommended?: boolean
}

const BASE_FACTIONS: Omit<FallbackFaction, 'initialRelationship' | 'recommended'>[] = [
  {
    id: 'qing-ting',
    name: '清廷',
    summary: '大清朝廷，中央集权虽衰，仍有正统之名与天下兵马调遣之权',
    initialPower: 70
  },
  {
    id: 'xiang-jun',
    name: '湘军',
    summary: '曾国藩创办之湖南团练，书生领兵，以宗族乡谊为纽带，征战十余年',
    initialPower: 65
  },
  {
    id: 'huai-jun',
    name: '淮军',
    summary: '李鸿章创办之安徽地方军，装备西化较早，掌北洋实权',
    initialPower: 60
  },
  {
    id: 'tai-ping',
    name: '太平天国',
    summary: '洪秀全领导的农民起义政权，定都天京，控江南半壁',
    initialPower: 80
  },
  {
    id: 'bei-yang',
    name: '北洋',
    summary: '袁世凯小站练兵所建新军，装备精良，为近代最强新式武装',
    initialPower: 75
  },
  {
    id: 'ge-ming-dang',
    name: '革命党',
    summary: '孙中山领导的兴中会、同盟会等反清革命力量，主张驱除鞑虏恢复中华',
    initialPower: 55
  }
]

/** 身份 → 推荐势力 id + 初始关系偏移 */
const BACKGROUND_RECOMMENDATION: Record<Background, { factionId: string; relationshipBonus: number }> = {
  文官: { factionId: 'qing-ting', relationshipBonus: 30 },
  武将: { factionId: 'xiang-jun', relationshipBonus: 30 },
  商贾: { factionId: 'huai-jun', relationshipBonus: 25 },
  士绅: { factionId: 'qing-ting', relationshipBonus: 20 },
  宗室: { factionId: 'qing-ting', relationshipBonus: 40 }
}

/** 各身份对各势力的关系基线（负数=敌对，正数=友好） */
const RELATIONSHIP_BASELINE: Record<Background, Record<string, number>> = {
  文官: { 'qing-ting': 50, 'xiang-jun': 20, 'huai-jun': 15, 'tai-ping': -50, 'bei-yang': 0, 'ge-ming-dang': -30 },
  武将: { 'qing-ting': 20, 'xiang-jun': 50, 'huai-jun': 30, 'tai-ping': -40, 'bei-yang': 25, 'ge-ming-dang': -20 },
  商贾: { 'qing-ting': 10, 'xiang-jun': 10, 'huai-jun': 50, 'tai-ping': -30, 'bei-yang': 20, 'ge-ming-dang': -10 },
  士绅: { 'qing-ting': 40, 'xiang-jun': 30, 'huai-jun': 20, 'tai-ping': -60, 'bei-yang': -10, 'ge-ming-dang': -40 },
  宗室: { 'qing-ting': 80, 'xiang-jun': 30, 'huai-jun': 20, 'tai-ping': -70, 'bei-yang': -20, 'ge-ming-dang': -60 }
}

/**
 * 获取 6 个预置势力，按 background 调整 initialRelationship 与 recommended
 */
export function getFallbackFactions(background: Background): FallbackFaction[] {
  const recommendedId = BACKGROUND_RECOMMENDATION[background].factionId
  const baseline = RELATIONSHIP_BASELINE[background]

  return BASE_FACTIONS.map((f) => ({
    id: f.id,
    name: f.name,
    summary: f.summary,
    initialPower: f.initialPower,
    initialRelationship: baseline[f.id] ?? 0,
    recommended: f.id === recommendedId
  }))
}
