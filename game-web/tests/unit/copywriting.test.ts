/**
 * @file utils/copywriting.ts 单元测试
 *
 * 覆盖 T1.1 验证要求：
 *   - EFFECT_LABELS 所有映射键值存在性与中文非空
 *   - formatRelationshipLabel 5 档分级文案
 *   - getRelationshipLevel 5 档分级
 *   - BUTTON_TEXT / PHASE_HINTS / TOOLTIP_TEXT 等常量非空
 *   - TERM_EXPLANATIONS 术语解释非空
 */

import { describe, expect, it } from 'vitest'
import {
  EFFECT_LABELS,
  BUTTON_TEXT,
  PHASE_HINTS,
  TOOLTIP_TEXT,
  NPC_ACTION_LABELS,
  EVENT_TYPE_LABELS,
  TERM_EXPLANATIONS,
  EMPTY_TEXT,
  ERROR_TEXT,
  CHAIN_LABELS,
  CHAIN_PROGRESS_LABEL,
  CHAIN_PENDING_LABEL,
  CHAIN_EXPAND_LABEL,
  formatRelationshipLabel,
  getRelationshipLevel
} from '../../src/utils/copywriting'

describe('EFFECT_LABELS', () => {
  it('包含 5 维属性完整词映射', () => {
    expect(EFFECT_LABELS.military).toBe('军事')
    expect(EFFECT_LABELS.economy).toBe('经济')
    expect(EFFECT_LABELS.politics).toBe('政治')
    expect(EFFECT_LABELS.people).toBe('民心')
    expect(EFFECT_LABELS.diplomacy).toBe('外交')
  })

  it('包含 4 资源完整词映射', () => {
    expect(EFFECT_LABELS.silver).toBe('银两')
    expect(EFFECT_LABELS.troops).toBe('兵员')
    expect(EFFECT_LABELS.food).toBe('粮草')
    expect(EFFECT_LABELS.reputation).toBe('名望')
  })

  it('所有值均为非空中文字符串', () => {
    for (const [key, value] of Object.entries(EFFECT_LABELS)) {
      expect(value, `EFFECT_LABELS.${key} 应为非空字符串`).toBeTruthy()
      expect(value.length, `EFFECT_LABELS.${key} 长度应 ≥ 2`).toBeGreaterThanOrEqual(2)
    }
  })

  it('共 9 个映射键（5 属性 + 4 资源）', () => {
    expect(Object.keys(EFFECT_LABELS)).toHaveLength(9)
  })
})

describe('formatRelationshipLabel', () => {
  it('v > 50 返回盟友', () => {
    expect(formatRelationshipLabel(60)).toBe('盟友 +60')
    expect(formatRelationshipLabel(100)).toBe('盟友 +100')
  })

  it('0 < v ≤ 50 返回友好', () => {
    expect(formatRelationshipLabel(1)).toBe('友好 +1')
    expect(formatRelationshipLabel(50)).toBe('友好 +50')
  })

  it('v === 0 返回中立', () => {
    expect(formatRelationshipLabel(0)).toBe('中立')
  })

  it('-50 < v < 0 返回紧张（v > -50 才紧张，-50 属敌对）', () => {
    expect(formatRelationshipLabel(-1)).toBe('紧张 -1')
    expect(formatRelationshipLabel(-49)).toBe('紧张 -49')
  })

  it('v ≤ -50 返回敌对', () => {
    expect(formatRelationshipLabel(-50)).toBe('敌对 -50')
    expect(formatRelationshipLabel(-51)).toBe('敌对 -51')
    expect(formatRelationshipLabel(-100)).toBe('敌对 -100')
  })
})

describe('getRelationshipLevel', () => {
  it('v > 50 返回 ally', () => {
    expect(getRelationshipLevel(51)).toBe('ally')
    expect(getRelationshipLevel(100)).toBe('ally')
  })

  it('0 < v ≤ 50 返回 friendly', () => {
    expect(getRelationshipLevel(1)).toBe('friendly')
    expect(getRelationshipLevel(50)).toBe('friendly')
  })

  it('v === 0 返回 neutral', () => {
    expect(getRelationshipLevel(0)).toBe('neutral')
  })

  it('-50 < v < 0 返回 tense（v > -50 才 tense，-50 属 hostile）', () => {
    expect(getRelationshipLevel(-1)).toBe('tense')
    expect(getRelationshipLevel(-49)).toBe('tense')
  })

  it('v ≤ -50 返回 hostile', () => {
    expect(getRelationshipLevel(-50)).toBe('hostile')
    expect(getRelationshipLevel(-51)).toBe('hostile')
    expect(getRelationshipLevel(-100)).toBe('hostile')
  })
})

describe('常量文案非空校验', () => {
  it('BUTTON_TEXT 所有值为非空字符串', () => {
    for (const [key, value] of Object.entries(BUTTON_TEXT)) {
      expect(value, `BUTTON_TEXT.${key} 应为非空字符串`).toBeTruthy()
    }
  })

  it('TOOLTIP_TEXT 所有值为非空字符串', () => {
    for (const [key, value] of Object.entries(TOOLTIP_TEXT)) {
      expect(value, `TOOLTIP_TEXT.${key} 应为非空字符串`).toBeTruthy()
    }
  })

  it('NPC_ACTION_LABELS 包含 6 种行动类型', () => {
    expect(Object.keys(NPC_ACTION_LABELS)).toHaveLength(6)
    expect(NPC_ACTION_LABELS.扩张).toBe('扩张')
    expect(NPC_ACTION_LABELS.结盟).toBe('结盟')
    expect(NPC_ACTION_LABELS.备战).toBe('备战')
    expect(NPC_ACTION_LABELS.休养).toBe('休养')
    expect(NPC_ACTION_LABELS.挑衅).toBe('挑衅')
    expect(NPC_ACTION_LABELS.外交).toBe('外交')
  })

  it('EVENT_TYPE_LABELS 包含 7 种事件类型（含系统产出）', () => {
    expect(Object.keys(EVENT_TYPE_LABELS)).toHaveLength(7)
    expect(EVENT_TYPE_LABELS.系统).toBe('系统')
    expect(EVENT_TYPE_LABELS.民生).toBe('民生')
    expect(EVENT_TYPE_LABELS.npc).toBe('NPC动态')
  })

  it('TERM_EXPLANATIONS 所有值为非空字符串', () => {
    for (const [key, value] of Object.entries(TERM_EXPLANATIONS)) {
      expect(value, `TERM_EXPLANATIONS.${key} 应为非空字符串`).toBeTruthy()
      expect(value.length, `TERM_EXPLANATIONS.${key} 长度应 ≥ 10`).toBeGreaterThanOrEqual(10)
    }
  })

  it('TERM_EXPLANATIONS 包含综合实力解释', () => {
    expect(TERM_EXPLANATIONS.overallPower).toContain('综合实力')
    expect(TERM_EXPLANATIONS.overallPower).toContain('90')
  })

  it('EMPTY_TEXT 所有值为非空字符串', () => {
    for (const [key, value] of Object.entries(EMPTY_TEXT)) {
      expect(value, `EMPTY_TEXT.${key} 应为非空字符串`).toBeTruthy()
    }
  })

  it('ERROR_TEXT 所有值为非空字符串', () => {
    for (const [key, value] of Object.entries(ERROR_TEXT)) {
      expect(value, `ERROR_TEXT.${key} 应为非空字符串`).toBeTruthy()
    }
  })
})

describe('PHASE_HINTS', () => {
  it('提供等待决策提示', () => {
    expect(PHASE_HINTS.awaitingDecision).toContain('应对方案')
  })

  it('提供决策完成提示', () => {
    expect(PHASE_HINTS.decided).toContain('下一回合')
  })

  it('提供推演中提示', () => {
    expect(PHASE_HINTS.thinking).toContain('推演')
  })

  it('crisisSuffix 追加危机提示', () => {
    const suffix = PHASE_HINTS.crisisSuffix('军事')
    expect(suffix).toContain('军事')
    expect(suffix).toContain('濒临崩溃')
  })
})

// ====================== expand-event-engine T4.4 剧情链文案 ======================
describe('CHAIN_LABELS', () => {
  it('包含 14 条剧情链的中文标题', () => {
    expect(Object.keys(CHAIN_LABELS)).toHaveLength(14)
    expect(CHAIN_LABELS['tai-ping-tian-guo']).toBe('太平天国兴亡')
    expect(CHAIN_LABELS['xin-hai-ge-ming']).toBe('辛亥革命')
    expect(CHAIN_LABELS['jia-wu-zhan-zheng']).toBe('甲午战争')
  })

  it('未知 chainId 返回 undefined（调用方应兜底）', () => {
    expect(CHAIN_LABELS['not-exist']).toBeUndefined()
  })
})

describe('CHAIN_PROGRESS_LABEL', () => {
  it('生成「剧情 {current}/{total}」角标文案', () => {
    expect(CHAIN_PROGRESS_LABEL(2, 5)).toBe('剧情 2/5')
    expect(CHAIN_PROGRESS_LABEL(1, 3)).toBe('剧情 1/3')
  })
})

describe('CHAIN_PENDING_LABEL', () => {
  it('生成「下回合将触发：{chainTitle} 第 {current}/{total} 节」', () => {
    expect(CHAIN_PENDING_LABEL('太平天国兴亡', 3, 5)).toBe(
      '下回合将触发：太平天国兴亡 第 3/5 节'
    )
  })
})

describe('CHAIN_EXPAND_LABEL', () => {
  it('提供点击展开提示文案', () => {
    expect(CHAIN_EXPAND_LABEL).toBe('点击查看详情')
  })
})
