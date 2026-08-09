<template>
  <view class="toast-container">
    <TransitionGroup name="toast">
      <view
        v-for="t in toasts"
        :key="t.id"
        class="toast"
        :class="`toast--${t.type}`"
      >
        <view class="toast__icon">
          <!-- success: ✓ -->
          <svg
            v-if="t.type === 'success'"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
            />
          </svg>
          <!-- error: ✕ -->
          <svg
            v-else-if="t.type === 'error'"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
            />
          </svg>
          <!-- warning: ⚠ 三角警告（避免 Unicode ⚠ 字符） -->
          <svg
            v-else-if="t.type === 'warning'"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"
            />
          </svg>
          <!-- info: i -->
          <svg v-else viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"
            />
          </svg>
        </view>
        <text class="toast__message">{{ t.message }}</text>
      </view>
    </TransitionGroup>
  </view>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onUnmounted, watch } from 'vue'
import { useUIStore } from '@/stores/ui'

const ui = useUIStore()
const { toasts } = storeToRefs(ui)

/** 跟踪每条 toast 的定时器，组件卸载时清理 */
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function clearTimer(id: number): void {
  const t = timers.get(id)
  if (t) {
    clearTimeout(t)
    timers.delete(id)
  }
}

/** 监听 toasts 数组变化，为新出现的 toast 启动自动消失定时器 */
watch(
  () => toasts.value.map((t) => t.id),
  (newIds, oldIds = []) => {
    const added = newIds.filter((id) => !oldIds.includes(id) && !timers.has(id))
    const removed = oldIds.filter((id) => !newIds.includes(id))

    for (const id of added) {
      const item = toasts.value.find((t) => t.id === id)
      if (!item) continue
      const delay = Math.max(500, item.expireAt - Date.now())
      const timer = setTimeout(() => {
        ui._removeToast(id)
        timers.delete(id)
      }, delay)
      timers.set(id, timer)
    }

    for (const id of removed) {
      clearTimer(id)
    }
  },
  { deep: false }
)

onUnmounted(() => {
  for (const id of Array.from(timers.keys())) {
    clearTimer(id)
  }
})
</script>

<style lang="scss" scoped>
.toast-container {
  position: fixed;
  top: 5%;
  left: 50%;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  align-items: center;
  width: 90%;
  max-width: 600rpx;
  // 居中：通过 left:50% + transform translateX(-50%)
  transform: translateX(-50%);
  pointer-events: none;
}

.toast {
  display: flex;
  gap: 12rpx;
  align-items: center;
  width: 100%;
  padding: 20rpx 24rpx;
  color: #fff;
  border-radius: 12rpx;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.2);
  pointer-events: auto;

  &--success {
    background-color: #2e7d32;
  }

  &--error {
    background-color: #c62828;
  }

  &--info {
    background-color: #5d4037;
  }

  &--warning {
    background-color: #ef6c00;
  }

  &__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 36rpx;
    height: 36rpx;
    color: #fff;
  }

  &__message {
    flex: 1;
    font-size: 26rpx;
    line-height: 1.4;
    color: #fff;
    word-break: break-all;
  }
}

// TransitionGroup 动画
.toast-enter-active,
.toast-leave-active {
  transition: transform 250ms ease, opacity 250ms ease;
}

.toast-enter-from {
  transform: translateY(-20rpx);
  opacity: 0;
}

.toast-leave-to {
  transform: translateY(-20rpx);
  opacity: 0;
}
</style>
