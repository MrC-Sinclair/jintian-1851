<template>
  <view class="cc">
    <!-- 顶部步骤指示器 -->
    <view class="cc__stepper">
      <view
        v-for="n in 3"
        :key="n"
        class="cc__step"
        :class="{
          'cc__step--active': step >= n,
          'cc__step--current': step === n
        }"
      >
        <text class="cc__step-num">{{ n }}</text>
        <text class="cc__step-label">{{ stepLabels[n - 1] }}</text>
      </view>
    </view>

    <!-- 步骤 1：身份选择 -->
    <view v-if="step === 1" class="cc__panel">
      <text class="cc__panel-title">选择出身</text>
      <text class="cc__panel-hint">身份决定起始属性偏移，影响后续游戏走向</text>

      <view class="cc__cards">
        <view
          v-for="bg in BACKGROUNDS"
          :key="bg.value"
          class="cc__bg-card"
          :class="{
            'cc__bg-card--selected': selectedBackground === bg.value
          }"
          :hover-class="'cc__bg-card--hover'"
          :hover-stay-time="100"
          @click="selectedBackground = bg.value"
        >
          <text class="cc__bg-name">{{ bg.value }}</text>
          <text class="cc__bg-desc">{{ bg.desc }}</text>
          <view class="cc__bg-perks">
            <text
              v-for="perk in bg.perks"
              :key="perk.label"
              class="cc__bg-perk"
              :class="perk.cls"
            >{{ perk.label }}</text>
          </view>
        </view>
      </view>

      <view class="cc__actions">
        <view
          class="cc__btn cc__btn--primary"
          :class="{ 'cc__btn--disabled': !selectedBackground }"
          :hover-class="selectedBackground ? 'cc__btn--hover' : ''"
          :hover-stay-time="100"
          @click="onConfirmBackground"
        >
          <text class="cc__btn-text">下一步</text>
        </view>
      </view>
    </view>

    <!-- 步骤 2：AI 生成势力 -->
    <view v-else-if="step === 2" class="cc__panel">
      <text class="cc__panel-title">天下群雄</text>
      <text v-if="loadingFactions" class="cc__panel-hint">
        身份：{{ selectedBackground }} · 军师推演中…
      </text>
      <text v-else-if="factionsError" class="cc__panel-hint">
        身份：{{ selectedBackground }} · 推演失败
      </text>
      <text v-else class="cc__panel-hint">
        身份：{{ selectedBackground }} · 请选择你的势力
      </text>

      <view v-if="loadingFactions" class="cc__loading">
        <view class="cc__loading-spinner">
          <view class="cc__loading-dot" />
        </view>
        <!-- T2.3：loading 文案白话化（copywriting.PAGE_TEXT.characterCreate） -->
        <text class="cc__loading-text">{{ PAGE_TEXT.characterCreate.factionLoading }}</text>
        <text class="cc__loading-hint">{{ PAGE_TEXT.characterCreate.factionLoadingHint }}</text>
      </view>

      <view v-else-if="factionsError" class="cc__error">
        <text class="cc__error-text">{{ factionsError }}</text>
        <view
          class="cc__btn"
          :hover-class="'cc__btn--hover'"
          :hover-stay-time="100"
          @click="loadFactions"
        >
          <text class="cc__btn-text">重试</text>
        </view>
      </view>

      <view v-else class="cc__factions">
        <FactionCard
          v-for="f in factions"
          :key="f.id"
          :faction="toFactionCardProps(f)"
          :selected="selectedFaction?.id === f.id"
          @select="onSelectFaction(f)"
        />
      </view>

      <view v-if="!loadingFactions && !factionsError" class="cc__actions">
        <view
          class="cc__btn"
          :hover-class="'cc__btn--hover'"
          :hover-stay-time="100"
          @click="onBackToBackground"
        >
          <text class="cc__btn-text">上一步</text>
        </view>
      </view>
    </view>

    <!-- 步骤 3：确认开局（实际点击势力卡片时触发，本步骤显示初始化中状态） -->
    <view v-else-if="step === 3" class="cc__panel">
      <view class="cc__loading">
        <view class="cc__loading-spinner">
          <view class="cc__loading-dot" />
        </view>
        <text class="cc__loading-text">正在开局…</text>
        <text class="cc__loading-hint">已选定「{{ selectedFaction?.name }}」势力</text>
      </view>
    </view>

    <!-- 全局确认对话框 + Toast 提示（uni-app H5 端 App.vue template 被忽略，必须在每个页面挂载） -->
    <ConfirmDialog />
    <ToastContainer />
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { post, ApiError } from '@/utils/api'
import { useGameState } from '@/composables/useGameState'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useToast } from '@/composables/useToast'
import FactionCard from '@/components/FactionCard.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import { PAGE_TEXT } from '@/utils/copywriting'
import type { Background, Faction } from '@/types/game'

/** init-factions 接口返回的势力结构 */
interface InitFaction {
  id: string
  name: string
  summary: string
  initialPower: number
  initialRelationship: number
}

interface BackgroundOption {
  value: Background
  desc: string
  perks: Array<{ label: string; cls: string }>
}

const BACKGROUNDS: BackgroundOption[] = [
  {
    value: '文官',
    desc: '通晓政事，善理政务',
    perks: [
      { label: '政+10', cls: 'cc__bg-perk--positive' },
      { label: '外+5', cls: 'cc__bg-perk--positive' },
      { label: '军-5', cls: 'cc__bg-perk--negative' }
    ]
  },
  {
    value: '武将',
    desc: '沙场宿将，威震四方',
    perks: [
      { label: '军+10', cls: 'cc__bg-perk--positive' },
      { label: '民+5', cls: 'cc__bg-perk--positive' },
      { label: '政-5', cls: 'cc__bg-perk--negative' }
    ]
  },
  {
    value: '商贾',
    desc: '富甲一方，财通四海',
    perks: [
      { label: '经+15', cls: 'cc__bg-perk--positive' },
      { label: '外+5', cls: 'cc__bg-perk--positive' },
      { label: '政-5', cls: 'cc__bg-perk--negative' }
    ]
  },
  {
    value: '士绅',
    desc: '望重乡里，深得民心',
    perks: [
      { label: '民+10', cls: 'cc__bg-perk--positive' },
      { label: '政+5', cls: 'cc__bg-perk--positive' },
      { label: '军-5', cls: 'cc__bg-perk--negative' }
    ]
  },
  {
    value: '宗室',
    desc: '皇族后裔，名正言顺',
    perks: [
      { label: '外+10', cls: 'cc__bg-perk--positive' },
      { label: '政+5', cls: 'cc__bg-perk--positive' },
      { label: '军-5', cls: 'cc__bg-perk--negative' }
    ]
  }
]

const stepLabels = ['身份', '势力', '开局']

const { initSave } = useGameState()
const { confirm } = useConfirmDialog()
const toast = useToast()

/** 当前步骤（1/2/3） */
const step = ref<1 | 2 | 3>(1)
/** 选中的身份 */
const selectedBackground = ref<Background | null>(null)
/** AI 生成的势力列表 */
const factions = ref<InitFaction[]>([])
/** 加载势力中 */
const loadingFactions = ref(false)
/** 加载势力错误信息 */
const factionsError = ref<string | null>(null)
/** 选中的势力 */
const selectedFaction = ref<InitFaction | null>(null)
/** 开局初始化中 */
const initializing = ref(false)

/**
 * 调用 init-factions 接口加载势力
 */
async function loadFactions(): Promise<void> {
  if (!selectedBackground.value) return
  loadingFactions.value = true
  factionsError.value = null
  factions.value = []

  try {
    const res = await post<{ factions: InitFaction[] }>('/api/game/init-factions', {
      background: selectedBackground.value
    })
    factions.value = res.factions
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : '势力推演失败'
    factionsError.value = msg
  } finally {
    loadingFactions.value = false
  }
}

/** 步骤 1 确认身份 → 进入步骤 2 并加载势力 */
function onConfirmBackground(): void {
  if (!selectedBackground.value) {
    toast.info('请先选择身份')
    return
  }
  step.value = 2
  void loadFactions()
}

/** 步骤 2 返回步骤 1 */
function onBackToBackground(): void {
  step.value = 1
  factions.value = []
  selectedFaction.value = null
  factionsError.value = null
}

/**
 * 选中势力 → 弹确认 → 调 initSave → 跳转 game-main
 */
async function onSelectFaction(f: InitFaction): Promise<void> {
  if (loadingFactions.value || initializing.value) return

  const ok = await confirm({
    title: '确认势力',
    message: `将选择「${f.name}」作为起始势力\n${f.summary}\n\n此选择无法更改，是否继续？`,
    confirmText: '确定',
    cancelText: '再想想'
  })
  if (!ok) return

  selectedFaction.value = f
  step.value = 3
  initializing.value = true

  try {
    await initSave({
      background: selectedBackground.value!,
      faction: { id: f.id, name: f.name, summary: f.summary },
      allFactions: factions.value
    })
    // 跳转主界面（redirectTo 替换当前页，玩家不会返回到开局页）
    uni.redirectTo({ url: '/pages/game-main/index' })
  } catch (err) {
    console.error('[character-create] initSave 失败:', err)
    toast.error('开局失败，请重试')
    step.value = 2
    selectedFaction.value = null
  } finally {
    initializing.value = false
  }
}

/**
 * 将 InitFaction 适配为 FactionCard 所需的 props 结构
 * FactionCard 期望 { name, summary, power, relationship }
 */
function toFactionCardProps(f: InitFaction): Pick<Faction, 'name' | 'summary' | 'power' | 'relationship'> {
  return {
    name: f.name,
    summary: f.summary,
    power: f.initialPower,
    relationship: f.initialRelationship
  }
}
</script>

<style lang="scss" scoped>
.cc {
  min-height: 100vh;
  padding: 32rpx;
  background: linear-gradient(180deg, #f5e6c8 0%, #fdf6e3 100%);

  &__stepper {
    display: flex;
    gap: 16rpx;
    padding: 16rpx 0 32rpx;
  }

  &__step {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    gap: 8rpx;
    padding: 16rpx 8rpx;
    background-color: rgba(245, 230, 200, 0.5);
    border: 2rpx solid #d4c5a0;
    border-radius: 8rpx;
    opacity: 0.5;
    transition: opacity 200ms ease, border-color 200ms ease, background-color 200ms ease;

    &--active {
      opacity: 1;
    }

    &--current {
      background-color: #fdf6e3;
      border-color: #8b1a1a;
    }
  }

  &__step-num {
    width: 40rpx;
    height: 40rpx;
    font-size: 26rpx;
    font-weight: 600;
    line-height: 40rpx;
    color: #fff;
    text-align: center;
    background-color: #8b1a1a;
    border-radius: 50%;
  }

  &__step-label {
    font-size: 22rpx;
    color: #5d4037;
  }

  &__panel {
    padding: 16rpx 0;
  }

  &__panel-title {
    display: block;
    margin-bottom: 8rpx;
    font-size: 40rpx;
    font-weight: 600;
    color: #2c1810;
  }

  &__panel-hint {
    display: block;
    margin-bottom: 24rpx;
    font-size: 24rpx;
    color: #8d6e63;
  }

  &__cards {
    display: flex;
    flex-direction: column;
    gap: 16rpx;
  }

  &__bg-card {
    min-height: 44px;
    padding: 24rpx;
    background-color: #fdf6e3;
    border: 2rpx solid #d4c5a0;
    border-radius: 12rpx;
    transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease;

    &:active {
      transform: scale(0.98);
    }

    &--hover {
      background-color: #f5e6c8;
    }

    &--selected {
      background-color: #f5e6c8;
      border-color: #8b1a1a;
      box-shadow: 0 0 0 4rpx rgba(139, 26, 26, 0.15);
    }
  }

  &__bg-name {
    display: block;
    margin-bottom: 4rpx;
    font-size: 36rpx;
    font-weight: 600;
    color: #2c1810;
  }

  &__bg-desc {
    display: block;
    margin-bottom: 12rpx;
    font-size: 24rpx;
    color: #5d4037;
  }

  &__bg-perks {
    display: flex;
    flex-wrap: wrap;
    gap: 8rpx;
  }

  &__bg-perk {
    padding: 4rpx 12rpx;
    font-size: 22rpx;
    border-radius: 4rpx;

    &--positive {
      color: #2e7d32;
      background-color: rgba(46, 125, 50, 0.15);
    }

    &--negative {
      color: #c62828;
      background-color: rgba(198, 40, 40, 0.15);
    }
  }

  &__factions {
    display: flex;
    flex-direction: column;
    gap: 16rpx;
  }

  &__actions {
    display: flex;
    gap: 16rpx;
    margin-top: 32rpx;
  }

  &__btn {
    flex: 1;
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24rpx 0;
    background-color: #fdf6e3;
    border: 2rpx solid #8b1a1a;
    border-radius: 12rpx;
    transition: background-color 150ms ease, transform 150ms ease, opacity 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: #f5e6c8;
    }

    &--primary {
      background-color: #8b1a1a;

      .cc__btn-text {
        color: #fff;
      }
    }

    &--disabled {
      opacity: 0.5;
    }
  }

  &__btn-text {
    font-size: 30rpx;
    font-weight: 500;
    color: #2c1810;
  }

  &__loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16rpx;
    padding: 80rpx 0;
  }

  &__loading-spinner {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 60rpx;
    height: 60rpx;
  }

  &__loading-dot {
    width: 48rpx;
    height: 48rpx;
    border: 6rpx solid rgba(139, 26, 26, 0.2);
    border-top-color: #8b1a1a;
    border-radius: 50%;
    animation: cc-spin 0.8s linear infinite;
  }

  &__loading-text {
    font-size: 28rpx;
    color: #5d4037;
  }

  &__loading-hint {
    font-size: 22rpx;
    color: #8d6e63;
    font-style: italic;
  }

  &__error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24rpx;
    padding: 80rpx 0;
  }

  &__error-text {
    font-size: 28rpx;
    color: #c62828;
  }
}

@keyframes cc-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
