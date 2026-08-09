<template>
  <view
    class="decision-button"
    role="button"
    :aria-label="ariaLabel"
    :aria-pressed="selected"
    :aria-disabled="disabled || loading"
    tabindex="0"
    :class="{
      'decision-button--disabled': disabled,
      'decision-button--loading': loading,
      'decision-button--selected': selected
    }"
    :hover-class="disabled || loading ? '' : 'decision-button--hover'"
    :hover-stay-time="100"
    @click="handleClick"
    @keydown.enter.prevent="handleClick"
    @keydown.space.prevent="handleClick"
  >
    <view class="decision-button__content">
      <text class="decision-button__label">{{ label }}</text>
      <view v-if="hasEffects" class="decision-button__effects">
        <text
          v-for="eff in formattedEffects"
          :key="eff.key"
          class="decision-button__effect"
          :class="eff.cls"
        >{{ eff.text }}</text>
      </view>
    </view>

    <view v-if="loading" class="decision-button__spinner">
      <view class="decision-button__spinner-dot" />
    </view>

    <!-- T3.1：选中态标记（右上角勾选 SVG，仅 selected 时显示） -->
    <view v-if="selected" class="decision-button__check">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          fill="currentColor"
          d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
        />
      </svg>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Attributes, Resources } from '@/types/game'
import { EFFECT_LABELS } from '@/utils/copywriting'

const props = withDefaults(
  defineProps<{
    label: string
    /** 选项 effects（用于在按钮下方预览属性/资源变化） */
    effects?: Partial<Attributes & Resources>
    /** 禁用（不可点击） */
    disabled?: boolean
    /** 加载态（显示 spinner，禁用点击） */
    loading?: boolean
    /** T3.1：选中态（两步交互，选中后高亮，点击确认才生效） */
    selected?: boolean
  }>(),
  { disabled: false, loading: false, selected: false }
)

const emit = defineEmits<{
  (e: 'click'): void
  /** T3.1：选中事件（替代 click，供 EventCard 监听后更新 selectedOptionId） */
  (e: 'select'): void
}>()

interface FormattedEffect {
  key: string
  text: string
  cls: string
}

const formattedEffects = computed<FormattedEffect[]>(() => {
  if (!props.effects) return []
  const list: FormattedEffect[] = []
  for (const [k, v] of Object.entries(props.effects)) {
    if (typeof v !== 'number' || v === 0) continue
    // T2.4：改用 EFFECT_LABELS 完整词（"军事+10" 而非 "军+10"）
    const label = EFFECT_LABELS[k] ?? k
    const sign = v > 0 ? '+' : ''
    const cls = v > 0 ? 'decision-button__effect--positive' : 'decision-button__effect--negative'
    list.push({ key: k, text: `${label}${sign}${v}`, cls })
  }
  return list
})

const hasEffects = computed(() => formattedEffects.value.length > 0)

/** 无障碍标签：含选项名与选中态，供屏幕阅读器朗读 */
const ariaLabel = computed(() => {
  const state = props.disabled
    ? '（已禁用）'
    : props.loading
      ? '（加载中）'
      : props.selected
        ? '（已选中）'
        : ''
  const effects = hasEffects.value
    ? `，影响：${formattedEffects.value.map((e) => e.text).join('、')}`
    : ''
  return `决策选项：${props.label}${state}${effects}`
})

function handleClick(): void {
  if (props.disabled || props.loading) return
  // T3.1：同时 emit click（向后兼容）和 select（语义化选中事件）
  emit('click')
  emit('select')
}
</script>

<style lang="scss" scoped>
.decision-button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  // 触摸目标 ≥ 44px（AGENTS.md 输入区按钮规范）
  min-width: 44px;
  min-height: 44px;
  padding: 20rpx 24rpx;
  margin-bottom: 12rpx;
  text-align: left;
  background-color: #fdf6e3;
  // T3.1：未选中态 border 2rpx 浅金色
  border: 2rpx solid #d4c5a0;
  border-radius: 8rpx;
  transition: transform 150ms ease, background-color 150ms ease, border-color 150ms ease,
    opacity 150ms ease;

  &:last-child {
    margin-bottom: 0;
  }

  // hover 反馈（uni-app hover-class 替代 :hover，三端通用）
  &--hover {
    background-color: #f5e6c8;
    border-color: #6b1313;
  }

  // active 按压反馈（AGENTS.md 点击反馈规范）
  &:active {
    transform: scale(0.95);
  }

  &--disabled,
  &--loading {
    // 灰底 + 降饱和边框 + 半透明，比单纯 opacity 更明确表达「不可操作」
    opacity: 0.65;
    background-color: #e8e0d0;
    border-color: #c9bda3;

    .decision-button__label {
      color: #9e8e76;
    }
  }

  // T3.1：选中态（border 4rpx 暗红 + 浅米色背景）
  &--selected {
    background-color: #fff8e7;
    border: 4rpx solid #8b1a1a;

    // 选中时 hover 不覆盖选中态背景
    &.decision-button--hover {
      background-color: #fff0d4;
    }
  }

  &__content {
    flex: 1;
  }

  &__label {
    display: block;
    font-size: 30rpx;
    font-weight: 500;
    line-height: 1.4;
    color: #2c1810;
  }

  &__effects {
    display: flex;
    flex-wrap: wrap;
    gap: 8rpx;
    margin-top: 8rpx;
  }

  &__effect {
    padding: 2rpx 10rpx;
    // T2.4：字号 24rpx（tasks.md 规范）
    font-size: 24rpx;
    border-radius: 4rpx;

    &--positive {
      color: #2e7d32;
      background-color: rgba(46, 125, 50, 0.1);
    }

    &--negative {
      color: #c62828;
      background-color: rgba(198, 40, 40, 0.1);
    }
  }

  &__spinner {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40rpx;
    height: 40rpx;
    margin-left: 16rpx;
  }

  &__spinner-dot {
    width: 28rpx;
    height: 28rpx;
    border: 4rpx solid rgba(139, 26, 26, 0.2);
    border-top-color: #8b1a1a;
    border-radius: 50%;
    animation: decision-button-spin 0.8s linear infinite;
  }

  // T3.1：选中态右上角勾选标记
  &__check {
    position: absolute;
    top: 8rpx;
    right: 8rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36rpx;
    height: 36rpx;
    color: #fff;
    background-color: #8b1a1a;
    border-radius: 50%;
  }
}

@keyframes decision-button-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
