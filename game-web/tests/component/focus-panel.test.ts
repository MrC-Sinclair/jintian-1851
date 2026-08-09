/**
 * @file FocusPanel.vue 组件渲染测试
 *
 * 覆盖 T1.7 验证要求：
 *   - 综合实力进度条渲染（数值、90 阈值刻度、胜利态）
 *   - 危机渲染（属性 < 30 显示危机行）
 *   - 无危机渲染（全 ≥ 30 不显示危机行）
 *   - briefing 覆盖建议（briefing.suggestion 优先于规则 suggestion）
 *   - 无 briefing / briefing.suggestion 为空时回退规则建议
 *   - InfoHint 渲染（综合实力 + 危机预警）
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FocusPanel from '../../src/components/FocusPanel.vue'
import type { Attributes, PendingChainNode } from '../../src/types/game'

const stubs = {
  view: 'div',
  text: 'span',
  // stub InfoHint 避免浮层逻辑干扰 FocusPanel 测试
  InfoHint: {
    name: 'InfoHint',
    template: '<div class="info-hint-stub" />'
  }
}

const safeAttrs: Attributes = {
  military: 50,
  economy: 50,
  politics: 50,
  people: 50,
  diplomacy: 50
}

const crisisAttrs: Attributes = {
  military: 15,
  economy: 50,
  politics: 50,
  people: 50,
  diplomacy: 50
}

const multiCrisisAttrs: Attributes = {
  military: 10,
  economy: 25,
  politics: 50,
  people: 50,
  diplomacy: 50
}

function mountPanel(
  attrs: Attributes = safeAttrs,
  briefing: { summary: string; suggestion: string } | null = null,
  pendingChainNodes: PendingChainNode[] = []
) {
  return mount(FocusPanel, {
    props: { attributes: attrs, briefing, pendingChainNodes },
    global: { stubs }
  })
}

describe('FocusPanel - 综合实力进度条', () => {
  it('渲染综合实力标签与当前值', () => {
    const wrapper = mountPanel(safeAttrs)
    expect(wrapper.find('.focus-panel__power-label').text()).toBe('综合实力')
    // 全 50 → 综合 50/100
    expect(wrapper.find('.focus-panel__power-value').text()).toBe('50/100')
  })

  it('渲染 90 阈值刻度竖线与标签', () => {
    const wrapper = mountPanel(safeAttrs)
    expect(wrapper.find('.focus-panel__bar-threshold').exists()).toBe(true)
    expect(wrapper.find('.focus-panel__bar-threshold-label').text()).toBe('90')
  })

  it('进度条宽度 = 综合实力百分比（全 50 → 50%）', () => {
    const wrapper = mountPanel(safeAttrs)
    expect(wrapper.find('.focus-panel__bar-fill').attributes('style')).toContain('width: 50%')
  })

  it('综合实力 ≥ 90 时显示胜利态（绿色填充）', () => {
    const attrs: Attributes = { military: 90, economy: 90, politics: 90, people: 90, diplomacy: 90 }
    const wrapper = mountPanel(attrs)
    const fill = wrapper.find('.focus-panel__bar-fill')
    expect(fill.classes()).toContain('focus-panel__bar-fill--victory')
    expect(wrapper.find('.focus-panel__power-value').classes()).toContain('focus-panel__power-value--victory')
  })

  it('综合实力 < 90 时不显示胜利态', () => {
    const wrapper = mountPanel(safeAttrs)
    expect(wrapper.find('.focus-panel__bar-fill').classes()).not.toContain('focus-panel__bar-fill--victory')
  })

  it('综合实力 > 100 时进度条 clamp 到 100%', () => {
    const attrs: Attributes = { military: 150, economy: 150, politics: 150, people: 150, diplomacy: 150 }
    const wrapper = mountPanel(attrs)
    expect(wrapper.find('.focus-panel__bar-fill').attributes('style')).toContain('width: 100%')
  })

  it('渲染 InfoHint 组件（综合实力解释）', () => {
    const wrapper = mountPanel(safeAttrs)
    // 综合 + 危机（如有）共渲染 InfoHint stub
    expect(wrapper.findAll('.info-hint-stub').length).toBeGreaterThanOrEqual(1)
  })
})

describe('FocusPanel - 危机渲染', () => {
  it('属性 < 30 时渲染危机行', () => {
    const wrapper = mountPanel(crisisAttrs)
    expect(wrapper.find('.focus-panel__crisis').exists()).toBe(true)
  })

  it('危机行显示属性中文名 + 数值 + 「濒临崩溃」', () => {
    const wrapper = mountPanel(crisisAttrs)
    const text = wrapper.find('.focus-panel__crisis-text').text()
    expect(text).toContain('军事')
    expect(text).toContain('15')
    expect(text).toContain('濒临崩溃')
  })

  it('危机行渲染警告三角图标', () => {
    const wrapper = mountPanel(crisisAttrs)
    expect(wrapper.find('.focus-panel__crisis-icon').exists()).toBe(true)
    expect(wrapper.find('.focus-panel__crisis-icon-text').text()).toBe('!')
  })

  it('危机行渲染 InfoHint（危机预警解释）', () => {
    const wrapper = mountPanel(crisisAttrs)
    // 综合 + 危机 共 2 个 InfoHint
    expect(wrapper.findAll('.info-hint-stub')).toHaveLength(2)
  })

  it('多属性 < 30 时取最低者显示', () => {
    // military=10, economy=25，最低为 military=10
    const wrapper = mountPanel(multiCrisisAttrs)
    const text = wrapper.find('.focus-panel__crisis-text').text()
    expect(text).toContain('军事')
    expect(text).toContain('10')
  })

  it('全属性 ≥ 30 时不渲染危机行', () => {
    const wrapper = mountPanel(safeAttrs)
    expect(wrapper.find('.focus-panel__crisis').exists()).toBe(false)
  })

  it('属性恰好 30 时不触发危机（边界 < 30）', () => {
    const attrs: Attributes = { military: 30, economy: 50, politics: 50, people: 50, diplomacy: 50 }
    const wrapper = mountPanel(attrs)
    expect(wrapper.find('.focus-panel__crisis').exists()).toBe(false)
  })

  it('属性 29 时触发危机（边界 < 30）', () => {
    const attrs: Attributes = { military: 29, economy: 50, politics: 50, people: 50, diplomacy: 50 }
    const wrapper = mountPanel(attrs)
    expect(wrapper.find('.focus-panel__crisis').exists()).toBe(true)
    expect(wrapper.find('.focus-panel__crisis-text').text()).toContain('29')
  })

  it('危机行无 InfoHint stub 时数量正确（无危机态）', () => {
    const wrapper = mountPanel(safeAttrs)
    // 无危机时仅综合实力 1 个 InfoHint
    expect(wrapper.findAll('.info-hint-stub')).toHaveLength(1)
  })
})

describe('FocusPanel - 建议行（briefing 覆盖规则建议）', () => {
  it('无 briefing 时使用规则建议（无危机场景）', () => {
    const wrapper = mountPanel(safeAttrs)
    const text = wrapper.find('.focus-panel__suggestion-text').text()
    expect(text).toContain('本回合建议：')
    // 无危机 + 未胜利 → 稳步发展
    expect(text).toContain('稳步发展各项实力')
  })

  it('无 briefing 时使用规则建议（危机场景）', () => {
    const wrapper = mountPanel(crisisAttrs)
    const text = wrapper.find('.focus-panel__suggestion-text').text()
    expect(text).toContain('优先应对军事危机')
  })

  it('无 briefing 时使用规则建议（胜利场景）', () => {
    const attrs: Attributes = { military: 90, economy: 90, politics: 90, people: 90, diplomacy: 90 }
    const wrapper = mountPanel(attrs)
    const text = wrapper.find('.focus-panel__suggestion-text').text()
    expect(text).toContain('综合实力已达 90')
  })

  it('briefing.suggestion 存在时覆盖规则建议', () => {
    const wrapper = mountPanel(crisisAttrs, {
      summary: '局势紧张',
      suggestion: '建议立即招募新兵补充军力'
    })
    const text = wrapper.find('.focus-panel__suggestion-text').text()
    expect(text).toContain('本回合建议：建议立即招募新兵补充军力')
    // 不再包含规则建议
    expect(text).not.toContain('优先应对军事危机')
  })

  it('briefing.suggestion 为空字符串时回退规则建议', () => {
    const wrapper = mountPanel(crisisAttrs, {
      summary: '局势紧张',
      suggestion: ''
    })
    const text = wrapper.find('.focus-panel__suggestion-text').text()
    expect(text).toContain('优先应对军事危机')
  })

  it('briefing.suggestion 为纯空白时回退规则建议', () => {
    const wrapper = mountPanel(crisisAttrs, {
      summary: '局势紧张',
      suggestion: '   '
    })
    const text = wrapper.find('.focus-panel__suggestion-text').text()
    expect(text).toContain('优先应对军事危机')
  })

  it('briefing 为 null 时使用规则建议', () => {
    const wrapper = mountPanel(crisisAttrs, null)
    const text = wrapper.find('.focus-panel__suggestion-text').text()
    expect(text).toContain('优先应对军事危机')
  })

  it('建议行渲染灯泡图标', () => {
    const wrapper = mountPanel(safeAttrs)
    expect(wrapper.find('.focus-panel__suggestion-icon').exists()).toBe(true)
    expect(wrapper.find('.focus-panel__suggestion-svg').exists()).toBe(true)
  })
})

describe('FocusPanel - 始终展开', () => {
  it('渲染根容器', () => {
    const wrapper = mountPanel(safeAttrs)
    expect(wrapper.find('.focus-panel').exists()).toBe(true)
  })

  it('无折叠状态类（始终展开，无 collapsed 类）', () => {
    const wrapper = mountPanel(safeAttrs)
    expect(wrapper.find('.focus-panel').classes()).not.toContain('focus-panel--collapsed')
  })

  it('渲染综合实力区块', () => {
    const wrapper = mountPanel(safeAttrs)
    expect(wrapper.find('.focus-panel__power').exists()).toBe(true)
  })

  it('始终渲染建议行（无论是否有危机）', () => {
    const wrapper = mountPanel(safeAttrs)
    expect(wrapper.find('.focus-panel__suggestion').exists()).toBe(true)
  })
})

describe('FocusPanel - T4.3 剧情待续提示', () => {
  const taiPingNode: PendingChainNode = {
    chainId: 'tai-ping-tian-guo',
    nodeId: 'node-1',
    scheduledTurn: 5
  }

  it('pendingChainNodes 为空时不渲染剧情待续条', () => {
    const wrapper = mountPanel(safeAttrs)
    expect(wrapper.find('.focus-panel__pending').exists()).toBe(false)
  })

  it('pendingChainNodes 非空时渲染剧情待续条 + 书卷图标 + 标题', () => {
    const wrapper = mountPanel(safeAttrs, null, [taiPingNode])
    expect(wrapper.find('.focus-panel__pending').exists()).toBe(true)
    expect(wrapper.find('.focus-panel__pending-icon').exists()).toBe(true)
    expect(wrapper.find('.focus-panel__pending-svg').exists()).toBe(true)
    expect(wrapper.find('.focus-panel__pending-title').text()).toBe('剧情待续')
    // 数量徽标
    expect(wrapper.find('.focus-panel__pending-count').text()).toBe('1 条')
    // 折叠态文案为「点击查看详情」（默认未展开）
    expect(wrapper.find('.focus-panel__pending-toggle').text()).toBe('点击查看详情')
    expect(wrapper.find('.focus-panel__pending').classes()).not.toContain(
      'focus-panel__pending--expanded'
    )
  })

  it('多条挂起剧情链时数量徽标正确', () => {
    const nodes: PendingChainNode[] = [
      taiPingNode,
      { chainId: 'jia-wu-zhan-zheng', nodeId: 'node-1', scheduledTurn: 6 }
    ]
    const wrapper = mountPanel(safeAttrs, null, nodes)
    expect(wrapper.find('.focus-panel__pending-count').text()).toBe('2 条')
  })

  it('点击提示条展开：出现 expanded 类并显示链名/进度/简介/下节标题', async () => {
    const wrapper = mountPanel(safeAttrs, null, [taiPingNode])
    await wrapper.find('.focus-panel__pending').trigger('click')
    await wrapper.vm.$nextTick()
    const pending = wrapper.find('.focus-panel__pending')
    expect(pending.classes()).toContain('focus-panel__pending--expanded')
    expect(wrapper.find('.focus-panel__pending-toggle').text()).toBe('收起')
    // 链名来自 CHAIN_LABELS
    expect(wrapper.find('.focus-panel__pending-item-title').text()).toBe('太平天国兴亡')
    // 进度文案：node-1 在 5 节链中 → 剧情 1/5
    expect(wrapper.find('.focus-panel__pending-item-progress').text()).toBe('剧情 1/5')
    // 简介（非空）
    expect(wrapper.find('.focus-panel__pending-item-desc').text()).toBeTruthy()
    // 下节标题来自 getNodeTitle（node-1 → 金田起义）+ 计划回合
    const next = wrapper.find('.focus-panel__pending-item-next').text()
    expect(next).toContain('金田起义')
    expect(next).toContain('第 5 回合')
  })

  it('再次点击收起：移除 expanded 类', async () => {
    const wrapper = mountPanel(safeAttrs, null, [taiPingNode])
    const el = wrapper.find('.focus-panel__pending')
    await el.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.focus-panel__pending').classes()).toContain(
      'focus-panel__pending--expanded'
    )
    await wrapper.find('.focus-panel__pending').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.focus-panel__pending').classes()).not.toContain(
      'focus-panel__pending--expanded'
    )
  })

  it('未知 chainId / nodeId 时兜底为原始 id 与「未知剧情」', () => {
    const wrapper = mountPanel(safeAttrs, null, [
      { chainId: 'unknown-chain', nodeId: 'node-x', scheduledTurn: 3 }
    ])
    expect(wrapper.find('.focus-panel__pending-item-title').text()).toBe('unknown-chain')
    // 进度文案：节点无效 → 空（v-if 不渲染）
    expect(wrapper.find('.focus-panel__pending-item-progress').exists()).toBe(false)
    expect(wrapper.find('.focus-panel__pending-item-next').text()).toContain('未知剧情')
  })
})
