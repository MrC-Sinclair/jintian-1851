<template>
  <view class="negotiation-dialog">
    <!-- 头部：势力名 + 关闭 -->
    <view class="negotiation-dialog__header">
      <view class="negotiation-dialog__title-wrap">
        <text class="negotiation-dialog__title">致 {{ faction.name }} 的信</text>
        <text class="negotiation-dialog__rel">关系 {{ faction.relationship }}</text>
      </view>
      <view
        class="negotiation-dialog__close"
        role="button"
        aria-label="关闭谈判"
        tabindex="0"
        hover-class="negotiation-dialog__close--hover"
        hover-stay-time="100"
        @click="emit('close')"
        @keydown.enter.prevent="emit('close')"
      >
        <text class="negotiation-dialog__close-text">×</text>
      </view>
    </view>

    <!-- ====================== 阶段 1：写信 ====================== -->
    <view v-if="stage === 'compose'" class="negotiation-dialog__body">
      <text class="negotiation-dialog__hint">以言语试探对方态度（1-200 字），或许能换来更有利的条件。</text>
      <textarea
        v-model="letter"
        class="negotiation-dialog__textarea"
        :maxlength="200"
        placeholder="修书一封……"
        placeholder-class="negotiation-dialog__placeholder"
        :adjust-position="true"
      />
      <text class="negotiation-dialog__count">{{ letter.length }}/200</text>
      <view
        class="negotiation-dialog__btn negotiation-dialog__btn--primary"
        :class="{ 'negotiation-dialog__btn--disabled': !canSend }"
        role="button"
        aria-label="发送信件"
        tabindex="0"
        :hover-class="canSend ? 'negotiation-dialog__btn--hover' : ''"
        hover-stay-time="100"
        @click="onSend"
        @keydown.enter.prevent="onSend"
      >
        <text class="negotiation-dialog__btn-text negotiation-dialog__btn-text--primary">遣使送信</text>
      </view>
    </view>

    <!-- ====================== 阶段 2：信使途中（loading） ====================== -->
    <view v-else-if="stage === 'sending' || stage === 'settling'" class="negotiation-dialog__body">
      <text class="negotiation-dialog__loading">{{ stage === 'sending' ? '信使疾驰途中，静候回音…' : '静候对方裁定…' }}</text>
    </view>

    <!-- ====================== 阶段 3：回信 ====================== -->
    <view v-else-if="stage === 'reply'" class="negotiation-dialog__body">
      <!-- 回信卡片 -->
      <view class="negotiation-dialog__reply-card">
        <text class="negotiation-dialog__stance" :class="`negotiation-dialog__stance--${response!.stance}`">
          {{ STANCE_LABELS[response!.stance] }}
        </text>
        <text class="negotiation-dialog__reply-text">{{ response!.reply }}</text>
        <text class="negotiation-dialog__delta">
          态度变化：关系 {{ formatDelta(response!.relationshipDelta) }}
        </text>
      </view>

      <!-- 条件卡片（仅 counter） -->
      <view v-if="response!.stance === 'counter' && dealDef" class="negotiation-dialog__deal-card">
        <text class="negotiation-dialog__deal-title">对方开出的条件：{{ dealDef.label }}</text>
        <text class="negotiation-dialog__deal-line">
          代价：银两 {{ scaled!.cost.silver }}{{ scaled!.cost.reputation !== undefined ? `、名望 ${scaled!.cost.reputation}` : '' }}
        </text>
        <text class="negotiation-dialog__deal-line">
          效果：关系 +{{ scaled!.effect.relationship }}{{ scaled!.effect.reputation !== undefined ? `、名望 +${scaled!.effect.reputation}` : '' }}{{ dealDef.effect.status === 'allied' ? '、结为盟友' : '' }}
        </text>

        <!-- 还价输入区 -->
        <view v-if="countering" class="negotiation-dialog__counter">
          <text class="negotiation-dialog__counter-hint">
            还价区间：{{ counterRange.min }} ~ {{ counterRange.max }} 银两
          </text>
          <input
            v-model.number="counterPrice"
            class="negotiation-dialog__counter-input"
            type="number"
            :placeholder="`还价（${counterRange.min}~${counterRange.max}）`"
          >
          <view class="negotiation-dialog__counter-btns">
            <view
              class="negotiation-dialog__btn negotiation-dialog__btn--primary negotiation-dialog__btn--small"
              :class="{ 'negotiation-dialog__btn--disabled': !canSubmitCounter }"
              role="button"
              aria-label="提交还价"
              tabindex="0"
              :hover-class="canSubmitCounter ? 'negotiation-dialog__btn--hover' : ''"
              hover-stay-time="100"
              @click="onSubmitCounter"
              @keydown.enter.prevent="onSubmitCounter"
            >
              <text class="negotiation-dialog__btn-text negotiation-dialog__btn-text--primary">提交还价</text>
            </view>
            <view
              class="negotiation-dialog__btn negotiation-dialog__btn--ghost negotiation-dialog__btn--small"
              role="button"
              aria-label="返回"
              tabindex="0"
              hover-class="negotiation-dialog__btn--hover"
              hover-stay-time="100"
              @click="countering = false"
              @keydown.enter.prevent="countering = false"
            >
              <text class="negotiation-dialog__btn-text">返回</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 操作按钮 -->
      <view v-if="response!.stance === 'counter' && !countering" class="negotiation-dialog__actions">
        <view
          class="negotiation-dialog__btn negotiation-dialog__btn--primary"
          role="button"
          aria-label="接受条件"
          tabindex="0"
          hover-class="negotiation-dialog__btn--hover"
          hover-stay-time="100"
          @click="onAccept"
          @keydown.enter.prevent="onAccept"
        >
          <text class="negotiation-dialog__btn-text negotiation-dialog__btn-text--primary">接受条件</text>
        </view>
        <view
          class="negotiation-dialog__btn negotiation-dialog__btn--ghost"
          role="button"
          aria-label="还价"
          tabindex="0"
          hover-class="negotiation-dialog__btn--hover"
          hover-stay-time="100"
          @click="onStartCounter"
          @keydown.enter.prevent="onStartCounter"
        >
          <text class="negotiation-dialog__btn-text">还价</text>
        </view>
        <view
          class="negotiation-dialog__btn negotiation-dialog__btn--ghost"
          role="button"
          aria-label="放弃"
          tabindex="0"
          hover-class="negotiation-dialog__btn--hover"
          hover-stay-time="100"
          @click="onGiveUp"
          @keydown.enter.prevent="onGiveUp"
        >
          <text class="negotiation-dialog__btn-text">放弃</text>
        </view>
      </view>
      <view v-else-if="response!.stance !== 'counter'" class="negotiation-dialog__actions">
        <view
          class="negotiation-dialog__btn negotiation-dialog__btn--primary"
          role="button"
          aria-label="结束谈判"
          tabindex="0"
          hover-class="negotiation-dialog__btn--hover"
          hover-stay-time="100"
          @click="emit('close')"
          @keydown.enter.prevent="emit('close')"
        >
          <text class="negotiation-dialog__btn-text negotiation-dialog__btn-text--primary">结束谈判</text>
        </view>
      </view>
    </view>

    <!-- ====================== 阶段 4：settle 结果 ====================== -->
    <view v-else-if="stage === 'done'" class="negotiation-dialog__body">
      <view class="negotiation-dialog__reply-card">
        <text class="negotiation-dialog__stance" :class="`negotiation-dialog__stance--${settleResult!.stance}`">
          {{ STANCE_LABELS[settleResult!.stance] }}
        </text>
        <text class="negotiation-dialog__reply-text">{{ settleResult!.reply }}</text>
        <text class="negotiation-dialog__delta">{{ doneSummary }}</text>
      </view>
      <view
        class="negotiation-dialog__btn negotiation-dialog__btn--primary"
        role="button"
        aria-label="关闭"
        tabindex="0"
        hover-class="negotiation-dialog__btn--hover"
        hover-stay-time="100"
        @click="emit('close')"
        @keydown.enter.prevent="emit('close')"
      >
        <text class="negotiation-dialog__btn-text negotiation-dialog__btn-text--primary">关闭</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * @file NegotiationDialog — 与 NPC 势力自然语言谈判弹窗（faction-negotiation 提案 T6）
 *
 * 弹窗内完成全流程（design.md D1 两阶段状态机）：
 *   写信（compose）→ loading（sending）→ 回信（reply：应允/拒绝直接结束，还价展示条件卡片）
 *   → 接受条件 / 还价（counter 输入） / 放弃 → settling → 裁定结果（done）
 *
 * - 效果执行不在本组件：useTurn.sendNegotiationLetter / respondNegotiationDeal 内调用
 *   store.applyLetterDelta / applyNegotiationDeal 确定性执行（数值权威在兑换表）
 * - 降级（fallback）：toast「信使途中受阻」，letter 阶段不消耗配额可重试
 * - 触摸目标：全部操作按钮 min-height 88rpx（≥44px）
 */

import { computed, ref } from 'vue'
import { useGameStore } from '@/stores/game'
import { useTurn, type FactionNegotiateResult } from '@/composables/useTurn'
import { useToast } from '@/composables/useToast'
import {
  counterPriceRange,
  getNegotiationDealById,
  scaleNegotiationEffect,
  type NegotiationDealDef
} from '@/utils/constants'
import type { Faction } from '@/types/game'

const props = defineProps<{
  faction: Faction
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const store = useGameStore()
const toast = useToast()

/** onError 仅 console，玩家侧反馈由本组件按阶段自理 */
const { sendNegotiationLetter, respondNegotiationDeal } = useTurn({
  onError: (stage, message) => {
    console.error(`[NegotiationDialog] ${stage} 失败:`, message)
  }
})

const STANCE_LABELS: Record<string, string> = {
  accept: '对方应允',
  reject: '对方婉拒',
  counter: '对方还价'
}

/** 谈判阶段：写信 → 发送中 → 回信 → （还价输入）→ 裁定中 → 完成 */
type Stage = 'compose' | 'sending' | 'reply' | 'settling' | 'done'
const stage = ref<Stage>('compose')
const letter = ref('')
/** letter 阶段响应（含信件 delta，settle 时作为参数带回） */
const response = ref<FactionNegotiateResult | null>(null)
/** settle 最终裁定 */
const settleResult = ref<FactionNegotiateResult | null>(null)
/** 还价输入态与还价金额 */
const countering = ref(false)
const counterPrice = ref(0)
/** 成交/未成交摘要（done 阶段展示） */
const doneSummary = ref('')

/** 对方条件定义（counter 时必有） */
const dealDef = computed<NegotiationDealDef | null>(() => {
  const deal = response.value?.deal
  if (!deal) return null
  return getNegotiationDealById(deal.dealId) ?? null
})

/** 按对方定价缩放后的代价/效果预览 */
const scaled = computed(() => {
  if (!dealDef.value || !response.value?.deal) return null
  return scaleNegotiationEffect(dealDef.value, response.value.deal.price)
})

/** 还价合法区间 */
const counterRange = computed(() => {
  if (!dealDef.value || !response.value?.deal) return { min: 0, max: 0 }
  return counterPriceRange(dealDef.value, response.value.deal.price)
})

const canSend = computed(() => letter.value.trim().length >= 1 && !store.negotiationUsedThisTurn)
const canSubmitCounter = computed(
  () =>
    Number.isFinite(counterPrice.value) &&
    counterPrice.value >= counterRange.value.min &&
    counterPrice.value <= counterRange.value.max
)

function formatDelta(v: number): string {
  return v >= 0 ? `+${v}` : `${v}`
}

/** 发送信件（letter 阶段） */
async function onSend(): Promise<void> {
  if (!canSend.value) {
    if (store.negotiationUsedThisTurn) toast.error('本回合谈判次数已用尽')
    return
  }
  stage.value = 'sending'
  const res = await sendNegotiationLetter(props.faction.id, letter.value)
  if (!res) {
    // 网络层失败：回到写信页允许重试
    stage.value = 'compose'
    toast.error('信件未能送出，请稍后再试')
    return
  }
  if (res.fallback) {
    // 降级：不消耗配额，回到写信页允许重试
    stage.value = 'compose'
    toast.warning('信使途中受阻，未能送达')
    return
  }
  response.value = res
  stage.value = 'reply'
}

/** 接受条件（settle accept） */
async function onAccept(): Promise<void> {
  if (!response.value?.deal) return
  stage.value = 'settling'
  const res = await respondNegotiationDeal({
    factionId: props.faction.id,
    letter: letter.value,
    previousReply: response.value.reply,
    deal: response.value.deal,
    playerResponse: 'accept',
    letterDelta: response.value.relationshipDelta
  })
  finishSettle(res, 'accept')
}

/** 进入还价输入 */
function onStartCounter(): void {
  counterPrice.value = counterRange.value.max
  countering.value = true
}

/** 提交还价（settle counter） */
async function onSubmitCounter(): Promise<void> {
  if (!canSubmitCounter.value || !response.value?.deal) {
    toast.error(`还价需在 ${counterRange.value.min}~${counterRange.value.max} 之间`)
    return
  }
  countering.value = false
  stage.value = 'settling'
  const res = await respondNegotiationDeal({
    factionId: props.faction.id,
    letter: letter.value,
    previousReply: response.value.reply,
    deal: response.value.deal,
    playerResponse: 'counter',
    counterPrice: counterPrice.value,
    letterDelta: response.value.relationshipDelta
  })
  finishSettle(res, 'counter')
}

/** 放弃：不调 AI，仅应用信件 delta（配额已耗，不退） */
function onGiveUp(): void {
  if (response.value) {
    store.applyLetterDelta(props.faction.id, response.value.relationshipDelta)
  }
  toast.warning('你收回了信使，此事作罢')
  emit('close')
}

/** settle 收尾：展示裁定结果 */
function finishSettle(
  res: FactionNegotiateResult | null,
  playerResponse: 'accept' | 'counter'
): void {
  if (!res) {
    // 网络层失败：回到回信页（settle 可重试，letter 配额已耗）
    stage.value = 'reply'
    toast.error('裁定未能送达，请稍后再试')
    return
  }
  settleResult.value = res
  if (res.stance === 'accept') {
    const price = playerResponse === 'counter' ? counterPrice.value : response.value?.deal?.price ?? 0
    doneSummary.value = res.fallback
      ? '对方未有回音，仅以书信往来作结'
      : `谈判成交：按银两 ${price} 结算（关系变化已入档）`
  } else {
    doneSummary.value = res.fallback
      ? '对方未有回音，仅以书信往来作结'
      : '对方拒绝了你提出的价格，谈判作罢（仅信件态度影响生效）'
  }
  stage.value = 'done'
}
</script>

<style lang="scss" scoped>
.negotiation-dialog {
  display: flex;
  flex-direction: column;
  width: 640rpx;
  max-height: 80vh;
  padding: 24rpx 24rpx 32rpx;
  overflow-y: auto;
  background-color: #fdf6e3;
  border: 2rpx solid #d4c5a0;
  border-radius: 16rpx;

  // ====================== 头部 ======================
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

  &__rel {
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

  // ====================== 主体 ======================
  &__body {
    display: flex;
    flex-direction: column;
    gap: 16rpx;
  }

  &__hint {
    font-size: 24rpx;
    color: #8d6e63;
  }

  &__textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 200rpx;
    padding: 16rpx;
    font-size: 26rpx;
    color: #2c1810;
    background-color: #fbf3df;
    border: 2rpx solid #d4c5a0;
    border-radius: 12rpx;
  }

  &__placeholder {
    color: #bca988;
  }

  &__count {
    align-self: flex-end;
    font-size: 22rpx;
    color: #8d6e63;
  }

  &__loading {
    padding: 60rpx 0;
    font-size: 26rpx;
    color: #8d6e63;
    text-align: center;
  }

  // 回信卡片
  &__reply-card {
    display: flex;
    flex-direction: column;
    gap: 12rpx;
    padding: 20rpx;
    background-color: #fbf3df;
    border: 2rpx solid #d4c5a0;
    border-radius: 12rpx;
  }

  &__stance {
    align-self: flex-start;
    padding: 4rpx 14rpx;
    font-size: 22rpx;
    color: #fff;
    border-radius: 6rpx;

    &--accept {
      background-color: #2e7d32;
    }

    &--reject {
      background-color: #616161;
    }

    &--counter {
      background-color: #8b1a1a;
    }
  }

  &__reply-text {
    font-size: 26rpx;
    line-height: 1.6;
    color: #2c1810;
  }

  &__delta {
    font-size: 22rpx;
    color: #8d6e63;
  }

  // 条件卡片
  &__deal-card {
    display: flex;
    flex-direction: column;
    gap: 8rpx;
    padding: 20rpx;
    background-color: #f6ecd4;
    border: 2rpx solid #c9a86a;
    border-radius: 12rpx;
  }

  &__deal-title {
    font-size: 28rpx;
    font-weight: 600;
    color: #8b1a1a;
  }

  &__deal-line {
    font-size: 24rpx;
    color: #5d4037;
  }

  &__counter {
    display: flex;
    flex-direction: column;
    gap: 12rpx;
    padding-top: 12rpx;
    margin-top: 8rpx;
    border-top: 2rpx dashed #c9a86a;
  }

  &__counter-hint {
    font-size: 22rpx;
    color: #8d6e63;
  }

  &__counter-input {
    box-sizing: border-box;
    height: 80rpx;
    padding: 0 16rpx;
    font-size: 26rpx;
    color: #2c1810;
    background-color: #fdf6e3;
    border: 2rpx solid #8b1a1a;
    border-radius: 8rpx;
  }

  &__counter-btns {
    display: flex;
    gap: 16rpx;
  }

  // 操作按钮
  &__actions {
    display: flex;
    flex-direction: column;
    gap: 16rpx;
  }

  &__btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 88rpx;
    padding: 12rpx 24rpx;
    background-color: #fdf6e3;
    border: 2rpx solid #8b1a1a;
    border-radius: 10rpx;
    transition: background-color 150ms ease;

    &--primary {
      background-color: #8b1a1a;
    }

    &--ghost {
      border-color: #bca988;
    }

    &--small {
      flex: 1;
      min-height: 88rpx;
    }

    &--hover {
      background-color: rgba(139, 26, 26, 0.12);
    }

    &--disabled {
      opacity: 0.45;
    }
  }

  &__btn-text {
    font-size: 28rpx;
    color: #8b1a1a;

    &--primary {
      color: #fdf6e3;
    }
  }
}
</style>
