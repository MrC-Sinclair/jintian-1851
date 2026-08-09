<template>
  <!--
    根元素兜底：@click.stop 捕获所有子元素 click（即使子元素 stopPropagation 失效），
    阻止冒泡到父级 FactionCard 触发 select 事件。
    安全性：子元素 click 先触发自身 handler，再冒泡到这里被 stop，
    不影响子元素的正常逻辑。
  -->
  <view class="info-hint" @click.stop="onRootClick">
    <!--
      问号图标按钮（触摸目标 48rpx）。
      统一使用 @click 处理鼠标和触摸：
      - 配合 CSS `touch-action: manipulation`（Pointer Events 规范的一部分），
        浏览器在触摸端不再延迟 300ms 派发 click，也不会合成 ghost click，
        因此无需 @touchend 抢跑、无需 document 级拦截器。
      - onIconClick 显式 e.stopPropagation() 阻止冒泡到父级 FactionCard。
      - toggle 语义：点击图标即可开/关浮层，符合用户直觉。
    -->
    <view
      class="info-hint__icon"
      :class="{ 'info-hint__icon--active': visible }"
      @click="onIconClick"
    >
      <text class="info-hint__icon-text">?</text>
    </view>

    <!--
      浮层（Transition 淡入淡出）。
      关键设计：所有交互元素统一用 @click + 显式 e.stopPropagation()，
      不依赖 Vue 的 .stop/.prevent 修饰符（uni-app H5 端 <view> 编译为 <uni-view>，
      修饰符在合成事件层可能不稳定）。

      穿透问题根因（已修复）：
      - 旧实现用 @touchend 关闭浮层，touchend 先触发 → 浮层从 DOM 移除 →
        300ms 后合成的 ghost click 落到下层 FactionCard → 触发 select 事件。
      - document 级拦截器虽能吸收 ghost click，但在部分 WebView 中时序不稳定，
        且 jsdom 无法测试 document 捕获阶段，导致测试长期失败。
      - 现方案：只用 @click，click 直接落在仍存在于 DOM 的浮层上，
        由浮层的 @click 处理后关闭，无 ghost click，无穿透。

      stopPropagation 必要性：
      - InfoHint 嵌在可点击卡片（如 FactionCard @click="$emit('select')")内，
        若不阻止冒泡，遮罩 click 会冒泡到卡片，错误弹出「确认势力」等弹窗。
      - Vue 的 .self 修饰符不会自动 stopPropagation；uni-app H5 端 click 事件
        target/currentTarget 是 undefined，无法靠 target === currentTarget 拦截冒泡。
      - 因此所有 handler 显式 e.stopPropagation()，根元素再加 @click.stop 兜底。
    -->
    <Transition name="info-hint-fade">
      <view
        v-if="visible"
        class="info-hint__overlay"
        @click="onOverlayClick"
        @touchmove.stop.prevent
      >
        <view class="info-hint__modal" @click="onModalClick" @touchmove.stop>
          <view class="info-hint__modal-head">
            <text class="info-hint__modal-title">{{ title }}</text>
            <!-- 关闭按钮：CSS 伪元素画 X，避免 Unicode 字符，触摸目标 88rpx -->
            <view
              class="info-hint__close"
              @click="onCloseClick"
            />
          </view>
          <text class="info-hint__modal-content">{{ content }}</text>
        </view>
      </view>
    </Transition>
  </view>
</template>

<script setup lang="ts">
/**
 * @file InfoHint 术语解释组件
 *
 * 用途：在专业术语旁显示小问号图标，点击弹出解释浮层。
 * 覆盖 StatusPanel / FactionCard / NpcActionList 等组件的术语解释需求。
 *
 * 设计依据：openspec/changes/improve-ux-playability/tasks.md T1.4 + specs/help-system/spec.md
 *   - 问号图标直径 48rpx，bg #8B1A1A，白字"?"
 *   - 点击切换浮层显隐（移动端友好，非 hover）
 *   - 浮层 position:fixed 居中，半透明遮罩，点击遮罩或关闭按钮关闭
 *   - 关闭按钮触摸目标 min-w/min-h: 88rpx
 *
 * 事件模型（重要）：
 *   统一用 @click + CSS `touch-action: manipulation`，不用 @touchend / @pointerup。
 *   - `touch-action: manipulation` 是 Pointer Events 规范的一部分，禁用浏览器
 *     300ms click 延迟和双击缩放，使 click 在触摸端即时响应。
 *   - 不用 @touchend：避免 touchend 先关闭浮层、合成 ghost click 穿透到下层元素。
 *   - 不用 @pointerup：浮层关闭后 DOM 移除，合成的 click 仍会穿透到下层元素；
 *     且 jsdom 不支持 PointerEvent，无法单元测试。
 *   - 只用 @click：click 直接落在仍存在于 DOM 的浮层上，由浮层处理关闭，无穿透。
 */

import { ref, watch } from 'vue'
import { useScrollLock } from '@/composables/useScrollLock'

defineProps<{
  /** 术语名（浮层标题，粗体显示） */
  title: string
  /** 解释文字（浮层正文） */
  content: string
}>()

/** 浮层显隐状态 */
const visible = ref(false)
const { lock, unlock } = useScrollLock()

// 浮层显示时锁定底层滚动，关闭时解锁（修复「弹框时下方列表可滚动」bug）
watch(visible, (v) => {
  if (v) lock()
  else unlock()
})

/**
 * 切换浮层显隐（图标 @click 调用）。
 * 桌面鼠标点击和移动端触摸（已通过 touch-action: manipulation 消除 300ms 延迟）
 * 都走这个路径，统一语义：点击图标即开/关浮层。
 */
function toggle(): void {
  visible.value = !visible.value
}

/**
 * 关闭浮层（关闭按钮 @click 调用）。
 */
function close(): void {
  if (!visible.value) return
  visible.value = false
}

/**
 * 图标 click handler。
 * 显式 stopPropagation：阻止 click 冒泡到父级 FactionCard 触发 select 事件。
 * 不依赖 Vue 的 .stop 修饰符：uni-app H5 端 <view> 编译为 <uni-view> 自定义元素，
 * 修饰符在合成事件层可能不稳定；显式调用原生事件方法最可靠。
 */
function onIconClick(e: Event): void {
  e.stopPropagation()
  toggle()
}

/**
 * 关闭按钮 click handler。
 * stopPropagation 阻止冒泡到遮罩（避免触发 onOverlayClick 重复 close）和父级卡片。
 * preventDefault 阻止 click 默认行为（部分 WebView 中 view 可能有默认行为）。
 */
function onCloseClick(e: Event): void {
  e.stopPropagation()
  e.preventDefault()
  close()
}

/**
 * modal 内容区 click handler。
 * stopPropagation 阻止冒泡到遮罩：点击 modal 内部不应关闭浮层。
 */
function onModalClick(e: Event): void {
  e.stopPropagation()
}

/**
 * 根元素 click handler（兜底）。
 * 即使子元素（图标/遮罩/关闭按钮/modal）的 stopPropagation 失效，
 * 根元素的 @click.stop 仍能阻断冒泡到父级 FactionCard。
 * 这里不需要做任何事，仅依赖 .stop 修饰符阻断冒泡。
 */
function onRootClick(_e: Event): void {
  // 故意空实现：仅靠 @click.stop 修饰符阻断冒泡
}

/**
 * 遮罩点击处理（浮层 @click 调用）。
 *
 * 必须显式 stopPropagation：InfoHint 通常嵌在可点击卡片（如 FactionCard）内，
 * 若不阻止冒泡，遮罩 click 会冒泡到卡片触发 select 事件，
 * 错误弹出「确认势力」等无关弹窗。
 * Vue 的 .self 修饰符只检查 target/currentTarget，不会自动 stopPropagation。
 *
 * 不用判断 target === currentTarget：uni-app H5 端的 @click 合成事件
 * target/currentTarget 是 undefined；而 modal 内的点击已通过 onModalClick 拦截，
 * 能到达 overlay 的 click 必然来自 modal 外部（直接点遮罩或更底层），
 * 全部需要关闭浮层并阻止冒泡。
 *
 * @param e MouseEvent
 */
function onOverlayClick(e: Event): void {
  e.stopPropagation()
  close()
}
</script>

<style lang="scss" scoped>
.info-hint {
  display: inline-flex;
  align-items: center;

  &__icon {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    width: 44rpx;
    height: 44rpx;
    min-width: 44rpx;
    min-height: 44rpx;
    margin-left: 10rpx;
    // 实心暖棕填充，与浮层模态框（#fdf6e3 / #d4c5a0）和关闭按钮（#8d6e63）色调统一，
    // 在米黄卡片背景上有足够的辨识度，同时呼应历史古风配色。
    background-color: #8d6e63;
    border-radius: 50%;
    transition: transform 150ms ease, background-color 150ms ease;
    // touch-action: manipulation 是 Pointer Events 规范的一部分：
    // 禁用浏览器 300ms click 延迟和双击缩放，使 @click 在触摸端即时响应，
    // 且浏览器不再合成 ghost click，从根源消除穿透问题。
    touch-action: manipulation;

    &:active {
      transform: scale(0.92);
    }

    &--active {
      background-color: #6d4c41;
    }
  }

  &__icon-text {
    font-size: 26rpx;
    font-weight: 700;
    color: #fdf6e3;
    line-height: 1;
    // 微调问号位置，使其在圆圈内视觉居中（? 字符本身偏上）
    transform: translateY(1rpx);
  }

  &__overlay {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(0, 0, 0, 0.5);
    // 同样禁用 300ms 延迟，遮罩/关闭按钮的 @click 即时响应
    touch-action: manipulation;
  }

  &__modal {
    width: 80%;
    max-width: 600rpx;
    padding: 32rpx;
    background-color: #fdf6e3;
    border: 2rpx solid #d4c5a0;
    border-radius: 16rpx;
    box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.2);
  }

  &__modal-head {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16rpx;
  }

  &__modal-title {
    flex: 1;
    font-size: 32rpx;
    font-weight: 700;
    color: #2c1810;
  }

  // 关闭按钮：CSS 伪元素画 X（避免 Unicode ✕，三端兼容）
  &__close {
    position: relative;
    flex-shrink: 0;
    width: 88rpx;
    height: 88rpx;
    min-width: 88rpx;
    min-height: 88rpx;
    margin: -16rpx -16rpx 0 0;
    transition: transform 150ms ease;
    touch-action: manipulation;

    &:active {
      transform: scale(0.95);
    }

    &::before,
    &::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 36rpx;
      height: 4rpx;
      background-color: #8d6e63;
      border-radius: 2rpx;
    }

    &::before {
      transform: translate(-50%, -50%) rotate(45deg);
    }

    &::after {
      transform: translate(-50%, -50%) rotate(-45deg);
    }
  }

  &__modal-content {
    display: block;
    font-size: 28rpx;
    line-height: 1.6;
    color: #5d4037;
    word-break: break-all;
  }
}

// Transition 淡入淡出动画（H5 端生效，小程序端降级直接显隐）
.info-hint-fade-enter-active,
.info-hint-fade-leave-active {
  transition: opacity 200ms ease;
}

.info-hint-fade-enter-from,
.info-hint-fade-leave-to {
  opacity: 0;
}
</style>
