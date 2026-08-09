<template>
  <view class="tooltip-view">
    <!-- 触发区（插槽包裹图标按钮等内容）
         H5 端 mouseenter/mouseleave 生效（hover 显示）
         小程序/App 端 longpress 生效（长按 500ms 显示）
         所有事件统一绑定，无需条件编译：小程序端不支持的事件名会被忽略不报错 -->
    <view
      class="tooltip-view__trigger"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
      @longpress="onLongpress"
    >
      <slot />
    </view>

    <!-- 浮层（Transition 淡入淡出） -->
    <Transition name="tooltip-view-fade">
      <view
        v-if="visible"
        class="tooltip-view__bubble"
        :class="[`tooltip-view__bubble--${placement}`]"
      >
        <text class="tooltip-view__text">{{ content }}</text>
      </view>
    </Transition>
  </view>
</template>

<script setup lang="ts">
/**
 * @file TooltipView 通用 tooltip 组件（三端兼容）
 *
 * 替代 v-tooltip 自定义指令在小程序端无法编译的问题：
 * - H5 端：mouseenter 显示 / mouseleave 隐藏（保留 hover 体验）
 * - 小程序/App 端：@longpress 触发显示，3 秒后自动隐藏
 *
 * 与 v-tooltip 指令的差异：
 * - 声明式组件，通过插槽包裹触发内容，不依赖自定义指令
 * - 浮层用 view 渲染（非 document.createElement），三端一致
 * - 定位简化为上方/下方两档，基于 trigger 的位置自动选择
 *
 * 来源：小程序端 v-tooltip 编译失败修复方案 A
 */

import { ref, onUnmounted } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 提示内容 */
    content: string
    /** 浮层位置：默认 top（上方），可选 bottom（下方） */
    placement?: 'top' | 'bottom'
  }>(),
  {
    placement: 'top'
  }
)

/** 浮层显隐状态 */
const visible = ref(false)

/** 自动隐藏定时器句柄（触摸端 longpress 后 3 秒自动消失） */
let autoHideTimer: ReturnType<typeof setTimeout> | null = null

/** 显示浮层 + 启动自动隐藏（触摸端） */
function show(autoHide = false): void {
  if (!props.content) return
  clearAutoHide()
  visible.value = true
  if (autoHide) {
    autoHideTimer = setTimeout(hide, 3000)
  }
}

/** 隐藏浮层 */
function hide(): void {
  visible.value = false
  clearAutoHide()
}

/** 清除自动隐藏定时器 */
function clearAutoHide(): void {
  if (autoHideTimer) {
    clearTimeout(autoHideTimer)
    autoHideTimer = null
  }
}

/** H5 端 hover 显示 */
function onMouseEnter(): void {
  show(false)
}

/** H5 端 hover 隐藏 */
function onMouseLeave(): void {
  hide()
}

/** 触摸端 longpress 触发显示 + 3 秒自动隐藏 */
function onLongpress(): void {
  show(true)
}

onUnmounted(clearAutoHide)
</script>

<style lang="scss" scoped>
.tooltip-view {
  position: relative;
  display: inline-flex;

  &__trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  // 浮层：fixed 定位（基于 trigger view 的位置由 placement 决定上下）
  &__bubble {
    position: fixed;
    z-index: 999;
    max-width: 80%;
    padding: 16rpx 24rpx;
    background-color: rgba(0, 0, 0, 0.8);
    border-radius: 8rpx;
    box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.3);
    pointer-events: none;
    word-break: break-all;

    // 上方默认（top: 在 trigger 上方；left: 居中对齐 trigger）
    &--top {
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      margin-bottom: 8rpx;
    }

    &--bottom {
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      margin-top: 8rpx;
    }
  }

  &__text {
    font-size: 24rpx;
    line-height: 1.4;
    color: #fff;
  }
}

// Transition 淡入淡出（H5 端生效，小程序端降级直接显隐）
.tooltip-view-fade-enter-active,
.tooltip-view-fade-leave-active {
  transition: opacity 150ms ease;
}

.tooltip-view-fade-enter-from,
.tooltip-view-fade-leave-to {
  opacity: 0;
}
</style>
