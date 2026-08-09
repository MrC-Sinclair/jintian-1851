<template>
  <view class="event-card">
    <view class="event-card__header">
      <view class="event-card__header-main">
        <text class="event-card__type">{{ event.eventType }}</text>
        <text v-if="chainTitle" class="event-card__chain-title">{{ chainTitle }}</text>
      </view>
      <text v-if="event.chainProgress" class="event-card__chain-badge">{{ badgeText }}</text>
    </view>
    <text class="event-card__title">{{ event.title }}</text>
    <text class="event-card__description">{{ event.description }}</text>

    <view class="event-card__options">
      <text class="event-card__options-title">{{ PAGE_TEXT.eventCard.optionsTitle }}</text>
      <DecisionButton
        v-for="option in event.options"
        :key="option.id"
        :label="option.label"
        :effects="option.effects"
        :selected="option.id === selectedOptionId"
        :disabled="disabled"
        @click="$emit('select', option.id)"
      />
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { GameEvent } from '@/types/game'
import { PAGE_TEXT, CHAIN_LABELS, CHAIN_PROGRESS_LABEL } from '@/utils/copywriting'
import DecisionButton from './DecisionButton.vue'

const props = withDefaults(
  defineProps<{
    event: GameEvent
    /** T3.1：当前选中选项 ID（用于 DecisionButton 选中态高亮） */
    selectedOptionId?: string | null
    /** T3.1：禁用所有选项（已决策或处理中时） */
    disabled?: boolean
  }>(),
  { selectedOptionId: null, disabled: false }
)

/**
 * T4.1：剧情链名（顶部左侧）
 * 仅剧情链事件（event.chainId 存在）才显示；查不到标题时回退为 chainId 本身。
 */
const chainTitle = computed(() =>
  props.event.chainId ? (CHAIN_LABELS[props.event.chainId] ?? props.event.chainId) : null
)

/**
 * T4.1：剧情进度角标文案（右上角）
 * 仅当事件携带 chainProgress（{current,total}）时显示，如「剧情 2/5」。
 */
const badgeText = computed(() =>
  props.event.chainProgress
    ? CHAIN_PROGRESS_LABEL(props.event.chainProgress.current, props.event.chainProgress.total)
    : ''
)

defineEmits<{
  (e: 'select', optionId: string): void
}>()
</script>

<style lang="scss" scoped>
.event-card {
  padding: 24rpx;
  background-color: #fdf6e3;
  border: 2rpx solid #d4c5a0;
  border-radius: 12rpx;

  &__header {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12rpx;
    margin-bottom: 16rpx;
  }

  &__header-main {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
    gap: 12rpx;
  }

  &__type {
    display: inline-block;
    padding: 4rpx 12rpx;
    margin-bottom: 8rpx;
    font-size: 22rpx;
    color: #fff;
    background-color: #8b1a1a;
    border-radius: 6rpx;
  }

  // T4.1：剧情链名（顶部左侧，区别于普通事件标题黑色）
  &__chain-title {
    font-size: 28rpx;
    font-weight: 600;
    color: #5c4030;
  }

  // T4.1：剧情进度角标（右上角，背景与主色一致）
  &__chain-badge {
    flex-shrink: 0;
    padding: 8rpx 16rpx;
    font-size: 24rpx;
    font-weight: 600;
    color: #fff;
    background-color: #8b1a1a;
    border-radius: 8rpx;
  }

  &__title {
    display: block;
    font-size: 36rpx;
    font-weight: 600;
    color: #2c1810;
  }

  &__description {
    display: block;
    margin-bottom: 24rpx;
    font-size: 28rpx;
    line-height: 1.6;
    color: #5d4037;
  }

  &__options {
    padding-top: 16rpx;
    border-top: 2rpx solid #d4c5a0;
  }

  &__options-title {
    display: block;
    margin-bottom: 12rpx;
    font-size: 26rpx;
    font-weight: 600;
    color: #5d4037;
  }
}
</style>
