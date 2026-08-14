/**
 * @file faction-summary 单元测试
 *
 * 验证 summary 字段被剔除
 */

import { describe, expect, it } from 'vitest'
import { compressFactions, type Faction } from '../../server/utils/faction-summary'

const fullFactions: Faction[] = [
  {
    id: 'f1',
    name: '湘军',
    summary: '曾国藩创办的湖南地方团练',
    power: 65,
    relationship: 30,
    status: 'active',
    lastAction: '扩张至安徽'
  },
  {
    id: 'f2',
    name: '淮军',
    summary: '李鸿章创办的安徽地方军',
    power: 55,
    relationship: 20,
    status: 'active'
  },
  {
    id: 'f3',
    name: '太平天国',
    summary: '洪秀全领导的农民起义政权',
    power: 80,
    relationship: -60,
    status: 'active'
  }
]

describe('compressFactions', () => {
  it('保留 id/name/power/relationship/status 五字段', () => {
    const result = compressFactions(fullFactions)
    expect(result).toHaveLength(3)
    for (const f of result) {
      expect(Object.keys(f).sort()).toEqual(
        ['id', 'name', 'power', 'relationship', 'status'].sort()
      )
    }
  })

  it('剔除 summary 字段', () => {
    const result = compressFactions(fullFactions)
    for (const f of result) {
      expect(f).not.toHaveProperty('summary')
    }
  })

  it('剔除 lastAction 字段', () => {
    const result = compressFactions(fullFactions)
    for (const f of result) {
      expect(f).not.toHaveProperty('lastAction')
    }
  })

  it('数值正确传递', () => {
    const result = compressFactions(fullFactions)
    expect(result[0].power).toBe(65)
    expect(result[0].relationship).toBe(30)
    expect(result[2].name).toBe('太平天国')
    expect(result[2].relationship).toBe(-60)
  })

  it('空数组返回空数组', () => {
    expect(compressFactions([])).toEqual([])
  })

  it('单个势力正确压缩', () => {
    const single: Faction[] = [
      {
        id: 'f-x',
        name: '清廷',
        summary: '大清朝廷',
        power: 70,
        relationship: 100,
        status: 'allied'
      }
    ]
    const result = compressFactions(single)
    expect(result).toEqual([
      { id: 'f-x', name: '清廷', power: 70, relationship: 100, status: 'allied' }
    ])
  })
})
