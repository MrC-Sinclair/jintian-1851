<template>
  <view class="help">
    <!-- 顶部栏：返回按钮 + 标题 -->
    <view class="help__header">
      <TooltipView :content="TOOLTIP_TEXT.back" placement="bottom">
        <view
          class="help__back"
          :hover-class="'help__back--hover'"
          :hover-stay-time="100"
          @click="onBack"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </view>
      </TooltipView>
      <text class="help__title">如何游戏</text>
      <view class="help__header-placeholder" />
    </view>

    <!-- 内容滚动区 -->
    <scroll-view class="help__body" scroll-y>
      <!-- 1. 游戏背景 -->
      <view class="help__section">
        <text class="help__section-title">游戏背景</text>
        <text class="help__paragraph">
          咸丰元年（1851 年），天下动荡。太平军起事于广西，列强虎视于沿海，朝廷财政枯竭、八旗军力衰微。你将扮演一方势力领袖，在 1851-1912 这六十余年间，通过一项项决策与军师对话，尝试成就霸业——或亲眼见证它的终结。
        </text>
        <text class="help__paragraph">你的目标：让所辖势力的综合实力提升到 90 以上，即可达成胜利结局。</text>
      </view>

      <!-- 2. 五类身份 -->
      <view class="help__section">
        <text class="help__section-title">五类身份</text>
        <text class="help__section-desc">开局选择身份，决定起始属性偏移，影响后续走向。</text>
        <view
          v-for="bg in BACKGROUNDS_HELP"
          :key="bg.name"
          class="help__item"
        >
          <view class="help__item-head">
            <text class="help__item-name">{{ bg.name }}</text>
            <text class="help__item-perks">{{ bg.perks }}</text>
          </view>
          <text class="help__item-desc">{{ bg.desc }}</text>
        </view>
      </view>

      <!-- 3. 五维属性 -->
      <view class="help__section">
        <view class="help__section-head">
          <text class="help__section-title">五维属性</text>
          <InfoHint title="综合实力" :content="TERM_EXPLANATIONS.overallPower" />
        </view>
        <text class="help__section-desc">综合实力 = 五维属性加权平均（政治、民心权重更高），达到 90 即胜利。任一属性 ≤ 0 即失败。</text>
        <view
          v-for="attr in ATTRIBUTES_HELP"
          :key="attr.key"
          class="help__item"
        >
          <view class="help__item-head">
            <text class="help__item-name">{{ attr.name }}</text>
            <InfoHint :title="attr.name" :content="TERM_EXPLANATIONS[attr.key]" />
          </view>
        </view>
      </view>

      <!-- 4. 四项资源 -->
      <view class="help__section">
        <text class="help__section-title">四项资源</text>
        <text class="help__section-desc">资源会随决策消耗，需通过对应属性回复。</text>
        <view
          v-for="res in RESOURCES_HELP"
          :key="res.key"
          class="help__item"
        >
          <view class="help__item-head">
            <text class="help__item-name">{{ res.name }}</text>
            <InfoHint :title="res.name" :content="TERM_EXPLANATIONS[res.key]" />
          </view>
        </view>
      </view>

      <!-- 5. 势力关系 -->
      <view class="help__section">
        <view class="help__section-head">
          <text class="help__section-title">势力关系</text>
          <InfoHint title="势力关系" :content="TERM_EXPLANATIONS.relationship" />
        </view>
        <text class="help__section-desc">取值 -100（敌对）到 100（盟友），共 5 档分级。</text>
        <view
          v-for="rel in RELATIONSHIP_LEVELS_HELP"
          :key="rel.label"
          class="help__item"
        >
          <view class="help__item-head">
            <text class="help__item-name">{{ rel.label }}</text>
            <text class="help__item-perks">{{ rel.range }}</text>
          </view>
          <text class="help__item-desc">{{ rel.desc }}</text>
        </view>
      </view>

      <!-- 6. 事件类型 -->
      <view class="help__section">
        <view class="help__section-head">
          <text class="help__section-title">事件类型</text>
          <InfoHint title="事件类型" :content="TERM_EXPLANATIONS.eventType" />
        </view>
        <view
          v-for="evt in EVENT_TYPES_HELP"
          :key="evt.type"
          class="help__item"
        >
          <view class="help__item-head">
            <text class="help__item-name">{{ evt.type }}</text>
          </view>
          <text class="help__item-desc">{{ evt.desc }}</text>
        </view>
      </view>

      <!-- 7. NPC 行动 -->
      <view class="help__section">
        <view class="help__section-head">
          <text class="help__section-title">天下动静（NPC 行动）</text>
          <InfoHint title="天下动静" :content="TERM_EXPLANATIONS.npcAction" />
        </view>
        <text class="help__section-desc">每回合其他势力会自主行动，可能影响你的属性与资源。</text>
        <view
          v-for="npc in NPC_ACTIONS_HELP"
          :key="npc.type"
          class="help__item"
        >
          <view class="help__item-head">
            <text class="help__item-name">{{ npc.type }}</text>
          </view>
          <text class="help__item-desc">{{ npc.desc }}</text>
        </view>
      </view>

      <!-- 8. 胜利与失败 -->
      <view class="help__section">
        <text class="help__section-title">胜利与失败</text>
        <view class="help__item">
          <text class="help__item-name help__item-name--victory">胜利条件</text>
          <text class="help__item-desc">综合实力 ≥ 90，达成霸业结局。</text>
        </view>
        <view class="help__item">
          <text class="help__item-name help__item-name--defeat">失败条件</text>
          <text class="help__item-desc">任一属性 ≤ 0，对应维度崩溃（军事/经济/政治/民心/外交）。</text>
        </view>
        <view class="help__item">
          <text class="help__item-name help__item-name--neutral">时光尽头</text>
          <text class="help__item-desc">推进到 1912 年 12 月仍未达成胜利，按最终综合实力评分结算。</text>
        </view>
        <view class="help__item">
          <view class="help__item-head">
            <text class="help__item-name">危机预警</text>
            <InfoHint title="危机预警" :content="TERM_EXPLANATIONS.crisis" />
          </view>
          <text class="help__item-desc">属性低于 30 时触发，需尽快应对。</text>
        </view>
      </view>

      <!-- 9. 玩法技巧 -->
      <view class="help__section">
        <text class="help__section-title">玩法技巧</text>
        <view
          v-for="(tip, idx) in PLAY_TIPS"
          :key="idx"
          class="help__tip"
        >
          <text class="help__tip-num">{{ idx + 1 }}</text>
          <text class="help__tip-text">{{ tip }}</text>
        </view>
      </view>

      <!-- 10. FAQ -->
      <view class="help__section">
        <text class="help__section-title">常见问题</text>
        <view
          v-for="(faq, idx) in FAQ_LIST"
          :key="idx"
          class="help__faq"
        >
          <text class="help__faq-q">Q：{{ faq.q }}</text>
          <text class="help__faq-a">A：{{ faq.a }}</text>
        </view>
      </view>

      <view class="help__body-pad" />
    </scroll-view>

    <!-- 全局确认对话框 + Toast 提示（uni-app H5 端 App.vue template 被忽略，必须在每个页面挂载） -->
    <ConfirmDialog />
    <ToastContainer />
  </view>
</template>

<script setup lang="ts">
/**
 * @file 帮助页 — 如何游戏
 *
 * 集中展示游戏所有核心概念、规则与 FAQ，解决新玩家"看不懂"问题。
 * 内容来源：openspec/changes/improve-ux-playability/tasks.md T1.10
 *
 * 设计要点：
 *   - 复用 TERM_EXPLANATIONS（copywriting.ts）保持术语解释一致
 *   - 复用 InfoHint 组件提供详细解释浮层
 *   - scroll-view 滚动，顶部固定返回按钮 + 标题
 *   - 返回按钮 min-w/min-h: 72rpx（触摸目标合规），v-tooltip 提示
 */

import InfoHint from '@/components/InfoHint.vue'
import TooltipView from '@/components/TooltipView.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import { TERM_EXPLANATIONS, TOOLTIP_TEXT } from '@/utils/copywriting'

/** 五类身份（含偏移说明，与 character-create/index.vue BACKGROUNDS 对齐） */
const BACKGROUNDS_HELP = [
  { name: '文官', desc: '通晓政事，善理政务', perks: '政治+10、外交+5、军事-5' },
  { name: '武将', desc: '沙场宿将，威震四方', perks: '军事+10、民心+5、政治-5' },
  { name: '商贾', desc: '富甲一方，财通四海', perks: '经济+15、外交+5、政治-5' },
  { name: '士绅', desc: '望重乡里，深得民心', perks: '民心+10、政治+5、军事-5' },
  { name: '宗室', desc: '皇族后裔，名正言顺', perks: '外交+10、政治+5、军事-5' }
] as const

/** 五维属性（key 对齐 TERM_EXPLANATIONS） */
const ATTRIBUTES_HELP = [
  { key: 'military' as const, name: '军事' },
  { key: 'economy' as const, name: '经济' },
  { key: 'politics' as const, name: '政治' },
  { key: 'people' as const, name: '民心' },
  { key: 'diplomacy' as const, name: '外交' }
]

/** 四项资源（key 对齐 TERM_EXPLANATIONS） */
const RESOURCES_HELP = [
  { key: 'silver' as const, name: '银两' },
  { key: 'troops' as const, name: '兵员' },
  { key: 'food' as const, name: '粮草' },
  { key: 'reputation' as const, name: '名望' }
]

/** 势力关系 5 档分级（对齐 formatRelationshipLabel） */
const RELATIONSHIP_LEVELS_HELP = [
  { range: '51 ~ 100', label: '盟友', desc: '可结盟互助，共同对外' },
  { range: '1 ~ 50', label: '友好', desc: '关系融洽，不易起冲突' },
  { range: '0', label: '中立', desc: '互不干涉' },
  { range: '-1 ~ -50', label: '紧张', desc: '随时可能爆发冲突' },
  { range: '-51 ~ -100', label: '敌对', desc: '兵戎相见，需重点防御' }
] as const

/** 事件类型 6 类 */
const EVENT_TYPES_HELP = [
  { type: '民生', desc: '关乎百姓生计，影响民心与稳定' },
  { type: '军事', desc: '战事与军队相关，影响军事与兵员' },
  { type: '外交', desc: '涉及列强与邻省，影响外交与名望' },
  { type: '随机', desc: '偶发事件，可能是机遇或灾祸' },
  { type: '历史剧情', desc: '还原真实历史事件，影响深远' },
  { type: 'NPC动态', desc: '其他势力行动的反馈记录' },
  { type: '系统', desc: '系统自动结算的资源产出与环境变化记录' }
] as const

/** NPC 行动 6 种 */
const NPC_ACTIONS_HELP = [
  { type: '扩张', desc: '势力正在扩张领土，可能威胁你的领地' },
  { type: '结盟', desc: '势力之间结成同盟，可能联合对你' },
  { type: '备战', desc: '势力正在积蓄军力，战争一触即发' },
  { type: '休养', desc: '势力休养生息，恢复实力' },
  { type: '挑衅', desc: '势力主动挑衅，可能引发冲突' },
  { type: '外交', desc: '势力进行外交活动，影响格局' }
] as const

/** 玩法技巧 */
const PLAY_TIPS = [
  '优先平衡发展五维属性，避免某项过低触发危机。',
  '关注危机预警（属性 < 30），优先应对濒临崩溃的维度。',
  '善用军师对话，前 3 回合军师会主动引导新玩家。',
  '自由行动可自定义想做的事，由 AI 推演结果，可能解锁隐藏策略。',
  '势力关系差时避免主动挑衅，可通过外交决策改善关系。'
] as const

/** 常见问题 FAQ */
const FAQ_LIST = [
  {
    q: '怎么提升综合实力？',
    a: '通过决策与事件应对提升五维属性，综合实力 = 五维属性加权平均（政治、民心权重更高）。'
  },
  {
    q: '属性降到 0 会怎样？',
    a: '任一属性 ≤ 0 即游戏失败，需重点关注危机预警（属性 < 30 时提示）。'
  },
  {
    q: '军师有什么用？',
    a: '可随时咨询军师，获取局势分析与决策建议。前 3 回合军师会更主动地引导新玩家。'
  },
  {
    q: '自由行动和选项决策有什么区别？',
    a: '选项决策是预设方案，效果明确；自由行动可自定义想做的事，由 AI 推演结果，可能解锁隐藏策略。'
  },
  {
    q: '势力关系怎么改善？',
    a: '通过外交类决策、善待邻省百姓、援助盟友等方式可提升关系；挑衅与扩张会降低关系。'
  },
  {
    q: '什么时候会触发结局？',
    a: '综合实力 ≥ 90 触发胜利结局；任一属性 ≤ 0 触发失败结局；1912 年末仍未达成胜利则触发时光尽头结局。'
  },
  {
    q: '存档会丢失吗？',
    a: '本地存档自动保存，可在设置中手动同步到云端。清除本地存档不影响云端。'
  }
] as const

/** 返回上一页 */
function onBack(): void {
  uni.navigateBack({ delta: 1 })
}
</script>

<style lang="scss" scoped>
.help {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: linear-gradient(180deg, #fdf6e3 0%, #f5e6c8 100%);

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 24rpx 32rpx;
    background-color: #8b1a1a;
    box-shadow: 0 4rpx 12rpx rgba(139, 26, 26, 0.15);
  }

  &__back {
    // 触摸目标 ≥ 72rpx（任务规范）
    min-width: 72rpx;
    min-height: 72rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    transition: background-color 150ms ease, transform 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: rgba(255, 255, 255, 0.15);
      border-radius: 8rpx;
    }
  }

  &__title {
    font-size: 32rpx;
    font-weight: 600;
    color: #fff;
    letter-spacing: 4rpx;
  }

  &__header-placeholder {
    width: 72rpx;
  }

  &__body {
    flex: 1;
    min-height: 0;
    padding: 16rpx 24rpx;
  }

  &__section {
    margin-bottom: 24rpx;
    padding: 24rpx;
    background-color: #fdf6e3;
    border: 2rpx solid #d4c5a0;
    border-radius: 12rpx;
  }

  &__section-head {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

  &__section-title {
    display: block;
    margin-bottom: 12rpx;
    font-size: 30rpx;
    font-weight: 600;
    color: #8b1a1a;
    letter-spacing: 2rpx;
  }

  &__section-desc {
    display: block;
    margin-bottom: 16rpx;
    font-size: 24rpx;
    color: #8d6e63;
    line-height: 1.5;
  }

  &__paragraph {
    display: block;
    margin-bottom: 12rpx;
    font-size: 28rpx;
    color: #2c1810;
    line-height: 1.7;
  }

  &__item {
    padding: 16rpx 0;
    border-bottom: 2rpx solid rgba(212, 197, 160, 0.5);

    &:last-child {
      border-bottom: none;
    }
  }

  &__item-head {
    display: flex;
    flex-direction: row;
    align-items: center;
    margin-bottom: 8rpx;
  }

  &__item-name {
    font-size: 28rpx;
    font-weight: 600;
    color: #2c1810;

    &--victory {
      color: #2e7d32;
    }

    &--defeat {
      color: #c62828;
    }

    &--neutral {
      color: #5d4037;
    }
  }

  &__item-perks {
    margin-left: 16rpx;
    font-size: 24rpx;
    color: #5d4037;
  }

  &__item-desc {
    display: block;
    font-size: 26rpx;
    color: #5d4037;
    line-height: 1.6;
  }

  &__tip {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    margin-bottom: 12rpx;

    &:last-child {
      margin-bottom: 0;
    }
  }

  &__tip-num {
    flex-shrink: 0;
    width: 40rpx;
    height: 40rpx;
    margin-right: 16rpx;
    background-color: #8b1a1a;
    border-radius: 50%;
    font-size: 24rpx;
    font-weight: 600;
    color: #fff;
    text-align: center;
    line-height: 40rpx;
  }

  &__tip-text {
    flex: 1;
    font-size: 28rpx;
    color: #2c1810;
    line-height: 1.6;
  }

  &__faq {
    margin-bottom: 20rpx;
    padding: 16rpx;
    background-color: rgba(245, 230, 200, 0.5);
    border-radius: 8rpx;

    &:last-child {
      margin-bottom: 0;
    }
  }

  &__faq-q {
    display: block;
    margin-bottom: 8rpx;
    font-size: 28rpx;
    font-weight: 600;
    color: #8b1a1a;
    line-height: 1.5;
  }

  &__faq-a {
    display: block;
    font-size: 26rpx;
    color: #5d4037;
    line-height: 1.6;
  }

  &__body-pad {
    height: 60rpx;
  }
}
</style>
