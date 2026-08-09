<template>
  <view class="end-game" :class="{ 'end-game--failure': isFailure }">
    <view class="end-game__hero">
      <text class="end-game__label">{{ endLabel }}</text>
      <text class="end-game__title">{{ endTitle }}</text>
      <text class="end-game__description">{{ endDescription }}</text>
    </view>

    <view class="end-game__summary">
      <view class="end-game__row">
        <text class="end-game__row-label">游戏时长</text>
        <text class="end-game__row-value">{{ survivedYears }} 年 · 第 {{ saveTurn }} 回合</text>
      </view>
      <view class="end-game__row">
        <text class="end-game__row-label">终止日期</text>
        <text class="end-game__row-value">{{ saveDate }}</text>
      </view>
      <view class="end-game__row">
        <text class="end-game__row-label">势力</text>
        <text class="end-game__row-value">{{ factionName }}（{{ background }}）</text>
      </view>
    </view>

    <view v-if="save" class="end-game__snapshot">
      <text class="end-game__snapshot-title">最终状态</text>
      <StatusPanel :attributes="save.state.attributes" :resources="save.state.resources" />
    </view>

    <view class="end-game__actions">
      <view
        class="end-game__btn"
        :hover-class="'end-game__btn--hover'"
        :hover-stay-time="100"
        @click="onBackHome"
      >
        <text class="end-game__btn-text">返回首页</text>
      </view>
      <view
        class="end-game__btn end-game__btn--primary"
        :hover-class="'end-game__btn--hover'"
        :hover-stay-time="100"
        @click="onRestart"
      >
        <text class="end-game__btn-text">重新开始</text>
      </view>
    </view>

    <!-- 全局确认对话框 + Toast 提示（uni-app H5 端 App.vue template 被忽略，必须在每个页面挂载） -->
    <ConfirmDialog />
    <ToastContainer />
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useGameState } from '@/composables/useGameState'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useToast } from '@/composables/useToast'
import StatusPanel from '@/components/StatusPanel.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import {
  getEndReasonDescription,
  getEndReasonLabel,
  isFailureEnd
} from '@/utils/end-conditions'
import type { EndedReason, GameSave } from '@/types/game'

const { load, clear } = useGameState()
const { confirm } = useConfirmDialog()
const toast = useToast()

/** 当前存档（结局页可能从 store 或 storage 加载） */
const save = ref<GameSave | null>(null)

/** 结局类型（从 save.endedReason 读取，缺省视为 time_up） */
const endReason = computed<EndedReason>(() => {
  const r = save.value?.endedReason
  return r ?? 'time_up'
})

const endLabel = computed(() =>
  isFailureEnd(endReason.value) ? '游戏结束' : '游戏通关'
)
const endTitle = computed(() => getEndReasonLabel(endReason.value))
const endDescription = computed(() => getEndReasonDescription(endReason.value))
const isFailure = computed(() => isFailureEnd(endReason.value))

/** 存活年数（开局 1851 → 结束 year） */
const survivedYears = computed(() => {
  const endYear = save.value?.state.date.year ?? 1851
  return Math.max(0, endYear - 1851)
})

const saveTurn = computed(() => save.value?.state.turn ?? 0)
const saveDate = computed(() => {
  const d = save.value?.state.date
  return d ? `${d.year} 年 ${d.month} 月` : ''
})
const factionName = computed(() => save.value?.character.factionName ?? '')
const background = computed(() => save.value?.character.background ?? '')

async function refreshSave(): Promise<void> {
  try {
    const s = await load()
    save.value = s
    if (!s || !s.ended) {
      // 无存档或未结束，跳回首页
      uni.redirectTo({ url: '/pages/index/index' })
    }
  } catch (err) {
    console.error('[end-game] 加载存档失败:', err)
    uni.redirectTo({ url: '/pages/index/index' })
  }
}

onMounted(refreshSave)
onShow(refreshSave)

/** 返回首页 */
function onBackHome(): void {
  uni.redirectTo({ url: '/pages/index/index' })
}

/** 重新开始：弹确认 → 清空存档 → 跳 character-create */
async function onRestart(): Promise<void> {
  const ok = await confirm({
    title: '重新开始',
    message: '将清除当前存档并开始新游戏，是否继续？',
    confirmText: '清除并开始',
    cancelText: '取消'
  })
  if (!ok) return

  try {
    await clear()
    uni.redirectTo({ url: '/pages/character-create/index' })
  } catch (err) {
    console.error('[end-game] 清除存档失败:', err)
    toast.error('清除存档失败，请重试')
  }
}
</script>

<style lang="scss" scoped>
.end-game {
  min-height: 100vh;
  padding: 48rpx 32rpx;
  background: linear-gradient(180deg, #fdf6e3 0%, #f5e6c8 100%);

  &--failure {
    background: linear-gradient(180deg, #f5e6c8 0%, #e8d9b8 100%);
  }

  &__hero {
    padding: 48rpx 24rpx;
    margin-bottom: 32rpx;
    text-align: center;
    background-color: #fdf6e3;
    border: 2rpx solid #8b1a1a;
    border-radius: 16rpx;
    box-shadow: 0 4rpx 12rpx rgba(139, 26, 26, 0.1);
  }

  &__label {
    display: block;
    margin-bottom: 12rpx;
    font-size: 24rpx;
    color: #8d6e63;
    letter-spacing: 8rpx;
  }

  &__title {
    display: block;
    margin-bottom: 16rpx;
    font-size: 56rpx;
    font-weight: 700;
    color: #8b1a1a;
    letter-spacing: 8rpx;
  }

  &__description {
    display: block;
    font-size: 28rpx;
    line-height: 1.6;
    color: #5d4037;
    font-style: italic;
  }

  &__summary {
    margin-bottom: 24rpx;
    padding: 24rpx;
    background-color: rgba(253, 246, 227, 0.6);
    border: 2rpx solid #d4c5a0;
    border-radius: 12rpx;
  }

  &__row {
    display: flex;
    justify-content: space-between;
    padding: 8rpx 0;

    &:not(:last-child) {
      border-bottom: 2rpx dashed rgba(212, 197, 160, 0.5);
    }
  }

  &__row-label {
    font-size: 26rpx;
    color: #8d6e63;
  }

  &__row-value {
    font-size: 26rpx;
    font-weight: 500;
    color: #2c1810;
  }

  &__snapshot {
    margin-bottom: 32rpx;
  }

  &__snapshot-title {
    display: block;
    margin-bottom: 12rpx;
    font-size: 28rpx;
    font-weight: 600;
    color: #5d4037;
  }

  &__actions {
    display: flex;
    gap: 16rpx;
    margin-top: 16rpx;
  }

  &__btn {
    flex: 1;
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24rpx 0;
    background-color: #fdf6e3;
    border: 2rpx solid #8b1a1a;
    border-radius: 12rpx;
    transition: background-color 150ms ease, transform 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: #f5e6c8;
    }

    &--primary {
      background-color: #8b1a1a;

      .end-game__btn-text {
        color: #fff;
      }
    }
  }

  &__btn-text {
    font-size: 30rpx;
    font-weight: 500;
    color: #2c1810;
  }
}
</style>
