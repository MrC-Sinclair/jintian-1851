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
    <!-- 剧情链事件提示：告知玩家选项与自由行动均可推进剧情（chainId 事件才显示） -->
    <text v-if="chainTitle" class="event-card__chain-hint">{{ PAGE_TEXT.eventCard.chainHint }}</text>

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
  // P0-3：卡片层次用「背景分层 + 阴影」替代细描边；正文黑体、标题衬线
  padding: $jt-space-lg;
  font-family: $jt-font-sans;
  background-color: $jt-bg-surface;
  border-radius: $jt-radius-xl;
  box-shadow: $jt-shadow-card;

  &__header {
    display: flex;
    flex-direction: row;
    gap: $jt-space-base;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: $jt-space-md;
  }

  &__header-main {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: $jt-space-base;
    align-items: center;
  }

  &__type {
    display: inline-block;
    padding: $jt-space-xs $jt-space-base;
    margin-bottom: $jt-space-sm;
    font-size: $jt-font-sm;
    color: $jt-ink-inverse;
    background-color: $jt-primary;
    border-radius: $jt-radius-sm;
  }

  // T4.1：剧情链名（顶部左侧，区别于普通事件标题黑色）
  &__chain-title {
    font-size: $jt-font-lg;
    font-weight: 600;
    color: $jt-ink-secondary;
  }

  // T4.1：剧情进度角标（右上角，背景与主色一致）
  &__chain-badge {
    flex-shrink: 0;
    padding: $jt-space-sm $jt-space-md;
    font-size: $jt-font-base;
    font-weight: 600;
    color: $jt-ink-inverse;
    background-color: $jt-primary;
    border-radius: $jt-radius-base;
  }

  &__title {
    display: block;
    font-family: $jt-font-serif;
    font-size: $jt-font-title;
    font-weight: 600;
    color: $jt-ink;
  }

  &__description {
    display: block;
    margin-bottom: $jt-space-md;
    font-size: $jt-font-lg;
    line-height: 1.6;
    color: $jt-ink-secondary;
  }

  // 剧情链推进提示（描述下方弱化小字，仅剧情事件显示）
  &__chain-hint {
    display: block;
    margin-bottom: $jt-space-lg;
    font-size: $jt-font-sm;
    line-height: 1.5;
    color: $jt-ink-faint;
  }

  &__options {
    padding-top: $jt-space-md;
    border-top: 2rpx solid $jt-border;
  }

  &__options-title {
    display: block;
    margin-bottom: $jt-space-base;
    font-size: $jt-font-md;
    font-weight: 600;
    color: $jt-ink-secondary;
  }
}
</style>
