<template>
  <view class="end-game" :class="{ 'end-game--failure': isFailure }">
    <view class="end-game__hero">
      <text class="end-game__label">{{ endLabel }}</text>
      <text class="end-game__title">{{ endTitle }}</text>
      <text class="end-game__description">{{ endDescription }}</text>
      <!-- 史评：由名望档位决定，刻意不参与「是否胜利」的判定（理由见 utils/end-conditions.ts）
           v-if="save"：存档是 onMounted 才载入的，未加载时不渲染，避免闪一下最低档 -->
      <view v-if="save" class="end-game__rating">
        <text class="end-game__rating-label">史评</text>
        <text class="end-game__rating-title">{{ rating.label }}</text>
        <text class="end-game__rating-remark">{{ rating.remark }}</text>
      </view>
      <!-- 历史进程：剧情链完成度。分母是「终局年份之前可达的链数」而不是全集，
           否则 1865 年通关的存档会因为"没走完 1911 的剧本"被判成低档 -->
      <view v-if="save" class="end-game__chains">
        <text class="end-game__chains-label">历史进程</text>
        <text class="end-game__chains-count">
          亲历 {{ chainStats.completed }}/{{ chainStats.reachable }} 段史事（至 {{ chainStats.endYear }} 年）
        </text>
        <text v-if="chainTier" class="end-game__chains-tier">{{ chainTier.label }}</text>
        <text v-if="chainTier" class="end-game__chains-remark">{{ chainTier.remark }}</text>
        <text v-if="chainStats.completedTitles.length" class="end-game__chains-list">
          {{ chainStats.completedTitles.join(' · ') }}
        </text>
        <text v-if="chainStats.inProgress > 0" class="end-game__chains-open">
          另有 {{ chainStats.inProgress }} 段未及收束
        </text>
      </view>
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
      <!-- 中兴锁定年份：年钟下胜利不再中途结束游戏，这里交代"哪一年成的局" -->
      <view v-if="save?.zenithYear" class="end-game__row">
        <text class="end-game__row-label">中兴已定</text>
        <text class="end-game__row-value">{{ save.zenithYear }} 年（其后仍须守住这副局面）</text>
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
  getChainCompletion,
  getChainTier,
  getEndReasonDescription,
  getEndReasonLabel,
  getHistoryRating,
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

/** 史评：名望档位（称号 + 评语）。存档未加载时取 0，模板用 v-if="save" 兜住不闪 */
const rating = computed(() => getHistoryRating(save.value?.state.resources.reputation ?? 0))

/** 历史进程：剧情链完成度（派生值，不参与胜负判定） */
const chainStats = computed(() => getChainCompletion(save.value))
const chainTier = computed(() => getChainTier(chainStats.value))

/** 存活年数（开局 1851 → 结束 year） */
const survivedYears = computed(() => {
  const endYear = save.value?.state.date.year ?? 1851
  return Math.max(0, endYear - 1851)
})

const saveTurn = computed(() => save.value?.state.turn ?? 0)
const saveDate = computed(() => {
  const d = save.value?.state.date
  // 年钟：month 恒为 1，只显示年
  return d ? `${d.year} 年` : ''
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

  &__rating {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 24rpx;
    padding-top: 24rpx;
    border-top: 2rpx dashed rgba(139, 26, 26, 0.3);
  }

  &__rating-label {
    font-size: 22rpx;
    color: #8d6e63;
    letter-spacing: 6rpx;
  }

  &__rating-title {
    margin-top: 8rpx;
    font-size: 40rpx;
    font-weight: 700;
    color: #8b1a1a;
    letter-spacing: 6rpx;
  }

  &__rating-remark {
    margin-top: 8rpx;
    font-size: 26rpx;
    line-height: 1.6;
    color: #5d4037;
    font-style: italic;
  }

  &__chains {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 24rpx;
    padding-top: 24rpx;
    border-top: 2rpx dashed rgba(139, 26, 26, 0.3);
  }

  &__chains-label {
    font-size: 22rpx;
    color: #8d6e63;
    letter-spacing: 6rpx;
  }

  &__chains-count {
    margin-top: 8rpx;
    font-size: 28rpx;
    color: #5d4037;
  }

  &__chains-tier {
    margin-top: 8rpx;
    font-size: 34rpx;
    font-weight: 700;
    color: #4e6b3e;
    letter-spacing: 4rpx;
  }

  &__chains-remark {
    margin-top: 6rpx;
    font-size: 26rpx;
    line-height: 1.6;
    color: #5d4037;
    font-style: italic;
  }

  // 链名逐条列出，长度不定（最多 23 条），必须允许折行
  &__chains-list {
    margin-top: 12rpx;
    max-width: 90%;
    font-size: 24rpx;
    line-height: 1.7;
    color: #6d5c4c;
    text-align: center;
    word-break: break-all;
  }

  &__chains-open {
    margin-top: 6rpx;
    font-size: 22rpx;
    color: #a1887f;
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
