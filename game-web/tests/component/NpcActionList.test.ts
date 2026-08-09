/**
 * @file NpcActionList.vue 组件渲染测试
 *
 * 覆盖：
 *   - props 传递（actions）
 *   - 空状态（actions=[] → 「本回合各方暂无行动」白话文案）
 *   - 渲染标题「天下动静」与计数
 *   - 渲染 factionName / action / description
 *   - target 字段条件渲染
 *   - actionClass 映射（aggressive/friendly/neutral）
 *   - effects 渲染（正/负，使用完整词标签"军事+5"而非单字"军+5"）
 *   - T2.8：「对你影响：」标签 + 无 effects 时显示「暂无直接影响」
 *   - InfoHint 渲染（标题旁 1 个 + 每个 action 项 1 个）
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import NpcActionList from '../../src/components/NpcActionList.vue'
import type { NpcAction } from '../../src/types/game'

const stubs = {
  view: 'div',
  text: 'span',
  // InfoHint stub：渲染占位 div，便于统计数量
  InfoHint: {
    name: 'InfoHint',
    template: '<div class="info-hint-stub" />'
  }
}

function makeAction(overrides: Partial<NpcAction> = {}): NpcAction {
  return {
    factionId: 'f1',
    factionName: '清廷',
    action: '扩张',
    description: '扩张领土',
    ...overrides
  }
}

function mountList(props: Record<string, unknown>) {
  return mount(NpcActionList, {
    props,
    global: { stubs }
  })
}

describe('NpcActionList - 空状态', () => {
  it('actions 为空时显示「本回合各方暂无行动」白话文案', () => {
    const wrapper = mountList({ actions: [] })
    expect(wrapper.find('.npc-action-list__empty').exists()).toBe(true)
    // T2.3：白话文案「本回合各方暂无行动」替代「天下暂无事端」
    expect(wrapper.find('.npc-action-list__empty-text').text()).toBe(
      '本回合各方暂无行动'
    )
  })

  it('actions 为空时不显示计数', () => {
    const wrapper = mountList({ actions: [] })
    expect(wrapper.find('.npc-action-list__count').exists()).toBe(false)
  })

  it('actions 为空时不渲染 items 区', () => {
    const wrapper = mountList({ actions: [] })
    expect(wrapper.find('.npc-action-list__items').exists()).toBe(false)
  })
})

describe('NpcActionList - 标题与计数', () => {
  it('渲染标题「天下动静」', () => {
    const wrapper = mountList({ actions: [makeAction()] })
    expect(wrapper.find('.npc-action-list__title').text()).toBe('天下动静')
  })

  it('有 actions 时显示计数「共 N 则」', () => {
    const wrapper = mountList({
      actions: [makeAction(), makeAction({ factionId: 'f2' }), makeAction({ factionId: 'f3' })]
    })
    expect(wrapper.find('.npc-action-list__count').text()).toBe('共 3 则')
  })
})

describe('NpcActionList - action 字段渲染', () => {
  it('渲染 factionName / action / description', () => {
    const wrapper = mountList({
      actions: [
        makeAction({
          factionName: '太平天国',
          action: '备战',
          description: '整军备战，意欲北伐。'
        })
      ]
    })
    expect(wrapper.find('.npc-action-item__faction').text()).toBe('太平天国')
    expect(wrapper.find('.npc-action-item__action').text()).toBe('备战')
    expect(wrapper.find('.npc-action-item__desc').text()).toBe('整军备战，意欲北伐。')
  })

  it('多条 actions 都渲染', () => {
    const wrapper = mountList({
      actions: [
        makeAction({ factionId: 'f1', factionName: '清廷' }),
        makeAction({ factionId: 'f2', factionName: '太平天国' })
      ]
    })
    const items = wrapper.findAll('.npc-action-item')
    expect(items).toHaveLength(2)
    const names = items.map((i) => i.find('.npc-action-item__faction').text())
    expect(names).toEqual(['清廷', '太平天国'])
  })
})

describe('NpcActionList - target 条件渲染', () => {
  it('target 存在时渲染「目标：xxx」', () => {
    const wrapper = mountList({
      actions: [makeAction({ target: '江南大营' })]
    })
    const targetEl = wrapper.find('.npc-action-item__target')
    expect(targetEl.exists()).toBe(true)
    expect(targetEl.text()).toBe('目标：江南大营')
  })

  it('target 缺省时不渲染目标行', () => {
    const wrapper = mountList({
      actions: [makeAction()]
    })
    expect(wrapper.find('.npc-action-item__target').exists()).toBe(false)
  })

  it('target 为空字符串时不渲染目标行', () => {
    const wrapper = mountList({
      actions: [makeAction({ target: '' })]
    })
    expect(wrapper.find('.npc-action-item__target').exists()).toBe(false)
  })
})

describe('NpcActionList - actionClass 映射', () => {
  const aggressiveCases: Array<[NpcAction['action'], string]> = [
    ['挑衅', 'npc-action-item__action--aggressive'],
    ['扩张', 'npc-action-item__action--aggressive'],
    ['备战', 'npc-action-item__action--aggressive']
  ]
  const friendlyCases: Array<[NpcAction['action'], string]> = [
    ['结盟', 'npc-action-item__action--friendly'],
    ['外交', 'npc-action-item__action--friendly']
  ]

  aggressiveCases.forEach(([action, cls]) => {
    it(`action=${action} → ${cls}`, () => {
      const wrapper = mountList({ actions: [makeAction({ action })] })
      const el = wrapper.find('.npc-action-item__action')
      expect(el.classes()).toContain(cls)
    })
  })

  friendlyCases.forEach(([action, cls]) => {
    it(`action=${action} → ${cls}`, () => {
      const wrapper = mountList({ actions: [makeAction({ action })] })
      const el = wrapper.find('.npc-action-item__action')
      expect(el.classes()).toContain(cls)
    })
  })

  it('action=休养 → neutral 类', () => {
    const wrapper = mountList({ actions: [makeAction({ action: '休养' })] })
    const el = wrapper.find('.npc-action-item__action')
    expect(el.classes()).toContain('npc-action-item__action--neutral')
  })
})

describe('NpcActionList - T2.8 对你影响行渲染', () => {
  it('每条 action 都渲染「对你影响：」标签', () => {
    const wrapper = mountList({ actions: [makeAction()] })
    expect(wrapper.find('.npc-action-item__impact').exists()).toBe(true)
    expect(wrapper.find('.npc-action-item__impact-label').text()).toBe('对你影响：')
  })

  it('有 effects 时渲染 impact-effects 区', () => {
    const wrapper = mountList({
      actions: [makeAction({ effects: { military: 5 } })]
    })
    expect(wrapper.find('.npc-action-item__impact-effects').exists()).toBe(true)
    expect(wrapper.find('.npc-action-item__impact-effects').findAll('.npc-action-item__effect')).toHaveLength(1)
  })

  it('未传 effects 时渲染「暂无直接影响」灰字', () => {
    const wrapper = mountList({
      actions: [makeAction({ effects: undefined })]
    })
    expect(wrapper.find('.npc-action-item__impact-effects').exists()).toBe(false)
    expect(wrapper.find('.npc-action-item__impact-none').exists()).toBe(true)
    expect(wrapper.find('.npc-action-item__impact-none').text()).toBe('暂无直接影响')
  })

  it('effects 全为 0 时渲染「暂无直接影响」灰字', () => {
    const wrapper = mountList({
      actions: [makeAction({ effects: { military: 0, silver: 0 } })]
    })
    expect(wrapper.find('.npc-action-item__impact-effects').exists()).toBe(false)
    expect(wrapper.find('.npc-action-item__impact-none').exists()).toBe(true)
    expect(wrapper.find('.npc-action-item__impact-none').text()).toBe('暂无直接影响')
  })
})

describe('NpcActionList - effects 渲染', () => {
  it('正值 effects 显示 +号 与 positive 类，使用完整词标签', () => {
    const wrapper = mountList({
      actions: [makeAction({ effects: { military: 5, silver: 200 } })]
    })
    const effects = wrapper.find('.npc-action-item__impact-effects').findAll('.npc-action-item__effect')
    expect(effects).toHaveLength(2)
    expect(wrapper.text()).toContain('军事+5')
    expect(wrapper.text()).toContain('银两+200')
    effects.forEach((e) => {
      expect(e.classes()).toContain('npc-action-item__effect--positive')
    })
  })

  it('负值 effects 显示原值 与 negative 类，使用完整词标签', () => {
    const wrapper = mountList({
      actions: [makeAction({ effects: { military: -5, food: -100 } })]
    })
    const effects = wrapper.find('.npc-action-item__impact-effects').findAll('.npc-action-item__effect')
    expect(effects).toHaveLength(2)
    expect(wrapper.text()).toContain('军事-5')
    expect(wrapper.text()).toContain('粮草-100')
    effects.forEach((e) => {
      expect(e.classes()).toContain('npc-action-item__effect--negative')
    })
  })

  it('effects 含非数字值 → 跳过非数字项', () => {
    const wrapper = mountList({
      actions: [
        makeAction({ effects: { military: 5, silver: 'NaN' as unknown as number } })
      ]
    })
    expect(wrapper.find('.npc-action-item__impact-effects').findAll('.npc-action-item__effect')).toHaveLength(1)
    expect(wrapper.text()).toContain('军事+5')
  })
})

describe('NpcActionList - InfoHint 渲染', () => {
  it('标题旁渲染 1 个 InfoHint（解释"天下动静"机制）', () => {
    const wrapper = mountList({ actions: [makeAction()] })
    const titleWrap = wrapper.find('.npc-action-list__title-wrap')
    expect(titleWrap.exists()).toBe(true)
    expect(titleWrap.findAll('.info-hint-stub')).toHaveLength(1)
  })

  it('每个 action 项渲染 1 个 InfoHint（解释该行动后果）', () => {
    const wrapper = mountList({
      actions: [
        makeAction({ factionId: 'f1' }),
        makeAction({ factionId: 'f2' }),
        makeAction({ factionId: 'f3' })
      ]
    })
    const items = wrapper.findAll('.npc-action-item')
    expect(items).toHaveLength(3)
    // 每个 action 项内 1 个 InfoHint
    items.forEach((item) => {
      expect(item.findAll('.info-hint-stub')).toHaveLength(1)
    })
  })

  it('InfoHint 总数 = 1（标题）+ N（每行动 1）', () => {
    const wrapper = mountList({
      actions: [makeAction({ factionId: 'f1' }), makeAction({ factionId: 'f2' })]
    })
    // 1（标题）+ 2（两个 action 项）= 3
    expect(wrapper.findAll('.info-hint-stub')).toHaveLength(3)
  })

  it('空状态时仅标题 1 个 InfoHint（不渲染 items）', () => {
    const wrapper = mountList({ actions: [] })
    expect(wrapper.findAll('.info-hint-stub')).toHaveLength(1)
  })

  it('action-wrap 内 InfoHint 与 action 标签一起渲染', () => {
    const wrapper = mountList({ actions: [makeAction({ action: '备战' })] })
    const actionWrap = wrapper.find('.npc-action-item__action-wrap')
    expect(actionWrap.exists()).toBe(true)
    expect(actionWrap.find('.npc-action-item__action').text()).toBe('备战')
    expect(actionWrap.findAll('.info-hint-stub')).toHaveLength(1)
  })
})

describe('NpcActionList - T3.4 失败标识', () => {
  it('仅 failedFactionIds（无 actions）时仍渲染 items 区与失败卡片', () => {
    const wrapper = mountList({
      actions: [],
      failedFactionIds: [{ id: 'taiping', name: '太平军' }]
    })
    // 不再显示空状态
    expect(wrapper.find('.npc-action-list__empty').exists()).toBe(false)
    expect(wrapper.find('.npc-action-list__items').exists()).toBe(true)
    // 失败卡片渲染
    expect(wrapper.find('.npc-action-item--failed').exists()).toBe(true)
  })

  it('失败卡片显示势力名与「决策失败」角标', () => {
    const wrapper = mountList({
      actions: [],
      failedFactionIds: [{ id: 'taiping', name: '太平军' }]
    })
    const failed = wrapper.find('.npc-action-item--failed')
    expect(failed.find('.npc-action-item__faction').text()).toBe('太平军')
    expect(failed.find('.npc-action-item__fail-badge').text()).toBe('决策失败')
  })

  it('失败卡片数量 = failedFactionIds 长度', () => {
    const wrapper = mountList({
      actions: [makeAction({ factionId: 'f1', factionName: '清廷' })],
      failedFactionIds: [
        { id: 'taiping', name: '太平军' },
        { id: 'huai', name: '淮军' }
      ]
    })
    const failed = wrapper.findAll('.npc-action-item--failed')
    expect(failed).toHaveLength(2)
  })

  it('计数包含失败项（成功 + 失败）', () => {
    const wrapper = mountList({
      actions: [makeAction({ factionId: 'f1', factionName: '清廷' })],
      failedFactionIds: [{ id: 'taiping', name: '太平军' }]
    })
    expect(wrapper.find('.npc-action-list__count').text()).toBe('共 2 则')
  })

  it('失败卡片带 --failed 类（红色边框样式）', () => {
    const wrapper = mountList({
      actions: [],
      failedFactionIds: [{ id: 'taiping', name: '太平军' }]
    })
    const failed = wrapper.find('.npc-action-item--failed')
    expect(failed.classes()).toContain('npc-action-item--failed')
  })
})

describe('NpcActionList - 2026-08-06 累计影响汇总卡', () => {
  it('有 actions 时渲染「本回合累计影响」汇总卡标题', () => {
    const wrapper = mountList({
      actions: [makeAction({ effects: { military: -3, economy: 2 } })]
    })
    expect(wrapper.find('.npc-action-list__cumulative').exists()).toBe(true)
    expect(wrapper.find('.npc-action-list__cumulative-title').text()).toBe(
      '本回合累计影响'
    )
  })

  it('多条 actions 的 effects 按维度累加（军事 -5 + 2 = -3）', () => {
    const wrapper = mountList({
      actions: [
        makeAction({ factionId: 'f1', effects: { military: -5, economy: 3 } }),
        makeAction({ factionId: 'f2', effects: { military: 2, silver: -50 } })
      ]
    })
    // cumulative: military -3, economy 3, silver -50
    const cumEl = wrapper.find('.npc-action-list__cumulative')
    expect(cumEl.text()).toContain('军事-3')
    expect(cumEl.text()).toContain('经济+3')
    expect(cumEl.text()).toContain('银两-50')
  })

  it('累计影响按绝对值降序：银两-50 > 经济+3 / 军事-3', () => {
    const wrapper = mountList({
      actions: [
        makeAction({ factionId: 'f1', effects: { military: -5, economy: 3 } }),
        makeAction({ factionId: 'f2', effects: { military: 2, silver: -50 } })
      ]
    })
    const chips = wrapper
      .find('.npc-action-list__cumulative-effects')
      .findAll('.npc-action-item__effect')
      .map((e) => e.text())
    // 银两(-50) 绝对值最大，排第一
    expect(chips[0]).toBe('银两-50')
  })

  it('空 effects 与 0 值不计入累计', () => {
    const wrapper = mountList({
      actions: [
        makeAction({ factionId: 'f1', effects: {} }),
        makeAction({ factionId: 'f2', effects: { military: 0, silver: 0 } })
      ]
    })
    // 全部为 0 / 空 → 无 effect chip，显示空态文案
    expect(wrapper.find('.npc-action-list__cumulative-effects').exists()).toBe(false)
    expect(wrapper.find('.npc-action-list__cumulative-empty').text()).toBe(
      '本回合各方按兵不动，暂无累计影响'
    )
  })

  it('各 action 含非数字 effects 值被跳过', () => {
    const wrapper = mountList({
      actions: [
        makeAction({ factionId: 'f1', effects: { military: -5, silver: 'NaN' as unknown as number } })
      ]
    })
    const cumEl = wrapper.find('.npc-action-list__cumulative')
    expect(cumEl.text()).toContain('军事-5')
    expect(cumEl.text()).not.toContain('银两')
  })

  it('决策失败项（failedFactionIds）不计入累计，且 actions 为空时不显示汇总卡', () => {
    const wrapper = mountList({
      actions: [],
      failedFactionIds: [{ id: 'taiping', name: '太平军' }]
    })
    // 仅渲染 items 区与失败卡片，不渲染累计汇总卡
    expect(wrapper.find('.npc-action-list__cumulative').exists()).toBe(false)
    expect(wrapper.find('.npc-action-item--failed').exists()).toBe(true)
  })

  it('actions 非空 + 失败项共存时，汇总卡仅聚合 actions 的 effects', () => {
    const wrapper = mountList({
      actions: [makeAction({ factionId: 'f1', effects: { military: -2 } })],
      failedFactionIds: [{ id: 'taiping', name: '太平军' }]
    })
    const cumEl = wrapper.find('.npc-action-list__cumulative')
    expect(cumEl.exists()).toBe(true)
    expect(cumEl.text()).toContain('军事-2')
    expect(cumEl.text()).not.toContain('太平军')
  })
})
