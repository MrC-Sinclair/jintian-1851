/**
 * @file useSaveList — 云端存档列表（多存档管理）
 *
 * 数据源：GET /api/game/saves?deviceId=&limit=（摘要列表，按 updated_at 倒序）
 * 切换/导出：GET /api/game/sync-save 拉全量 → 写本地（deviceId 随存档传播，属主校验由服务端负责）
 * 删除：DELETE /api/game/saves（服务端 saveId+deviceId 双条件原子删除；删除当前本地档时同步清本地）
 * 导出：H5 Blob 下载；小程序端剪贴板兜底（JSON 文本）
 * 导入：JSON 文本 → isValidSaveShape 校验 → 写本地（导航由页面层负责，本模块保持可测）
 *
 * 防重复提交：isLoading（列表）与 isMutating（切换/删除/导出/导入）分离，
 * 异步完成后在 finally 重置（数据安全规则）。
 */

import { ref } from 'vue'
import { useGameStore } from '@/stores/game'
import { ApiError, del, get } from '@/utils/api'
import { getDeviceId } from '@/utils/device-id'
import { clearSave, isValidSaveShape, saveSave } from '@/utils/storage'
import type { GameSave } from '@/types/game'

/** GET /api/game/saves 响应中的单条摘要 */
export interface SaveListItem {
  saveId: string
  saveVersion: number
  updatedAt: number
  endedAt: number | null
  endedReason: string | null
  summary: {
    background: string
    factionName: string
    turn: number
    ended: boolean
  }
}

interface SavesListResponse {
  saves: SaveListItem[]
}

interface SyncSaveGetResponse {
  save: GameSave
  updatedAt: number
}

interface DeleteSaveResponse {
  saveId: string
  deleted: boolean
}

/** 操作结果（页面层据此 toast / 导航） */
export interface SaveOpResult {
  ok: boolean
  message?: string
}

/** 取当前设备 ID（取不到返回空串，由服务端校验拦截） */
function safeDeviceId(): string {
  try {
    return getDeviceId()
  } catch {
    return ''
  }
}

export function useSaveList() {
  const store = useGameStore()

  /** 云端存档摘要列表（fetchList 成功后更新） */
  const saves = ref<SaveListItem[]>([])
  /** 列表加载中（防重复请求） */
  const isLoading = ref(false)
  /** 切换/删除/导出/导入进行中（共用防重复守卫） */
  const isMutating = ref(false)

  /**
   * 拉取云端存档列表
   * @throws ApiError 网络层/服务端错误（由调用方 toast）
   */
  async function fetchList(limit = 20): Promise<SaveListItem[]> {
    if (isLoading.value) return saves.value
    isLoading.value = true
    try {
      const deviceId = safeDeviceId()
      if (!deviceId) {
        saves.value = []
        return []
      }
      const res = await get<SavesListResponse>(
        `/api/game/saves?deviceId=${encodeURIComponent(deviceId)}&limit=${limit}`
      )
      saves.value = res.saves
      return res.saves
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 拉取单个存档全量数据并写入本地（切换/导出共用）
   * @throws ApiError
   */
  async function fetchFullSave(saveId: string): Promise<GameSave> {
    const deviceId = safeDeviceId()
    const res = await get<SyncSaveGetResponse>(
      `/api/game/sync-save?saveId=${encodeURIComponent(saveId)}&deviceId=${encodeURIComponent(deviceId)}`
    )
    return res.save
  }

  /**
   * 切换存档：拉全量 → 写本地 → 更新 store（导航由页面层负责）
   */
  async function switchSave(saveId: string): Promise<SaveOpResult> {
    if (isMutating.value) return { ok: false, message: '操作进行中，请稍候' }
    isMutating.value = true
    try {
      const save = await fetchFullSave(saveId)
      await saveSave(save)
      store.setSave(save)
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof ApiError ? err.message : '切换存档失败'
      }
    } finally {
      isMutating.value = false
    }
  }

  /**
   * 删除云端存档；若删除的是当前本地存档，同步清除本地与 store
   */
  async function deleteSave(saveId: string): Promise<SaveOpResult> {
    if (isMutating.value) return { ok: false, message: '操作进行中，请稍候' }
    isMutating.value = true
    try {
      const deviceId = safeDeviceId()
      await del<DeleteSaveResponse>(
        `/api/game/saves?saveId=${encodeURIComponent(saveId)}&deviceId=${encodeURIComponent(deviceId)}`
      )
      // 本地当前档即被删档：清本地 + 置空 store（与云端一致，防「幽灵存档」）
      if (store.currentSave?.saveId === saveId) {
        await clearSave()
        store.setSave(null)
      }
      // 本地列表同步移除，省一次 fetchList
      saves.value = saves.value.filter((s) => s.saveId !== saveId)
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof ApiError ? err.message : '删除存档失败'
      }
    } finally {
      isMutating.value = false
    }
  }

  /**
   * 导出存档为 JSON：
   *   - H5：Blob + a[download] 浏览器下载
   *   - 小程序/App：无 Blob/URL API，剪贴板兜底（复制 JSON 文本）
   *
   * 平台判断走运行时 uni.getSystemInfoSync().uniPlatform（同 device-id.ts 惯例），
   * 不用条件编译：vitest 环境无编译步骤，运行时判断行为可预期、可 mock。
   */
  async function exportSave(saveId: string): Promise<SaveOpResult> {
    if (isMutating.value) return { ok: false, message: '操作进行中，请稍候' }
    isMutating.value = true
    try {
      const save = await fetchFullSave(saveId)
      const json = JSON.stringify(save)

      // H5 端 uniPlatform 实际返回 'web'（uni-app 3.x），兼容历史 'h5'
      const { uniPlatform } = uni.getSystemInfoSync()
      const isH5 = uniPlatform === 'web' || uniPlatform === 'h5'

      if (isH5) {
        // 运行时守卫：防非浏览器环境（SSR 等）引用 document/Blob
        if (typeof document === 'undefined' || typeof Blob === 'undefined') {
          return { ok: false, message: '当前环境不支持文件下载' }
        }
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `save-${save.saveId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        // 立即 revoke 可能中断下载，延后释放
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        return { ok: true }
      }

      // 小程序/App：剪贴板兜底
      await new Promise<void>((resolve, reject) => {
        uni.setClipboardData({
          data: json,
          success: () => resolve(),
          fail: (err: { errMsg?: string }) => reject(new Error(err?.errMsg ?? 'clipboard fail'))
        })
      })
      return { ok: true, message: '存档 JSON 已复制到剪贴板' }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof ApiError ? err.message : '导出存档失败'
      }
    } finally {
      isMutating.value = false
    }
  }

  /**
   * 导入存档：JSON 文本 → 结构校验 → 写本地 + 更新 store
   * 校验口径与本地读取一致（isValidSaveShape），防坏数据流入 store
   */
  async function importSave(jsonText: string): Promise<SaveOpResult> {
    if (isMutating.value) return { ok: false, message: '操作进行中，请稍候' }
    isMutating.value = true
    try {
      let parsed: unknown
      try {
        parsed = JSON.parse(jsonText)
      } catch {
        return { ok: false, message: '不是有效的 JSON 文件' }
      }
      if (!isValidSaveShape(parsed)) {
        return { ok: false, message: '存档结构校验失败，文件不完整或已损坏' }
      }
      await saveSave(parsed)
      store.setSave(parsed)
      return { ok: true }
    } finally {
      isMutating.value = false
    }
  }

  return {
    saves,
    isLoading,
    isMutating,
    fetchList,
    switchSave,
    deleteSave,
    exportSave,
    importSave
  }
}
