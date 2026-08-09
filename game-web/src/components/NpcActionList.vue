<template>
  <view class="npc-action-list">
    <view class="npc-action-list__header">
      <view class="npc-action-list__title-wrap">
        <text class="npc-action-list__title">天下动静</text>
        <InfoHint
          :title="'天下动静'"
          :content="TERM_EXPLANATIONS.npcAction"
        />
      </view>
      <text v-if="totalCount > 0" class="npc-action-list__count">
        共 {{ totalCount }} 则
      </text>
    </view>

    <view v-if="totalCount === 0" class="npc-action-list__empty">
      <!-- T2.3：空状态文案白话化（copywriting.EMPTY_TEXT.npcActions） -->
      <text class="npc-action-list__empty-text">{{ EMPTY_TEXT.npcActions }}</text>
    </view>

    <view v-else class="npc-action-list__items">

      <!-- 2026-08-06-npc-action-cumulative-impact：本回合累计影响汇总卡（位于列表项上方） -->
      <view
        v-if="showCumulativeCard"
        class="npc-action-list__cumulative"
      >
        <text class="npc-action-list__cumulative-title">{{ NPC_CUMULATIVE_IMPACT.title }}</text>
        <view
          v-if="formatEffects(sortedCumulative).length > 0"
          class="npc-action-list__cumulative-effects"
        >
          <text
            v-for="eff in formatEffects(sortedCumulative)"
            :key="eff.key"
            class="npc-action-item__effect"
            :class="eff.cls"
          >{{ eff.text }}</text>
        </view>
        <text v-else class="npc-action-list__cumulative-empty">{{ NPC_CUMULATIVE_IMPACT.empty }}</text>
      </view>

      <view
        v-for="(action, idx) in actions"
        :key="`${action.factionId}-${idx}`"
        class="npc-action-item"
      >
        <view class="npc-action-item__head">
          <text class="npc-action-item__faction">{{ action.factionName }}</text>
          <view class="npc-action-item__action-wrap">
            <text
              class="npc-action-item__action"
              :class="actionClass(action.action)"
            >{{ action.action }}</text>
            <InfoHint
              :title="action.action"
              :content="getActionExplanation(action.action)"
            />
          </view>
        </view>

        <text v-if="action.target" class="npc-action-item__target">
          目标：{{ action.target }}
        </text>

        <text class="npc-action-item__desc">{{ action.description }}</text>

        <!-- T2.8：突出"对你影响"行（让玩家明确这是对自己的影响） -->
        <view class="npc-action-item__impact">
          <text class="npc-action-item__impact-label">对你影响：</text>
          <view
            v-if="hasEffects(action.effects)"
            class="npc-action-item__impact-effects"
          >
            <text
              v-for="eff in formatEffects(action.effects)"
              :key="eff.key"
              class="npc-action-item__effect"
              :class="eff.cls"
            >{{ eff.text }}</text>
          </view>
          <text v-else class="npc-action-item__impact-none">暂无直接影响</text>
        </view>
      </view>

      <!-- T3.4：决策失败的 NPC 卡片（红色边框 + 角标） -->
      <view
        v-for="ff in failedFactionIds"
        :key="`failed-${ff.id}`"
        class="npc-action-item npc-action-item--failed"
      >
        <view class="npc-action-item__head">
          <text class="npc-action-item__faction">{{ ff.name }}</text>
          <text class="npc-action-item__fail-badge">决策失败</text>
        </view>
        <text class="npc-action-item__fail-desc">
          本回合该势力决策生成失败，未产生行动计划。
        </text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import InfoHint from '@/components/InfoHint.vue'
import {
  EFFECT_LABELS,
  EMPTY_TEXT,
  NPC_ACTION_EXPLANATIONS,
  NPC_CUMULATIVE_IMPACT,
  TERM_EXPLANATIONS
} from '@/utils/copywriting'
import type { Attributes, NpcAction, NpcActionType, Resources } from '@/types/game'

/** 决策失败的 NPC（id + 名称，由上层从存档 factions 解析） */
interface FailedFaction {
  id: string
  name: string
}

const props = defineProps<{
  actions: NpcAction[]
  /** T3.4：本回合决策失败的 NPC 列表（用于展示失败角标） */
  failedFactionIds?: FailedFaction[]
}>()

const totalCount = computed(
  () => props.actions.length + (props.failedFactionIds?.length ?? 0)
)

/**
 * 本回合累计影响（2026-08-06-npc-action-cumulative-impact）
 *
 * 聚合 props.actions 中所有 NPC 行动的 effects（按维度数值累加）。
 * 决策失败项（failedFactionIds）无 effects，不进入聚合；
 * 单条 effects 为空对象（如"休养"无直接影响）自然贡献 0，不污染累计。
 */
const cumulative = computed<Partial<Attributes & Resources>>(() => {
  const acc: Record<string, number> = {}
  for (const a of props.actions) {
    if (!a.effects) continue
    for (const [k, v] of Object.entries(a.effects)) {
      if (typeof v === 'number') acc[k] = (acc[k] ?? 0) + v
    }
  }
  return acc
})

/**
 * 累计影响按绝对值降序重建为有序对象，最受影响维度在前。
 * 0 值过滤交由既有 formatEffects 处理；此处排序后直接喂给 formatEffects，
 * 彻底复用其标签（EFFECT_LABELS）+ 红/绿着色逻辑，不另写一套。
 */
const sortedCumulative = computed<Partial<Attributes & Resources>>(() => {
  const entries = Object.entries(cumulative.value)
    .filter(([, v]) => typeof v === 'number' && v !== 0)
    .sort((a, b) => Math.abs(b[1] as number) - Math.abs(a[1] as number))
  return Object.fromEntries(entries) as Partial<Attributes & Resources>
})

/** 汇总卡是否展示：本回合有成功生成的 NPC 行动（避免与整面板空态/失败卡片语义冲突） */
const showCumulativeCard = computed(() => props.actions.length > 0)

/** 行动类型样式 */
function actionClass(action: NpcActionType): string {
  // 敌意行动标红、友好行动标绿、其余中性
  switch (action) {
    case '挑衅':
    case '扩张':
    case '备战':
      return 'npc-action-item__action--aggressive'
    case '结盟':
    case '外交':
      return 'npc-action-item__action--friendly'
    case '休养':
    default:
      return 'npc-action-item__action--neutral'
  }
}

/** 行动后果解释（取自 copywriting.NPC_ACTION_EXPLANATIONS，缺省返回通用提示） */
function getActionExplanation(action: NpcActionType): string {
  return NPC_ACTION_EXPLANATIONS[action] ?? `${action}：该势力采取此行动，可能影响你的局势。`
}

interface FormattedEffect {
  key: string
  text: string
  cls: string
}

function hasEffects(effects?: Partial<Attributes & Resources>): boolean {
  if (!effects) return false
  return Object.values(effects).some((v) => typeof v === 'number' && v !== 0)
}

/** 对玩家影响标红/标绿（负面红、正面绿），标签使用完整词（军事/银两等） */
function formatEffects(effects?: Partial<Attributes & Resources>): FormattedEffect[] {
  if (!effects) return []
  const list: FormattedEffect[] = []
  for (const [k, v] of Object.entries(effects)) {
    if (typeof v !== 'number' || v === 0) continue
    const label = EFFECT_LABELS[k] ?? k
    const sign = v > 0 ? '+' : ''
    const cls =
      v > 0
        ? 'npc-action-item__effect--positive'
        : 'npc-action-item__effect--negative'
    list.push({ key: k, text: `${label}${sign}${v}`, cls })
  }
  return list
}
</script>

<style lang="scss" scoped>
.npc-action-list {
  padding: 16rpx 24rpx;
  background-color: #fdf6e3;
  border: 2rpx solid #d4c5a0;
  border-radius: 12rpx;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12rpx;
  }

  &__title-wrap {
    display: flex;
    align-items: center;
  }

  &__title {
    font-size: 28rpx;
    font-weight: 600;
    color: #5d4037;
  }

  &__count {
    font-size: 22rpx;
    color: #8d6e63;
  }

  // 2026-08-06-npc-action-cumulative-impact：本回合累计影响汇总卡
  &__cumulative {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8rpx;
    margin-bottom: 12rpx;
    padding: 12rpx 16rpx;
    background-color: rgba(139, 26, 26, 0.05);
    border: 2rpx solid rgba(139, 26, 26, 0.15);
    border-radius: 8rpx;
  }

  &__cumulative-title {
    font-size: 24rpx;
    font-weight: 600;
    color: #8b1a1a;
    white-space: nowrap;
  }

  &__cumulative-effects {
    display: flex;
    flex-wrap: wrap;
    gap: 8rpx;
  }

  &__cumulative-empty {
    font-size: 22rpx;
    color: #8d6e63;
    font-style: italic;
  }

  &__empty {
    padding: 24rpx 0;
    text-align: center;
  }

  &__empty-text {
    font-size: 26rpx;
    color: #8d6e63;
    font-style: italic;
  }

  &__items {
    display: flex;
    flex-direction: column;
    gap: 12rpx;
  }
}

.npc-action-item {
  padding: 12rpx 16rpx;
  background-color: rgba(245, 230, 200, 0.5);
  border-radius: 8rpx;
  transition: background-color 150ms ease;

  &:active {
    background-color: rgba(245, 230, 200, 0.8);
  }

  // T3.4：决策失败卡片（红色边框 + 浅红背景区分）
  &--failed {
    border: 2rpx solid #EF4444;
    background-color: rgba(239, 68, 68, 0.08);
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4rpx;
  }

  &__action-wrap {
    display: flex;
    align-items: center;
  }

  &__faction {
    font-size: 26rpx;
    font-weight: 600;
    color: #2c1810;
  }

  // T3.4：失败角标
  &__fail-badge {
    padding: 2rpx 10rpx;
    font-size: 20rpx;
    color: #fff;
    background-color: #EF4444;
    border-radius: 4rpx;
  }

  // T3.4：失败说明
  &__fail-desc {
    display: block;
    margin-top: 4rpx;
    font-size: 22rpx;
    color: #8d6e63;
    line-height: 1.5;
  }

  &__action {
    padding: 2rpx 10rpx;
    font-size: 22rpx;
    color: #fff;
    border-radius: 4rpx;

    &--aggressive {
      background-color: #c62828;
    }

    &--friendly {
      background-color: #2e7d32;
    }

    &--neutral {
      background-color: #5d4037;
    }
  }

  &__target {
    display: block;
    margin-bottom: 4rpx;
    font-size: 22rpx;
    color: #8d6e63;
  }

  &__desc {
    display: block;
    margin-bottom: 8rpx;
    font-size: 26rpx;
    line-height: 1.5;
    color: #5d4037;
  }

  // T2.8：突出"对你影响"行（独立区域 + 浅色背景区分）
  &__impact {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8rpx;
    padding: 8rpx 12rpx;
    background-color: rgba(139, 26, 26, 0.06);
    border-left: 4rpx solid #8b1a1a;
    border-radius: 4rpx;
  }

  &__impact-label {
    font-size: 22rpx;
    font-weight: 600;
    color: #8b1a1a;
    white-space: nowrap;
  }

  &__impact-effects {
    display: flex;
    flex-wrap: wrap;
    gap: 8rpx;
  }

  &__impact-none {
    font-size: 22rpx;
    color: #8d6e63;
    font-style: italic;
  }

  &__effect {
    padding: 2rpx 8rpx;
    font-size: 22rpx;
    border-radius: 4rpx;

    &--positive {
      color: #2e7d32;
      background-color: rgba(46, 125, 50, 0.15);
    }

    &--negative {
      color: #c62828;
      background-color: rgba(198, 40, 40, 0.15);
    }
  }
}
</style>
