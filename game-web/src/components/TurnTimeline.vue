<template>
  <view class="turn-timeline">
    <text class="turn-timeline__title">近况</text>

    <view v-if="events.length === 0" class="turn-timeline__empty">
      <text class="turn-timeline__empty-text">{{ EMPTY_TEXT.timeline }}</text>
    </view>

    <view v-else class="turn-timeline__list">
      <view
        v-for="(evt, idx) in displayEvents"
        :key="`${evt.turn}-${idx}`"
        class="turn-timeline__item"
        :class="{ 'turn-timeline__item--latest': idx === 0 }"
      >
        <!-- T4.2：含 chainId 的历史事件左侧显示书卷图标（TooltipView 显示剧情链名），否则显示普通圆点 -->
        <TooltipView
          v-if="evt.chainId"
          :content="chainTitleFor(evt)"
          placement="top"
        >
          <view class="turn-timeline__book">
            <svg
              class="turn-timeline__book-icon"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zM21 18.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z" />
              <path d="M17.5 10.5c.6 0 1.15.1 1.65.25V7.5c-.5-.15-1.05-.25-1.65-.25s-1.15.1-1.65.25v3.25c.5-.15 1.05-.25 1.65-.25z" />
              <path d="M17.5 14.5c.6 0 1.15.1 1.65.25V11.5c-.5-.15-1.05-.25-1.65-.25s-1.15.1-1.65.25v3.25c.5-.15 1.05-.25 1.65-.25z" />
            </svg>
          </view>
        </TooltipView>
        <view v-else class="turn-timeline__dot" />
        <view class="turn-timeline__body">
          <view class="turn-timeline__head">
            <text class="turn-timeline__turn">第 {{ evt.turn }} 回合</text>
            <text
              class="turn-timeline__type"
              :class="typeClass(evt.eventType)"
            >{{ evt.eventType }}</text>
          </view>
          <text class="turn-timeline__event-title">{{ evt.title }}</text>
          <!-- T2.7：补全选择记录（玩家选择 + effects 摘要） -->
          <view v-if="evt.playerChoice || hasEffects(evt)" class="turn-timeline__choice">
            <text v-if="evt.playerChoice" class="turn-timeline__choice-label">
              你的选择：{{ evt.playerChoice }}
            </text>
            <view v-if="hasEffects(evt)" class="turn-timeline__effects">
              <text
                v-for="eff in formatEffects(evt)"
                :key="eff.key"
                class="turn-timeline__effect"
                :class="eff.cls"
              >{{ eff.text }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { EventType, HistoryEvent } from '@/types/game'
import { EMPTY_TEXT, EFFECT_LABELS, CHAIN_LABELS } from '@/utils/copywriting'
import TooltipView from '@/components/TooltipView.vue'

const props = defineProps<{
  /** 历史事件（GameSave.events，按时间正序） */
  events: HistoryEvent[]
  /** 展示最近多少条（默认 5） */
  limit?: number
}>()

/** 倒序后取前 N 条，再倒序回正序展示（最近一条在顶部高亮） */
const displayEvents = computed<HistoryEvent[]>(() => {
  const limit = props.limit ?? 5
  return [...props.events].slice(-limit).reverse()
})

function typeClass(type: EventType): string {
  switch (type) {
    case '民生':
      return 'turn-timeline__type--people'
    case '军事':
      return 'turn-timeline__type--military'
    case '外交':
      return 'turn-timeline__type--diplomacy'
    case '随机':
      return 'turn-timeline__type--random'
    case '历史剧情':
      return 'turn-timeline__type--history'
    case 'npc':
      return 'turn-timeline__type--npc'
    case '系统':
      return 'turn-timeline__type--system'
    default:
      return ''
  }
}

/**
 * T4.2：获取历史事件所属剧情链的展示名（用于书卷图标 tooltip）
 *
 * - 无 chainId（普通随机事件）→ 返回空串（模板走普通圆点分支）
 * - 有 chainId → 优先用 CHAIN_LABELS 的中文链名，未知 id 兜底为原始 id
 */
function chainTitleFor(evt: HistoryEvent): string {
  const id = evt.chainId
  if (!id) return ''
  return CHAIN_LABELS[id] ?? id
}

/**
 * T2.7：判断历史记录是否有 effects（优先 appliedEffects，回退 effects）
 *
 * 向后兼容：旧存档可能无 appliedEffects，使用 effects 兜底
 */
function hasEffects(evt: HistoryEvent): boolean {
  const effects = evt.appliedEffects ?? evt.effects
  if (!effects) return false
  return Object.values(effects).some((v) => typeof v === 'number' && v !== 0)
}

interface FormattedEffect {
  key: string
  text: string
  cls: string
}

/**
 * T2.7：格式化 effects 摘要（用 EFFECT_LABELS 完整词）
 */
function formatEffects(evt: HistoryEvent): FormattedEffect[] {
  const effects = evt.appliedEffects ?? evt.effects
  if (!effects) return []
  const list: FormattedEffect[] = []
  for (const [k, v] of Object.entries(effects)) {
    if (typeof v !== 'number' || v === 0) continue
    const label = EFFECT_LABELS[k] ?? k
    const sign = v > 0 ? '+' : ''
    const cls = v > 0 ? 'turn-timeline__effect--positive' : 'turn-timeline__effect--negative'
    list.push({ key: k, text: `${label}${sign}${v}`, cls })
  }
  return list
}
</script>

<style lang="scss" scoped>
.turn-timeline {
  padding: 16rpx 24rpx;
  background-color: #fdf6e3;
  border: 2rpx solid #d4c5a0;
  border-radius: 12rpx;

  &__title {
    display: block;
    margin-bottom: 12rpx;
    font-size: 28rpx;
    font-weight: 600;
    color: #5d4037;
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

  &__list {
    display: flex;
    flex-direction: column;
    gap: 12rpx;
  }

  &__item {
    display: flex;
    gap: 12rpx;
    // T2.7：触摸目标 min-h: 88rpx（tasks.md 规范）
    min-height: 88rpx;
    padding: 12rpx 0;
    transition: opacity 200ms ease;

    &:not(:last-child) {
      border-bottom: 2rpx dashed rgba(212, 197, 160, 0.5);
    }

    &--latest {
      opacity: 1;

      .turn-timeline__event-title {
        color: #2c1810;
        font-weight: 600;
      }
    }
  }

  &__dot {
    flex-shrink: 0;
    width: 12rpx;
    height: 12rpx;
    margin-top: 12rpx;
    background-color: #8b1a1a;
    border-radius: 50%;
  }

  // T4.2：剧情链事件左侧书卷图标（替代普通圆点）
  &__book {
    flex-shrink: 0;
    width: 24rpx;
    height: 24rpx;
    margin-top: 6rpx;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__book-icon {
    width: 24rpx;
    height: 24rpx;
    fill: #5d4037;
  }

  &__body {
    flex: 1;
    min-width: 0;
  }

  &__head {
    display: flex;
    align-items: center;
    gap: 8rpx;
    margin-bottom: 4rpx;
  }

  &__turn {
    font-size: 22rpx;
    color: #8d6e63;
  }

  &__type {
    padding: 2rpx 8rpx;
    font-size: 20rpx;
    color: #fff;
    border-radius: 4rpx;

    &--people {
      background-color: #2e7d32;
    }

    &--military {
      background-color: #8b1a1a;
    }

    &--diplomacy {
      background-color: #1565c0;
    }

    &--random {
      background-color: #6a1b9a;
    }

    &--history {
      background-color: #bf360c;
    }

    &--npc {
      background-color: #5d4037;
    }

    // 资源产出机制：系统事件（赋税入库等行政产出），中性青灰区分于其余 6 类
    &--system {
      background-color: #455a64;
    }
  }

  &__event-title {
    display: block;
    overflow: hidden;
    font-size: 26rpx;
    line-height: 1.4;
    color: #5d4037;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  // T2.7：选择记录区
  &__choice {
    margin-top: 8rpx;
    padding: 8rpx 12rpx;
    background-color: rgba(212, 197, 160, 0.2);
    border-radius: 6rpx;
  }

  &__choice-label {
    display: block;
    font-size: 22rpx;
    line-height: 1.4;
    color: #5d4037;
  }

  &__effects {
    display: flex;
    flex-wrap: wrap;
    gap: 8rpx;
    margin-top: 4rpx;
  }

  &__effect {
    padding: 2rpx 8rpx;
    font-size: 20rpx;
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
}
</style>
