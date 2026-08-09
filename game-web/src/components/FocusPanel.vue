<template>
  <view class="focus-panel">
    <!-- 综合实力进度条（含 90 阈值刻度）+ InfoHint -->
    <view class="focus-panel__power">
      <view class="focus-panel__power-head">
        <text class="focus-panel__power-label">综合实力</text>
        <InfoHint title="综合实力" :content="overallPowerHint" />
        <text
          class="focus-panel__power-value"
          :class="{ 'focus-panel__power-value--victory': isVictory }"
        >{{ Math.round(overallPower) }}/100</text>
      </view>
      <view class="focus-panel__bar">
        <view
          class="focus-panel__bar-fill"
          :class="{ 'focus-panel__bar-fill--victory': isVictory }"
          :style="{ width: overallPercent + '%' }"
        />
        <!-- 90 阈值刻度竖线 -->
        <view class="focus-panel__bar-threshold" />
        <text class="focus-panel__bar-threshold-label">90</text>
      </view>
    </view>

    <!-- 危机提示行（仅当存在危机时渲染） -->
    <view v-if="hint.crisis" class="focus-panel__crisis">
      <!-- CSS 画警告三角图标（避免 Unicode ⚠ 字符） -->
      <view class="focus-panel__crisis-icon">
        <text class="focus-panel__crisis-icon-text">!</text>
      </view>
      <text class="focus-panel__crisis-text">
        {{ hint.crisis.name }} {{ hint.crisis.value }}（濒临崩溃）
      </text>
      <InfoHint title="危机预警" :content="crisisHint" />
    </view>

    <!-- 建议行：briefing.suggestion 优先于规则 suggestion -->
    <view class="focus-panel__suggestion">
      <!-- SVG 灯泡图标（避免 Unicode 💡 字符） -->
      <view class="focus-panel__suggestion-icon">
        <svg
          class="focus-panel__suggestion-svg"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7zm-2 19c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-1h-4v1z"
          />
        </svg>
      </view>
      <text class="focus-panel__suggestion-text">
        本回合建议：{{ finalSuggestion }}
      </text>
    </view>

    <!-- T4.3：剧情待续提示（挂起剧情链节点非空时显示，可点击展开详情） -->
    <view
      v-if="pendingChainNodes.length > 0"
      class="focus-panel__pending"
      :class="{ 'focus-panel__pending--expanded': pendingExpanded }"
      @click="togglePending"
    >
      <view class="focus-panel__pending-head">
        <!-- 书卷图标（与 TurnTimeline 书卷图标同款） -->
        <view class="focus-panel__pending-icon">
          <svg
            class="focus-panel__pending-svg"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zM21 18.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z" />
            <path d="M17.5 10.5c.6 0 1.15.1 1.65.25V7.5c-.5-.15-1.05-.25-1.65-.25s-1.15.1-1.65.25v3.25c.5-.15 1.05-.25 1.65-.25z" />
            <path d="M17.5 14.5c.6 0 1.15.1 1.65.25V11.5c-.5-.15-1.05-.25-1.65-.25s-1.15.1-1.65.25v3.25c.5-.15 1.05-.25 1.65-.25z" />
          </svg>
        </view>
        <text class="focus-panel__pending-title">剧情待续</text>
        <text class="focus-panel__pending-count">{{ pendingChainNodes.length }} 条</text>
        <text class="focus-panel__pending-toggle">
          {{ pendingExpanded ? '收起' : CHAIN_EXPAND_LABEL }}
        </text>
      </view>

      <!-- 详情区：每条挂起剧情链显示 链名 / 进度 / 简介 / 下节标题 -->
      <view class="focus-panel__pending-detail">
        <view
          v-for="node in pendingChainNodes"
          :key="`${node.chainId}-${node.nodeId}`"
          class="focus-panel__pending-item"
        >
          <text class="focus-panel__pending-item-title">{{ chainTitleOf(node) }}</text>
          <text
            v-if="chainProgressText(node)"
            class="focus-panel__pending-item-progress"
          >{{ chainProgressText(node) }}</text>
          <text
            v-if="chainDescOf(node)"
            class="focus-panel__pending-item-desc"
          >{{ chainDescOf(node) }}</text>
          <text class="focus-panel__pending-item-next">
            下回合（第 {{ node.scheduledTurn }} 回合）将触发：{{ nextNodeTitleOf(node) }}
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * @file FocusPanel 当前焦点区块（置顶始终展开）
 *
 * 用途：游戏主界面顶部常驻信息条，让玩家一眼掌握当前局势焦点：
 *   1. 综合实力进度条（与 GoalPanel 同款，含 90 阈值刻度）
 *   2. 危机提示行（属性 < 30 时显示，红色高亮）
 *   3. 建议行（AI 简报返回时覆盖规则建议）
 *
 * 设计依据：openspec/changes/improve-ux-playability/tasks.md T1.7 + specs/goal-system/spec.md
 *   - 始终展开，无折叠态
 *   - 数据流：goal-hint.ts 计算本地部分，briefing.suggestion 存在时覆盖 suggestion
 */

import { computed, ref } from 'vue'
import type { Attributes, PendingChainNode } from '@/types/game'
import { generateFocusHint, VICTORY_THRESHOLD } from '@/utils/goal-hint'
import { TERM_EXPLANATIONS, CHAIN_PROGRESS_LABEL, CHAIN_EXPAND_LABEL } from '@/utils/copywriting'
import { getChainMeta, getChainProgress, getNodeTitle } from '@/data/story-chains'
import InfoHint from './InfoHint.vue'

/** AI 简报结构（由 advisor-briefing 接口返回，T1.14 实现） */
interface AdvisorBriefing {
  /** 局势摘要（可选展示，本版本不直接渲染，留作扩展） */
  summary: string
  /** AI 给出的本回合建议（覆盖规则 suggestion） */
  suggestion: string
}

const props = withDefaults(
  defineProps<{
    /** 5 维属性（用于计算综合实力与危机） */
    attributes: Attributes
    /** AI 军师简报（可选，存在时其 suggestion 覆盖规则建议） */
    briefing?: AdvisorBriefing | null
    /** T4.3：挂起的剧情链节点（非空时显示「剧情待续」提示） */
    pendingChainNodes?: PendingChainNode[]
  }>(),
  { briefing: null, pendingChainNodes: () => [] }
)

/** 焦点提示（复用 goal-hint.ts 计算综合实力/危机/规则建议） */
const hint = computed(() => generateFocusHint(props.attributes))

/** 综合实力（0-100） */
const overallPower = computed(() => hint.value.overallPower)

/** 综合实力百分比（用于进度条宽度，clamp 0-100） */
const overallPercent = computed(() => Math.max(0, Math.min(100, overallPower.value)))

/** 是否已达胜利阈值 */
const isVictory = computed(() => overallPower.value >= VICTORY_THRESHOLD)

/** InfoHint 解释文案：综合实力（复用 copywriting.ts 统一术语解释） */
const overallPowerHint = TERM_EXPLANATIONS.overallPower

/** InfoHint 解释文案：危机预警 */
const crisisHint = TERM_EXPLANATIONS.crisis

/**
 * 最终建议文案
 * - briefing 存在且 suggestion 非空 → 用 AI 简报建议（覆盖规则建议）
 * - 否则 → 用 goal-hint.ts 规则生成的建议
 */
const finalSuggestion = computed(() => {
  if (props.briefing?.suggestion && props.briefing.suggestion.trim().length > 0) {
    return props.briefing.suggestion
  }
  return hint.value.suggestion
})

/**
 * T4.3：剧情待续详情展开态（默认折叠，点击提示条切换）
 */
const pendingExpanded = ref(false)

function togglePending(): void {
  pendingExpanded.value = !pendingExpanded.value
}

/** T4.3：取挂起剧情链的中文链名（未知 id 兜底为原始 chainId） */
function chainTitleOf(node: PendingChainNode): string {
  return getChainMeta(node.chainId)?.title ?? node.chainId
}

/** T4.3：取挂起剧情节点的进度文案「剧情 X/Y」（节点无效时返回空串） */
function chainProgressText(node: PendingChainNode): string {
  const progress = getChainProgress(node.chainId, node.nodeId)
  if (!progress) return ''
  return CHAIN_PROGRESS_LABEL(progress.current, progress.total)
}

/** T4.3：取剧情链简介（无则空串） */
function chainDescOf(node: PendingChainNode): string {
  return getChainMeta(node.chainId)?.description ?? ''
}

/** T4.3：取下节（即将触发）节点标题（未知兜底为「未知剧情」） */
function nextNodeTitleOf(node: PendingChainNode): string {
  return getNodeTitle(node.chainId, node.nodeId) ?? '未知剧情'
}
</script>

<style lang="scss" scoped>
.focus-panel {
  padding: 16rpx 24rpx;
  background-color: #fdf6e3;
  border: 2rpx solid #d4c5a0;
  border-radius: 12rpx;

  // 综合实力进度条
  &__power {
    margin-bottom: 12rpx;
  }

  &__power-head {
    display: flex;
    flex-direction: row;
    align-items: center;
    margin-bottom: 8rpx;
  }

  &__power-label {
    flex-shrink: 0;
    font-size: 26rpx;
    font-weight: 600;
    color: #5d4037;
  }

  &__power-value {
    margin-left: auto;
    font-size: 28rpx;
    font-weight: 700;
    color: #8b1a1a;

    &--victory {
      color: #2e7d32;
    }
  }

  // 进度条（与 GoalPanel 同款样式）
  &__bar {
    position: relative;
    height: 16rpx;
    background-color: #e5d5b7;
    border-radius: 8rpx;
  }

  &__bar-fill {
    height: 100%;
    background-color: #8b1a1a;
    border-radius: 8rpx;
    transition: width 300ms ease;

    &--victory {
      background-color: #2e7d32;
    }
  }

  // 90 阈值刻度竖线
  &__bar-threshold {
    position: absolute;
    top: -4rpx;
    bottom: -4rpx;
    left: 90%;
    width: 2rpx;
    background-color: #5d4037;
    transform: translateX(-1rpx);
  }

  &__bar-threshold-label {
    position: absolute;
    top: -24rpx;
    left: 90%;
    font-size: 20rpx;
    color: #5d4037;
    transform: translateX(-50%);
  }

  // 危机提示行
  &__crisis {
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 8rpx 12rpx;
    margin-bottom: 12rpx;
    background-color: rgba(198, 40, 40, 0.08);
    border: 2rpx solid rgba(198, 40, 40, 0.3);
    border-radius: 8rpx;
  }

  // CSS 画警告三角图标（避免 Unicode ⚠）
  &__crisis-icon {
    position: relative;
    flex-shrink: 0;
    width: 36rpx;
    height: 36rpx;
    min-width: 36rpx;
    min-height: 36rpx;
    margin-right: 12rpx;

    // 用 border 画三角形（与 GoalPanel 折叠图标同款技巧）
    &::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      border-right: 18rpx solid transparent;
      border-left: 18rpx solid transparent;
      border-bottom: 32rpx solid #c62828;
      border-radius: 4rpx;
    }
  }

  &__crisis-icon-text {
    position: absolute;
    top: 8rpx;
    left: 50%;
    z-index: 1;
    font-size: 22rpx;
    font-weight: 700;
    color: #fff;
    transform: translateX(-50%);
  }

  &__crisis-text {
    flex: 1;
    font-size: 26rpx;
    font-weight: 600;
    color: #c62828;
  }

  // 建议行
  &__suggestion {
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 8rpx 12rpx;
    background-color: rgba(139, 26, 26, 0.04);
    border-radius: 8rpx;
  }

  &__suggestion-icon {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 36rpx;
    height: 36rpx;
    min-width: 36rpx;
    min-height: 36rpx;
    margin-right: 12rpx;
    color: #f9a825;
  }

  &__suggestion-svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  &__suggestion-text {
    flex: 1;
    font-size: 26rpx;
    line-height: 1.5;
    color: #5d4037;
  }

  // T4.3：剧情待续提示条（浅米黄，可点击展开）
  &__pending {
    display: flex;
    flex-direction: column;
    margin-top: 12rpx;
    padding: 12rpx 16rpx;
    background-color: #fff8e1;
    border: 2rpx solid #e6d9a8;
    border-radius: 8rpx;
    // T4.3：触摸目标 min-h 88rpx（tasks.md 规范）
    min-height: 88rpx;
  }

  &__pending-head {
    display: flex;
    flex-direction: row;
    align-items: center;
    cursor: pointer;
  }

  &__pending-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 32rpx;
    height: 32rpx;
    margin-right: 8rpx;
  }

  &__pending-svg {
    width: 32rpx;
    height: 32rpx;
    fill: #8b1a1a;
  }

  &__pending-title {
    font-size: 26rpx;
    font-weight: 600;
    color: #5d4037;
  }

  &__pending-count {
    margin-left: 8rpx;
    font-size: 22rpx;
    color: #8d6e63;
  }

  &__pending-toggle {
    margin-left: auto;
    font-size: 22rpx;
    color: #1565c0;
  }

  &__pending-detail {
    max-height: 0;
    overflow: hidden;
    transition: max-height 300ms ease;
  }

  &__pending--expanded &__pending-detail {
    max-height: 1600rpx;
  }

  &__pending-item {
    display: flex;
    flex-direction: column;
    padding: 8rpx 0;

    &:not(:last-child) {
      border-bottom: 2rpx dashed rgba(212, 197, 160, 0.5);
    }
  }

  &__pending-item-title {
    font-size: 24rpx;
    font-weight: 600;
    color: #5d4037;
  }

  &__pending-item-progress {
    margin-top: 2rpx;
    font-size: 22rpx;
    color: #8b1a1a;
  }

  &__pending-item-desc {
    margin-top: 2rpx;
    font-size: 22rpx;
    line-height: 1.4;
    color: #8d6e63;
  }

  &__pending-item-next {
    margin-top: 2rpx;
    font-size: 22rpx;
    color: #1565c0;
  }
}
</style>
