<template>
  <view class="goal-panel">
    <!-- 标题栏（可点击切换折叠） -->
    <view
      class="goal-panel__header"
      @click="toggle"
    >
      <view class="goal-panel__toggle-icon" :class="{ 'goal-panel__toggle-icon--expanded': expanded }" />
      <text class="goal-panel__title">游戏目标</text>

      <!-- 折叠态缩略进度条 + 数值 -->
      <view v-if="!expanded" class="goal-panel__brief">
        <view class="goal-panel__bar goal-panel__bar--brief">
          <view
            class="goal-panel__bar-fill"
            :class="{ 'goal-panel__bar-fill--victory': isVictory }"
            :style="{ width: overallPercent + '%' }"
          />
        </view>
        <text class="goal-panel__brief-value" :class="{ 'goal-panel__brief-value--victory': isVictory }">
          {{ Math.round(overallPower) }}/100
        </text>
      </view>
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
          <text class="goal-panel__row-value">综合实力 ≥ 90</text>
        </view>

        <!-- 失败条件 -->
        <view class="goal-panel__row">
          <text class="goal-panel__row-label goal-panel__row-label--lose">失败条件</text>
          <text class="goal-panel__row-value">任一属性 ≤ 0</text>
        </view>

        <!-- 综合实力进度条（含 90 阈值刻度）+ InfoHint -->
        <view class="goal-panel__power">
          <view class="goal-panel__power-head">
            <text class="goal-panel__power-label">综合实力</text>
            <InfoHint title="综合实力" :content="overallPowerHint" />
            <text
              class="goal-panel__power-value"
              :class="{ 'goal-panel__power-value--victory': isVictory }"
            >{{ Math.round(overallPower) }}</text>
          </view>
          <view class="goal-panel__bar">
            <view
              class="goal-panel__bar-fill"
              :class="{ 'goal-panel__bar-fill--victory': isVictory }"
              :style="{ width: overallPercent + '%' }"
            />
            <!-- 90 阈值刻度竖线 -->
            <view class="goal-panel__bar-threshold" />
            <text class="goal-panel__bar-threshold-label">90</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * @file GoalPanel 目标与进度面板
 *
 * 展示游戏长期目标、胜利/失败条件、综合实力进度条（标注 90 阈值刻度）。
 * - 折叠态：标题 + 缩略进度条 + 数值
 * - 展开态：长期目标 + 胜利条件 + 失败条件 + 详细进度条 + InfoHint
 *
 * 设计依据：openspec/changes/improve-ux-playability/tasks.md T1.5 + specs/goal-system/spec.md
 */

import { computed, ref } from 'vue'
import type { Attributes } from '@/types/game'
import { generateFocusHint, VICTORY_THRESHOLD } from '@/utils/goal-hint'
import { TERM_EXPLANATIONS } from '@/utils/copywriting'
import InfoHint from './InfoHint.vue'

const props = withDefaults(
  defineProps<{
    /** 5 维属性（用于计算综合实力） */
    attributes: Attributes
    /** 默认是否展开（默认 false 折叠） */
    defaultExpanded?: boolean
  }>(),
  { defaultExpanded: false }
)

/** 折叠状态（初始值 SSR 安全，来自 prop） */
const expanded = ref(props.defaultExpanded)

/** 焦点提示（复用 goal-hint.ts 计算 overallPower） */
const hint = computed(() => generateFocusHint(props.attributes))

/** 综合实力（0-100） */
const overallPower = computed(() => hint.value.overallPower)

/** 综合实力百分比（用于进度条宽度，clamp 0-100） */
const overallPercent = computed(() => Math.max(0, Math.min(100, overallPower.value)))

/** 是否已达胜利阈值 */
const isVictory = computed(() => overallPower.value >= VICTORY_THRESHOLD)

/** InfoHint 解释文案（复用 copywriting.ts 统一术语解释） */
const overallPowerHint = TERM_EXPLANATIONS.overallPower

/** 切换折叠/展开 */
function toggle(): void {
  expanded.value = !expanded.value
}
</script>

<style lang="scss" scoped>
.goal-panel {
  padding: 16rpx 24rpx;
  background-color: #fdf6e3;
  border: 2rpx solid #d4c5a0;
  border-radius: 12rpx;

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
    margin-right: 16rpx;
    border-right: 10rpx solid transparent;
    border-left: 10rpx solid transparent;
    border-top: 14rpx solid #5d4037;
    transition: transform 200ms ease;

    &--expanded {
      transform: rotate(180deg);
    }
  }

  &__title {
    flex-shrink: 0;
    font-size: 30rpx;
    font-weight: 600;
    color: #5d4037;
  }

  // 折叠态缩略进度条 + 数值
  &__brief {
    display: flex;
    flex: 1;
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    margin-left: 16rpx;
    gap: 12rpx;
  }

  &__brief-value {
    font-size: 26rpx;
    color: #8d6e63;

    &--victory {
      color: #2e7d32;
      font-weight: 600;
    }
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
    padding-top: 16rpx;
    border-top: 2rpx dashed rgba(212, 197, 160, 0.5);
  }

  &__row {
    display: flex;
    flex-direction: row;
    align-items: baseline;
    margin-bottom: 12rpx;
  }

  &__row-label {
    flex-shrink: 0;
    width: 160rpx;
    font-size: 26rpx;
    color: #8d6e63;

    &--win {
      color: #2e7d32;
    }

    &--lose {
      color: #c62828;
    }
  }

  &__row-value {
    flex: 1;
    font-size: 26rpx;
    color: #5d4037;
  }

  // 综合实力进度条
  &__power {
    margin-top: 16rpx;
  }

  &__power-head {
    display: flex;
    flex-direction: row;
    align-items: center;
    margin-bottom: 8rpx;
  }

  &__power-label {
    font-size: 26rpx;
    font-weight: 600;
    color: #5d4037;
  }

  &__power-value {
    margin-left: auto;
    font-size: 28rpx;
    font-weight: 700;
    color: #8b1a1a;

    &--victory {
      color: #2e7d32;
    }
  }

  // 进度条
  &__bar {
    position: relative;
    height: 16rpx;
    background-color: #e5d5b7;
    border-radius: 8rpx;

    &--brief {
      flex: 1;
      max-width: 200rpx;
    }
  }

  &__bar-fill {
    height: 100%;
    background-color: #8b1a1a;
    border-radius: 8rpx;
    transition: width 300ms ease;

    &--victory {
      background-color: #2e7d32;
    }
  }

  // 90 阈值刻度竖线
  &__bar-threshold {
    position: absolute;
    top: -4rpx;
    bottom: -4rpx;
    left: 90%;
    width: 2rpx;
    background-color: #5d4037;
    transform: translateX(-1rpx);
  }

  &__bar-threshold-label {
    position: absolute;
    top: -24rpx;
    left: 90%;
    font-size: 20rpx;
    color: #5d4037;
    transform: translateX(-50%);
  }
}
</style>
