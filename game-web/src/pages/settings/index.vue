<template>
  <view class="settings">
    <view class="settings__header">
      <TooltipView :content="TOOLTIP_TEXT.back" placement="bottom">
        <view
          class="settings__back"
          role="button"
          aria-label="返回"
          tabindex="0"
          :hover-class="'settings__back--hover'"
          :hover-stay-time="100"
          @click="onBack"
          @keydown.enter.prevent="onBack"
          @keydown.space.prevent="onBack"
        >
          <AppIcon name="arrow-back" :size="22" color="#fff" />
        </view>
      </TooltipView>
      <text class="settings__title">设置</text>
      <view class="settings__header-placeholder" />
    </view>

    <scroll-view class="settings__body" scroll-y>
      <!-- 同步区 -->
      <view class="settings__section">
        <text class="settings__section-title">存档同步</text>

        <view class="settings__row">
          <view class="settings__row-label">
            <text class="settings__row-title">手动同步</text>
            <text class="settings__row-desc">立即上传或拉取云端存档</text>
          </view>
          <view
            class="settings__btn settings__btn--primary"
            role="button"
            :aria-label="isSyncing ? '同步中' : '手动同步存档'"
            :aria-disabled="isSyncing"
            tabindex="0"
            :class="{ 'settings__btn--disabled': isSyncing }"
            :hover-class="!isSyncing ? 'settings__btn--hover' : ''"
            :hover-stay-time="100"
            @click="onSync"
            @keydown.enter.prevent="onSync"
            @keydown.space.prevent="onSync"
          >
            <view v-if="isSyncing" class="settings__spinner">
              <view class="settings__spinner-dot" />
            </view>
            <text v-else class="settings__btn-text">同步</text>
          </view>
        </view>

        <view class="settings__row">
          <view class="settings__row-label">
            <text class="settings__row-title">自动同步</text>
            <text class="settings__row-desc">每回合结束后自动上传</text>
          </view>
          <view
            class="settings__switch"
            role="switch"
            :aria-label="autoSync ? '自动同步已开启' : '自动同步已关闭'"
            :aria-checked="autoSync"
            tabindex="0"
            :class="{ 'settings__switch--on': autoSync }"
            :hover-class="'settings__switch--hover'"
            :hover-stay-time="100"
            @click="onToggleAutoSync"
            @keydown.enter.prevent="onToggleAutoSync"
            @keydown.space.prevent="onToggleAutoSync"
          >
            <view class="settings__switch-thumb" />
          </view>
        </view>
      </view>

      <!-- 云端存档列表（多存档管理） -->
      <view class="settings__section">
        <view class="settings__section-header">
          <text class="settings__section-title">{{ SAVE_LIST_TEXT.title }}</text>
          <view
            class="settings__refresh-btn"
            role="button"
            :aria-label="SAVE_LIST_TEXT.refresh"
            :aria-disabled="isLoadingList"
            tabindex="0"
            :hover-class="'settings__refresh-btn--hover'"
            :hover-stay-time="100"
            @click="onRefreshList"
            @keydown.enter.prevent="onRefreshList"
            @keydown.space.prevent="onRefreshList"
          >
            <text class="settings__refresh-text">{{ SAVE_LIST_TEXT.refresh }}</text>
          </view>
        </view>

        <view v-if="isLoadingList" class="settings__list-hint">
          <text class="settings__list-hint-text">加载中…</text>
        </view>
        <view v-else-if="saveItems.length === 0" class="settings__list-hint">
          <text class="settings__list-hint-text">{{ SAVE_LIST_TEXT.empty }}</text>
        </view>
        <view v-else class="settings__save-list">
          <view
            v-for="item in saveItems"
            :key="item.saveId"
            class="settings__save-item"
          >
            <view class="settings__save-info">
              <view class="settings__save-name-row">
                <text class="settings__save-name">
                  {{ item.summary.factionName || '未命名势力' }}·{{ item.summary.background || '未知出身' }}
                </text>
                <text
                  v-if="isCurrentSave(item.saveId)"
                  class="settings__save-badge settings__save-badge--current"
                >当前</text>
                <text
                  class="settings__save-badge"
                  :class="item.summary.ended ? 'settings__save-badge--ended' : 'settings__save-badge--active'"
                >{{ item.summary.ended ? SAVE_LIST_TEXT.endedBadge : SAVE_LIST_TEXT.inProgressBadge }}</text>
              </view>
              <text class="settings__save-meta">
                {{ SAVE_LIST_TEXT.turnLabel(item.summary.turn) }} · {{ formatDate(item.updatedAt) }}
              </text>
            </view>
            <view class="settings__save-actions">
              <view
                class="settings__save-btn"
                role="button"
                :aria-label="SAVE_LIST_TEXT.switch"
                tabindex="0"
                :hover-class="'settings__save-btn--hover'"
                :hover-stay-time="100"
                @click="onSwitchSave(item)"
                @keydown.enter.prevent="onSwitchSave(item)"
                @keydown.space.prevent="onSwitchSave(item)"
              >
                <text class="settings__save-btn-text">{{ SAVE_LIST_TEXT.switch }}</text>
              </view>
              <view
                class="settings__save-btn"
                role="button"
                :aria-label="SAVE_LIST_TEXT.export"
                tabindex="0"
                :hover-class="'settings__save-btn--hover'"
                :hover-stay-time="100"
                @click="onExportSave(item)"
                @keydown.enter.prevent="onExportSave(item)"
                @keydown.space.prevent="onExportSave(item)"
              >
                <text class="settings__save-btn-text">{{ SAVE_LIST_TEXT.export }}</text>
              </view>
              <view
                class="settings__save-btn settings__save-btn--danger"
                role="button"
                :aria-label="SAVE_LIST_TEXT.delete"
                tabindex="0"
                :hover-class="'settings__save-btn--hover'"
                :hover-stay-time="100"
                @click="onDeleteSave(item)"
                @keydown.enter.prevent="onDeleteSave(item)"
                @keydown.space.prevent="onDeleteSave(item)"
              >
                <text class="settings__save-btn-text settings__save-btn-text--danger">{{ SAVE_LIST_TEXT.delete }}</text>
              </view>
            </view>
          </view>
          <view
            class="settings__save-import"
            role="button"
            aria-label="导入存档"
            tabindex="0"
            :hover-class="'settings__save-btn--hover'"
            :hover-stay-time="100"
            @click="onImportSave"
            @keydown.enter.prevent="onImportSave"
            @keydown.space.prevent="onImportSave"
          >
            <text class="settings__save-import-text">导入存档（JSON）</text>
          </view>
        </view>
      </view>

      <!-- 数据区 -->
      <view class="settings__section">
        <text class="settings__section-title">本地数据</text>

        <view
          class="settings__row settings__row--clickable"
          role="button"
          aria-label="清除本地存档"
          tabindex="0"
          :hover-class="'settings__row--hover'"
          :hover-stay-time="100"
          @click="onClearSave"
          @keydown.enter.prevent="onClearSave"
          @keydown.space.prevent="onClearSave"
        >
          <view class="settings__row-label">
            <text class="settings__row-title settings__row-title--danger">清除本地存档</text>
            <text class="settings__row-desc">删除本地存档，云端不受影响</text>
          </view>
          <text class="settings__row-arrow">›</text>
        </view>
      </view>

      <!-- 关于区 -->
      <view class="settings__section">
        <text class="settings__section-title">关于</text>

        <view class="settings__row settings__row--readonly">
          <view class="settings__row-label">
            <text class="settings__row-title">版本</text>
          </view>
          <text class="settings__row-value">{{ version }}</text>
        </view>

        <view class="settings__row settings__row--readonly">
          <view class="settings__row-label">
            <text class="settings__row-title">说明</text>
            <text class="settings__row-desc">
              近代策略模拟游戏，参考「重振模拟器」。玩家扮演一方势力领袖，在 1851-1912 年间通过决策与军师对话，尝试成就霸业或见证时代终结。
            </text>
          </view>
        </view>
      </view>

      <view class="settings__body-pad" />
    </scroll-view>

    <!-- 全局确认对话框 + Toast 提示（uni-app H5 端 App.vue template 被忽略，必须在每个页面挂载） -->
    <ConfirmDialog />
    <ToastContainer />
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useSaveSync } from '@/composables/useSaveSync'
import { useSaveList, type SaveListItem } from '@/composables/useSaveList'
import { useGameState } from '@/composables/useGameState'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useToast } from '@/composables/useToast'
import { useGameStore } from '@/stores/game'
import { TOOLTIP_TEXT, PAGE_TEXT } from '@/utils/copywriting'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import TooltipView from '@/components/TooltipView.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import AppIcon from '@/components/AppIcon.vue'

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

const { clear } = useGameState()
const { confirm } = useConfirmDialog()
const toast = useToast()

/** 自动同步开关（持久化到 storage） */
const autoSync = ref(false)

/** 应用版本号（写死，无构建注入） */
const version = '0.1.0'

onMounted(() => {
  // 读取 auto_sync 持久化状态
  try {
    autoSync.value = uni.getStorageSync('auto_sync') === true
  } catch {
    autoSync.value = false
  }
})

async function onSync(): Promise<void> {
  if (isSyncing.value) return
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

function onToggleAutoSync(): void {
  const next = !autoSync.value
  autoSync.value = next
  try {
    uni.setStorageSync('auto_sync', next)
    toast.success(next ? '已开启自动同步' : '已关闭自动同步')
  } catch {
    // 写入失败回滚
    autoSync.value = !next
    toast.error('设置保存失败')
  }
}

async function onClearSave(): Promise<void> {
  const ok = await confirm({
    title: '清除本地存档',
    message: '此操作将删除本地存档，且不可恢复。\n云端存档不受影响，可重新登录拉取。\n\n确认清除？',
    confirmText: '清除',
    cancelText: '取消'
  })
  if (!ok) return

  try {
    await clear()
    toast.success('本地存档已清除')
  } catch {
    toast.error('清除失败，请重试')
  }
}

// ====================== 云端存档列表（多存档管理） ======================

const SAVE_LIST_TEXT = PAGE_TEXT.saveList
const store = useGameStore()

const {
  saves: saveItems,
  isLoading: isLoadingList,
  isMutating,
  fetchList,
  switchSave,
  deleteSave,
  exportSave,
  importSave
} = useSaveList()

/** 判断某云端档是否为当前本地存档（列表标记「当前」用） */
function isCurrentSave(saveId: string): boolean {
  return store.currentSave?.saveId === saveId
}

/** 毫秒时间戳 → 本地化日期时间（列表元信息展示用） */
function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN')
}

/** 拉取云端存档列表（进入页面与手动刷新共用） */
async function onRefreshList(): Promise<void> {
  try {
    await fetchList()
  } catch {
    toast.error(SAVE_LIST_TEXT.loadFailed)
  }
}

onMounted(() => {
  // 静默预取云端存档列表（失败不阻断页面，仅 toast）
  void onRefreshList()
})

/** 存档显示名（摘要取不到时兜底） */
function saveDisplayName(item: SaveListItem): string {
  const name = item.summary.factionName || '未命名势力'
  const bg = item.summary.background || '未知出身'
  return `${name}·${bg}`
}

/** 切换存档：确认 → 拉全量写本地 → 进游戏页（game-main 对 ended 存档自动跳结局页） */
async function onSwitchSave(item: SaveListItem): Promise<void> {
  if (isMutating.value) return
  const ok = await confirm({
    title: SAVE_LIST_TEXT.switchConfirm.title,
    message: SAVE_LIST_TEXT.switchConfirm.message(saveDisplayName(item)),
    confirmText: SAVE_LIST_TEXT.switch,
    cancelText: '取消'
  })
  if (!ok) return

  const res = await switchSave(item.saveId)
  if (!res.ok) {
    toast.error(res.message ?? '切换失败')
    return
  }
  toast.success(SAVE_LIST_TEXT.switchDone)
  uni.reLaunch({ url: '/pages/game-main/index' })
}

/** 删除云端存档：二次确认（不可逆）→ 删除 → 刷新列表 */
async function onDeleteSave(item: SaveListItem): Promise<void> {
  if (isMutating.value) return
  const ok = await confirm({
    title: SAVE_LIST_TEXT.deleteConfirm.title,
    message: SAVE_LIST_TEXT.deleteConfirm.message(saveDisplayName(item)),
    confirmText: SAVE_LIST_TEXT.delete,
    cancelText: '取消'
  })
  if (!ok) return

  const res = await deleteSave(item.saveId)
  if (!res.ok) {
    toast.error(res.message ?? '删除失败')
    return
  }
  toast.success(SAVE_LIST_TEXT.deleteDone)
}

/** 导出存档（H5 文件下载 / 小程序剪贴板兜底，见 useSaveList.exportSave） */
async function onExportSave(item: SaveListItem): Promise<void> {
  if (isMutating.value) return
  const res = await exportSave(item.saveId)
  if (!res.ok) {
    toast.error(res.message ?? '导出失败')
    return
  }
  // 剪贴板方案需要告知用户去哪找数据；文件下载无需多言
  if (res.message) toast.info(res.message)
}

/** 导入存档：H5 动态 file input + FileReader；小程序端 chooseMessageFile（微信聊天文件） */
function onImportSave(): void {
  if (isMutating.value) return

  // 运行时平台判断（同 useSaveList.exportSave 惯例）
  const { uniPlatform } = uni.getSystemInfoSync()
  const isH5 = uniPlatform === 'web' || uniPlatform === 'h5'

  if (isH5) {
    // 动态创建 file input（uni-app 模板不支持原生 input[type=file] 跨端编译）
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        void handleImportText(String(reader.result ?? ''))
      }
      reader.onerror = () => toast.error(`${SAVE_LIST_TEXT.importFailedPrefix}：文件读取失败`)
      reader.readAsText(file)
    }
    input.click()
    return
  }

  // 小程序端：uni.chooseMessageFile 仅微信支持，失败给出明确提示
  const choose = (
    uni as unknown as {
      chooseMessageFile?: (opts: {
        count: number
        type: string
        success: (res: { tempFiles: { path: string }[] }) => void
        fail: (err: { errMsg?: string }) => void
      }) => void
    }
  ).chooseMessageFile
  if (typeof choose !== 'function') {
    toast.error('当前环境不支持文件导入，请使用 H5 端')
    return
  }
  choose({
    count: 1,
    type: 'file',
    success: (res) => {
      const filePath = res.tempFiles?.[0]?.path
      if (!filePath) return
      uni.getFileSystemManager().readFile({
        filePath,
        encoding: 'utf8',
        success: (read) => {
          // uni 类型定义未声明 result 字段（实际返回 utf8 文本），断言取值
          void handleImportText(String((read as unknown as { result?: string }).result ?? ''))
        },
        fail: () => toast.error(`${SAVE_LIST_TEXT.importFailedPrefix}：文件读取失败`)
      })
    },
    fail: () => {
      // 用户取消选择不提示，仅失败时提示
      toast.error(`${SAVE_LIST_TEXT.importFailedPrefix}：未选择文件`)
    }
  })
}

/** 导入文本 → 校验写入 → 成功进游戏页 */
async function handleImportText(jsonText: string): Promise<void> {
  const res = await importSave(jsonText)
  if (!res.ok) {
    toast.error(res.message ?? SAVE_LIST_TEXT.importFailedPrefix)
    return
  }
  toast.success(SAVE_LIST_TEXT.switchDone)
  uni.reLaunch({ url: '/pages/game-main/index' })
}

function onBack(): void {
  uni.navigateBack({ delta: 1 })
}
</script>

<style lang="scss" scoped>
.settings {
  display: flex;
  flex-direction: column;
  // 显式 100% 宽度：确保在 uni-app H5 的容器嵌套中铺满视口
  width: 100%;
  // min-height 而非 height：允许内容超出时扩展
  min-height: 100vh;
  // 横向溢出兜底：防止子元素固定最小宽度在窄屏撑破视口
  overflow-x: hidden;
  background: linear-gradient(180deg, #fdf6e3 0%, #f5e6c8 100%);

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 24rpx 32rpx;
    background-color: #8b1a1a;
    box-shadow: 0 4rpx 12rpx rgba(139, 26, 26, 0.15);
  }

  &__back {
    // 触摸目标 ≥ 36px（用 rpx 跟随视口缩放）
    min-width: 72rpx;
    min-height: 72rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    transition: background-color 150ms ease, transform 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: rgba(255, 255, 255, 0.15);
      border-radius: 8rpx;
    }
  }

  &__title {
    font-size: 32rpx;
    font-weight: 600;
    color: #fff;
    letter-spacing: 4rpx;
  }

  &__header-placeholder {
    width: 72rpx;
  }

  &__body {
    flex: 1;
    min-height: 0;
    padding: 16rpx 24rpx;
  }

  &__section {
    margin-bottom: 32rpx;
    padding: 16rpx 24rpx;
    background-color: #fdf6e3;
    border: 2rpx solid #d4c5a0;
    border-radius: 12rpx;
  }

  &__section-title {
    display: block;
    margin-bottom: 16rpx;
    font-size: 26rpx;
    font-weight: 600;
    color: #8d6e63;
    letter-spacing: 2rpx;
  }

  &__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20rpx 0;
    border-bottom: 2rpx solid rgba(212, 197, 160, 0.5);

    &:last-child {
      border-bottom: none;
    }

    &--clickable {
      transition: background-color 150ms ease;
    }

    &--hover {
      background-color: rgba(245, 230, 200, 0.5);
    }

    &--readonly {
      pointer-events: none;
    }
  }

  &__row-label {
    flex: 1;
    margin-right: 24rpx;
  }

  &__row-title {
    display: block;
    font-size: 28rpx;
    font-weight: 500;
    color: #2c1810;

    &--danger {
      color: #c62828;
    }
  }

  &__row-desc {
    display: block;
    margin-top: 6rpx;
    font-size: 24rpx;
    color: #8d6e63;
    line-height: 1.5;
  }

  &__row-value {
    font-size: 26rpx;
    color: #5d4037;
  }

  &__row-arrow {
    font-size: 36rpx;
    color: #8d6e63;
  }

  &__btn {
    // 触摸目标 ≥ 44px（用 rpx 跟随视口缩放）
    min-width: 88rpx;
    min-height: 88rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12rpx 32rpx;
    background-color: #8b1a1a;
    border-radius: 8rpx;
    transition: background-color 150ms ease, transform 150ms ease, opacity 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: #6e1414;
    }

    &--disabled {
      opacity: 0.65;
      background-color: #e8e0d0;

      .settings__btn-text {
        color: #9e8e76;
      }
    }

    &--primary {
      .settings__btn-text {
        color: #fff;
      }
    }
  }

  &__btn-text {
    font-size: 26rpx;
    font-weight: 500;
    color: #fff;
  }

  &__spinner {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32rpx;
    height: 32rpx;
  }

  &__spinner-dot {
    width: 28rpx;
    height: 28rpx;
    border: 3rpx solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: settings-spin 0.8s linear infinite;
  }

  // 自定义开关（uni-app 三端通用，避免原生 switch 样式差异）
  &__switch {
    width: 88rpx;
    height: 52rpx;
    background-color: #d4c5a0;
    border-radius: 26rpx;
    position: relative;
    transition: background-color 200ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--on {
      background-color: #2e7d32;
    }

    &--hover {
      opacity: 0.85;
    }
  }

  &__switch-thumb {
    width: 44rpx;
    height: 44rpx;
    background-color: #fff;
    border-radius: 50%;
    position: absolute;
    top: 4rpx;
    left: 4rpx;
    transition: transform 200ms ease;
    box-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.2);
  }

  // 开关打开时 thumb 右移（uni-app 不支持 SCSS 嵌套父引用 + 修饰符，用显式选择器）
  .settings__switch--on &__switch-thumb {
    transform: translateX(36rpx);
  }

  // ====================== 云端存档列表（多存档管理） ======================

  &__section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16rpx;
  }

  &__refresh-btn {
    // 触摸目标 ≥ 44px
    min-height: 88rpx;
    display: flex;
    align-items: center;
    padding: 8rpx 24rpx;
    background-color: rgba(139, 26, 26, 0.08);
    border: 2rpx solid #d4c5a0;
    border-radius: 8rpx;
    transition: background-color 150ms ease, transform 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: rgba(139, 26, 26, 0.15);
    }
  }

  &__refresh-text {
    font-size: 24rpx;
    color: #8b1a1a;
  }

  &__list-hint {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32rpx 0;
  }

  &__list-hint-text {
    font-size: 24rpx;
    color: #8d6e63;
    line-height: 1.6;
    text-align: center;
  }

  &__save-list {
    display: flex;
    flex-direction: column;
  }

  &__save-item {
    display: flex;
    flex-direction: column;
    padding: 20rpx 0;
    border-bottom: 2rpx solid rgba(212, 197, 160, 0.5);

    &:last-of-type {
      border-bottom: none;
    }
  }

  &__save-info {
    margin-bottom: 12rpx;
  }

  &__save-name-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12rpx;
  }

  &__save-name {
    font-size: 28rpx;
    font-weight: 600;
    color: #2c1810;
  }

  &__save-badge {
    padding: 2rpx 12rpx;
    font-size: 20rpx;
    border-radius: 6rpx;

    &--current {
      color: #fff;
      background-color: #8b1a1a;
    }

    &--active {
      color: #2e7d32;
      background-color: rgba(46, 125, 50, 0.12);
    }

    &--ended {
      color: #8d6e63;
      background-color: rgba(141, 110, 99, 0.15);
    }
  }

  &__save-meta {
    display: block;
    margin-top: 6rpx;
    font-size: 22rpx;
    color: #8d6e63;
  }

  &__save-actions {
    display: flex;
    align-items: center;
    gap: 16rpx;
  }

  &__save-btn {
    // 触摸目标 ≥ 44px（AGENTS/spec 硬性要求）
    min-height: 88rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8rpx 28rpx;
    background-color: rgba(139, 26, 26, 0.08);
    border: 2rpx solid #d4c5a0;
    border-radius: 8rpx;
    transition: background-color 150ms ease, transform 150ms ease;

    &:active {
      transform: scale(0.95);
    }

    &--hover {
      background-color: rgba(139, 26, 26, 0.15);
    }

    &--danger {
      background-color: rgba(198, 40, 40, 0.08);
      border-color: rgba(198, 40, 40, 0.35);
    }
  }

  &__save-btn-text {
    font-size: 24rpx;
    color: #8b1a1a;

    &--danger {
      color: #c62828;
    }
  }

  &__save-import {
    min-height: 88rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 16rpx;
    border: 2rpx dashed #d4c5a0;
    border-radius: 8rpx;
    transition: background-color 150ms ease;

    &--hover {
      background-color: rgba(245, 230, 200, 0.5);
    }
  }

  &__save-import-text {
    font-size: 24rpx;
    color: #8d6e63;
  }

  &__body-pad {
    height: 60rpx;
  }
}

@keyframes settings-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
