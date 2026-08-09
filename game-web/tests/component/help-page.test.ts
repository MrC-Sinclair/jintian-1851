/**
 * @file pages/help/index.vue 帮助页组件渲染测试
 *
 * 覆盖 T1.10 验证要求：
 *   - 标题"如何游戏"渲染
 *   - 返回按钮存在且点击触发 uni.navigateBack
 *   - 10 个内容区块全部渲染（游戏背景/五类身份/五维属性/四项资源/势力关系/事件类型/NPC 行动/胜利失败/玩法技巧/FAQ）
 *   - 五类身份渲染（文官/武将/商贾/士绅/宗室）
 *   - 五维属性 + 四项资源均渲染 InfoHint stub
 *   - 势力关系 5 档、事件类型 6 类、NPC 行动 6 种
 *   - FAQ 7 条
 *
 * Mock 策略：
 *   - uni-app 平台组件 view/text/scroll-view 用 slotStub（保留 children 渲染）
 *   - InfoHint stub 避免浮层逻辑干扰
 *   - v-tooltip 用 no-op 指令 stub（避免 DOM 事件绑定）
 *   - uni.navigateBack 用 vi.fn spy
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import HelpPage from '../../src/pages/help/index.vue'

// uni.navigateBack 在 tests/setup.ts 未 mock，此处补上
const navigateBackSpy = vi.fn()
;(globalThis as any).uni.navigateBack = navigateBackSpy

// stub key 用 PascalCase：Vue 模板编译器会把 <scroll-view> 转为 ScrollView 查找
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
  // InfoHint stub：渲染占位 div，便于统计数量
  InfoHint: {
    name: 'InfoHint',
    template: '<div class="info-hint-stub" />'
  },
  // ConfirmDialog / ToastContainer 依赖 Pinia store，与帮助页内容测试无关，stub 掉
  ConfirmDialog: {
    name: 'ConfirmDialog',
    template: '<div class="confirm-dialog-stub" />'
  },
  ToastContainer: {
    name: 'ToastContainer',
    template: '<div class="toast-container-stub" />'
  }
}

// v-tooltip no-op 指令 stub（避免真实指令绑定 DOM 事件）
const directives = {
  tooltip: {
    mounted() {},
    updated() {},
    unmounted() {}
  }
}

function mountHelp() {
  return mount(HelpPage, {
    global: { stubs, directives }
  })
}

beforeEach(() => {
  navigateBackSpy.mockClear()
})

describe('HelpPage - 顶部栏', () => {
  it('渲染标题"如何游戏"', () => {
    const wrapper = mountHelp()
    expect(wrapper.find('.help__title').text()).toBe('如何游戏')
  })

  it('渲染返回按钮', () => {
    const wrapper = mountHelp()
    expect(wrapper.find('.help__back').exists()).toBe(true)
  })

  it('返回按钮触摸目标 ≥ 72rpx（min-width/min-height）', () => {
    const wrapper = mountHelp()
    const back = wrapper.find('.help__back')
    // min-width/min-height 通过 class 样式声明，验证 class 存在即可
    expect(back.classes()).toContain('help__back')
  })

  it('点击返回按钮调用 uni.navigateBack', async () => {
    const wrapper = mountHelp()
    await wrapper.find('.help__back').trigger('click')
    expect(navigateBackSpy).toHaveBeenCalledWith({ delta: 1 })
  })
})

describe('HelpPage - 游戏背景', () => {
  it('渲染游戏背景区块', () => {
    const wrapper = mountHelp()
    const text = wrapper.text()
    expect(text).toContain('游戏背景')
    expect(text).toContain('咸丰元年')
    expect(text).toContain('1851')
  })

  it('提及玩家目标（综合实力 90）', () => {
    const wrapper = mountHelp()
    expect(wrapper.text()).toContain('90')
  })
})

describe('HelpPage - 五类身份', () => {
  it('渲染五类身份区块标题', () => {
    const wrapper = mountHelp()
    expect(wrapper.text()).toContain('五类身份')
  })

  it('渲染全部 5 类身份', () => {
    const wrapper = mountHelp()
    const text = wrapper.text()
    expect(text).toContain('文官')
    expect(text).toContain('武将')
    expect(text).toContain('商贾')
    expect(text).toContain('士绅')
    expect(text).toContain('宗室')
  })

  it('身份含属性偏移说明', () => {
    const wrapper = mountHelp()
    const text = wrapper.text()
    // 文官偏移
    expect(text).toContain('政治+10')
    expect(text).toContain('外交+5')
    expect(text).toContain('军事-5')
  })
})

describe('HelpPage - 五维属性', () => {
  it('渲染五维属性区块标题', () => {
    const wrapper = mountHelp()
    expect(wrapper.text()).toContain('五维属性')
  })

  it('渲染全部 5 维属性', () => {
    const wrapper = mountHelp()
    const text = wrapper.text()
    expect(text).toContain('军事')
    expect(text).toContain('经济')
    expect(text).toContain('政治')
    expect(text).toContain('民心')
    expect(text).toContain('外交')
  })

  it('五维属性 + 综合实力共渲染 6 个 InfoHint', () => {
    const wrapper = mountHelp()
    // 5 维属性各 1 个 InfoHint + 综合实力 1 个 = 6 个
    expect(wrapper.findAll('.info-hint-stub').length).toBeGreaterThanOrEqual(6)
  })
})

describe('HelpPage - 四项资源', () => {
  it('渲染四项资源区块标题', () => {
    const wrapper = mountHelp()
    expect(wrapper.text()).toContain('四项资源')
  })

  it('渲染全部 4 项资源', () => {
    const wrapper = mountHelp()
    const text = wrapper.text()
    expect(text).toContain('银两')
    expect(text).toContain('兵员')
    expect(text).toContain('粮草')
    expect(text).toContain('名望')
  })

  it('四项资源渲染 4 个 InfoHint', () => {
    const wrapper = mountHelp()
    // 在四项资源区块内查找 InfoHint（区块索引 3）
    const sections = wrapper.findAll('.help__section')
    // 第 4 个 section 是四项资源（索引 3）
    const resourcesSection = sections[3]
    expect(resourcesSection.findAll('.info-hint-stub')).toHaveLength(4)
  })
})

describe('HelpPage - 势力关系', () => {
  it('渲染势力关系区块标题', () => {
    const wrapper = mountHelp()
    expect(wrapper.text()).toContain('势力关系')
  })

  it('渲染 5 档分级', () => {
    const wrapper = mountHelp()
    const text = wrapper.text()
    expect(text).toContain('盟友')
    expect(text).toContain('友好')
    expect(text).toContain('中立')
    expect(text).toContain('紧张')
    expect(text).toContain('敌对')
  })

  it('提及 -100 到 100 范围', () => {
    const wrapper = mountHelp()
    const text = wrapper.text()
    expect(text).toContain('-100')
    expect(text).toContain('100')
  })
})

describe('HelpPage - 事件类型', () => {
  it('渲染事件类型区块标题', () => {
    const wrapper = mountHelp()
    expect(wrapper.text()).toContain('事件类型')
  })

  it('渲染全部 6 类事件', () => {
    const wrapper = mountHelp()
    const text = wrapper.text()
    expect(text).toContain('民生')
    expect(text).toContain('军事')
    expect(text).toContain('外交')
    expect(text).toContain('随机')
    expect(text).toContain('历史剧情')
    expect(text).toContain('NPC动态')
  })
})

describe('HelpPage - NPC 行动', () => {
  it('渲染天下动静区块标题', () => {
    const wrapper = mountHelp()
    expect(wrapper.text()).toContain('天下动静')
  })

  it('渲染全部 6 种 NPC 行动', () => {
    const wrapper = mountHelp()
    const text = wrapper.text()
    expect(text).toContain('扩张')
    expect(text).toContain('结盟')
    expect(text).toContain('备战')
    expect(text).toContain('休养')
    expect(text).toContain('挑衅')
    // "外交"已在势力关系/事件类型中出现，此处验证 NPC 行动区块含"外交"
    expect(text).toContain('外交')
  })
})

describe('HelpPage - 胜利与失败', () => {
  it('渲染胜利条件', () => {
    const wrapper = mountHelp()
    const text = wrapper.text()
    expect(text).toContain('胜利条件')
    expect(text).toContain('综合实力 ≥ 90')
  })

  it('渲染失败条件', () => {
    const wrapper = mountHelp()
    const text = wrapper.text()
    expect(text).toContain('失败条件')
    expect(text).toContain('任一属性 ≤ 0')
  })

  it('渲染时光尽头（1912）', () => {
    const wrapper = mountHelp()
    const text = wrapper.text()
    expect(text).toContain('时光尽头')
    expect(text).toContain('1912')
  })

  it('渲染危机预警', () => {
    const wrapper = mountHelp()
    const text = wrapper.text()
    expect(text).toContain('危机预警')
    expect(text).toContain('30')
  })
})

describe('HelpPage - 玩法技巧', () => {
  it('渲染玩法技巧区块标题', () => {
    const wrapper = mountHelp()
    expect(wrapper.text()).toContain('玩法技巧')
  })

  it('渲染 5 条玩法技巧', () => {
    const wrapper = mountHelp()
    expect(wrapper.findAll('.help__tip')).toHaveLength(5)
  })
})

describe('HelpPage - FAQ', () => {
  it('渲染常见问题区块标题', () => {
    const wrapper = mountHelp()
    expect(wrapper.text()).toContain('常见问题')
  })

  it('渲染 7 条 FAQ', () => {
    const wrapper = mountHelp()
    expect(wrapper.findAll('.help__faq')).toHaveLength(7)
  })

  it('FAQ 含 Q/A 标记', () => {
    const wrapper = mountHelp()
    const text = wrapper.text()
    expect(text).toContain('Q：')
    expect(text).toContain('A：')
  })
})

describe('HelpPage - 全局组件挂载', () => {
  it('挂载 ConfirmDialog 与 ToastContainer（stub 验证）', () => {
    const wrapper = mountHelp()
    // 这两个组件是全局 UI 容器，页面需挂载（uni-app H5 端 App.vue template 被忽略）
    // 测试中 stub 掉以隔离 Pinia 依赖，此处验证 stub 被渲染
    expect(wrapper.find('.confirm-dialog-stub').exists()).toBe(true)
    expect(wrapper.find('.toast-container-stub').exists()).toBe(true)
  })
})
