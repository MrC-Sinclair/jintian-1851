<template>
  <view v-if="visible" class="advisor-drawer">
    <view class="advisor-drawer__mask" @click.stop="onClose" @touchmove.stop.prevent @touchend.stop />
    <view class="advisor-drawer__panel" @click.stop>
      <!-- 顶部：标题 + 关闭 -->
      <view class="advisor-drawer__header">
        <text class="advisor-drawer__title">军师对话</text>
        <TooltipView :content="TOOLTIP_TEXT.close" placement="bottom">
          <view
            class="advisor-drawer__close"
            :hover-class="'advisor-drawer__close--hover'"
            :hover-stay-time="100"
            @click="onClose"
          >
            <!-- 关闭 SVG 图标（禁止 Unicode ✕） -->
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
              />
            </svg>
          </view>
        </TooltipView>
      </view>

      <!-- T2.5：工具调用过程展示（对话区上方，始终可见） -->
      <view v-if="toolCalls.length" class="advisor-tools">
        <view
          v-for="(tc, i) in toolCalls"
          :key="i"
          class="advisor-tool"
          :class="[`advisor-tool--${tc.status}`]"
          :hover-class="'advisor-tool--hover'"
          :hover-stay-time="100"
          @click="toggleTool(i)"
        >
          <view class="advisor-tool__head">
            <svg class="advisor-tool__icon" viewBox="0 0 24 24" aria-hidden="true">
              <path :d="statusIconPath(tc.status)" fill="currentColor" />
            </svg>
            <text class="advisor-tool__label">{{ toolText(tc) }}</text>
          </view>
          <!-- 展开详情：工具名 + 参数 + 完整结果 JSON -->
          <view v-if="expandedTools[i]" class="advisor-tool__detail">
            <text class="advisor-tool__detail-line">工具：{{ tc.toolName }}</text>
            <text class="advisor-tool__detail-line">参数：{{ safeStringify(tc.args) }}</text>
            <text class="advisor-tool__detail-line">结果：{{ safeStringify(tc.result) }}</text>
          </view>
        </view>
      </view>

      <!-- 中部：消息列表 -->
      <scroll-view
        class="advisor-drawer__messages"
        scroll-y
        :scroll-top="scrollTop"
        :scroll-with-animation="true"
      >
        <view v-if="messages.length === 0 && !isStreaming" class="advisor-drawer__empty">
          <!-- T2.3：空状态文案白话化（copywriting.EMPTY_TEXT.advisor） -->
          <text class="advisor-drawer__empty-text">
            {{ EMPTY_TEXT.advisor }}
          </text>
        </view>

        <view
          v-for="(msg, idx) in messages"
          :key="`${msg.turn}-${idx}-${msg.timestamp}`"
          class="advisor-msg"
          :class="[
            `advisor-msg--${msg.role}`,
            // T2.6：局势简报消息加特殊样式类（浅色背景 + 角标）
            msg.isBriefing ? 'advisor-msg--briefing' : ''
          ]"
        >
          <!-- T2.6：局势简报角标（view 包裹独占一行，三端兼容） -->
          <view v-if="msg.isBriefing" class="advisor-msg__badge">
            <text class="advisor-msg__badge-text">局势简报</text>
          </view>
          <text class="advisor-msg__content">{{ msg.content }}</text>
        </view>

        <!-- 流式渲染中的当前回复 -->
        <view v-if="isStreaming && streamingText" class="advisor-msg advisor-msg--assistant">
          <text class="advisor-msg__content">{{ streamingText }}</text>
          <text class="advisor-msg__cursor">▌</text>
        </view>

        <!-- 流式中无内容时的等待提示 -->
        <view v-if="isStreaming && !streamingText" class="advisor-drawer__waiting">
          <view class="advisor-drawer__dot-flashing" />
          <text class="advisor-drawer__waiting-text">军师思索中…</text>
        </view>
      </scroll-view>

      <!-- 底部：输入 + 发送 -->
      <view class="advisor-drawer__footer">
        <textarea
          v-model="input"
          class="advisor-drawer__textarea"
          :placeholder="PAGE_TEXT.advisorDrawer.placeholder"
          :maxlength="200"
          :auto-height="true"
          :disabled="isStreaming"
          :cursor-spacing="20"
          confirm-type="send"
          @confirm="onSend"
        />
        <view
          class="advisor-drawer__send"
          :class="{
            'advisor-drawer__send--disabled': !canSend,
            'advisor-drawer__send--loading': isStreaming
          }"
          :hover-class="canSend ? 'advisor-drawer__send--hover' : ''"
          :hover-stay-time="100"
          @click="onSend"
        >
          <view v-if="isStreaming" class="advisor-drawer__send-spinner">
            <view class="advisor-drawer__send-dot" />
          </view>
          <text v-else class="advisor-drawer__send-text">送出</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useAdvisor } from '@/composables/useAdvisor'
import { useToast } from '@/composables/useToast'
import { useGameStore } from '@/stores/game'
import { useScrollLock } from '@/composables/useScrollLock'
import { EMPTY_TEXT, PAGE_TEXT, TOOLTIP_TEXT } from '@/utils/copywriting'
import type { AdvisorMessage } from '@/types/game'
import TooltipView from '@/components/TooltipView.vue'

const props = defineProps<{
  /** 是否显示 */
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const store = useGameStore()
const toast = useToast()
const { lock, unlock } = useScrollLock()

const { send, abort, streamingText, isStreaming, toolCalls, briefing, briefingTurn } = useAdvisor({
  // 军师对话系统提示词大（人物+状态快照+势力+事件历史），Qwen3-8B 首 token 常超 3 秒，
  // 3 秒会把大量正常请求误判为超时；15 秒在 60 秒流式上限内留足生成时间
  firstChunkTimeoutMs: 15_000,
  onError: (code) => {
    if (code === 'TIMEOUT') {
      toast.error('军师迟迟未答，请稍候再试')
    } else if (code === 'NETWORK') {
      toast.error('网络异常，军师未能回应')
    } else {
      toast.error('军师暂时无法回应')
    }
  }
})

/** T2.5：工具调用气泡展开状态（按索引，点击切换） */
const expandedTools = ref<Record<number, boolean>>({})

/** 切换某条工具调用气泡的详情展开/收起 */
function toggleTool(i: number): void {
  expandedTools.value[i] = !expandedTools.value[i]
}

/**
 * T2.5：状态图标路径（SVG path，配合 fill="currentColor" 跟随气泡配色）
 *   - calling：放大镜（查询中）
 *   - done：✓ 勾（已完成）
 *   - fail：✗ 叉（失败）
 */
function statusIconPath(status: string): string {
  if (status === 'done') {
    return 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'
  }
  if (status === 'fail') {
    return 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
  }
  // calling：放大镜
  return 'M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z'
}

/** T2.5：气泡文案（按状态区分） */
function toolText(tc: { label: string; status: string }): string {
  if (tc.status === 'calling') return `查询${tc.label}…`
  if (tc.status === 'fail') return `${tc.label}查询失败`
  return `已查询${tc.label}`
}

/** 安全 JSON 序列化（用于详情展示，避免循环引用/大对象报错） */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v ?? {})
  } catch {
    return String(v)
  }
}

/** 输入框文本 */
const input = ref('')
/** scroll-view 滚动位置（用于强制滚到底部） */
const scrollTop = ref(0)

/** 当前存档中的军师对话历史 */
const messages = computed(() => store.currentSave?.advisorMessages ?? [])

/** 是否可发送（非流式 + 有内容 + 有存档） */
const canSend = computed(
  () => !isStreaming.value && input.value.trim().length > 0 && !!store.currentSave
)

/**
 * T2.6：已展示过简报的回合（避免同一回合多次打开抽屉重复插入）
 *
 * 初始 null。每次插入简报消息后更新为 briefingTurn.value。
 * 新回合 startTurn 后 briefingTurn 变化，下次打开抽屉会再次插入。
 */
const lastShownBriefingTurn = ref<number | null>(null)

/**
 * T2.6：抽屉打开时自动插入「局势简报」消息
 *
 * 触发条件：
 *   1. briefing 存在（startTurn 内调 advisor-briefing 成功）
 *   2. briefingTurn 与 lastShownBriefingTurn 不同（本回合未展示过）
 *
 * 插入内容：summary + 换行 + suggestion（summary 为空时仅 suggestion）
 * 标记 isBriefing=true，渲染时显示「局势简报」角标 + 浅色背景区分。
 *
 * 注意：失败降级时 briefing 为 null（game-main onBriefing 传 null），
 *      此时 FocusPanel 使用规则 suggestion 兜底，AdvisorDrawer 不插入消息。
 */
function maybeInsertBriefing(): void {
  if (!store.currentSave) return
  if (!briefing.value || briefingTurn.value === null) return
  // 本回合已展示过，跳过
  if (lastShownBriefingTurn.value === briefingTurn.value) return

  const b = briefing.value
  const content = b.summary
    ? `${b.summary}\n\n${b.suggestion}`
    : b.suggestion

  // 简报超时降级时后端返回空 summary/suggestion（HTTP 200 非错误），
  // 空 content 消息会污染存档：后续军师对话携带它会被 server zod 校验
  // （content min(1)）拒绝为 400，导致对话永久失败。此处直接跳过插入。
  if (!content.trim()) {
    lastShownBriefingTurn.value = briefingTurn.value
    return
  }

  const briefingMessage: AdvisorMessage = {
    role: 'assistant',
    content,
    turn: briefingTurn.value,
    timestamp: Date.now(),
    isBriefing: true
  }
  store.appendAdvisorMessage(briefingMessage)
  lastShownBriefingTurn.value = briefingTurn.value
}

/** 关闭抽屉（流式中先 abort） */
function onClose(): void {
  if (isStreaming.value) {
    abort()
  }
  emit('close')
}

/** 发送消息 */
async function onSend(): Promise<void> {
  if (!canSend.value) return
  const content = input.value.trim()
  input.value = ''
  await send(content)
}

/**
 * 消息列表或流式文本变化时，自动滚动到底部
 */
async function scrollToBottom(): Promise<void> {
  await nextTick()
  // uni-app scroll-view 通过改变 scroll-top 触发滚动
  // 两次赋值（先大值后小值）的 hack 在某些端不通用，改用单调递增 + 短延迟
  const next = scrollTop.value === 99998 ? 99999 : 99998
  scrollTop.value = next
}

watch(
  () => [messages.value.length, streamingText.value, isStreaming.value] as const,
  () => {
    void scrollToBottom()
  }
)

// 抽屉打开时：锁定底层滚动 + 重置输入 + T2.6 自动插入局势简报（本回合未展示过时） + 滚动到底部
// 抽屉关闭时：解锁底层滚动
watch(
  () => props.visible,
  (v) => {
    if (v) {
      lock()
      input.value = ''
      maybeInsertBriefing()
      void scrollToBottom()
    } else {
      unlock()
    }
  }
)

// 组件卸载时确保解锁（防止异常卸载导致滚动永久锁定）
onUnmounted(unlock)
</script>

<style lang="scss" scoped>
.advisor-drawer {
  position: fixed;
  inset: 0;
  z-index: 100;

  &__mask {
    position: absolute;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.5);
    animation: advisor-drawer-fade 200ms ease;
  }

  &__panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    width: 85%;
    max-width: 680rpx;
    background-color: #fdf6e3;
    border-left: 2rpx solid #8b1a1a;
    box-shadow: -8rpx 0 24rpx rgba(0, 0, 0, 0.1);
    // 右侧滑入 300ms（T6.1 规范）
    animation: advisor-drawer-slide-in 300ms ease;
  }

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 24rpx;
    background-color: #8b1a1a;
  }

  &__title {
    font-size: 32rpx;
    font-weight: 600;
    color: #fff;
  }

  &__close {
    // 关闭按钮触摸目标 ≥ 36px（AGENTS.md 图标按钮规范）
    min-width: 36px;
    min-height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    border-radius: 8rpx;
    transition: background-color 150ms ease, transform 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: rgba(255, 255, 255, 0.15);
    }
  }

  &__messages {
    flex: 1;
    // 需要明确高度让 flex 子项收缩
    min-height: 0;
    padding: 16rpx;
    overflow: auto;
  }

  &__empty {
    padding: 64rpx 24rpx;
    text-align: center;
  }

  &__empty-text {
    font-size: 26rpx;
    color: #8d6e63;
    font-style: italic;
  }

  &__waiting {
    display: flex;
    gap: 12rpx;
    align-items: center;
    padding: 16rpx 24rpx;
  }

  &__waiting-text {
    font-size: 24rpx;
    color: #8d6e63;
  }

  &__dot-flashing {
    width: 12rpx;
    height: 12rpx;
    background-color: #8b1a1a;
    border-radius: 50%;
    animation: advisor-drawer-blink 1s linear infinite;
  }

  // T2.5：工具调用过程展示（对话区上方，始终可见，max-height 可滚动）
  .advisor-tools {
    max-height: 300rpx;
    overflow-y: auto;
    margin: 0 16rpx;
    padding: 8rpx 12rpx;
    background-color: #faf7f0;
    border: 2rpx solid #e8ddc4;
    border-radius: 12rpx;
  }

  .advisor-tool {
    // 触摸目标 ≥ 44px（88rpx），满足 AGENTS.md 输入区按钮规范（可点击展开详情）
    min-height: 88rpx;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 12rpx 16rpx;
    margin-bottom: 8rpx;
    border-radius: 8rpx;
    background-color: #f5f5f5; // 调用中：浅灰
    border-left: 6rpx solid #bdbdbd;
    transition: opacity 150ms ease, transform 150ms ease;

    &:last-child {
      margin-bottom: 0;
    }

    &:active {
      transform: scale(0.98);
    }

    &__head {
      display: flex;
      align-items: center;
      gap: 12rpx;
    }

    &__icon {
      width: 28rpx;
      height: 28rpx;
      flex-shrink: 0;
      color: #616161; // 调用中图标色（配合 SVG fill=currentColor）
    }

    &__label {
      font-size: 24rpx;
      color: #424242;
    }

    &__detail {
      margin-top: 8rpx;
      padding-top: 8rpx;
      border-top: 2rpx dashed #cfcfcf;
    }

    &__detail-line {
      display: block;
      font-size: 20rpx;
      line-height: 1.5;
      color: #666;
      word-break: break-all;
      white-space: pre-wrap;
    }

    // 完成：浅绿 + ✓
    &--done {
      background-color: #e8f5e9;
      border-left-color: #66bb6a;

      .advisor-tool__icon {
        color: #2e7d32;
      }

      .advisor-tool__label {
        color: #1b5e20;
      }
    }

    // 失败：浅红 + ✗
    &--fail {
      background-color: #ffebee;
      border-left-color: #ef5350;

      .advisor-tool__icon {
        color: #c62828;
      }

      .advisor-tool__label {
        color: #b71c1c;
      }
    }

    // 点击反馈（三态通用，不改底色避免与状态色冲突）
    &--hover {
      opacity: 0.85;
    }
  }

  &__footer {
    display: flex;
    gap: 12rpx;
    align-items: flex-end;
    padding: 16rpx 24rpx;
    background-color: #f5e6c8;
    border-top: 2rpx solid #d4c5a0;
  }

  &__textarea {
    flex: 1;
    min-height: 44px;
    max-height: 200rpx;
    padding: 16rpx;
    font-size: 28rpx;
    line-height: 1.5;
    color: #2c1810;
    background-color: #fff;
    border: 2rpx solid #d4c5a0;
    border-radius: 8rpx;
  }

  &__send {
    // 发送按钮 ≥ 44px（AGENTS.md 输入区按钮规范）
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 24rpx;
    background-color: #8b1a1a;
    border-radius: 8rpx;
    transition: background-color 150ms ease, transform 150ms ease, opacity 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: #6b1313;
    }

    &--disabled {
      opacity: 0.5;
    }

    &--loading {
      opacity: 0.8;
    }

    &-text {
      font-size: 28rpx;
      color: #fff;
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
      border: 4rpx solid rgba(255, 255, 255, 0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: advisor-drawer-spin 0.8s linear infinite;
    }
  }
}

.advisor-msg {
  max-width: 85%;
  margin-bottom: 12rpx;
  padding: 16rpx 20rpx;
  border-radius: 12rpx;
  word-break: break-all;

  &--user {
    align-self: flex-end;
    margin-left: auto;
    background-color: #8b1a1a;

    .advisor-msg__content {
      color: #fff;
    }
  }

  &--assistant {
    align-self: flex-start;
    margin-right: auto;
    background-color: #f5e6c8;

    .advisor-msg__content {
      color: #2c1810;
    }
  }

  // T2.6：局势简报消息（浅色背景 + 左侧金色 border + 角标）
  &--briefing {
    align-self: flex-start;
    margin-right: auto;
    // 比 assistant 更浅的金色，配合左侧金色 border 强调「局势简报」
    background-color: #fff8e1;
    border-left: 6rpx solid #c9a063;
    padding-left: 24rpx;

    .advisor-msg__content {
      color: #5d4037;
      // 简报内容稍大，便于阅读
      font-size: 29rpx;
      line-height: 1.7;
    }
  }

  // T2.6：局势简报角标容器（view 独占一行，宽度自适应内容）
  &__badge {
    width: fit-content;
    margin-bottom: 8rpx;
    padding: 4rpx 12rpx;
    background-color: #c9a063;
    border-radius: 4rpx;
  }

  // T2.6：局势简报角标文字
  &__badge-text {
    font-size: 20rpx;
    font-weight: 600;
    color: #fff;
  }

  &__content {
    display: inline;
    font-size: 28rpx;
    line-height: 1.6;
  }

  &__cursor {
    display: inline-block;
    margin-left: 4rpx;
    font-size: 28rpx;
    color: #8b1a1a;
    animation: advisor-drawer-blink 1s steps(2, start) infinite;
  }
}

@keyframes advisor-drawer-fade {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@keyframes advisor-drawer-slide-in {
  from {
    transform: translateX(100%);
  }

  to {
    transform: translateX(0);
  }
}

@keyframes advisor-drawer-blink {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.2;
  }
}

@keyframes advisor-drawer-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
