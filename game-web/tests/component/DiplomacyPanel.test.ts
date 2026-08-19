/**
 * @file DiplomacyPanel.vue 组件测试
 *
 * 覆盖（player-active-diplomacy 提案 T3）：
 *   - 渲染全部势力列表（每势力 6 个动作按钮）
 *   - 门槛禁用：关系不足势力的「结盟」按钮置 --disabled
 *   - 可用按钮点击调用 store.applyDiplomacyAction（传 factionId + action）
 *   - 禁用按钮点击不调用 store（仅靠 UI 预校验拦截）
 *   - 关系条宽度随 relationship 映射（100 → 100%）
 *   - 剩余次数展示
 *   - close 按钮 emit('close')
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import DiplomacyPanel from '../../src/components/DiplomacyPanel.vue'
import { useGameStore } from '../../src/stores/game'
import type { GameSave } from '../../src/types/game'

const stubs = { view: 'div', text: 'span' }

function buildMockSave(): GameSave {
  return {
    saveVersion: 2,
    saveId: '550e8400-e29b-41d4-a716-446655440000',
    deviceId: 'test-device-id',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    character: {
      background: '文官',
      backgroundPerks: { politics: 5 },
      factionId: 'f1',
      factionName: '清廷',
      factionSummary: '晚清朝廷'
    },
    state: {
      turn: 1,
      date: { year: 1851, month: 1 },
      attributes: { military: 50, economy: 50, politics: 55, people: 50, diplomacy: 50 },
      // 资源充足，确保按钮不被资源门槛禁用，便于单独验证关系门槛
      resources: { silver: 5000, troops: 5000, food: 5000, reputation: 500 }
    },
    factions: [
      { id: 'f1', name: '清廷', summary: '', power: 70, relationship: 100, status: 'active' },
      { id: 'f2', name: '太平天国', summary: '', power: 60, relationship: -50, status: 'active' },
      { id: 'f3', name: '湘军', summary: '', power: 50, relationship: 20, status: 'active' },
      { id: 'f4', name: '革命党', summary: '', power: 40, relationship: -20, status: 'active' },
      { id: 'f5', name: '北洋', summary: '', power: 45, relationship: 0, status: 'active' },
      { id: 'f6', name: '淮军', summary: '', power: 55, relationship: 30, status: 'active' }
    ],
    events: [],
    advisorMessages: [],
    pendingChainNodes: [],
    completedChainIds: [],
    activeChainIds: [],
    ended: false
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

function mountPanel() {
  const store = useGameStore()
  store.setSave(buildMockSave())
  const wrapper = mount(DiplomacyPanel, { global: { stubs } })
  return { store, wrapper }
}

describe('DiplomacyPanel - 渲染', () => {
  it('渲染全部 6 个势力', () => {
    const { wrapper } = mountPanel()
    expect(wrapper.findAll('.diplomacy-panel__faction')).toHaveLength(6)
  })

  it('每个势力渲染 6 个外交动作按钮 + 1 个写信谈判入口', () => {
    const { wrapper } = mountPanel()
    const factions = wrapper.findAll('.diplomacy-panel__faction')
    // faction-negotiation 提案 T6：6 动作按钮之外新增「写信」入口（共用 __action 类）
    expect(factions[0].findAll('.diplomacy-panel__action')).toHaveLength(7)
    expect(factions[0].find('.diplomacy-panel__action--letter').exists()).toBe(true)
  })

  it('显示本回合剩余次数', () => {
    const { wrapper } = mountPanel()
    expect(wrapper.find('.diplomacy-panel__remaining').text()).toContain('1')
  })

  it('关系 100 的势力关系条宽度为 100%', () => {
    const { wrapper } = mountPanel()
    const f1Fill = wrapper.findAll('.diplomacy-panel__faction')[0].find('.diplomacy-panel__bar-fill')
    expect(f1Fill.attributes('style')).toContain('100%')
  })
})

describe('DiplomacyPanel - 按钮禁用态（门槛）', () => {
  it('关系 ≥50 的势力「结盟」可用', () => {
    const { wrapper } = mountPanel()
    const f1Actions = wrapper.findAll('.diplomacy-panel__faction')[0].findAll(
      '.diplomacy-panel__action'
    )
    // actionList[0] = 结盟
    expect(f1Actions[0].classes()).not.toContain('diplomacy-panel__action--disabled')
  })

  it('关系 <50 的势力「结盟」禁用', () => {
    const { wrapper } = mountPanel()
    const f2Actions = wrapper.findAll('.diplomacy-panel__faction')[1].findAll(
      '.diplomacy-panel__action'
    )
    // 太平天国 relationship=-50 < 50
    expect(f2Actions[0].classes()).toContain('diplomacy-panel__action--disabled')
  })

  it('结盟门槛对所有非友好势力生效（批量）', () => {
    const { wrapper } = mountPanel()
    const factions = wrapper.findAll('.diplomacy-panel__faction')
    // 仅 f1（rel 100）结盟可用，其余 5 个结盟禁用
    const allyDisabledCount = factions
      .map((f) => f.findAll('.diplomacy-panel__action')[0])
      .filter((btn) => btn.classes().includes('diplomacy-panel__action--disabled')).length
    expect(allyDisabledCount).toBe(5)
  })
})

describe('DiplomacyPanel - 交互', () => {
  it('点击可用按钮调用 store.applyDiplomacyAction（传 factionId + action）', async () => {
    const { store, wrapper } = mountPanel()
    const spy = vi.spyOn(store, 'applyDiplomacyAction')
    const f1Actions = wrapper.findAll('.diplomacy-panel__faction')[0].findAll(
      '.diplomacy-panel__action'
    )
    await f1Actions[0].trigger('click') // 结盟
    expect(spy).toHaveBeenCalledWith('f1', '结盟')
  })

  it('点击禁用按钮不调用 store.applyDiplomacyAction', async () => {
    const { store, wrapper } = mountPanel()
    const spy = vi.spyOn(store, 'applyDiplomacyAction')
    const f2Actions = wrapper.findAll('.diplomacy-panel__faction')[1].findAll(
      '.diplomacy-panel__action'
    )
    await f2Actions[0].trigger('click') // 结盟（禁用）
    expect(spy).not.toHaveBeenCalled()
  })

  it('close 按钮 emit close 事件', async () => {
    const { wrapper } = mountPanel()
    await wrapper.find('.diplomacy-panel__close').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
