<template>
  <view class="collapsible-section">
    <!-- 标题栏（可点击切换折叠，触摸目标 min-h: 88rpx） -->
    <view
      class="collapsible-section__header"
      :hover-class="'collapsible-section__header--hover'"
      :hover-stay-time="100"
      @click="toggle"
    >
      <!-- 标题图标（可选，SVG path） -->
      <view v-if="icon" class="collapsible-section__icon">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="currentColor" :d="icon" />
        </svg>
      </view>

      <!-- chevron 旋转图标（CSS border 画三角形，避免 Unicode 字符） -->
      <view
        class="collapsible-section__chevron"
        :class="{ 'collapsible-section__chevron--expanded': expanded }"
      />

      <!-- 标题文本 -->
      <text class="collapsible-section__title">{{ title }}</text>

      <!-- 标题旁可选内容（如 InfoHint、状态摘要等） -->
      <view v-if="$slots['title-extra']" class="collapsible-section__title-extra">
        <slot name="title-extra" />
      </view>
    </view>

    <!-- 展开内容（max-height transition 折叠动画，禁止 v-if 直接切换） -->
    <view
      class="collapsible-section__expand"
      :class="{ 'collapsible-section__expand--collapsed': !expanded }"
    >
      <view class="collapsible-section__expand-inner">
        <slot />
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * @file CollapsibleSection 通用可折叠区块
 *
 * 用于 game-main 信息分区重构（T2.1/T2.2）：
 *   - 标题栏可点击切换折叠/展开
 *   - chevron 旋转动画（0deg 折叠态朝下，180deg 展开态朝上）
 *   - max-height + opacity transition 实现平滑高度过渡（禁止 v-if 硬切）
 *   - 标题旁可通过 #title-extra slot 插入 InfoHint 等附加内容
 *
 * 设计依据：openspec/changes/improve-ux-playability/tasks.md T2.1
 *   - Props：title / defaultExpanded / icon
 *   - emits：toggle(expanded)
 *   - 触摸目标 min-h: 88rpx
 *   - 折叠动画：max-height 300ms ease, opacity 200ms ease
 */

import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 标题文本 */
    title: string
    /** 默认是否展开（默认 true） */
    defaultExpanded?: boolean
    /** 标题图标 SVG path（可选，传入 path d 属性值） */
    icon?: string
  }>(),
  { defaultExpanded: true, icon: '' }
)

const emit = defineEmits<{
  /** 折叠/展开状态切换事件 */
  (e: 'toggle', expanded: boolean): void
}>()

/** 折叠状态（初始值 SSR 安全，来自 prop，onMounted 不改 DOM 结构） */
const expanded = ref(props.defaultExpanded)

/** 切换折叠/展开，emit toggle 事件 */
function toggle(): void {
  expanded.value = !expanded.value
  emit('toggle', expanded.value)
}
</script>

<style lang="scss" scoped>
.collapsible-section {
  background-color: #fdf6e3;
  border: 2rpx solid #d4c5a0;
  border-radius: 12rpx;
  overflow: hidden;

  // ====================== 标题栏 ======================
  &__header {
    display: flex;
    flex-direction: row;
    align-items: center;
    // 触摸目标 min-h: 88rpx
    min-height: 88rpx;
    padding: 16rpx 24rpx;
    transition: background-color 150ms ease;

    &:active {
      background-color: rgba(212, 197, 160, 0.3);
    }

    &--hover {
      background-color: rgba(212, 197, 160, 0.2);
    }
  }

  // 标题图标（可选 SVG）
  &__icon {
    flex-shrink: 0;
    width: 40rpx;
    height: 40rpx;
    margin-right: 12rpx;
    color: #5d4037;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  // chevron 旋转图标（CSS border 画三角形，避免 Unicode ▼ 字符）
  &__chevron {
    flex-shrink: 0;
    width: 0;
    height: 0;
    margin-right: 16rpx;
    border-right: 10rpx solid transparent;
    border-left: 10rpx solid transparent;
    border-top: 14rpx solid #5d4037;
    // 折叠态朝下（0deg），展开态旋转 180deg 朝上
    transition: transform 200ms ease;

    &--expanded {
      transform: rotate(180deg);
    }
  }

  &__title {
    flex-shrink: 0;
    font-size: 30rpx;
    font-weight: 600;
    color: #5d4037;
  }

  // 标题旁附加内容（slot #title-extra）
  &__title-extra {
    display: flex;
    flex: 1;
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    margin-left: 16rpx;
  }

  // ====================== 展开内容（max-height transition 折叠动画） ======================
  &__expand {
    max-height: 2000rpx;
    opacity: 1;
    overflow: hidden;
    transition: max-height 300ms ease, opacity 200ms ease;

    &--collapsed {
      max-height: 0;
      opacity: 0;
    }
  }

  &__expand-inner {
    padding: 16rpx 24rpx;
    border-top: 2rpx dashed rgba(212, 197, 160, 0.5);
  }
}
</style>
