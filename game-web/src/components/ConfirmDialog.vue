<template>
  <view v-if="state.visible" class="confirm-dialog" @touchmove.stop.prevent>
    <view class="confirm-dialog__mask" @click="onCancel" @touchmove.stop.prevent @touchend.stop />
    <view class="confirm-dialog__card" @click.stop @touchmove.stop>
      <text class="confirm-dialog__title">{{ state.title }}</text>
      <text class="confirm-dialog__message">{{ state.message }}</text>
      <view class="confirm-dialog__actions">
        <view
          class="confirm-dialog__btn confirm-dialog__btn--cancel"
          :hover-class="'confirm-dialog__btn--hover'"
          :hover-stay-time="100"
          @click="onCancel"
        >
          <text class="confirm-dialog__btn-text">{{ state.cancelText }}</text>
        </view>
        <view
          class="confirm-dialog__btn confirm-dialog__btn--confirm"
          :hover-class="'confirm-dialog__btn--hover'"
          :hover-stay-time="100"
          @click="onConfirm"
        >
          <text class="confirm-dialog__btn-text confirm-dialog__btn-text--confirm">
            {{ state.confirmText }}
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onUnmounted, watch } from 'vue'
import { useUIStore } from '@/stores/ui'
import { useScrollLock } from '@/composables/useScrollLock'

const ui = useUIStore()
const { confirmState: state } = storeToRefs(ui)
const { lock, unlock } = useScrollLock()

// 对话框显示时锁定底层滚动，关闭时解锁（修复「弹框时下方列表可滚动」bug）
watch(
  () => state.value.visible,
  (visible) => {
    if (visible) lock()
    else unlock()
  }
)

// 组件卸载时确保解锁（防止异常卸载导致滚动永久锁定）
onUnmounted(unlock)

function onConfirm(): void {
  ui._resolveConfirm(true)
}

function onCancel(): void {
  ui._resolveConfirm(false)
}
</script>

<style lang="scss" scoped>
.confirm-dialog {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  // 入场过渡（max-width 已是 80%，卡片通过 scale 入场）
  animation: confirm-dialog-fade 200ms ease;

  &__mask {
    position: absolute;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.5);
  }

  &__card {
    position: relative;
    width: 80%;
    max-width: 600rpx;
    padding: 32rpx;
    background-color: #fdf6e3;
    border: 2rpx solid #8b1a1a;
    border-radius: 16rpx;
    box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.15);
    animation: confirm-dialog-pop 200ms ease;
  }

  &__title {
    display: block;
    margin-bottom: 16rpx;
    font-size: 32rpx;
    font-weight: 600;
    color: #2c1810;
  }

  &__message {
    display: block;
    margin-bottom: 32rpx;
    font-size: 28rpx;
    line-height: 1.5;
    color: #5d4037;
  }

  &__actions {
    display: flex;
    gap: 16rpx;
  }

  &__btn {
    flex: 1;
    // 触摸目标 ≥ 44px
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16rpx 0;
    border-radius: 8rpx;
    transition: background-color 150ms ease, transform 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      opacity: 0.8;
    }

    &--cancel {
      background-color: #e8d9b8;
    }

    &--confirm {
      background-color: #8b1a1a;
    }
  }

  &__btn-text {
    font-size: 28rpx;
    color: #2c1810;

    &--confirm {
      color: #fff;
    }
  }
}

@keyframes confirm-dialog-fade {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@keyframes confirm-dialog-pop {
  from {
    transform: scale(0.9);
    opacity: 0;
  }

  to {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
