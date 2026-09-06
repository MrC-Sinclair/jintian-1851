<template>
  <view class="status-panel">
    <view class="status-panel__section">
      <text class="status-panel__section-title">五维属性</text>
      <view
        v-for="attr in attributesList"
        :key="attr.key"
        class="status-panel__row"
      >
        <view class="status-panel__label-wrap">
          <!-- 五维属性图标（像素风格） -->
          <image
            class="status-panel__attr-icon"
            :src="`/static/attr-${attr.key}.png`"
            mode="aspectFit"
            aria-hidden="true"
          />
          <!-- 危机预警图标（属性 < 30 时显示） -->
          <AppIcon
            v-if="props.attributes[attr.key] < 30"
            class="status-panel__warning-icon"
            name="warning"
            :size="18"
            color="#c62828"
          />
          <text class="status-panel__label">{{ attr.label }}</text>
          <InfoHint :title="attr.label" :content="TERM_EXPLANATIONS[attr.key]" />
        </view>
        <view class="status-panel__bar-track">
          <view
            class="status-panel__bar-fill"
            :class="[barColorClass(props.attributes[attr.key]), flashClass(attr.key)]"
            :style="{ width: `${clampPercent(props.attributes[attr.key])}%` }"
          />
        </view>
        <text
          class="status-panel__value"
          :class="[valueColorClass(props.attributes[attr.key]), flashClass(attr.key)]"
        >{{ displayedAttributes[attr.key] }}</text>
      </view>
    </view>

    <view class="status-panel__section">
      <text class="status-panel__section-title">资源</text>
      <view class="status-panel__resources">
        <view
          v-for="res in resourcesList"
          :key="res.key"
          class="status-panel__resource"
        >
          <view class="status-panel__resource-label-wrap">
            <text class="status-panel__resource-label">{{ res.label }}</text>
            <InfoHint :title="res.label" :content="TERM_EXPLANATIONS[res.key]" />
          </view>
          <text
            class="status-panel__resource-value"
            :class="flashClass(res.key)"
          >{{ formatNumber(displayedResources[res.key]) }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { Attributes, Resources } from '@/types/game'
import InfoHint from '@/components/InfoHint.vue'
import AppIcon from '@/components/AppIcon.vue'
import { TERM_EXPLANATIONS } from '@/utils/copywriting'

const props = defineProps<{
  attributes: Attributes
  resources: Resources
}>()

/** 动画时长（ms），与 AGENTS.md 微交互 200-300ms 规范一致 */
const ANIM_DURATION = 300
/** 帧间隔（ms），约 60fps */
const FRAME_INTERVAL = 16

const attributesList = [
  { key: 'military' as const, label: '军事' },
  { key: 'economy' as const, label: '经济' },
  { key: 'politics' as const, label: '政治' },
  { key: 'people' as const, label: '民心' },
  { key: 'diplomacy' as const, label: '外交' }
]

const resourcesList = [
  { key: 'silver' as const, label: '银两' },
  { key: 'troops' as const, label: '兵员' },
  { key: 'food' as const, label: '粮草' },
  { key: 'reputation' as const, label: '名望' }
]

/** 显示中的属性值（动画过渡值） */
const displayedAttributes = reactive<Attributes>({ ...props.attributes })
/** 显示中的资源值 */
const displayedResources = reactive<Resources>({ ...props.resources })
/** 闪烁状态：'up' | 'down' | null */
const flashState = reactive<Record<string, 'up' | 'down' | null>>({
  military: null,
  economy: null,
  politics: null,
  people: null,
  diplomacy: null,
  silver: null,
  troops: null,
  food: null,
  reputation: null
})

/** 活跃的动画句柄（避免同一字段重复动画时叠加） */
const animTimers = new Map<string, ReturnType<typeof setInterval>>()
const flashTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * 启动数字滚动动画 + 闪烁
 * - 数字从 from 平滑插值到 to，时长 ANIM_DURATION
 * - 闪烁类在 ANIM_DURATION 后清除
 */
function animateValue(
  key: string,
  from: number,
  to: number,
  apply: (v: number) => void
): void {
  // 清掉同字段旧的动画与闪烁
  const oldAnim = animTimers.get(key)
  if (oldAnim) {
    clearInterval(oldAnim)
    animTimers.delete(key)
  }
  const oldFlash = flashTimers.get(key)
  if (oldFlash) {
    clearTimeout(oldFlash)
    flashTimers.delete(key)
  }

  // 整数差值无意义（如 50 → 51），直接赋值 + 短闪烁
  if (Math.abs(to - from) < 1) {
    apply(to)
  } else {
    const start = Date.now()
    const timer = setInterval(() => {
      const elapsed = Date.now() - start
      const progress = Math.min(1, elapsed / ANIM_DURATION)
      // 线性插值（数值简单，不需要 ease）
      const current = Math.round(from + (to - from) * progress)
      apply(current)
      if (progress >= 1) {
        clearInterval(timer)
        animTimers.delete(key)
      }
    }, FRAME_INTERVAL)
    animTimers.set(key, timer)
  }

  // 闪烁：上升绿、下降红
  flashState[key] = to > from ? 'up' : 'down'
  const flashTimer = setTimeout(() => {
    flashState[key] = null
    flashTimers.delete(key)
  }, ANIM_DURATION)
  flashTimers.set(key, flashTimer)
}

/** 监听属性变化触发动画 */
watch(
  () => ({ ...props.attributes }),
  (newAttrs, oldAttrs) => {
    for (const { key } of attributesList) {
      const oldVal = oldAttrs?.[key] ?? newAttrs[key]
      const newVal = newAttrs[key]
      if (newVal !== oldVal) {
        animateValue(key, oldVal, newVal, (v) => {
          displayedAttributes[key] = v
        })
      }
    }
  },
  { deep: true }
)

/** 监听资源变化触发动画 */
watch(
  () => ({ ...props.resources }),
  (newRes, oldRes) => {
    for (const { key } of resourcesList) {
      const oldVal = oldRes?.[key] ?? newRes[key]
      const newVal = newRes[key]
      if (newVal !== oldVal) {
        animateValue(key, oldVal, newVal, (v) => {
          displayedResources[key] = v
        })
      }
    }
  },
  { deep: true }
)

function clampPercent(v: number): number {
  // 用 props 中的实际值（而非 displayedAttributes），让属性条立即跟随实际值
  return Math.max(0, Math.min(100, v))
}

/** 数值格式化（千分位） */
function formatNumber(v: number): string {
  if (Math.abs(v) >= 1000) {
    return v.toLocaleString('zh-CN')
  }
  return String(v)
}

/** 属性条颜色：>70 绿、30-70 中、<30 红 */
function barColorClass(v: number): string {
  if (v >= 70) return 'status-panel__bar-fill--high'
  if (v < 30) return 'status-panel__bar-fill--low'
  return 'status-panel__bar-fill--mid'
}

function valueColorClass(v: number): string {
  if (v >= 70) return 'status-panel__value--high'
  if (v < 30) return 'status-panel__value--low'
  return ''
}

/** 闪烁类（up 绿、down 红），与属性值/属性条共用 */
function flashClass(key: string): string {
  const state = flashState[key]
  if (state === 'up') return 'status-panel--flash-up'
  if (state === 'down') return 'status-panel--flash-down'
  return ''
}
</script>

<style lang="scss" scoped>
.status-panel {
  // P0-3：卡片层次用「背景分层 + 阴影」替代细描边
  padding: $jt-space-md $jt-space-lg;
  background-color: $jt-bg-surface;
  border-radius: $jt-radius-xl;
  box-shadow: $jt-shadow-card;

  &__section {
    margin-bottom: $jt-space-lg;

    &:last-child {
      margin-bottom: 0;
    }
  }

  &__section-title {
    display: block;
    margin-bottom: $jt-space-base;
    font-size: $jt-font-lg;
    font-weight: 600;
    color: $jt-ink-secondary;
  }

  // 属性标签行（含图标 + 危机图标 + InfoHint）
  &__label-wrap {
    display: flex;
    flex-direction: row;
    align-items: center;
    width: 160rpx;
    flex-shrink: 0;
  }

  &__attr-icon {
    width: 36rpx;
    height: 36rpx;
    margin-right: $jt-space-sm;
    flex-shrink: 0;
  }

  &__warning-icon {
    flex-shrink: 0;
    margin-right: $jt-space-xs;
  }

  &__resource-label-wrap {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

  &__row {
    display: flex;
    align-items: center;
    margin-bottom: $jt-space-sm;
  }

  &__label {
    font-size: $jt-font-md;
    color: $jt-ink;
  }

  &__bar-track {
    flex: 1;
    height: 12rpx;
    margin: 0 $jt-space-md;
    overflow: hidden;
    background-color: $jt-bg-track;
    border-radius: $jt-radius-sm;
  }

  &__bar-fill {
    height: 100%;
    transition: width 300ms ease, background-color 300ms ease, box-shadow 300ms ease;

    &--high {
      background-color: $jt-success;
    }

    &--mid {
      background-color: $jt-warning;
    }

    &--low {
      background-color: $jt-danger;
    }
  }

  &__value {
    width: 60rpx;
    font-size: $jt-font-md;
    text-align: right;
    color: $jt-ink;
    transition: color 300ms ease, text-shadow 300ms ease;

    &--high {
      color: $jt-success;
    }

    &--low {
      color: $jt-danger;
    }
  }

  &__resources {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: $jt-space-base;
  }

  &__resource {
    display: flex;
    justify-content: space-between;
    padding: $jt-space-sm $jt-space-base;
    background-color: $jt-bg-subtle;
    border-radius: $jt-radius-sm;
    transition: background-color 300ms ease;
  }

  &__resource-label {
    font-size: $jt-font-base;
    color: $jt-ink-secondary;
  }

  &__resource-value {
    font-size: $jt-font-base;
    font-weight: 600;
    color: $jt-ink;
    transition: text-shadow 300ms ease;
  }

  // 闪烁动画（300ms 后由 JS 清除 class）
  // 使用 text-shadow / box-shadow 而非 background-color，
  // 避免覆盖属性条原本的高/中/低色与属性值颜色
  &--flash-up {
    text-shadow: 0 0 8rpx rgba(46, 125, 50, 0.8);
    box-shadow: 0 0 12rpx 2rpx rgba(46, 125, 50, 0.6);
  }

  &--flash-down {
    text-shadow: 0 0 8rpx rgba(198, 40, 40, 0.8);
    box-shadow: 0 0 12rpx 2rpx rgba(198, 40, 40, 0.6);
  }
}
</style>
