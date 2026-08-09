<template>
  <view
    class="faction-card"
    :class="{ 'faction-card--selected': selected }"
    :hover-class="'faction-card--hover'"
    :hover-stay-time="100"
    @click="$emit('select')"
  >
    <view class="faction-card__header">
      <view class="faction-card__name-wrap">
        <text class="faction-card__name">{{ faction.name }}</text>
        <InfoHint
          :title="'势力关系'"
          :content="TERM_EXPLANATIONS.relationship"
        />
      </view>
      <view v-if="selected" class="faction-card__badge">
        <text class="faction-card__badge-text">已选</text>
      </view>
    </view>
    <text class="faction-card__summary">{{ faction.summary }}</text>

    <view class="faction-card__bar">
      <view class="faction-card__bar-label">
        <text class="faction-card__bar-text">实力</text>
        <text class="faction-card__bar-value">{{ faction.power }}</text>
      </view>
      <view class="faction-card__bar-track">
        <view
          class="faction-card__bar-fill faction-card__bar-fill--power"
          :style="{ width: `${clampPercent(faction.power)}%` }"
        />
      </view>
    </view>

    <view class="faction-card__bar">
      <view class="faction-card__bar-label">
        <text class="faction-card__bar-text">关系</text>
        <text
          class="faction-card__bar-value"
          :class="relationshipColorClass(faction.relationship)"
        >{{ formatRelationship(faction.relationship) }}</text>
      </view>
      <view class="faction-card__bar-track faction-card__bar-track--relationship">
        <view
          class="faction-card__bar-fill"
          :class="relationshipFillClass(faction.relationship)"
          :style="{ width: `${relationshipPercent(faction.relationship)}%` }"
        />
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import InfoHint from '@/components/InfoHint.vue'
import {
  TERM_EXPLANATIONS,
  formatRelationshipLabel,
  getRelationshipLevel
} from '@/utils/copywriting'
import type { Faction } from '@/types/game'

defineProps<{
  faction: Pick<Faction, 'name' | 'summary' | 'power' | 'relationship'>
  selected?: boolean
}>()

defineEmits<{
  (e: 'select'): void
}>()

/** power 0-100 → 0-100% */
function clampPercent(v: number): number {
  return Math.max(0, Math.min(100, v))
}

/** relationship -100~100 → 0~100% （50% 表示中立） */
function relationshipPercent(v: number): number {
  return Math.max(0, Math.min(100, (v + 100) / 2))
}

/** 关系文案（统一来自 copywriting.formatRelationshipLabel） */
function formatRelationship(v: number): string {
  return formatRelationshipLabel(v)
}

/** 关系值颜色类（positive/negative/空） */
function relationshipColorClass(v: number): string {
  const level = getRelationshipLevel(v)
  if (level === 'ally' || level === 'friendly') return 'faction-card__bar-value--positive'
  if (level === 'tense' || level === 'hostile') return 'faction-card__bar-value--negative'
  return ''
}

/** 关系填充类（positive/negative/neutral） */
function relationshipFillClass(v: number): string {
  const level = getRelationshipLevel(v)
  if (level === 'ally' || level === 'friendly') return 'faction-card__bar-fill--positive'
  if (level === 'tense' || level === 'hostile') return 'faction-card__bar-fill--negative'
  return 'faction-card__bar-fill--neutral'
}
</script>

<style lang="scss" scoped>
.faction-card {
  min-height: 96px;
  padding: 16rpx 24rpx;
  margin-bottom: 16rpx;
  background-color: #fdf6e3;
  border: 2rpx solid #d4c5a0;
  border-radius: 12rpx;
  // 注意：不要用 transform / filter 做 hover 效果。
  // CSS 规范：祖先元素有 transform/filter/perspective 时，子元素 position: fixed 会以该祖先为包含块，
  // 导致 InfoHint 浮层（position: fixed）缩小到卡片范围内，无法全屏覆盖。
  // 改用 background-color 变化提供 hover 反馈，避免与 --selected 的 box-shadow 冲突。
  transition: border-color 150ms ease, background-color 150ms ease, box-shadow 150ms ease;

  &--hover {
    background-color: #f5ecd6;
  }

  &--selected {
    border-color: #8b1a1a;
    box-shadow: 0 0 0 4rpx rgba(139, 26, 26, 0.15);
  }

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8rpx;
  }

  &__name-wrap {
    display: flex;
    align-items: center;
  }

  &__name {
    font-size: 36rpx;
    font-weight: 600;
    color: #2c1810;
  }

  &__badge {
    padding: 4rpx 12rpx;
    background-color: #8b1a1a;
    border-radius: 8rpx;
  }

  &__badge-text {
    font-size: 22rpx;
    color: #fff;
  }

  &__summary {
    display: block;
    margin-bottom: 16rpx;
    font-size: 26rpx;
    color: #5d4037;
    line-height: 1.5;
  }

  &__bar {
    margin-bottom: 8rpx;

    &:last-child {
      margin-bottom: 0;
    }
  }

  &__bar-label {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4rpx;
  }

  &__bar-text {
    font-size: 24rpx;
    color: #5d4037;
  }

  &__bar-value {
    font-size: 24rpx;
    color: #5d4037;

    &--positive {
      color: #2e7d32;
    }

    &--negative {
      color: #c62828;
    }
  }

  &__bar-track {
    height: 12rpx;
    overflow: hidden;
    background-color: #e8d9b8;
    border-radius: 6rpx;

    &--relationship {
      background-color: #e8d9b8;
    }
  }

  &__bar-fill {
    height: 100%;
    transition: width 200ms ease;

    &--power {
      background-color: #8b1a1a;
    }

    &--positive {
      background-color: #2e7d32;
    }

    &--negative {
      background-color: #c62828;
    }

    &--neutral {
      background-color: #9e9e9e;
    }
  }
}
</style>
