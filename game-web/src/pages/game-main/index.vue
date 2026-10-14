<template>
  <view class="game-main">
    <!-- 顶部状态栏 -->
    <view class="game-main__header">
      <!-- 返回（自定义导航无原生返回键，需自绘） -->
      <TooltipView :content="TOOLTIP_TEXT.back" placement="bottom">
        <view
          class="game-main__back"
          role="button"
          aria-label="返回"
          tabindex="0"
          :hover-class="'game-main__back--hover'"
          :hover-stay-time="100"
          @click="onBack"
          @keydown.enter.prevent="onBack"
          @keydown.space.prevent="onBack"
        >
          <AppIcon name="arrow-back" :size="22" color="#fff" />
        </view>
      </TooltipView>

      <view class="game-main__header-info">
        <text class="game-main__turn">第 {{ currentTurn }} 回合</text>
        <text class="game-main__date">{{ gameDate }}</text>
      </view>

      <view class="game-main__header-actions">
        <!-- P0-6 帮助入口：跳转「如何游戏」页 -->
        <TooltipView :content="TOOLTIP_TEXT.help" placement="bottom">
          <view
            class="game-main__help-btn"
            role="button"
            aria-label="如何游戏"
            tabindex="0"
            :hover-class="'game-main__help-btn--hover'"
            :hover-stay-time="100"
            @click="onOpenHelp"
            @keydown.enter.prevent="onOpenHelp"
            @keydown.space.prevent="onOpenHelp"
          >
            <text class="game-main__help-text">?</text>
          </view>
        </TooltipView>
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

      <!-- 决策应用反馈区（T4：自由行动对势力的软性微调提示，复用决策已应用态） -->
      <view
        v-if="hasDecided && store.lastFreeFactionEffects.length > 0"
        class="game-main__section game-main__faction-feedback"
      >
        <text class="game-main__faction-feedback-title">{{ PAGE_TEXT.gameMain.factionEffectTitle }}</text>
        <view
          v-for="(fe, idx) in store.lastFreeFactionEffects"
          :key="idx"
          class="game-main__faction-feedback-item"
        >
          <text class="game-main__faction-feedback-name">{{ fe.name }}</text>
          <text
            v-if="fe.relationshipDelta !== undefined"
            class="game-main__faction-feedback-delta"
            :class="fe.relationshipDelta >= 0 ? 'game-main__faction-feedback--up' : 'game-main__faction-feedback--down'"
          >关系 {{ fe.relationshipDelta >= 0 ? '+' : '' }}{{ fe.relationshipDelta }}</text>
          <text
            v-if="fe.powerDelta !== undefined"
            class="game-main__faction-feedback-delta"
            :class="fe.powerDelta >= 0 ? 'game-main__faction-feedback--up' : 'game-main__faction-feedback--down'"
          >实力 {{ fe.powerDelta >= 0 ? '+' : '' }}{{ fe.powerDelta }}</text>
        </view>
      </view>

      <!-- 阶段提示（无事件时显示当前阶段建议；推演失败时展示重试按钮 P0-4） -->
      <view v-if="!currentEvent && !isProcessingTurn" class="game-main__section game-main__hint">
        <text class="game-main__hint-text">{{ eventFailed ? ERROR_TEXT.eventRetryFailed : phaseHint }}</text>
        <view
          v-if="eventFailed"
          class="game-main__retry-btn"
          role="button"
          :aria-label="BUTTON_TEXT.retryEvent"
          tabindex="0"
          :hover-class="'game-main__retry-btn--hover'"
          :hover-stay-time="100"
          @click="onRetryEvent"
          @keydown.enter.prevent="onRetryEvent"
          @keydown.space.prevent="onRetryEvent"
        >
          <text class="game-main__retry-text">{{ BUTTON_TEXT.retryEvent }}</text>
        </view>
      </view>

      <!-- 阶段 spinner（推演中显示进度） -->
      <view v-if="isProcessingTurn" class="game-main__section game-main__loading">
        <view class="game-main__loading-dot" />
        <text class="game-main__loading-text">{{ processingStage || PAGE_TEXT.gameMain.processingFallback }}</text>
        <!-- 流式生成进度：实时展示已生成的事件文本，避免玩家干等无反馈 -->
        <text v-if="eventStreamText" class="game-main__loading-stream">{{ eventStreamText }}</text>
      </view>

      <!-- T2.2: 状态区（CollapsibleSection 包裹，默认折叠，玩家可查看属性资源） -->
      <view v-if="save" class="game-main__section game-main__section--status">
        <CollapsibleSection
          :title="PAGE_TEXT.sections.status"
          :default-expanded="false"
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
           长期目标 + 胜利/失败条件（综合实力进度条已在 FocusPanel 顶部单处展示） -->
      <view v-if="save" class="game-main__section game-main__goal-panel">
        <GoalPanel :default-expanded="false" />
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
          <image
            class="game-main__footer-btn-icon game-main__footer-btn-icon--advisor"
            src="/static/advisor-icon.png"
            mode="aspectFill"
          />
          <text class="game-main__footer-btn-text">{{ BUTTON_TEXT.advisor }}</text>
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
        <text class="game-main__footer-btn-text">{{ BUTTON_TEXT.freeAction }}</text>
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
        <text class="game-main__footer-btn-text">{{ BUTTON_TEXT.confirmDecision }}</text>
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
        <text v-else class="game-main__footer-btn-text">{{ BUTTON_TEXT.nextTurn }}</text>
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
        <DiplomacyPanel
          @close="onCloseDiplomacy"
          @negotiate="onNegotiate"
        />
      </view>
    </view>

    <!-- 谈判弹窗（faction-negotiation 提案 T6）：写信 → 回信 → 接受/还价/放弃 -->
    <view
      v-if="showNegotiation && negotiationFaction"
      class="game-main__negotiation-mask"
      @click="onCloseNegotiation"
    >
      <view class="game-main__negotiation-wrap" @click.stop>
        <NegotiationDialog
          :key="negotiationFaction.id"
          :faction="negotiationFaction"
          @close="onCloseNegotiation"
        />
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
import AppIcon from '@/components/AppIcon.vue'
import DiplomacyPanel from '@/components/DiplomacyPanel.vue'
import NegotiationDialog from '@/components/NegotiationDialog.vue'
import OnboardingOverlay, {
  type OnboardingStep
} from '@/components/OnboardingOverlay.vue'
import { PAGE_TEXT, PHASE_HINTS, TOOLTIP_TEXT, ERROR_TEXT, BUTTON_TEXT } from '@/utils/copywriting'
import { getCrisis } from '@/utils/goal-hint'
import type { Faction, HistoryEvent } from '@/types/game'

const { load } = useGameState()
const { confirm } = useConfirmDialog()
const toast = useToast()
const store = useGameStore()
const { isOnboarding, checkAndStart, markDone, skip } = useOnboarding()

/** 处理阶段文案（用于 spinner 提示） */
const processingStage = ref('')

/**
 * P0-4：事件推演失败标志（无事件且为 true 时，阶段提示区展示「重新推演」按钮）
 * 事件成功加载或新回合开始时复位为 false。
 */
const eventFailed = ref(false)

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

/** 事件流式生成过程中已收到的文本（空串表示尚未收到或走的非流式） */
const eventStreamText = ref('')

const { startTurn, makeDecision, endTurn } = useTurn({
  // T3.4：错误文案白话化（技术错误码 console.error 保留，不展示给玩家）
  onError: (stage, message) => {
    console.error(`[useTurn] ${stage} 失败:`, message)
    if (stage === 'startTurn') {
      toast.error(ERROR_TEXT.startTurnFailed)
    } else if (stage === 'makeDecision') {
      // useTurn 已把服务端裁决文案归一为玩家可读文本（技术码换成 networkError），
      // 这里必须透出具体原因：固定成"网络连接失败"会误导玩家去查网络
      toast.error(message || ERROR_TEXT.networkError)
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
  },
  // 流式生成进度：网关慢实例上事件要 40-60s，这里实时展示已生成内容，
  // 把「无感知干等」变成「看得见的进展」
  onEventProgress: (partialText) => {
    eventStreamText.value = partialText
  }
})

const { sync, isSyncing } = useSaveSync({
  confirmOverwrite: async (cloudTs) => {
    const cloudDate = new Date(cloudTs).toLocaleString('zh-CN')
    return confirm({
      title: PAGE_TEXT.syncConfirm.title,
      message: PAGE_TEXT.syncConfirm.message(cloudDate),
      confirmText: PAGE_TEXT.syncConfirm.pull,
      cancelText: PAGE_TEXT.syncConfirm.keep
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

/** 谈判弹窗（faction-negotiation 提案 T6）：目标势力 + 显隐 */
const showNegotiation = ref(false)
const negotiationFaction = ref<Faction | null>(null)
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
      '顶部常驻 FocusPanel：综合实力进度条（达到 85 胜利）、危机预警（属性 <30 红色高亮）、本回合建议（AI 军师生成）。',
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
    content: '底部可折叠 GoalPanel：长期目标是综合实力 ≥ 85（胜利），任一属性 ≤ 0（失败）。点击可展开查看详情。',
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
  // 1 回合 = 1 年，month 恒为 1，因此只显示年（带上"1 月"会让人误以为日历按月走）
  return d ? `${d.year} 年` : ''
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
    eventStreamText.value = ''
    const event = await startTurn()
    eventStreamText.value = ''
    processingStage.value = ''
    if (!event) {
      // P0-4：推演失败 → 置失败标志（阶段提示区展示重试按钮）+ toast 提示
      eventFailed.value = true
      toast.info(ERROR_TEXT.eventFailed)
    } else {
      eventFailed.value = false
    }
  }
}

/** P0-4：推演失败后点击「重新推演」重试 */
async function onRetryEvent(): Promise<void> {
  if (isProcessingTurn.value) return
  await refreshAndStartTurn()
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

  // 清空上次自由行动的势力变化反馈（避免与上回合残留混淆）
  store.clearLastFreeFactionEffects()

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
  eventStreamText.value = ''
  const event = await startTurn()
  eventStreamText.value = ''
  processingStage.value = ''
  if (!event) {
    // P0-4：新回合推演失败 → 置失败标志（展示重试按钮）+ toast 提示
    eventFailed.value = true
    toast.info(ERROR_TEXT.eventRetryFailed)
  } else {
    eventFailed.value = false
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

// ====================== 导航（自定义导航栏 P0-2） ======================
/** 返回上一页；无页面栈时回首页（存档自动持久化，不会丢进度） */
function onBack(): void {
  uni.navigateBack({
    fail: () => {
      uni.redirectTo({ url: '/pages/index/index' })
    }
  })
}

/** P0-6 帮助入口：跳转「如何游戏」页 */
function onOpenHelp(): void {
  uni.navigateTo({ url: '/pages/help/index' })
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

// ====================== 谈判弹窗（faction-negotiation 提案 T6） ======================
function onNegotiate(fac: Faction): void {
  negotiationFaction.value = fac
  showNegotiation.value = true
}

function onCloseNegotiation(): void {
  showNegotiation.value = false
  negotiationFaction.value = null
}
</script>

<style lang="scss" scoped>
.game-main {
  display: flex;
  flex-direction: column;
  // 显式 100% 宽度：确保在 uni-app H5 的容器嵌套中铺满视口
  width: 100%;
  // 固定视口高度（而非 min-height）：本页是三段式布局（header / 内容滚动区 / footer），
  // 必须给 flex 容器一个确定高度，中间的 scroll-view 才能被约束成「内部滚动」。
  // 若用 min-height，容器会被内容撑高到超过视口，而 uni-app H5 的 html/body 是
  // overflow:hidden，溢出部分既滚不动也点不到 —— 底栏（外交/军师/自由行动/确认决策）
  // 会被永久推出视口且无法触达（实测：内容撑到 2569px 时滚轮/End/程序化滚动全部失效）。
  height: 100vh;
  // dvh 兜底移动端浏览器地址栏伸缩导致的 100vh 虚高；不支持时自动沿用上一行
  height: 100dvh;
  // 横向溢出兜底：防止子元素固定最小宽度（如下方按钮 min-width）在窄屏撑破视口
  overflow-x: hidden;
  background: linear-gradient(180deg, $jt-bg-page-top 0%, $jt-bg-page-bottom 100%);

  // ====================== 顶部导航栏（P0-2 自定义导航） ======================
  &__header {
    display: flex;
    // 高度固定为视口后，header/footer 必须禁止被 flex 压缩，否则内容多时会被挤扁
    flex-shrink: 0;
    gap: $jt-space-base;
    align-items: center;
    padding: $jt-space-lg $jt-space-xl;
    background-color: $jt-primary;
    box-shadow: $jt-shadow-header;
  }

  &__back {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    // 触摸目标 ≥ 36px（用 rpx 跟随视口缩放，避免窄屏下固定 px 撑破宽度）
    min-width: 72rpx;
    min-height: 72rpx;
    color: $jt-ink-inverse;
    transition: background-color 150ms ease, transform 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: rgba(255, 255, 255, 0.15);
    }
  }

  &__header-info {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: $jt-space-xs;
    align-items: center;
  }

  &__header-actions {
    display: flex;
    flex-shrink: 0;
    gap: $jt-space-base;
    align-items: center;
  }

  &__turn {
    font-size: $jt-font-xl;
    font-weight: 600;
    color: $jt-ink-inverse;
    letter-spacing: 2rpx;
  }

  &__date {
    font-size: $jt-font-base;
    color: rgba(255, 255, 255, 0.8);
  }

  // P0-6 帮助入口（"?" 按钮，跳转「如何游戏」页）
  &__help-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 72rpx;
    min-height: 72rpx;
    background-color: rgba(255, 255, 255, 0.15);
    border-radius: $jt-radius-base;
    transition: background-color 150ms ease, transform 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: rgba(255, 255, 255, 0.25);
    }
  }

  &__help-text {
    font-size: $jt-font-lg;
    font-weight: 600;
    color: $jt-ink-inverse;
  }

  &__sync-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    // 触摸目标 ≥ 36px（用 rpx 跟随视口缩放，避免窄屏下固定 px 撑破宽度）
    min-width: 72rpx;
    min-height: 72rpx;
    padding: $jt-space-sm 20rpx;
    background-color: rgba(255, 255, 255, 0.15);
    border-radius: $jt-radius-base;
    transition: background-color 150ms ease, transform 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: rgba(255, 255, 255, 0.25);
    }

    &--disabled {
      background-color: $jt-bg-disabled;
      opacity: 0.65;
    }
  }

  &__sync-text {
    font-size: $jt-font-base;
    color: $jt-ink-inverse;
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
    border-top-color: $jt-ink-inverse;
    border-radius: 50%;
    animation: game-main-spin 0.8s linear infinite;
  }

  // ====================== 主内容区 ======================
  &__body {
    flex: 1;
    // min-height:0 让 flex 子项可收缩到内容高度以下（H5 生效）；
    // height:0 是微信小程序端的稳妥写法：小程序里单靠 flex:1 未必能算出
    // scroll-view 的高度，显式 0 + flex-grow 才能触发内部滚动。
    // 两者并存互不影响（flex-basis:0% + grow:1 决定最终高度）
    height: 0;
    min-height: 0;
    padding: $jt-space-md $jt-space-lg;
  }

  &__section {
    margin-bottom: $jt-space-lg;
  }

  &__body-pad {
    height: 200rpx;
  }

  // ====================== T1.15: FocusPanel 顶部固定容器 ======================
  &__focus-panel {
    flex-shrink: 0;
    padding: $jt-space-md $jt-space-lg $jt-space-sm;
    background-color: rgba(253, 246, 227, 0.95);
    border-bottom: 2rpx solid $jt-border;
    box-shadow: $jt-shadow-card;
  }

  // ====================== T1.15: GoalPanel 底部容器 ======================
  &__goal-panel {
    margin-top: $jt-space-md;
  }

  // ====================== 自由行动输入 ======================
  &__free-input {
    padding: $jt-space-lg;
    background-color: $jt-bg-surface;
    border: 2rpx solid $jt-border;
    border-radius: $jt-radius-lg;
  }

  &__free-input-title {
    display: block;
    margin-bottom: $jt-space-md;
    font-size: $jt-font-lg;
    font-weight: 600;
    color: $jt-ink-secondary;
  }

  &__free-input-area {
    width: 100%;
    min-height: 120rpx;
    max-height: 400rpx;
    padding: $jt-space-md;
    font-size: $jt-font-lg;
    line-height: 1.5;
    color: $jt-ink;
    background-color: #fff;
    border: 2rpx solid $jt-border;
    border-radius: $jt-radius-base;
  }

  &__free-input-actions {
    display: flex;
    gap: $jt-space-md;
    margin-top: $jt-space-md;
  }

  // ====================== 决策应用势力反馈（T4） ======================
  &__faction-feedback {
    padding: $jt-space-lg;
    background: $jt-primary-soft;
    border: 1rpx solid $jt-primary-light;
    border-radius: $jt-radius-xl;
  }

  &__faction-feedback-title {
    display: block;
    margin-bottom: $jt-space-base;
    font-size: $jt-font-md;
    font-weight: 600;
    color: $jt-ink-secondary;
  }

  &__faction-feedback-item {
    display: flex;
    gap: $jt-space-md;
    align-items: center;
    margin-top: $jt-space-sm;
  }

  &__faction-feedback-name {
    font-size: $jt-font-md;
    font-weight: 500;
    color: $jt-ink;
  }

  &__faction-feedback-delta {
    font-size: $jt-font-base;
    font-weight: 600;
  }

  &__faction-feedback--up {
    color: $jt-success;
  }

  &__faction-feedback--down {
    color: $jt-danger;
  }

  // ====================== 阶段提示、失败重试与 spinner ======================
  &__hint {
    padding: 48rpx 24rpx;
    text-align: center;
  }

  &__hint-text {
    font-size: $jt-font-md;
    font-style: italic;
    color: $jt-ink-muted;
  }

  // P0-4：推演失败后的「重新推演」按钮
  &__retry-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    // 触摸目标 ≥ 44px
    min-height: 88rpx;
    padding: $jt-space-md 48rpx;
    margin-top: $jt-space-lg;
    background-color: $jt-primary;
    border-radius: $jt-radius-base;
    box-shadow: $jt-shadow-card;
    transition: background-color 150ms ease, transform 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: $jt-primary-dark;
    }
  }

  &__retry-text {
    font-size: $jt-font-lg;
    font-weight: 500;
    color: $jt-ink-inverse;
  }

  &__loading {
    display: flex;
    flex-direction: column;
    gap: $jt-space-md;
    align-items: center;
    padding: 48rpx 24rpx;
  }

  &__loading-dot {
    width: 36rpx;
    height: 36rpx;
    border: 4rpx solid $jt-primary-light;
    border-top-color: $jt-primary;
    border-radius: 50%;
    animation: game-main-spin 0.8s linear infinite;
  }

  &__loading-text {
    font-size: $jt-font-md;
    color: $jt-ink-secondary;
  }

  // 流式生成中的事件文本：作为 spinner 下方的「生成进展」，弱化于主文案
  &__loading-stream {
    display: block;
    // 长文本限高，避免生成过程中把下方内容顶飞
    max-height: 240rpx;
    margin-top: $jt-space-sm;
    overflow: hidden;
    font-size: $jt-font-base;
    line-height: 1.6;
    color: $jt-ink-muted;
  }

  // ====================== 通用按钮 ======================
  &__btn {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    // 触摸目标 ≥ 44px（用 rpx 跟随视口缩放，避免窄屏下固定 px 撑破宽度）
    min-width: 88rpx;
    min-height: 88rpx;
    padding: 20rpx 0;
    background-color: $jt-bg-surface;
    border: 2rpx solid $jt-primary;
    border-radius: $jt-radius-base;
    transition: background-color 150ms ease, transform 150ms ease, opacity 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: $jt-bg-subtle;
    }

    &--primary {
      background-color: $jt-primary;

      .game-main__btn-text {
        color: $jt-ink-inverse;
      }
    }

    &--ghost {
      background-color: transparent;
      border-color: $jt-border;

      .game-main__btn-text {
        color: $jt-ink-secondary;
      }
    }

    &--disabled {
      background-color: $jt-bg-disabled;
      border-color: $jt-border-disabled;
      opacity: 0.65;

      .game-main__btn-text {
        color: $jt-ink-disabled;
      }
    }
  }

  &__btn-text {
    font-size: $jt-font-lg;
    font-weight: 500;
    color: $jt-ink;
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
    border-top-color: $jt-ink-inverse;
    border-radius: 50%;
    animation: game-main-spin 0.8s linear infinite;
  }

  // ====================== 底部操作栏 ======================
  &__footer {
    display: flex;
    // 同 header：固定视口高度下禁止被 flex 压缩，保证底栏触摸目标完整可见
    flex-shrink: 0;
    gap: $jt-space-md;
    padding: $jt-space-md $jt-space-lg;
    // 比内容区略深的米色，拉开与滚动区的层次，强化固定底栏分隔感
    background-color: $jt-bg-subtle;
    border-top: 2rpx solid $jt-border;
    box-shadow: 0 -6rpx 16rpx rgba(139, 26, 26, 0.12);
  }

  &__footer-btn {
    display: flex;
    flex: 1;
    gap: $jt-space-sm;
    align-items: center;
    justify-content: center;
    // 触摸目标 ≥ 44px（用 rpx 跟随视口缩放，避免窄屏下固定 px 撑破宽度）
    min-width: 88rpx;
    min-height: 88rpx;
    padding: 20rpx 0;
    color: $jt-primary;
    background-color: $jt-bg-surface;
    border: 2rpx solid $jt-primary;
    border-radius: $jt-radius-base;
    transition: background-color 150ms ease, transform 150ms ease, opacity 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: $jt-bg-subtle;
    }

    &--disabled {
      color: $jt-ink-disabled;
      background-color: $jt-bg-disabled;
      border-color: $jt-border-disabled;
      opacity: 0.65;

      .game-main__footer-btn-text {
        color: $jt-ink-disabled;
      }
    }

    &--advisor {
      flex: 0 0 auto;
      min-width: 120rpx;
      padding: 20rpx 24rpx;
    }

    &--confirm,
    &--next {
      background-color: $jt-primary;

      .game-main__footer-btn-text {
        color: $jt-ink-inverse;
      }
    }

    &--free {
      background-color: $jt-bg-surface;
    }

    &--diplomacy {
      background-color: $jt-bg-surface;
    }

    &-text {
      font-size: $jt-font-lg;
      font-weight: 500;
      color: $jt-ink;
    }

    // 圆形裁切的军师图片图标（36×36 容器，aspectFill 居中裁切）
    &-icon {
      width: 36rpx;
      height: 36rpx;
      overflow: hidden;
      border-radius: 50%;

      &--advisor {
        width: 48rpx;
        height: 48rpx;
        border: 2rpx solid $jt-primary;
      }
    }
  }

  // ====================== 外交面板抽屉（player-active-diplomacy 提案 T3） ======================
  &__diplomacy-mask {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    // 高于 uni 页面头（z-index 998）：蒙层需盖住头部，否则抽屉顶区被标题栏压住
    z-index: 1100;
    display: flex;
    align-items: flex-end;
    background-color: rgba(0, 0, 0, 0.45);
  }

  &__diplomacy-drawer {
    width: 100%;
    max-height: 80vh;
    background-color: $jt-bg-surface;
    border-top-left-radius: 24rpx;
    border-top-right-radius: 24rpx;
    box-shadow: $jt-shadow-drawer;
  }

  // 谈判弹窗（faction-negotiation 提案 T6）：居中弹窗，盖在外交抽屉之上
  &__negotiation-mask {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    // 高于外交抽屉（1100）：谈判弹窗从外交面板内发起，需盖在其上
    z-index: 1110;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(0, 0, 0, 0.45);
  }

  &__negotiation-wrap {
    display: flex;
    justify-content: center;
  }
}

@keyframes game-main-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
