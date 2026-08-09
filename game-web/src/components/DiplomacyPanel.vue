<template>
  <view class="diplomacy-panel">
    <!-- 面板标题栏 -->
    <view class="diplomacy-panel__header">
      <view class="diplomacy-panel__title-wrap">
        <text class="diplomacy-panel__title">外交</text>
        <text class="diplomacy-panel__remaining">本回合剩余次数：{{ remainingDiplomacy }}</text>
      </view>
      <view
        class="diplomacy-panel__close"
        role="button"
        aria-label="关闭外交面板"
        tabindex="0"
        hover-class="diplomacy-panel__close--hover"
        hover-stay-time="100"
        @click="emit('close')"
        @keydown.enter.prevent="emit('close')"
      >
        <text class="diplomacy-panel__close-text">×</text>
      </view>
    </view>

    <!-- 势力列表 -->
    <view class="diplomacy-panel__list">
      <view
        v-for="fac in factions"
        :key="fac.id"
        class="diplomacy-panel__faction"
      >
        <!-- 势力头部：名称 + 关系文案 + 状态角标 -->
        <view class="diplomacy-panel__faction-head">
          <text class="diplomacy-panel__faction-name">{{ fac.name }}</text>
          <text
            class="diplomacy-panel__faction-rel"
            :class="relColorClass(fac.relationship)"
          >{{ formatRelationshipLabel(fac.relationship) }}</text>
          <text
            v-if="fac.status === 'allied'"
            class="diplomacy-panel__badge diplomacy-panel__badge--ally"
          >盟友</text>
          <text
            v-else-if="fac.status === 'destroyed'"
            class="diplomacy-panel__badge diplomacy-panel__badge--dead"
          >已灭</text>
        </view>

        <!-- 关系条 -->
        <view class="diplomacy-panel__bar-track">
          <view
            class="diplomacy-panel__bar-fill"
            :class="relFillClass(fac.relationship)"
            :style="{ width: `${relPercent(fac.relationship)}%` }"
          />
        </view>

        <!-- 6 动作按钮 -->
        <view class="diplomacy-panel__actions">
          <view
            v-for="action in actionList"
            :key="action"
            class="diplomacy-panel__action"
            :class="{ 'diplomacy-panel__action--disabled': isActionDisabled(fac, action) }"
            :hover-class="!isActionDisabled(fac, action) ? 'diplomacy-panel__action--hover' : ''"
            :hover-stay-time="100"
            @click="onAction(fac, action)"
          >
            <text class="diplomacy-panel__action-text">{{ DIPLOMACY_ACTION_LABELS[action] }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * @file DiplomacyPanel — 玩家主动外交面板（player-active-diplomacy 提案 T3）
 *
 * 列出 6 势力（关系条 + 关系文案 + 状态角标）与 6 个动作按钮。
 * 按钮禁用由 isActionDisabled 统一判定（门槛 / 资源不足 / 本回合已用尽 / 回合处理中 / 势力已灭），
 * store.applyDiplomacyAction 内部做二次校验防绕过。
 *
 * 外交为「次级操作」：独立于事件决策，但回合处理中禁用；每回合上限由 store.diplomacyUsedThisTurn 守卫。
 */

import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { useToast } from '@/composables/useToast'
import { DIPLOMACY_RULES, canAfford, MAX_DIPLOMACY_PER_TURN } from '@/utils/constants'
import {
  DIPLOMACY_ACTION_LABELS,
  formatRelationshipLabel,
  getRelationshipLevel
} from '@/utils/copywriting'
import type { Faction, PlayerDiplomacyAction } from '@/types/game'

const store = useGameStore()
const toast = useToast()

const emit = defineEmits<{
  (e: 'close'): void
}>()

/** 当前存档全部势力 */
const factions = computed<Faction[]>(() => store.currentSave?.factions ?? [])

/** 6 个动作固定顺序 */
const actionList: PlayerDiplomacyAction[] = ['结盟', '宣战', '行贿', '通商', '离间', '质子']

/** 本回合剩余外交次数（上限 - 已用） */
const remainingDiplomacy = computed(() =>
  Math.max(0, MAX_DIPLOMACY_PER_TURN - (store.diplomacyUsedThisTurn ? 1 : 0))
)

/** relationship -100~100 → 0~100% （50% 表示中立） */
function relPercent(v: number): number {
  return Math.max(0, Math.min(100, (v + 100) / 2))
}

/** 关系文案颜色类 */
function relColorClass(v: number): string {
  const level = getRelationshipLevel(v)
  if (level === 'ally' || level === 'friendly') return 'diplomacy-panel__rel--positive'
  if (level === 'tense' || level === 'hostile') return 'diplomacy-panel__rel--negative'
  return ''
}

/** 关系条填充颜色类 */
function relFillClass(v: number): string {
  const level = getRelationshipLevel(v)
  if (level === 'ally' || level === 'friendly') return 'diplomacy-panel__bar-fill--positive'
  if (level === 'tense' || level === 'hostile') return 'diplomacy-panel__bar-fill--negative'
  return 'diplomacy-panel__bar-fill--neutral'
}

/**
 * 动作是否禁用（UI 预校验，store 内二次校验）
 */
function isActionDisabled(fac: Faction, action: PlayerDiplomacyAction): boolean {
  if (!store.currentSave) return true
  // 回合处理中禁用（防并发）
  if (store.isProcessingTurn) return true
  // 本回合已用尽上限
  if (store.diplomacyUsedThisTurn) return true
  // 势力已灭不可外交
  if (fac.status === 'destroyed') return true
  const rule = DIPLOMACY_RULES[action]
  // 关系门槛
  if (fac.relationship < rule.minRelationship) return true
  // 资源成本
  if (!canAfford(rule.cost, store.currentSave.state.resources)) return true
  return false
}

/** 点击动作：调用 store，给出反馈 */
function onAction(fac: Faction, action: PlayerDiplomacyAction): void {
  if (isActionDisabled(fac, action)) {
    toast.error('该外交行动当前不可用（门槛/资源/本回合已用尽）')
    return
  }
  const ok = store.applyDiplomacyAction(fac.id, action)
  if (ok) {
    toast.success(`已对${fac.name}发动「${action}」`)
  } else {
    toast.error('外交行动失败，请稍后再试')
  }
}
</script>

<style lang="scss" scoped>
.diplomacy-panel {
  display: flex;
  flex-direction: column;
  background-color: #fdf6e3;
  // 抽屉容器已限制 max-height + 滚动，这里不再限制
  max-height: 80vh;
  box-sizing: border-box;
  padding: 24rpx 24rpx 40rpx;

  // ====================== 标题栏 ======================
  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 16rpx;
    margin-bottom: 16rpx;
    border-bottom: 2rpx solid #d4c5a0;
  }

  &__title-wrap {
    display: flex;
    align-items: baseline;
    gap: 16rpx;
  }

  &__title {
    font-size: 32rpx;
    font-weight: 600;
    color: #5d4037;
  }

  &__remaining {
    font-size: 22rpx;
    color: #8d6e63;
  }

  &__close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56rpx;
    height: 56rpx;
    border-radius: 8rpx;

    &--hover {
      background-color: rgba(139, 26, 26, 0.1);
    }
  }

  &__close-text {
    font-size: 44rpx;
    line-height: 1;
    color: #5d4037;
  }

  // ====================== 势力列表 ======================
  &__list {
    display: flex;
    flex-direction: column;
    gap: 20rpx;
  }

  &__faction {
    padding: 16rpx 20rpx;
    background-color: #fbf3df;
    border: 2rpx solid #d4c5a0;
    border-radius: 12rpx;
  }

  &__faction-head {
    display: flex;
    align-items: center;
    gap: 12rpx;
    margin-bottom: 10rpx;
  }

  &__faction-name {
    font-size: 30rpx;
    font-weight: 600;
    color: #2c1810;
  }

  &__faction-rel {
    font-size: 24rpx;
    color: #5d4037;

    &--positive {
      color: #2e7d32;
    }

    &--negative {
      color: #c62828;
    }
  }

  &__badge {
    padding: 2rpx 10rpx;
    font-size: 20rpx;
    color: #fff;
    border-radius: 6rpx;

    &--ally {
      background-color: #2e7d32;
    }

    &--dead {
      background-color: #616161;
    }
  }

  // 关系条
  &__bar-track {
    height: 12rpx;
    margin-bottom: 14rpx;
    overflow: hidden;
    background-color: #e8d9b8;
    border-radius: 6rpx;
  }

  &__bar-fill {
    height: 100%;
    transition: width 200ms ease;

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

  // ====================== 动作按钮 ======================
  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12rpx;
  }

  &__action {
    flex: 1 1 calc(33.33% - 12rpx);
    min-height: 72rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8rpx 12rpx;
    background-color: #fdf6e3;
    border: 2rpx solid #8b1a1a;
    border-radius: 8rpx;
    transition: background-color 150ms ease;

    &--hover {
      background-color: rgba(139, 26, 26, 0.12);
    }

    &--disabled {
      opacity: 0.45;
      border-color: #bca988;
      background-color: #f0e8d6;
    }
  }

  &__action-text {
    font-size: 26rpx;
    color: #8b1a1a;
  }
}
</style>
