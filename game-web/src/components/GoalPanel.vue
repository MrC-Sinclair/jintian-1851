<template>
  <view class="goal-panel">
    <!-- 标题栏（可点击切换折叠） -->
    <view
      class="goal-panel__header"
      @click="toggle"
    >
      <view class="goal-panel__toggle-icon" :class="{ 'goal-panel__toggle-icon--expanded': expanded }" />
      <text class="goal-panel__title">游戏目标</text>
    </view>

    <!-- 展开内容（max-height transition 折叠动画） -->
    <view class="goal-panel__expand" :class="{ 'goal-panel__expand--collapsed': !expanded }">
      <view class="goal-panel__expand-inner">
        <!-- 长期目标段落 -->
        <view class="goal-panel__row">
          <text class="goal-panel__row-label">长期目标</text>
          <text class="goal-panel__row-value">成就霸业（1851-1912）</text>
        </view>

        <!-- 胜利条件 -->
        <view class="goal-panel__row">
          <text class="goal-panel__row-label goal-panel__row-label--win">胜利条件</text>
          <text class="goal-panel__row-value">综合实力 ≥ {{ VICTORY_THRESHOLD }}</text>
        </view>

        <!-- 失败条件 -->
        <view class="goal-panel__row">
          <text class="goal-panel__row-label goal-panel__row-label--lose">失败条件</text>
          <text class="goal-panel__row-value">任一属性 ≤ 0</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * @file GoalPanel 目标面板
 *
 * 展示游戏长期目标与胜利/失败条件。
 * - 折叠态：仅标题
 * - 展开态：长期目标 + 胜利条件 + 失败条件
 *
 * P0-2：综合实力进度条已移除（FocusPanel 顶部常驻为唯一展示位），
 * 本面板专注「目标规则」说明，避免与顶部进度重复。
 *
 * 设计依据：openspec/changes/improve-ux-playability/tasks.md T1.5 + specs/goal-system/spec.md
 */

import { ref } from 'vue'
// 胜利条件文案直接取常量，避免改阈值时这里说谎（此前硬编码 90）
import { VICTORY_THRESHOLD } from '@/utils/constants'

const props = withDefaults(
  defineProps<{
    /** 默认是否展开（默认 false 折叠） */
    defaultExpanded?: boolean
  }>(),
  { defaultExpanded: false }
)

/** 折叠状态（初始值 SSR 安全，来自 prop） */
const expanded = ref(props.defaultExpanded)

/** 切换折叠/展开 */
function toggle(): void {
  expanded.value = !expanded.value
}
</script>

<style lang="scss" scoped>
.goal-panel {
  // P0-3：卡片层次用「背景分层 + 阴影」替代细描边
  padding: $jt-space-md $jt-space-lg;
  background-color: $jt-bg-surface;
  border-radius: $jt-radius-xl;
  box-shadow: $jt-shadow-card;

  &__header {
    display: flex;
    flex-direction: row;
    align-items: center;
    // 触摸目标 min-h: 88rpx
    min-height: 88rpx;
    transition: opacity 150ms ease;

    &:active {
      opacity: 0.7;
    }
  }

  // 折叠/展开图标（CSS border 画三角形，避免 Unicode 字符）
  &__toggle-icon {
    flex-shrink: 0;
    width: 0;
    height: 0;
    margin-right: $jt-space-md;
    border-right: 10rpx solid transparent;
    border-left: 10rpx solid transparent;
    border-top: 14rpx solid $jt-ink-secondary;
    transition: transform 200ms ease;

    &--expanded {
      transform: rotate(180deg);
    }
  }

  &__title {
    flex-shrink: 0;
    font-size: $jt-font-xl;
    font-weight: 600;
    color: $jt-ink-secondary;
  }

  // 折叠动画（max-height transition，禁止 v-if 直接切换）
  &__expand {
    max-height: 1000rpx;
    opacity: 1;
    overflow: hidden;
    transition: max-height 300ms ease, opacity 200ms ease;

    &--collapsed {
      max-height: 0;
      opacity: 0;
    }
  }

  &__expand-inner {
    padding-top: $jt-space-md;
    border-top: 2rpx dashed $jt-border-light;
  }

  &__row {
    display: flex;
    flex-direction: row;
    align-items: baseline;
    margin-bottom: $jt-space-base;
  }

  &__row-label {
    flex-shrink: 0;
    width: 160rpx;
    font-size: $jt-font-md;
    color: $jt-ink-muted;

    &--win {
      color: $jt-success;
    }

    &--lose {
      color: $jt-danger;
    }
  }

  &__row-value {
    flex: 1;
    font-size: $jt-font-md;
    color: $jt-ink-secondary;
  }
}
</style>
