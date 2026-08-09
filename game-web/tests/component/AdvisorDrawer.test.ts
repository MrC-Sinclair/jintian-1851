/**
 * @file AdvisorDrawer.vue 组件渲染测试
 *
 * 覆盖：
 *   - props 传递（visible）
 *   - visible=false 不渲染
 *   - visible=true 渲染标题「军师对话」
 *   - 空消息 + 非流式 → 默认文案
 *   - store 中的 advisorMessages 渲染
 *   - 流式状态（isStreaming + streamingText）由 mock useAdvisor 控制
 *   - 事件触发（关闭按钮 / mask → close）
 *
 * Mock 策略：
 *   - useAdvisor / useToast 整体 mock（避免触发 useSSE/useGameState 真实网络链路）
 *   - useGameStore 用真实 Pinia + setActivePinia，便于控制 currentSave
 *   - uni-app 平台组件 view/text/scroll-view/textarea 全部 stub
 *
 * 注意：vi.mock 工厂是 hoisted 的，会在 import vue 之前执行，
 * 因此用 async factory + 动态 import vue 来获取 ref，
 * 并通过 vi.hoisted 暴露 refs 容器供测试代码修改。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import AdvisorDrawer from '../../src/components/AdvisorDrawer.vue'
import { useGameStore } from '../../src/stores/game'
import type { AdvisorMessage, BriefingResult, GameSave } from '../../src/types/game'
import type { ToolCallEntry } from '../../src/composables/useAdvisor'

// 共享 ref 容器：vi.hoisted 保证在 vi.mock 工厂执行前定义，
// async 工厂内动态 import vue 后填充 refs
const advisorMock = vi.hoisted(() => ({
  refs: null as null | {
    streamingText: { value: string }
    isStreaming: { value: boolean }
    toolCalls: { value: ToolCallEntry[] }
    briefing: { value: BriefingResult | null }
    briefingTurn: { value: number | null }
  },
  setBriefingMock: vi.fn()
}))

vi.mock('@/composables/useAdvisor', async () => {
  const { ref } = await import('vue')
  advisorMock.refs = {
    streamingText: ref(''),
    isStreaming: ref(false),
    // T2.5：工具调用过程记录 mock（初始空）
    toolCalls: ref<ToolCallEntry[]>([]),
    // T2.6：briefing 模块级单例 mock（初始 null）
    briefing: ref(null),
    briefingTurn: ref(null)
  }
  return {
    useAdvisor: () => ({
      send: vi.fn(),
      abort: vi.fn(),
      streamingText: advisorMock.refs!.streamingText,
      isStreaming: advisorMock.refs!.isStreaming,
      // T2.5：工具调用过程记录
      toolCalls: advisorMock.refs!.toolCalls,
      // T2.6：briefing 模块级单例
      briefing: advisorMock.refs!.briefing,
      briefingTurn: advisorMock.refs!.briefingTurn,
      setBriefing: advisorMock.setBriefingMock
    })
  }
})

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  })
}))

// stub key 用 PascalCase：Vue 模板编译器会把 kebab-case 的 <scroll-view>
// 转换为 PascalCase 组件名 ScrollView 来查找。
// 用 defineComponent + slot 确保 children 渲染（字符串 stub 对多词标签不渲染 slot）
function slotStub(tag: string, name: string) {
  return defineComponent({
    name,
    inheritAttrs: false,
    setup(_, { slots, attrs }) {
      return () => h(tag, { ...attrs }, slots.default?.())
    }
  })
}

const stubs = {
  view: slotStub('div', 'view'),
  text: slotStub('span', 'text'),
  ScrollView: slotStub('div', 'ScrollView'),
  textarea: slotStub('textarea', 'textarea')
}

function createMockSave(overrides: Partial<GameSave> = {}): GameSave {
  return {
    saveVersion: 1,
    saveId: 'test-save-id',
    deviceId: 'test-device',
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
      attributes: {
        military: 50,
        economy: 50,
        politics: 50,
        people: 50,
        diplomacy: 50
      },
      resources: { silver: 1000, troops: 500, food: 800, reputation: 10 }
    },
    factions: [],
    events: [],
    advisorMessages: [],
    ended: false,
    ...overrides
  }
}

function mountDrawer(props: Record<string, unknown>) {
  return mount(AdvisorDrawer, {
    props,
    global: { stubs }
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  // 每个 case 之间重置流式状态 + T2.5 工具调用 + T2.6 briefing 状态
  advisorMock.refs!.streamingText.value = ''
  advisorMock.refs!.isStreaming.value = false
  advisorMock.refs!.toolCalls.value = []
  advisorMock.refs!.briefing.value = null
  advisorMock.refs!.briefingTurn.value = null
  advisorMock.setBriefingMock.mockClear()
})

describe('AdvisorDrawer - visible 控制', () => {
  it('visible=false 时根节点不渲染', () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const wrapper = mountDrawer({ visible: false })
    expect(wrapper.find('.advisor-drawer').exists()).toBe(false)
  })

  it('visible=true 时根节点渲染', () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const wrapper = mountDrawer({ visible: true })
    expect(wrapper.find('.advisor-drawer').exists()).toBe(true)
    expect(wrapper.find('.advisor-drawer__panel').exists()).toBe(true)
  })

  it('visible=true 时渲染标题「军师对话」', () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const wrapper = mountDrawer({ visible: true })
    expect(wrapper.find('.advisor-drawer__title').text()).toBe('军师对话')
  })
})

describe('AdvisorDrawer - 消息渲染', () => {
  it('空消息 + 非流式 → 显示默认提示文案', () => {
    const store = useGameStore()
    store.setSave(createMockSave({ advisorMessages: [] }))
    const wrapper = mountDrawer({ visible: true })
    expect(wrapper.find('.advisor-drawer__empty').exists()).toBe(true)
    // T2.3：文案白话化为「有问题可问我...」
    expect(wrapper.find('.advisor-drawer__empty-text').text()).toContain('有问题可问我')
  })

  it('渲染 store 中的 advisorMessages', () => {
    const store = useGameStore()
    const messages: AdvisorMessage[] = [
      { role: 'user', content: '如何应对太平军？', turn: 1, timestamp: 1 },
      { role: 'assistant', content: '宜安抚为主。', turn: 1, timestamp: 2 }
    ]
    store.setSave(createMockSave({ advisorMessages: messages }))
    const wrapper = mountDrawer({ visible: true })
    const msgEls = wrapper.findAll('.advisor-msg')
    expect(msgEls).toHaveLength(2)
    expect(msgEls[0].classes()).toContain('advisor-msg--user')
    expect(msgEls[1].classes()).toContain('advisor-msg--assistant')
    expect(msgEls[0].find('.advisor-msg__content').text()).toBe('如何应对太平军？')
    expect(msgEls[1].find('.advisor-msg__content').text()).toBe('宜安抚为主。')
  })

  it('无存档时不报错（currentSave=null，messages=[]）', () => {
    const store = useGameStore()
    expect(store.currentSave).toBeNull()
    const wrapper = mountDrawer({ visible: true })
    expect(wrapper.findAll('.advisor-msg')).toHaveLength(0)
  })
})

describe('AdvisorDrawer - 流式状态', () => {
  it('isStreaming=true 且 streamingText 为空 → 显示「军师思索中…」', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const wrapper = mountDrawer({ visible: true })
    advisorMock.refs!.isStreaming.value = true
    advisorMock.refs!.streamingText.value = ''
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.advisor-drawer__waiting').exists()).toBe(true)
    expect(wrapper.find('.advisor-drawer__waiting-text').text()).toBe('军师思索中…')
  })

  it('isStreaming=true 且 streamingText 非空 → 渲染流式文本 + 光标', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const wrapper = mountDrawer({ visible: true })
    advisorMock.refs!.isStreaming.value = true
    advisorMock.refs!.streamingText.value = '臣以为'
    await wrapper.vm.$nextTick()
    const streamingMsg = wrapper.find('.advisor-msg--assistant')
    expect(streamingMsg.exists()).toBe(true)
    expect(streamingMsg.find('.advisor-msg__content').text()).toBe('臣以为')
    expect(streamingMsg.find('.advisor-msg__cursor').exists()).toBe(true)
  })
})

describe('AdvisorDrawer - 事件触发', () => {
  it('点击关闭按钮触发 close 事件', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const wrapper = mountDrawer({ visible: true })
    await wrapper.find('.advisor-drawer__close').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('点击 mask 触发 close 事件', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const wrapper = mountDrawer({ visible: true })
    await wrapper.find('.advisor-drawer__mask').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('流式中关闭 → 仍触发 close', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const wrapper = mountDrawer({ visible: true })
    advisorMock.refs!.isStreaming.value = true
    await wrapper.vm.$nextTick()
    await wrapper.find('.advisor-drawer__close').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})

describe('AdvisorDrawer - 输入与发送', () => {
  it('渲染输入框与发送按钮', () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const wrapper = mountDrawer({ visible: true })
    expect(wrapper.find('.advisor-drawer__textarea').exists()).toBe(true)
    expect(wrapper.find('.advisor-drawer__send').exists()).toBe(true)
    expect(wrapper.find('.advisor-drawer__send-text').text()).toBe('送出')
  })

  it('流式中发送按钮显示 spinner（无「送出」文案）', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const wrapper = mountDrawer({ visible: true })
    advisorMock.refs!.isStreaming.value = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.advisor-drawer__send-spinner').exists()).toBe(true)
    expect(wrapper.find('.advisor-drawer__send-text').exists()).toBe(false)
    expect(wrapper.find('.advisor-drawer__send').classes()).toContain(
      'advisor-drawer__send--loading'
    )
  })
})

// ====================== T2.6: 局势简报自动插入 ======================
describe('AdvisorDrawer - T2.6 局势简报自动插入', () => {
  it('briefing 存在 + 首次打开 → 自动插入 isBriefing 消息', async () => {
    const store = useGameStore()
    store.setSave(createMockSave({ advisorMessages: [] }))
    advisorMock.refs!.briefing.value = { summary: '局势紧张', suggestion: '建议备战' }
    advisorMock.refs!.briefingTurn.value = 1
    const wrapper = mountDrawer({ visible: false })
    // 切换 visible=true 触发 watch，自动插入简报
    await wrapper.setProps({ visible: true })
    expect(store.currentSave!.advisorMessages).toHaveLength(1)
    const msg = store.currentSave!.advisorMessages[0]
    expect(msg.isBriefing).toBe(true)
    expect(msg.role).toBe('assistant')
    expect(msg.content).toContain('局势紧张')
    expect(msg.content).toContain('建议备战')
    expect(msg.turn).toBe(1)
  })

  it('briefing summary 为空时 content 仅含 suggestion', async () => {
    const store = useGameStore()
    store.setSave(createMockSave({ advisorMessages: [] }))
    advisorMock.refs!.briefing.value = { summary: '', suggestion: '只有建议' }
    advisorMock.refs!.briefingTurn.value = 1
    const wrapper = mountDrawer({ visible: false })
    await wrapper.setProps({ visible: true })
    expect(store.currentSave!.advisorMessages[0].content).toBe('只有建议')
  })

  it('同回合再次打开 → 不重复插入', async () => {
    const store = useGameStore()
    store.setSave(createMockSave({ advisorMessages: [] }))
    advisorMock.refs!.briefing.value = { summary: 'x', suggestion: 'y' }
    advisorMock.refs!.briefingTurn.value = 1
    const wrapper = mountDrawer({ visible: false })
    await wrapper.setProps({ visible: true })
    expect(store.currentSave!.advisorMessages).toHaveLength(1)
    // 关闭后再次打开（同回合）
    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true })
    expect(store.currentSave!.advisorMessages).toHaveLength(1)
  })

  it('briefing 为 null → 不插入消息（失败降级场景）', async () => {
    const store = useGameStore()
    store.setSave(createMockSave({ advisorMessages: [] }))
    advisorMock.refs!.briefing.value = null
    advisorMock.refs!.briefingTurn.value = null
    const wrapper = mountDrawer({ visible: false })
    await wrapper.setProps({ visible: true })
    expect(store.currentSave!.advisorMessages).toHaveLength(0)
  })

  it('新回合 briefingTurn 变化 → 再次打开插入新简报', async () => {
    const store = useGameStore()
    store.setSave(createMockSave({ advisorMessages: [] }))
    advisorMock.refs!.briefing.value = { summary: '回合1', suggestion: '建议1' }
    advisorMock.refs!.briefingTurn.value = 1
    const wrapper = mountDrawer({ visible: false })
    await wrapper.setProps({ visible: true })
    expect(store.currentSave!.advisorMessages).toHaveLength(1)
    // 关闭
    await wrapper.setProps({ visible: false })
    // 新回合：briefing 变化
    advisorMock.refs!.briefing.value = { summary: '回合2', suggestion: '建议2' }
    advisorMock.refs!.briefingTurn.value = 2
    await wrapper.setProps({ visible: true })
    expect(store.currentSave!.advisorMessages).toHaveLength(2)
    expect(store.currentSave!.advisorMessages[1].content).toContain('回合2')
    expect(store.currentSave!.advisorMessages[1].turn).toBe(2)
  })

  it('插入的简报消息渲染「局势简报」角标 + briefing 类', async () => {
    const store = useGameStore()
    store.setSave(createMockSave({ advisorMessages: [] }))
    advisorMock.refs!.briefing.value = { summary: 'x', suggestion: 'y' }
    advisorMock.refs!.briefingTurn.value = 1
    const wrapper = mountDrawer({ visible: false })
    await wrapper.setProps({ visible: true })
    await wrapper.vm.$nextTick()
    const briefingMsg = wrapper.find('.advisor-msg--briefing')
    expect(briefingMsg.exists()).toBe(true)
    expect(briefingMsg.find('.advisor-msg__badge').exists()).toBe(true)
    expect(briefingMsg.find('.advisor-msg__badge-text').text()).toBe('局势简报')
  })

  it('无存档时不插入（store.currentSave=null）', async () => {
    const store = useGameStore()
    expect(store.currentSave).toBeNull()
    advisorMock.refs!.briefing.value = { summary: 'x', suggestion: 'y' }
    advisorMock.refs!.briefingTurn.value = 1
    const wrapper = mountDrawer({ visible: false })
    await wrapper.setProps({ visible: true })
    expect(wrapper.findAll('.advisor-msg')).toHaveLength(0)
  })
})

// ====================== T2.5: 工具调用气泡 ======================
describe('AdvisorDrawer - T2.5 工具调用气泡', () => {
  it('toolCalls 为空 → 不渲染 .advisor-tools', () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    const wrapper = mountDrawer({ visible: true })
    expect(wrapper.find('.advisor-tools').exists()).toBe(false)
  })

  it('calling 状态气泡：文案「查询势力详情…」+ advisor-tool--calling 类', () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    advisorMock.refs!.toolCalls.value = [
      {
        toolName: 'get-faction-info',
        label: '势力详情',
        args: { factionId: 'xiang-jun' },
        status: 'calling'
      }
    ]
    const wrapper = mountDrawer({ visible: true })
    const tool = wrapper.find('.advisor-tool')
    expect(tool.exists()).toBe(true)
    expect(tool.classes()).toContain('advisor-tool--calling')
    expect(tool.find('.advisor-tool__label').text()).toBe('查询势力详情…')
  })

  it('done 状态气泡：文案「已查询势力详情」+ advisor-tool--done 类', () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    advisorMock.refs!.toolCalls.value = [
      {
        toolName: 'get-faction-info',
        label: '势力详情',
        args: { factionId: 'xiang-jun' },
        status: 'done',
        result: { faction: { id: 'xiang-jun' } }
      }
    ]
    const wrapper = mountDrawer({ visible: true })
    const tool = wrapper.find('.advisor-tool')
    expect(tool.classes()).toContain('advisor-tool--done')
    expect(tool.find('.advisor-tool__label').text()).toBe('已查询势力详情')
  })

  it('fail 状态气泡：文案「势力详情查询失败」+ advisor-tool--fail 类', () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    advisorMock.refs!.toolCalls.value = [
      {
        toolName: 'get-faction-info',
        label: '势力详情',
        args: { factionId: 'nope' },
        status: 'fail',
        result: { error: 'FACTION_NOT_FOUND', detail: '不存在' }
      }
    ]
    const wrapper = mountDrawer({ visible: true })
    const tool = wrapper.find('.advisor-tool')
    expect(tool.classes()).toContain('advisor-tool--fail')
    expect(tool.find('.advisor-tool__label').text()).toBe('势力详情查询失败')
  })

  it('点击气泡展开/收起详情', async () => {
    const store = useGameStore()
    store.setSave(createMockSave())
    advisorMock.refs!.toolCalls.value = [
      {
        toolName: 'get-faction-info',
        label: '势力详情',
        args: { factionId: 'xiang-jun' },
        status: 'done',
        result: { faction: { id: 'xiang-jun' } }
      }
    ]
    const wrapper = mountDrawer({ visible: true })
    const tool = wrapper.find('.advisor-tool')
    // 初始未展开：详情不存在
    expect(tool.find('.advisor-tool__detail').exists()).toBe(false)
    // 点击展开
    await tool.trigger('click')
    expect(tool.find('.advisor-tool__detail').exists()).toBe(true)
    expect(tool.find('.advisor-tool__detail-line').text()).toContain('工具：get-faction-info')
    // 再点击收起
    await tool.trigger('click')
    expect(tool.find('.advisor-tool__detail').exists()).toBe(false)
  })
})
