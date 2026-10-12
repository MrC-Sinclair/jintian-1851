<template>
  <view class="diplomacy-panel">
    <!-- 面板标题栏 -->
    <view class="diplomacy-panel__header">
      <view class="diplomacy-panel__title-wrap">
        <text class="diplomacy-panel__title">外交</text>
        <text class="diplomacy-panel__remaining">
          按钮剩余 {{ remainingDiplomacy }} · 谈判剩余 {{ remainingNegotiation }}
        </text>
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

        <!-- 6 动作按钮 + 写信入口（faction-negotiation 提案 T6） -->
        <view class="diplomacy-panel__actions">
          <view
            v-for="action in actionList"
            :key="action"
            class="diplomacy-panel__action"
            :class="{ 'diplomacy-panel__action--disabled': isActionDisabled(fac, action) }"
            role="button"
            :aria-label="DIPLOMACY_ACTION_LABELS[action]"
            :aria-disabled="isActionDisabled(fac, action)"
            tabindex="0"
            :hover-class="!isActionDisabled(fac, action) ? 'diplomacy-panel__action--hover' : ''"
            :hover-stay-time="100"
            @click="onAction(fac, action)"
            @keydown.enter.prevent="onAction(fac, action)"
            @keydown.space.prevent="onAction(fac, action)"
          >
            <text class="diplomacy-panel__action-text">{{ DIPLOMACY_ACTION_LABELS[action] }}</text>
          </view>
        </view>
        <view
          class="diplomacy-panel__action diplomacy-panel__action--letter"
          :class="{ 'diplomacy-panel__action--disabled': isLetterDisabled(fac) }"
          role="button"
          aria-label="写信"
          tabindex="0"
          :hover-class="!isLetterDisabled(fac) ? 'diplomacy-panel__action--hover' : ''"
          hover-stay-time="100"
          @click="onWriteLetter(fac)"
          @keydown.enter.prevent="onWriteLetter(fac)"
        >
          <text class="diplomacy-panel__action-text diplomacy-panel__action-text--letter">写信谈判</text>
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
import {
  DIPLOMACY_RULES,
  MAX_DIPLOMACY_PER_TURN,
  MAX_NEGOTIATION_PER_TURN,
  canAfford
} from '@/utils/constants'
import {
  DIPLOMACY_ACTION_LABELS,
  DIPLOMACY_DISABLED_TEXT,
  EFFECT_LABELS,
  formatRelationshipLabel,
  getRelationshipLevel
} from '@/utils/copywriting'
import type { Faction, PlayerDiplomacyAction, Resources } from '@/types/game'

const store = useGameStore()
const toast = useToast()

const emit = defineEmits<{
  (e: 'close'): void
  /** 写信谈判入口（faction-negotiation 提案）：由上层渲染 NegotiationDialog */
  (e: 'negotiate', faction: Faction): void
}>()

/** 当前存档全部势力 */
const factions = computed<Faction[]>(() => store.currentSave?.factions ?? [])

/** 6 个动作固定顺序 */
const actionList: PlayerDiplomacyAction[] = ['结盟', '宣战', '行贿', '通商', '离间', '质子']

/** 本回合剩余外交次数（上限 - 已用） */
const remainingDiplomacy = computed(() =>
  Math.max(0, MAX_DIPLOMACY_PER_TURN - (store.diplomacyUsedThisTurn ? 1 : 0))
)

/** 本回合剩余谈判次数（faction-negotiation 提案 D4：与按钮配额独立） */
const remainingNegotiation = computed(() =>
  Math.max(0, MAX_NEGOTIATION_PER_TURN - (store.negotiationUsedThisTurn ? 1 : 0))
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
 * 计算资源缺口文案（形如"银两 100"或"银两 100、兵员 50"）
 * 供资源不足禁用原因展示具体缺项。
 */
function resourceShortage(cost: Partial<Resources>, resources: Resources): string {
  const missing = (Object.keys(cost) as (keyof Resources)[])
    .filter((k) => (resources[k] ?? 0) < Math.abs(cost[k] ?? 0))
    .map((k) => `${EFFECT_LABELS[k]} ${Math.abs(cost[k] ?? 0)}`)
  return missing.join('、')
}

/**
 * 动作禁用原因（UI 预校验，store 内二次校验）
 *
 * 返回 null 表示可用；返回字符串为具体禁用原因（P0-6 禁用原因提示）。
 * 判定顺序与 store.applyDiplomacyAction 一致：处理中 → 配额用尽 → 势力已灭 → 关系门槛 → 资源不足。
 */
function getActionDisabledReason(fac: Faction, action: PlayerDiplomacyAction): string | null {
  if (!store.currentSave) return null
  // 回合处理中禁用（防并发）
  if (store.isProcessingTurn) return DIPLOMACY_DISABLED_TEXT.turnProcessing
  // 本回合已用尽上限
  if (store.diplomacyUsedThisTurn) return DIPLOMACY_DISABLED_TEXT.actionQuotaUsed
  // 势力已灭不可外交
  if (fac.status === 'destroyed') return DIPLOMACY_DISABLED_TEXT.factionDestroyed(fac.name)
  const rule = DIPLOMACY_RULES[action]
  // 关系门槛
  if (fac.relationship < rule.minRelationship) {
    return DIPLOMACY_DISABLED_TEXT.relationshipTooLow(
      fac.name,
      DIPLOMACY_ACTION_LABELS[action],
      rule.minRelationship
    )
  }
  // 资源成本
  if (!canAfford(rule.cost, store.currentSave.state.resources)) {
    return DIPLOMACY_DISABLED_TEXT.resourceShortage(
      resourceShortage(rule.cost, store.currentSave.state.resources)
    )
  }
  return null
}

/** 动作是否禁用（由禁用原因派生，避免判定逻辑两处漂移） */
function isActionDisabled(fac: Faction, action: PlayerDiplomacyAction): boolean {
  return getActionDisabledReason(fac, action) !== null
}

/** 点击动作：给出禁用原因或调用 store 并反馈结果 */
function onAction(fac: Faction, action: PlayerDiplomacyAction): void {
  const reason = getActionDisabledReason(fac, action)
  if (reason) {
    toast.error(reason)
    return
  }
  const ok = store.applyDiplomacyAction(fac.id, action)
  if (ok) {
    toast.success(`已对${fac.name}发动「${action}」`)
  } else {
    toast.error('外交行动失败，请稍后再试')
  }
}

/**
 * 写信按钮禁用原因（faction-negotiation 提案 T6）
 * 回合处理中 / 谈判配额已用 / 势力已灭 时禁用（allied 允许写信维持关系，首版口径）
 */
function getLetterDisabledReason(fac: Faction): string | null {
  if (!store.currentSave) return null
  if (store.isProcessingTurn) return DIPLOMACY_DISABLED_TEXT.turnProcessing
  if (store.negotiationUsedThisTurn) return DIPLOMACY_DISABLED_TEXT.letterQuotaUsed
  if (fac.status === 'destroyed') return DIPLOMACY_DISABLED_TEXT.letterFactionDestroyed(fac.name)
  return null
}

/** 写信按钮是否禁用（由禁用原因派生） */
function isLetterDisabled(fac: Faction): boolean {
  return getLetterDisabledReason(fac) !== null
}

/** 点击写信：给出禁用原因或交由上层弹出 NegotiationDialog */
function onWriteLetter(fac: Faction): void {
  const reason = getLetterDisabledReason(fac)
  if (reason) {
    toast.error(reason)
    return
  }
  emit('negotiate', fac)
}
</script>

<style lang="scss" scoped>
.diplomacy-panel {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  // 面板自身限制高度并支持内部滚动：势力较多（如 5 个）时内容会超出 80vh，
  // 必须由 overflow-y 提供滚动，否则底部势力/写信按钮将被裁切且不可达
  max-height: 80vh;
  padding: 24rpx 24rpx 40rpx;
  overflow-x: hidden;
  overflow-y: auto;
  background-color: #fdf6e3;

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
    gap: 16rpx;
    align-items: baseline;
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
    // 图标按钮触摸目标 ≥ 36px（AGENTS.md 图标按钮规范，与 AdvisorDrawer 一致）
    min-width: 36px;
    height: 56rpx;
    min-height: 36px;
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
    gap: 12rpx;
    align-items: center;
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
    display: flex;
    flex: 1 1 calc(33.33% - 12rpx);
    align-items: center;
    justify-content: center;
    min-height: 72rpx;
    padding: 8rpx 12rpx;
    background-color: #fdf6e3;
    border: 2rpx solid #8b1a1a;
    border-radius: 8rpx;
    transition: background-color 150ms ease;

    &--hover {
      background-color: rgba(139, 26, 26, 0.12);
    }

    &--disabled {
      background-color: #f0e8d6;
      border-color: #bca988;
      opacity: 0.45;
    }
  }

  &__action-text {
    font-size: 26rpx;
    color: #8b1a1a;
  }

  // 写信谈判入口（faction-negotiation 提案）：整行按钮，与 6 动作区分
  &__action--letter {
    min-height: 88rpx;
    margin-top: 12rpx;
    background-color: #f6ecd4;
    border-color: #c9a86a;
  }

  &__action-text--letter {
    font-weight: 600;
    color: #6d4c41;
  }
}
</style>
