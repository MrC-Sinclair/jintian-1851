/**
 * @file hesitation-guard 疑问句守卫单元测试
 *
 * 验证：强疑问/求助词开头 → 拦截判犹豫；"我想 + 具体动作"等行动句 → 不过拦交给 LLM
 */

import { describe, expect, it } from 'vitest'
import { HESITATION_EFFECTS, isHesitationQuery } from '../../server/utils/hesitation-guard'

describe('isHesitationQuery', () => {
  it.each([
    '怎么办？我毫无头绪',
    '怎样才能赢？',
    '如何处理这个事件比较好？',
    '为什么要征税？',
    '为啥粮价涨了？',
    '帮帮我，我不知道该怎么办',
    '能不能教教我？',
    '能否给点建议？',
    '该不该开仓放粮？',
    '该怎么办啊',
    '请问哪个选项好？',
    '  怎么办？带前后空格  '
  ])('疑问/求助句应拦截：%s', (input) => {
    expect(isHesitationQuery(input)).toBe(true)
  })

  it.each([
    '我想暗中资助湘军',
    '我要开仓赈灾',
    '暗中联络太平军，约定南北夹击清廷',
    '我想让国家变强', // 模糊句不过拦，交给 LLM 软判定（宁可放过不可误伤具体行动）
    '征收商税补充军费',
    '派兵镇压叛乱'
  ])('行动句不应拦截：%s', (input) => {
    expect(isHesitationQuery(input)).toBe(false)
  })
})

describe('HESITATION_EFFECTS', () => {
  it('犹豫签名为极小代价且不消耗兵力（与 prompt 解析规则 1 保持一致）', () => {
    expect(HESITATION_EFFECTS).toEqual({ people: -1, silver: -10 })
  })
})
