<template>
  <view class="home">
    <view class="home__hero">
      <image class="home__logo" src="/static/logo.png?v=2" mode="aspectFit" />
      <text class="home__title">金田：1851</text>
      <!-- T2.3：副标题文案集中管理（copywriting.PAGE_TEXT.index.subtitle） -->
      <text class="home__subtitle">{{ PAGE_TEXT.index.subtitle }}</text>
    </view>

    <view class="home__actions">
      <view
        class="home__btn home__btn--primary"
        role="button"
        aria-label="开始游戏"
        tabindex="0"
        :hover-class="'home__btn--hover'"
        :hover-stay-time="100"
        @click="onStart"
        @keydown.enter.prevent="onStart"
        @keydown.space.prevent="onStart"
      >
        <text class="home__btn-text">开始游戏</text>
      </view>

      <view
        class="home__btn"
        role="button"
        :aria-label="hasSave ? '继续游戏' : '继续游戏（尚无存档）'"
        tabindex="0"
        :class="{ 'home__btn--disabled': !hasSave || isSyncing }"
        :hover-class="!hasSave || isSyncing ? '' : 'home__btn--hover'"
        :hover-stay-time="100"
        @click="onContinue"
        @keydown.enter.prevent="onContinue"
        @keydown.space.prevent="onContinue"
      >
        <text class="home__btn-text">继续游戏</text>
        <text v-if="!hasSave" class="home__btn-hint">尚无存档</text>
      </view>

      <view
        class="home__btn"
        role="button"
        :aria-label="isSyncing ? '同步存档中' : '同步存档'"
        tabindex="0"
        :class="{ 'home__btn--disabled': !hasSave || isSyncing }"
        :hover-class="!hasSave || isSyncing ? '' : 'home__btn--hover'"
        :hover-stay-time="100"
        @click="onSync"
        @keydown.enter.prevent="onSync"
        @keydown.space.prevent="onSync"
      >
        <view v-if="isSyncing" class="home__btn-spinner">
          <view class="home__btn-dot" />
        </view>
        <text v-else class="home__btn-text">同步存档</text>
      </view>

      <view
        class="home__btn"
        role="button"
        aria-label="设置"
        tabindex="0"
        :hover-class="'home__btn--hover'"
        :hover-stay-time="100"
        @click="onSettings"
        @keydown.enter.prevent="onSettings"
        @keydown.space.prevent="onSettings"
      >
        <text class="home__btn-text">设置</text>
      </view>

      <view
        class="home__btn home__btn--ghost"
        role="button"
        :aria-label="BUTTON_TEXT.howToPlay"
        tabindex="0"
        :hover-class="'home__btn--hover'"
        :hover-stay-time="100"
        @click="onHowToPlay"
        @keydown.enter.prevent="onHowToPlay"
        @keydown.space.prevent="onHowToPlay"
      >
        <text class="home__btn-text">{{ BUTTON_TEXT.howToPlay }}</text>
      </view>
    </view>

    <view v-if="hasSave" class="home__footer">
      <text class="home__footer-text">
        当前存档：第 {{ saveTurn }} 回合 · {{ saveDate }}
      </text>
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
import { useSaveSync } from '@/composables/useSaveSync'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useToast } from '@/composables/useToast'
import { useGameStore } from '@/stores/game'
import { BUTTON_TEXT, PAGE_TEXT } from '@/utils/copywriting'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ToastContainer from '@/components/ToastContainer.vue'

const { load } = useGameState()
const { sync, isSyncing } = useSaveSync({
  confirmOverwrite: async (cloudTs) => {
    const cloudDate = new Date(cloudTs).toLocaleString('zh-CN')
    return confirm({
      title: '云端存档较新',
      message: `云端存档更新时间：${cloudDate}\n是否拉取覆盖本地？`,
      confirmText: '拉取云端',
      cancelText: '保留本地'
    })
  }
})
const { confirm } = useConfirmDialog()
const toast = useToast()
const store = useGameStore()

/** 是否已有本地存档 */
const hasSave = ref(false)

/** 当前回合数（用于底部显示） */
const saveTurn = computed(() => store.currentSave?.state.turn ?? 0)
/** 游戏内日期（如「1851 年 1 月」） */
const saveDate = computed(() => {
  const d = store.currentSave?.state.date
  return d ? `${d.year} 年 ${d.month} 月` : ''
})

/** 加载本地存档到 store，并更新 hasSave */
async function refreshSave(): Promise<void> {
  try {
    const save = await load()
    hasSave.value = !!save
  } catch (err) {
    console.error('[home] 加载本地存档失败:', err)
    hasSave.value = false
  }
}

onMounted(refreshSave)
// 每次显示页面都重新检测（用户从其他页面返回时存档可能变化）
onShow(refreshSave)

/** 「开始游戏」：有存档先弹确认 */
async function onStart(): Promise<void> {
  if (hasSave.value) {
    const ok = await confirm({
      title: '已有存档',
      message: '开始新游戏将覆盖现有存档，是否继续？',
      confirmText: '覆盖并开始',
      cancelText: '取消'
    })
    if (!ok) return
  }
  uni.navigateTo({ url: '/pages/character-create/index' })
}

/** 「继续游戏」：无存档禁用 */
function onContinue(): void {
  if (!hasSave.value) {
    toast.info('尚无存档，请先开始游戏')
    return
  }
  uni.navigateTo({ url: '/pages/game-main/index' })
}

/** 「同步存档」：调 useSaveSync */
async function onSync(): Promise<void> {
  if (!hasSave.value) {
    toast.info('尚无存档可同步')
    return
  }
  if (isSyncing.value) return

  const result = await sync()
  // 根据 action 给出反馈
  switch (result.action) {
    case 'uploaded':
      toast.success(result.message)
      break
    case 'pulled':
      toast.success(result.message)
      await refreshSave()
      break
    case 'noop':
      toast.info(result.message)
      break
    case 'error':
      toast.error(result.message)
      break
  }
}

/** 「设置」：跳转设置页 */
function onSettings(): void {
  uni.navigateTo({ url: '/pages/settings/index' })
}

/** 「如何游戏」：跳转帮助页 */
function onHowToPlay(): void {
  uni.navigateTo({ url: '/pages/help/index' })
}
</script>

<style lang="scss" scoped>
.home {
  display: flex;
  flex-direction: column;
  // 显式 100% 宽度：确保在 uni-app H5 的容器嵌套中铺满视口
  width: 100%;
  // 允许内容超出视口时滚动，避免小屏（如 iPhone SE）按钮被挤出可视区
  min-height: 100vh;
  overflow-y: auto;
  padding: 48rpx 32rpx;
  background: linear-gradient(180deg, #f5e6c8 0%, #fdf6e3 100%);

  &__hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    // 用 flex 撑开 hero，替代固定 margin，避免小屏溢出
    flex: 1 1 auto;
    justify-content: center;
    margin: 32rpx 0;
  }

  &__logo {
    width: 280rpx;
    height: 280rpx;
    margin-bottom: 32rpx;
    border-radius: 32rpx;
    // 微妙阴影增强立体感
    box-shadow: 0 8rpx 32rpx rgba(139, 26, 26, 0.15);
  }

  &__title {
    margin-bottom: 12rpx;
    font-size: 56rpx;
    font-weight: 700;
    color: #8b1a1a;
    letter-spacing: 8rpx;
  }

  &__subtitle {
    font-size: 24rpx;
    color: #5d4037;
    font-style: italic;
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: 24rpx;
  }

  &__btn {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    // 触摸目标 ≥ 44px（AGENTS.md 输入区按钮规范）
    min-width: 44px;
    min-height: 44px;
    padding: 28rpx 0;
    background-color: #fdf6e3;
    border: 2rpx solid #8b1a1a;
    border-radius: 12rpx;
    transition: background-color 150ms ease, transform 150ms ease, opacity 150ms ease;

    &:active {
      transform: scale(0.98);
    }

    &--hover {
      background-color: #f5e6c8;
    }

    &--primary {
      background-color: #8b1a1a;

      .home__btn-text {
        color: #fff;
      }
    }

    &--disabled {
      opacity: 0.65;
      background-color: #e8e0d0;
      border-color: #c9bda3;

      .home__btn-text {
        color: #9e8e76;
      }
    }

    // 如何游戏按钮：轻量辅助样式（虚线边框 + 透明背景）
    &--ghost {
      background-color: transparent;
      border: 2rpx dashed #8d6e63;

      .home__btn-text {
        color: #8d6e63;
      }
    }

    &-text {
      font-size: 32rpx;
      font-weight: 500;
      color: #2c1810;
    }

    &-hint {
      margin-top: 4rpx;
      font-size: 20rpx;
      color: #8d6e63;
      font-style: italic;
    }

    &-spinner {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36rpx;
      height: 36rpx;
    }

    &-dot {
      width: 28rpx;
      height: 28rpx;
      border: 4rpx solid rgba(139, 26, 26, 0.2);
      border-top-color: #8b1a1a;
      border-radius: 50%;
      animation: home-btn-spin 0.8s linear infinite;
    }
  }

  &__footer {
    margin-top: auto;
    padding: 24rpx 0;
    text-align: center;
  }

  &__footer-text {
    font-size: 22rpx;
    color: #8d6e63;
  }
}

@keyframes home-btn-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
