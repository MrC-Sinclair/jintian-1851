<template>
  <view v-if="mounted" class="onboarding-overlay" @click.stop="onOverlayClick" @touchmove.stop.prevent @wheel.stop.prevent>
    <!-- 全屏遮罩层（拦截点击，避免穿透到底层元素） -->
    <view class="onboarding-overlay__mask" @click.stop="onOverlayClick" @touchmove.stop.prevent @touchend.stop />

    <!-- 高亮层（外阴影覆盖非高亮区域，box-shadow 实现，仅视觉遮罩，点击由 mask 拦截） -->
    <view
      v-if="highlightStyle"
      class="onboarding-overlay__highlight"
      :style="highlightStyle"
      @click.stop
      @touchmove.stop.prevent
    />

    <!-- 引导卡片 -->
    <view class="onboarding-overlay__card" :style="cardStyle" @click.stop @touchmove.stop>
      <!-- 步骤指示（1/6） -->
      <view class="onboarding-overlay__indicator">
        <text class="onboarding-overlay__indicator-text">
          {{ currentStepIndex + 1 }}/{{ steps.length }}
        </text>
      </view>

      <!-- 标题 -->
      <text class="onboarding-overlay__title">{{ currentStep.title }}</text>

      <!-- 内容 -->
      <text class="onboarding-overlay__content">{{ currentStep.content }}</text>

      <!-- 操作按钮 -->
      <view class="onboarding-overlay__actions">
        <view
          class="onboarding-overlay__btn onboarding-overlay__btn--skip"
          @click.stop="onSkip"
        >
          <text class="onboarding-overlay__btn-text">跳过</text>
        </view>
        <view
          class="onboarding-overlay__btn onboarding-overlay__btn--next"
          @click.stop="onNext"
        >
          <text class="onboarding-overlay__btn-text onboarding-overlay__btn-text--next">
            {{ isLastStep ? '开始游戏' : '下一步' }}
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * @file OnboardingOverlay 新手引导覆盖层
 *
 * 用途：首次进入游戏时弹出全屏引导，6 步介绍核心玩法：
 *   1. 欢迎与背景
 *   2. 状态面板（5 维属性 + 4 资源）
 *   3. 事件卡片（每回合 AI 生成）
 *   4. 决策方式（选项 + 自由行动）
 *   5. 军师对话（随时咨询）
 *   6. 目标（胜利/失败条件）
 *
 * 设计依据：openspec/changes/improve-ux-playability/tasks.md T1.8 + specs/onboarding-tutorial/spec.md
 *   - 全屏遮罩 box-shadow 外阴影实现高亮（兼容三端）
 *   - 卡片定位：有高亮时置于下方/上方，无高亮时居中
 *   - SSR 安全：mounted ref 在 onMounted 设 true，避免水合不匹配
 *   - 三端兼容：targetSelectors 传 CSS 选择器字符串，由 platform.ts getElementRect 查询
 *
 * 修复（2026-07-24）：
 *   - 点击穿透：新增独立 __mask 遮罩层拦截点击（box-shadow 不拦截点击事件）
 *   - 聚焦失败：updateHighlight 中先 scrollElementIntoView 再获取 rect，确保目标元素在视口内
 *   - 滚动锁定：引入 useScrollLock，挂载时锁定 body 滚动，卸载时解锁
 *   - 窗口变化：监听 resize 重新计算高亮位置
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { getElementRect, scrollElementIntoView, type ElementRect } from '@/utils/platform'
import { useScrollLock } from '@/composables/useScrollLock'

/** 引导步骤数据结构 */
export interface OnboardingStep {
  /** 步骤标题 */
  title: string
  /** 步骤内容（玩法说明） */
  content: string
  /** 高亮目标的 key（对应 targetSelectors 中的键，null/空表示无高亮，仅居中显示卡片） */
  targetKey?: string | null
}

const props = withDefaults(
  defineProps<{
    /** 引导步骤数据（数据驱动） */
    steps: OnboardingStep[]
    /** 各步骤对应的目标 CSS 选择器（key → selector，由父组件提供） */
    targetSelectors?: Record<string, string>
  }>(),
  { targetSelectors: () => ({}) }
)

const emit = defineEmits<{
  /** 走完所有步骤触发（最后一步点"开始游戏"） */
  (e: 'complete'): void
  /** 玩家点"跳过"触发 */
  (e: 'skip'): void
}>()

/** 滚动锁：挂载时锁定，卸载时解锁（防止底层 scroll-view 滚动） */
const { lock, unlock } = useScrollLock()

/** 是否已挂载（SSR 安全：服务端不渲染覆盖层，避免水合不匹配） */
const mounted = ref(false)

/** 当前步骤索引（0-based） */
const currentStepIndex = ref(0)

/** 当前高亮元素的位置与尺寸（无高亮时为 null） */
const currentTargetRect = ref<ElementRect | null>(null)

/** 当前步骤对象 */
const currentStep = computed<OnboardingStep>(() => {
  return props.steps[currentStepIndex.value] ?? { title: '', content: '' }
})

/** 是否最后一步 */
const isLastStep = computed(() => currentStepIndex.value >= props.steps.length - 1)

/** 高亮元素的样式（position:fixed 定位 + 外阴影覆盖） */
const highlightStyle = computed(() => {
  const rect = currentTargetRect.value
  if (!rect) return null
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  }
})

/** 卡片定位样式（有高亮时置于下方/上方，无高亮时居中） */
const cardStyle = computed(() => {
  const rect = currentTargetRect.value
  // 无高亮：垂直水平居中
  if (!rect) {
    return {
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)'
    }
  }

  // 有高亮：默认置于下方，下方空间不足则置于上方
  const gap = 16 // 卡片与高亮的间距 16px
  const cardHeightEstimate = 260 // 卡片预估高度（用于判断空间，实际高度由内容决定）
  const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 0
  const bottomSpace = windowHeight - (rect.top + rect.height + gap + cardHeightEstimate)
  const placeBelow = bottomSpace > 0

  if (placeBelow) {
    // 置于下方，水平居中于高亮元素
    const cardLeft = rect.left + rect.width / 2
    return {
      left: `${cardLeft}px`,
      top: `${rect.top + rect.height + gap}px`,
      transform: 'translate(-50%, 0)'
    }
  }
  // 置于上方，水平居中于高亮元素
  const cardLeft = rect.left + rect.width / 2
  return {
    left: `${cardLeft}px`,
    top: `${rect.top - gap}px`,
    transform: 'translate(-50%, -100%)'
  }
})

/**
 * 更新当前步骤的高亮位置
 *
 * 步骤切换或窗口尺寸变化时调用：
 * - 当前步骤无 targetKey → 清空高亮
 * - targetSelectors 中无对应 selector → 清空高亮（降级居中显示卡片）
 * - 先 scrollElementIntoView 确保目标元素在视口内，再 getElementRect 获取位置
 * - 调 getElementRect 异步获取元素位置
 */
async function updateHighlight(): Promise<void> {
  const targetKey = currentStep.value.targetKey
  if (!targetKey) {
    currentTargetRect.value = null
    return
  }
  const selector = props.targetSelectors[targetKey]
  if (!selector) {
    currentTargetRect.value = null
    return
  }
  // 先滚动目标元素到视口中央（修复「聚焦时没聚焦到指定地方」的 bug）
  await scrollElementIntoView(selector)
  // 防止异步竞态：滚动期间用户可能已切换步骤
  if (currentStep.value.targetKey !== targetKey) return
  // 再获取元素位置（此时元素已在视口内，rect 坐标有效）
  const rect = await getElementRect(selector)
  // 再次检查竞态
  if (currentStep.value.targetKey === targetKey) {
    currentTargetRect.value = rect
  }
}

/** 下一步：最后一步触发 complete，否则索引 +1 */
function onNext(): void {
  if (isLastStep.value) {
    emit('complete')
    return
  }
  currentStepIndex.value += 1
}

/** 跳过：直接触发 skip 事件 */
function onSkip(): void {
  emit('skip')
}

/**
 * 遮罩层点击：不做任何操作（强制玩家通过按钮交互，防止误关闭引导）
 *
 * 绑定 @click.stop 仅为拦截事件冒泡，阻止点击穿透到底层元素。
 */
function onOverlayClick(): void {
  // 故意空实现：引导期间不允许点击遮罩关闭
}

/** 窗口 resize 回调：重新计算高亮位置 */
function onResize(): void {
  void updateHighlight()
}

onMounted(() => {
  mounted.value = true
  // 锁定底层滚动（修复「弹框时下方列表可滚动」的 bug）
  lock()
  // 首次挂载后立即更新高亮（onMounted 后 DOM 已渲染，可查询元素位置）
  void updateHighlight()
  // 监听窗口尺寸变化（横竖屏切换、浏览器窗口缩放）重新定位高亮
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onResize)
  }
})

onUnmounted(() => {
  // 解锁滚动
  unlock()
  // 移除 resize 监听
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', onResize)
  }
})

// 监听步骤变化，重新计算高亮位置
watch(currentStepIndex, () => {
  void updateHighlight()
})
</script>

<style lang="scss" scoped>
.onboarding-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1000;
}

// 全屏遮罩层：拦截点击事件，防止穿透到底层元素
// 高亮区域的视觉遮罩仍由 __highlight 的 box-shadow 实现，本层仅负责点击拦截
.onboarding-overlay__mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1000;
  // 透明背景（视觉遮罩由 __highlight 的 box-shadow 提供，避免双重遮罩）
  background-color: transparent;
}

// 高亮层：外阴影覆盖非高亮区域（box-shadow 9999px 实现全屏遮罩）
.onboarding-overlay__highlight {
  position: fixed;
  z-index: 1001;
  background-color: transparent;
  border: 2rpx solid #f9a825;
  border-radius: 8rpx;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);
  // 平滑过渡（步骤切换时高亮位置变化）
  transition: left 200ms ease, top 200ms ease, width 200ms ease, height 200ms ease;
  // 高亮层不拦截点击（pointer-events:none），点击交由 __mask 拦截
  pointer-events: none;
}

// 引导卡片
.onboarding-overlay__card {
  position: fixed;
  z-index: 1002;
  width: 86%;
  max-width: 640rpx;
  padding: 32rpx;
  background-color: #fdf6e3;
  border: 2rpx solid #d4c5a0;
  border-radius: 16rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.3);
  // 卡片位置过渡（步骤切换时位置变化）
  transition: left 200ms ease, top 200ms ease;
}

.onboarding-overlay__indicator {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: 12rpx;
}

.onboarding-overlay__indicator-text {
  padding: 4rpx 16rpx;
  font-size: 22rpx;
  color: #fff;
  background-color: #8b1a1a;
  border-radius: 20rpx;
}

.onboarding-overlay__title {
  display: block;
  margin-bottom: 16rpx;
  font-size: 36rpx;
  font-weight: 700;
  color: #2c1810;
}

.onboarding-overlay__content {
  display: block;
  margin-bottom: 24rpx;
  font-size: 28rpx;
  line-height: 1.6;
  color: #5d4037;
  word-break: break-word;
}

.onboarding-overlay__actions {
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
  gap: 16rpx;
}

// 按钮基础样式（触摸目标 min-w/min-h: 88rpx）
.onboarding-overlay__btn {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  min-width: 88rpx;
  min-height: 88rpx;
  padding: 16rpx 32rpx;
  border: 2rpx solid #8b1a1a;
  border-radius: 12rpx;
  transition: transform 150ms ease, background-color 150ms ease, opacity 150ms ease;

  &:active {
    transform: scale(0.95);
  }

  &--skip {
    background-color: #fdf6e3;

    .onboarding-overlay__btn-text {
      color: #8d6e63;
    }
  }

  &--next {
    background-color: #8b1a1a;

    .onboarding-overlay__btn-text--next {
      color: #fff;
    }
  }
}

.onboarding-overlay__btn-text {
  font-size: 28rpx;
  font-weight: 500;
}
</style>
