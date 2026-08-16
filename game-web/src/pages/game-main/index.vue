<template>
  <view class="game-main">
    <!-- 顶部状态栏 -->
    <view class="game-main__header">
      <view class="game-main__header-info">
        <text class="game-main__turn">第 {{ currentTurn }} 回合</text>
        <text class="game-main__date">{{ gameDate }}</text>
      </view>
      <TooltipView :content="TOOLTIP_TEXT.sync" placement="bottom">
        <view
          class="game-main__sync-btn"
          :class="{ 'game-main__sync-btn--disabled': isSyncing || isProcessingTurn }"
          :hover-class="!isSyncing && !isProcessingTurn ? 'game-main__sync-btn--hover' : ''"
          :hover-stay-time="100"
          @click="onSync"
        >
          <view v-if="isSyncing" class="game-main__sync-spinner">
            <view class="game-main__sync-dot" />
          </view>
          <text v-else class="game-main__sync-text">同步</text>
        </view>
      </TooltipView>
    </view>

    <!-- T1.15: FocusPanel 顶部固定（在状态栏下、滚动区上，始终可见）
         综合实力进度条 + 危机预警 + AI 军师建议 -->
    <view v-if="save" class="game-main__focus-panel">
      <FocusPanel
        :attributes="save.state.attributes"
        :briefing="briefing"
        :pending-chain-nodes="save.pendingChainNodes"
      />
    </view>

    <!-- 主内容滚动区 -->
    <scroll-view class="game-main__body" scroll-y>
      <!-- T2.2: 事件区置顶（始终展开，玩家进入即看到当前事件并决策） -->
      <view v-if="currentEvent" class="game-main__section game-main__section--event">
        <EventCard
          :event="currentEvent"
          :selected-option-id="store.selectedOptionId"
          :disabled="hasDecided || isProcessingTurn"
          @select="onSelectOption"
        />
      </view>

      <!-- 自由行动输入（事件区下方，作为决策的替代方式） -->
      <view v-if="showFreeInput" class="game-main__section game-main__free-input">
        <text class="game-main__free-input-title">{{ PAGE_TEXT.gameMain.freeActionTitle }}</text>
        <textarea
          v-model="freeInput"
          class="game-main__free-input-area"
          :placeholder="PAGE_TEXT.gameMain.freeActionPlaceholder"
          :maxlength="200"
          :auto-height="true"
          :cursor-spacing="20"
        />
        <view class="game-main__free-input-actions">
          <view
            class="game-main__btn game-main__btn--ghost"
            :hover-class="'game-main__btn--hover'"
            :hover-stay-time="100"
            @click="onCancelFreeInput"
          >
            <text class="game-main__btn-text">{{ PAGE_TEXT.gameMain.freeActionCancel }}</text>
          </view>
          <view
            class="game-main__btn game-main__btn--primary"
            :class="{ 'game-main__btn--disabled': !freeInput.trim() || isProcessingTurn }"
            :hover-class="freeInput.trim() && !isProcessingTurn ? 'game-main__btn--hover' : ''"
            :hover-stay-time="100"
            @click="onSubmitFreeInput"
          >
            <view v-if="isProcessingTurn" class="game-main__btn-spinner">
              <view class="game-main__btn-dot" />
            </view>
            <text v-else class="game-main__btn-text">{{ PAGE_TEXT.gameMain.freeActionSubmit }}</text>
          </view>
        </view>
      </view>

      <!-- 阶段提示（无事件时显示当前阶段建议） -->
      <view v-if="!currentEvent && !isProcessingTurn" class="game-main__section game-main__hint">
        <text class="game-main__hint-text">{{ phaseHint }}</text>
      </view>

      <!-- 阶段 spinner（推演中显示进度） -->
      <view v-if="isProcessingTurn" class="game-main__section game-main__loading">
        <view class="game-main__loading-dot" />
        <text class="game-main__loading-text">{{ processingStage }}</text>
      </view>

      <!-- T2.2: 状态区（CollapsibleSection 包裹，默认展开，玩家可查看属性资源） -->
      <view v-if="save" class="game-main__section game-main__section--status">
        <CollapsibleSection
          :title="PAGE_TEXT.sections.status"
          :default-expanded="true"
        >
          <StatusPanel
            :attributes="save.state.attributes"
            :resources="save.state.resources"
          />
        </CollapsibleSection>
      </view>

      <!-- T2.2: 天下动静（CollapsibleSection 包裹，默认折叠；成功行动或失败势力任一非空即展示） -->
      <view v-if="npcActions.length > 0 || npcFailedFactionIds.length > 0" class="game-main__section">
        <CollapsibleSection
          :title="PAGE_TEXT.sections.npcActions"
          :default-expanded="false"
        >
          <NpcActionList
            :actions="npcActions"
            :failed-faction-ids="npcFailedFactionIds"
          />
        </CollapsibleSection>
      </view>

      <!-- T2.2: 近况时间线（CollapsibleSection 包裹，默认折叠） -->
      <view v-if="historyEvents.length > 0" class="game-main__section">
        <CollapsibleSection
          :title="PAGE_TEXT.sections.timeline"
          :default-expanded="false"
        >
          <TurnTimeline :events="historyEvents" :limit="5" />
        </CollapsibleSection>
      </view>

      <!-- T1.15: GoalPanel 滚动区底部（可折叠，默认折叠）
           长期目标 + 胜利/失败条件 + 综合实力进度条（90 阈值刻度） -->
      <view v-if="save" class="game-main__section game-main__goal-panel">
        <GoalPanel :attributes="save.state.attributes" :default-expanded="false" />
      </view>

      <!-- 底部留白（避免被固定底栏遮挡） -->
      <view class="game-main__body-pad" />
    </scroll-view>

    <!-- 底部操作栏 -->
    <view class="game-main__footer">
      <!-- 外交入口（次级操作，常驻，独立于事件决策） -->
      <view
        class="game-main__footer-btn game-main__footer-btn--diplomacy"
        role="button"
        aria-label="外交"
        tabindex="0"
        :hover-class="!isProcessingTurn ? 'game-main__footer-btn--hover' : ''"
        :hover-stay-time="100"
        @click="onOpenDiplomacy"
        @keydown.enter.prevent="onOpenDiplomacy"
        @keydown.space.prevent="onOpenDiplomacy"
      >
        <text class="game-main__footer-btn-text">{{ BUTTON_TEXT.diplomacy }}</text>
      </view>

      <TooltipView :content="TOOLTIP_TEXT.advisor" placement="top">
        <view
          class="game-main__footer-btn game-main__footer-btn--advisor"
          role="button"
          aria-label="打开军师"
          tabindex="0"
          :hover-class="!isProcessingTurn ? 'game-main__footer-btn--hover' : ''"
          :hover-stay-time="100"
          @click="onOpenAdvisor"
          @keydown.enter.prevent="onOpenAdvisor"
          @keydown.space.prevent="onOpenAdvisor"
        >
          <!-- Lucide Icons: feather — 羽扇纶巾意象（诸葛亮式军师），通用开源标准路径 -->
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
            <line x1="16" y1="8" x2="2" y2="22" />
            <line x1="17.5" y1="15" x2="9" y2="15" />
          </svg>
          <text class="game-main__footer-btn-text">军师</text>
        </view>
      </TooltipView>

      <view
        v-if="!hasDecided"
        class="game-main__footer-btn game-main__footer-btn--free"
        role="button"
        aria-label="自由行动"
        tabindex="0"
        :hover-class="!isProcessingTurn ? 'game-main__footer-btn--hover' : ''"
        :hover-stay-time="100"
        @click="onShowFreeInput"
        @keydown.enter.prevent="onShowFreeInput"
        @keydown.space.prevent="onShowFreeInput"
      >
        <text class="game-main__footer-btn-text">自由行动</text>
      </view>

      <view
        v-if="!hasDecided"
        class="game-main__footer-btn game-main__footer-btn--confirm"
        role="button"
        :aria-label="canConfirm ? '确认决策' : '请先选择一个决策选项'"
        :aria-disabled="!canConfirm"
        tabindex="0"
        :class="{ 'game-main__footer-btn--disabled': !canConfirm }"
        :hover-class="canConfirm ? 'game-main__footer-btn--hover' : ''"
        :hover-stay-time="100"
        @click="onConfirmDecision"
        @keydown.enter.prevent="onConfirmDecision"
        @keydown.space.prevent="onConfirmDecision"
      >
        <text class="game-main__footer-btn-text">确认决策</text>
      </view>

      <view
        v-else
        class="game-main__footer-btn game-main__footer-btn--next"
        role="button"
        :aria-label="isProcessingTurn ? '回合推进中' : '进入下一回合'"
        :aria-disabled="isProcessingTurn"
        tabindex="0"
        :class="{ 'game-main__footer-btn--disabled': isProcessingTurn }"
        :hover-class="!isProcessingTurn ? 'game-main__footer-btn--hover' : ''"
        :hover-stay-time="100"
        @click="onNextTurn"
        @keydown.enter.prevent="onNextTurn"
        @keydown.space.prevent="onNextTurn"
      >
        <view v-if="isProcessingTurn" class="game-main__btn-spinner">
          <view class="game-main__btn-dot" />
        </view>
        <text v-else class="game-main__footer-btn-text">下一回合</text>
      </view>
    </view>

    <!-- 军师抽屉 -->
    <AdvisorDrawer :visible="showAdvisor" @close="onCloseAdvisor" />

    <!-- 外交面板抽屉（player-active-diplomacy 提案 T3） -->
    <view
      v-if="showDiplomacy"
      class="game-main__diplomacy-mask"
      @click="onCloseDiplomacy"
    >
      <view class="game-main__diplomacy-drawer" @click.stop>
        <DiplomacyPanel @close="onCloseDiplomacy" />
      </view>
    </view>

    <!-- 全局确认对话框 + Toast 提示（uni-app H5 端 App.vue template 被忽略，必须在每个页面挂载） -->
    <ConfirmDialog />
    <ToastContainer />

    <!-- T1.15: 新手引导覆盖层（SSR 安全：mounted + isOnboarding 双守卫）
         首次进入游戏时弹出 6 步引导，markDone/skip 后不再显示 -->
    <OnboardingOverlay
      v-if="mounted && isOnboarding"
      :steps="ONBOARDING_STEPS"
      :target-selectors="ONBOARDING_TARGET_SELECTORS"
      @complete="onOnboardingComplete"
      @skip="onOnboardingSkip"
    />
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useGameState } from '@/composables/useGameState'
import { useTurn, type AdvisorBriefing } from '@/composables/useTurn'
import { useAdvisor } from '@/composables/useAdvisor'
import { useSaveSync } from '@/composables/useSaveSync'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useToast } from '@/composables/useToast'
import { useOnboarding } from '@/composables/useOnboarding'
import { useGameStore } from '@/stores/game'
import StatusPanel from '@/components/StatusPanel.vue'
import TurnTimeline from '@/components/TurnTimeline.vue'
import EventCard from '@/components/EventCard.vue'
import NpcActionList from '@/components/NpcActionList.vue'
import AdvisorDrawer from '@/components/AdvisorDrawer.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import FocusPanel from '@/components/FocusPanel.vue'
import GoalPanel from '@/components/GoalPanel.vue'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import TooltipView from '@/components/TooltipView.vue'
import DiplomacyPanel from '@/components/DiplomacyPanel.vue'
import OnboardingOverlay, {
  type OnboardingStep
} from '@/components/OnboardingOverlay.vue'
import { PAGE_TEXT, PHASE_HINTS, TOOLTIP_TEXT, ERROR_TEXT, BUTTON_TEXT } from '@/utils/copywriting'
import { getCrisis } from '@/utils/goal-hint'
import type { HistoryEvent } from '@/types/game'

const { load } = useGameState()
const { confirm } = useConfirmDialog()
const toast = useToast()
const store = useGameStore()
const { isOnboarding, checkAndStart, markDone, skip } = useOnboarding()

/** 处理阶段文案（用于 spinner 提示） */
const processingStage = ref('')

/**
 * T1.15 AI 军师简报（由 useTurn.startTurn 内调 /api/game/advisor-briefing 获取）
 *
 * 初始 null，FocusPanel 收到 null 时使用规则 suggestion 兜底。
 * 每次 startTurn 后会通过 onBriefing 回调更新（成功传 briefing，失败传 null）。
 */
const briefing = ref<AdvisorBriefing | null>(null)

/**
 * SSR 安全标志：onMounted 后设 true
 *
 * 用于 OnboardingOverlay 的 v-if 守卫，避免 SSR 渲染与客户端不一致导致水合不匹配。
 * （OnboardingOverlay 内部依赖 window/document 查询元素位置，SSR 阶段不应渲染）
 */
const mounted = ref(false)

/**
 * T2.6：useAdvisor 仅取 setBriefing（写入模块级单例，供 AdvisorDrawer 读取）
 *
 * game-main 不需要 send/abort 等流式功能（那些在 AdvisorDrawer 内调用 useAdvisor），
 * 仅在 useTurn onBriefing 回调中将简报写入模块级单例 briefing ref。
 */
const { setBriefing: setAdvisorBriefing } = useAdvisor()

const { startTurn, makeDecision, endTurn } = useTurn({
  // T3.4：错误文案白话化（技术错误码 console.error 保留，不展示给玩家）
  onError: (stage, message) => {
    console.error(`[useTurn] ${stage} 失败:`, message)
    if (stage === 'startTurn') {
      toast.error(ERROR_TEXT.startTurnFailed)
    } else if (stage === 'makeDecision') {
      toast.error(ERROR_TEXT.networkError)
    } else if (stage === 'endTurn') {
      toast.error(ERROR_TEXT.networkError)
    } else {
      toast.error(ERROR_TEXT.networkError)
    }
  },
  onTurnEnd: () => {
    // T7.3 自动同步：检查 auto_sync 开关
    if (uni.getStorageSync('auto_sync') === true) {
      void autoSync()
    }
  },
  // T1.15：危机检查回调（属性 <30 触发 toast.warning）
  onCrisis: (crisis) => {
    toast.warning(`${crisis.name} ${crisis.value}（濒临崩溃，建议优先应对）`)
  },
  // T1.15+T2.6：AI 简报回调（成功传 briefing，失败传 null）
  //   - 写入本地 briefing ref（FocusPanel 用于展示 suggestion）
  //   - 同步到 useAdvisor 模块级单例（AdvisorDrawer 打开时插入「局势简报」消息）
  onBriefing: (b) => {
    briefing.value = b
    if (store.currentSave) {
      setAdvisorBriefing(b, store.currentSave.state.turn)
    }
  }
})

const { sync, isSyncing } = useSaveSync({
  confirmOverwrite: async (cloudTs) => {
    const cloudDate = new Date(cloudTs).toLocaleString('zh-CN')
    return confirm({
      title: '云端存档较新',
      message: `云端存档更新时间：${cloudDate}\n是否拉取覆盖本地？`,
      confirmText: '拉取云端',
      cancelText: '保留本地'
    })
  },
  onSuccess: (msg) => toast.success(msg),
  onError: (msg) => toast.error(msg)
})

/** 自动同步（静默失败，不打扰玩家） */
async function autoSync(): Promise<void> {
  try {
    await sync()
  } catch (err) {
    console.error('[game-main] 自动同步失败:', err)
  }
}

// ====================== 响应式状态 ======================
const showAdvisor = ref(false)
const showDiplomacy = ref(false)
const showFreeInput = ref(false)
const freeInput = ref('')
// T3.1：selectedOptionId 移至 store（跨组件同步，EventCard 内 DecisionButton 读取）
const decided = ref(false)
/** 决策描述（用于 endTurn 的历史记录） */
const decisionDescription = ref('')

// ====================== 新手引导数据（T1.15） ======================
/**
 * 6 步新手引导内容（数据驱动，OnboardingOverlay 消费）
 *
 * targetKey 对应 ONBOARDING_TARGET_SELECTORS 中的 CSS 选择器键。
 * null/undefined 表示该步无高亮，居中显示卡片。
 */
const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    title: '欢迎来到金田：1851',
    content:
      '你将扮演一方势力领袖，在 1851-1912 的动荡年代里，通过每回合的决策成就霸业。本引导将用 6 步介绍核心玩法。',
    targetKey: null
  },
  {
    title: '状态面板',
    content:
      '5 维属性（军事/经济/政治/民心/外交）+ 4 资源（银两/兵员/粮草/名望）。任一属性 ≤ 0 即游戏失败，需时刻关注。',
    targetKey: 'status-panel'
  },
  {
    title: '当前焦点',
    content:
      '顶部常驻 FocusPanel：综合实力进度条（达到 90 胜利）、危机预警（属性 <30 红色高亮）、本回合建议（AI 军师生成）。',
    targetKey: 'focus-panel'
  },
  {
    title: '事件卡片',
    content:
      '每回合 AI 生成历史事件，提供 2-3 个选项。点击选项即决策；也可点底部「自由行动」自己描述想做的事。',
    targetKey: 'event-card'
  },
  {
    title: '军师对话',
    content: '随时点底部「军师」按钮咨询 AI 军师，比如「我该优先发展什么？」「当前局势如何？」。',
    targetKey: 'footer-advisor'
  },
  {
    title: '游戏目标',
    content: '底部可折叠 GoalPanel：长期目标是综合实力 ≥ 90（胜利），任一属性 ≤ 0（失败）。点击可展开查看详情。',
    targetKey: 'goal-panel'
  }
]

/**
 * 各引导步骤对应的 CSS 选择器（OnboardingOverlay 用 getElementRect 查询元素位置）
 *
 * 注意：选择器必须能匹配到 game-main 内实际渲染的元素，否则 OnboardingOverlay 会降级居中显示卡片。
 */
const ONBOARDING_TARGET_SELECTORS: Record<string, string> = {
  'status-panel': '.game-main__section--status',
  'focus-panel': '.game-main__focus-panel',
  'event-card': '.game-main__section--event',
  'footer-advisor': '.game-main__footer-btn--advisor',
  'goal-panel': '.game-main__goal-panel'
}

/** 引导完成回调（最后一步点「开始游戏」） */
function onOnboardingComplete(): void {
  markDone()
  // T2.2: 引导完成后启动首回合（onMounted 中跳过了 startTurn）
  void refreshAndStartTurn()
}

/** 引导跳过回调（点「跳过」按钮） */
function onOnboardingSkip(): void {
  skip()
  // T2.2: 跳过引导也启动首回合
  void refreshAndStartTurn()
}

// ====================== 计算属性 ======================
const save = computed(() => store.currentSave)
const currentTurn = computed(() => store.currentTurn)
const currentEvent = computed(() => store.currentEvent)
const npcActions = computed(() => store.npcActions)
const npcFailedFactionIds = computed(() => store.npcFailedFactionIds)
const isProcessingTurn = computed(() => store.isProcessingTurn)
const historyEvents = computed<HistoryEvent[]>(() => store.currentSave?.events ?? [])

const gameDate = computed(() => {
  const d = store.currentSave?.state.date
  return d ? `${d.year} 年 ${d.month} 月` : ''
})

const hasDecided = computed(() => decided.value)

/** T3.1：是否可确认决策（选了选项或输入了自由文本，且未在处理中/已决策） */
const canConfirm = computed(
  () =>
    (store.selectedOptionId !== null || freeInput.value.trim().length > 0) &&
    !isProcessingTurn.value &&
    !decided.value
)

/**
 * 阶段提示（T1.15 改用 PHASE_HINTS，含危机后缀）
 *
 * - 已决策 → decided
 * - 有事件 → awaitingDecision（存在危机时追加 crisisSuffix）
 * - 推演中 → thinking
 */
const phaseHint = computed(() => {
  if (hasDecided.value) return PHASE_HINTS.decided
  if (currentEvent.value) {
    const attrs = store.currentSave?.state.attributes
    const crisis = attrs ? getCrisis(attrs) : null
    if (crisis) {
      return PHASE_HINTS.awaitingDecision + PHASE_HINTS.crisisSuffix(crisis.name)
    }
    return PHASE_HINTS.awaitingDecision
  }
  return PHASE_HINTS.thinking
})

// ====================== 生命周期 ======================
onMounted(async () => {
  // SSR 安全：mounted 标志置 true，允许 OnboardingOverlay 渲染
  mounted.value = true
  // T1.15：检查是否首次进入，启动新手引导
  checkAndStart()
  // T2.2: 引导激活时不立即 startTurn，等引导完成/跳过后才启动
  // 非首次进入（已 markDone）直接启动首回合
  if (!isOnboarding.value) {
    await refreshAndStartTurn()
  }
})

onShow(async () => {
  // 从其他页面返回时，若存档丢失则跳回首页
  if (!store.currentSave) {
    const s = await load()
    if (!s) {
      uni.redirectTo({ url: '/pages/index/index' })
      return
    }
  }
})

async function refreshAndStartTurn(): Promise<void> {
  if (!store.currentSave) {
    const s = await load()
    if (!s) {
      uni.redirectTo({ url: '/pages/index/index' })
      return
    }
  }

  // 已结束存档直接跳结局页
  if (store.currentSave?.ended) {
    uni.redirectTo({ url: '/pages/end-game/index' })
    return
  }

  // 若无当前回合事件，自动开始新回合
  if (!store.currentEvent) {
    processingStage.value = '事件生成中'
    const event = await startTurn()
    processingStage.value = ''
    if (!event) {
      // T3.4：文案白话化（ERROR_TEXT.eventFailed）
      toast.info(ERROR_TEXT.eventFailed)
    }
  }
}

// ====================== 决策处理 ======================
/**
 * T3.1：选项选中处理（两步交互：仅选中，不直接确认）
 *
 * - 未选中 → 选中该选项（同步清空自由输入，二者互斥）
 * - 已选中同一选项 → 取消选中（反悔重选）
 * - 已选中其他选项 → 切换选中
 */
function onSelectOption(optionId: string): void {
  if (isProcessingTurn.value || hasDecided.value) return
  if (store.selectedOptionId === optionId) {
    // 反悔重选：点已选中项取消选中
    store.setSelectedOptionId(null)
  } else {
    store.setSelectedOptionId(optionId)
    // 选项与自由输入互斥：选中选项时清空自由输入
    freeInput.value = ''
    showFreeInput.value = false
  }
}

function onShowFreeInput(): void {
  if (isProcessingTurn.value || hasDecided.value) return
  showFreeInput.value = true
}

function onCancelFreeInput(): void {
  showFreeInput.value = false
  freeInput.value = ''
}

async function onSubmitFreeInput(): Promise<void> {
  if (!freeInput.value.trim() || isProcessingTurn.value) return
  // 自由输入与选项互斥：提交自由输入时清空选项选中
  store.setSelectedOptionId(null)
  await onConfirmDecision()
}

async function onConfirmDecision(): Promise<void> {
  if (!canConfirm.value) {
    toast.info('请先选择应对方案或输入自由行动')
    return
  }

  let effects
  if (store.selectedOptionId) {
    // 选项决策
    const option = currentEvent.value?.options.find((o) => o.id === store.selectedOptionId)
    if (!option) {
      toast.error('选项已失效')
      return
    }
    effects = await makeDecision(store.selectedOptionId)
    decisionDescription.value = option.label
  } else if (freeInput.value.trim()) {
    // 自由行动
    processingStage.value = '判定中'
    effects = await makeDecision(undefined, freeInput.value.trim())
    processingStage.value = ''
    decisionDescription.value = freeInput.value.trim().slice(0, 50)
  }

  if (effects) {
    decided.value = true
    showFreeInput.value = false
    // T2.3：文案集中管理（PAGE_TEXT.gameMain.decisionApplied）
    toast.success(PAGE_TEXT.gameMain.decisionApplied)
  }
}

// ====================== 下一回合 ======================
async function onNextTurn(): Promise<void> {
  if (isProcessingTurn.value) return

  processingStage.value = 'NPC 行动中'
  await endTurn(decisionDescription.value || '决策')
  processingStage.value = ''

  // 若 endTurn 触发结局，已被 redirectTo 跳转，下面的代码不会执行
  decided.value = false
  store.setSelectedOptionId(null)
  freeInput.value = ''
  decisionDescription.value = ''

  // 开启新一回合
  processingStage.value = '事件生成中'
  const event = await startTurn()
  processingStage.value = ''
  if (!event) {
    // T3.4：文案白话化（ERROR_TEXT.eventRetryFailed）
    toast.info(ERROR_TEXT.eventRetryFailed)
  }
}

// ====================== 同步 ======================
async function onSync(): Promise<void> {
  if (isSyncing.value || isProcessingTurn.value) return
  const result = await sync()
  switch (result.action) {
    case 'uploaded':
    case 'pulled':
      toast.success(result.message)
      break
    case 'noop':
      toast.info(result.message)
      break
    case 'error':
      toast.error(result.message)
      break
  }
}

// ====================== 军师抽屉 ======================
function onOpenAdvisor(): void {
  if (isProcessingTurn.value) return
  showAdvisor.value = true
}

function onCloseAdvisor(): void {
  showAdvisor.value = false
}

// ====================== 外交面板抽屉（player-active-diplomacy 提案 T3） ======================
function onOpenDiplomacy(): void {
  if (isProcessingTurn.value) return
  showDiplomacy.value = true
}

function onCloseDiplomacy(): void {
  showDiplomacy.value = false
}
</script>

<style lang="scss" scoped>
.game-main {
  display: flex;
  flex-direction: column;
  // 显式 100% 宽度：确保在 uni-app H5 的容器嵌套中铺满视口
  width: 100%;
  // min-height 而非 height：允许内容超出时扩展，同时保证至少填满视口
  // 配合 App.vue 中 body/uni-page-body 的同色渐变背景，溢出区域不会显白
  min-height: 100vh;
  // 横向溢出兜底：防止子元素固定最小宽度（如下方按钮 min-width）在窄屏撑破视口
  overflow-x: hidden;
  background: linear-gradient(180deg, #fdf6e3 0%, #f5e6c8 100%);

  // ====================== 顶部状态栏 ======================
  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 24rpx 32rpx;
    background-color: #8b1a1a;
    box-shadow: 0 4rpx 12rpx rgba(139, 26, 26, 0.15);
  }

  &__header-info {
    display: flex;
    flex-direction: column;
    gap: 4rpx;
  }

  &__turn {
    font-size: 30rpx;
    font-weight: 600;
    color: #fff;
    letter-spacing: 2rpx;
  }

  &__date {
    font-size: 24rpx;
    color: rgba(255, 255, 255, 0.8);
  }

  &__sync-btn {
    // 触摸目标 ≥ 36px（用 rpx 跟随视口缩放，避免窄屏下固定 px 撑破宽度）
    min-width: 72rpx;
    min-height: 72rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8rpx 20rpx;
    background-color: rgba(255, 255, 255, 0.15);
    border-radius: 8rpx;
    transition: background-color 150ms ease, transform 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: rgba(255, 255, 255, 0.25);
    }

    &--disabled {
      opacity: 0.65;
      background-color: #e8e0d0;
    }
  }

  &__sync-text {
    font-size: 24rpx;
    color: #fff;
  }

  &__sync-spinner {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28rpx;
    height: 28rpx;
  }

  &__sync-dot {
    width: 24rpx;
    height: 24rpx;
    border: 3rpx solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: game-main-spin 0.8s linear infinite;
  }

  // ====================== 主内容区 ======================
  &__body {
    flex: 1;
    min-height: 0;
    padding: 16rpx 24rpx;
  }

  &__section {
    margin-bottom: 24rpx;
  }

  &__body-pad {
    height: 200rpx;
  }

  // ====================== T1.15: FocusPanel 顶部固定容器 ======================
  &__focus-panel {
    flex-shrink: 0;
    padding: 16rpx 24rpx 8rpx;
    background-color: rgba(253, 246, 227, 0.95);
    border-bottom: 2rpx solid #d4c5a0;
    box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);
  }

  // ====================== T1.15: GoalPanel 底部容器 ======================
  &__goal-panel {
    margin-top: 16rpx;
  }

  // ====================== 自由行动输入 ======================
  &__free-input {
    padding: 24rpx;
    background-color: #fdf6e3;
    border: 2rpx solid #d4c5a0;
    border-radius: 12rpx;
  }

  &__free-input-title {
    display: block;
    margin-bottom: 16rpx;
    font-size: 28rpx;
    font-weight: 600;
    color: #5d4037;
  }

  &__free-input-area {
    width: 100%;
    min-height: 120rpx;
    max-height: 400rpx;
    padding: 16rpx;
    font-size: 28rpx;
    line-height: 1.5;
    color: #2c1810;
    background-color: #fff;
    border: 2rpx solid #d4c5a0;
    border-radius: 8rpx;
  }

  &__free-input-actions {
    display: flex;
    gap: 16rpx;
    margin-top: 16rpx;
  }

  // ====================== 阶段提示与 spinner ======================
  &__hint {
    padding: 48rpx 24rpx;
    text-align: center;
  }

  &__hint-text {
    font-size: 26rpx;
    color: #8d6e63;
    font-style: italic;
  }

  &__loading {
    display: flex;
    flex-direction: column;
    gap: 16rpx;
    align-items: center;
    padding: 48rpx 24rpx;
  }

  &__loading-dot {
    width: 36rpx;
    height: 36rpx;
    border: 4rpx solid rgba(139, 26, 26, 0.2);
    border-top-color: #8b1a1a;
    border-radius: 50%;
    animation: game-main-spin 0.8s linear infinite;
  }

  &__loading-text {
    font-size: 26rpx;
    color: #5d4037;
  }

  // ====================== 通用按钮 ======================
  &__btn {
    flex: 1;
    // 触摸目标 ≥ 44px（用 rpx 跟随视口缩放，避免窄屏下固定 px 撑破宽度）
    min-width: 88rpx;
    min-height: 88rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20rpx 0;
    background-color: #fdf6e3;
    border: 2rpx solid #8b1a1a;
    border-radius: 8rpx;
    transition: background-color 150ms ease, transform 150ms ease, opacity 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: #f5e6c8;
    }

    &--primary {
      background-color: #8b1a1a;

      .game-main__btn-text {
        color: #fff;
      }
    }

    &--ghost {
      background-color: transparent;
      border-color: #d4c5a0;

      .game-main__btn-text {
        color: #5d4037;
      }
    }

    &--disabled {
      opacity: 0.65;
      background-color: #e8e0d0;
      border-color: #c9bda3;

      .game-main__btn-text {
        color: #9e8e76;
      }
    }
  }

  &__btn-text {
    font-size: 28rpx;
    font-weight: 500;
    color: #2c1810;
  }

  &__btn-spinner {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36rpx;
    height: 36rpx;
  }

  &__btn-dot {
    width: 28rpx;
    height: 28rpx;
    border: 4rpx solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: game-main-spin 0.8s linear infinite;
  }

  // ====================== 底部操作栏 ======================
  &__footer {
    display: flex;
    gap: 16rpx;
    padding: 16rpx 24rpx;
    // 比内容区略深的米色，拉开与滚动区的层次，强化固定底栏分隔感
    background-color: #f5e6c8;
    border-top: 2rpx solid #d4c5a0;
    box-shadow: 0 -6rpx 16rpx rgba(139, 26, 26, 0.12);
  }

  &__footer-btn {
    flex: 1;
    // 触摸目标 ≥ 44px（用 rpx 跟随视口缩放，避免窄屏下固定 px 撑破宽度）
    min-width: 88rpx;
    min-height: 88rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8rpx;
    padding: 20rpx 0;
    background-color: #fdf6e3;
    border: 2rpx solid #8b1a1a;
    border-radius: 8rpx;
    color: #8b1a1a;
    transition: background-color 150ms ease, transform 150ms ease, opacity 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: #f5e6c8;
    }

    &--disabled {
      opacity: 0.65;
      background-color: #e8e0d0;
      color: #9e8e76;
      border-color: #c9bda3;

      .game-main__footer-btn-text {
        color: #9e8e76;
      }
    }

    &--advisor {
      flex: 0 0 auto;
      min-width: 120rpx;
      padding: 20rpx 24rpx;
    }

    &--confirm,
    &--next {
      background-color: #8b1a1a;

      .game-main__footer-btn-text {
        color: #fff;
      }
    }

    &--free {
      background-color: #fdf6e3;
    }

    &--diplomacy {
      background-color: #fdf6e3;
    }

    &-text {
      font-size: 28rpx;
      font-weight: 500;
      color: #2c1810;
    }
  }

  // ====================== 外交面板抽屉（player-active-diplomacy 提案 T3） ======================
  &__diplomacy-mask {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 100;
    display: flex;
    align-items: flex-end;
    background-color: rgba(0, 0, 0, 0.45);
  }

  &__diplomacy-drawer {
    width: 100%;
    max-height: 80vh;
    background-color: #fdf6e3;
    border-top-left-radius: 24rpx;
    border-top-right-radius: 24rpx;
    box-shadow: 0 -8rpx 24rpx rgba(0, 0, 0, 0.18);
  }
}

@keyframes game-main-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
