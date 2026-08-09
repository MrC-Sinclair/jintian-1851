/**
 * @file useSaveSync — 云端存档同步（服务端权威 updated_at 方案）
 *
 * 同步策略（design.md D7）：
 *   1. GET /api/game/sync-save?saveId=xxx
 *      - 404：本地首次上传（POST，body 不含 updatedAt）
 *      - 200：比较本地与云端 updatedAt
 *   2. 时间戳比较（统一转 ms）：
 *      - |local - cloud| < 1000ms：toast「已是最新」，不发请求
 *      - local > cloud + 1000：本地新，POST 上传
 *      - cloud > local + 1000：云端新，弹确认框，确认后 GET 拉取覆盖本地
 *   3. POST 上传后用服务端返回的 updatedAt 写回本地（服务端权威）
 *
 * 注意：
 *   - 全程 isSyncing 守卫，禁止重复点击
 *   - 失败 toast.error 不影响本地，isSyncing 必须在 catch 重置
 *   - POST body 不含 updatedAt（strict 模式拒绝）
 */

import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { ApiError, get, post } from '@/utils/api'
import { loadSave, saveSave } from '@/utils/storage'
import type { EndedReason, GameSave } from '@/types/game'

/** 时间戳比较误差容忍（毫秒） */
const TIMESTAMP_TOLERANCE_MS = 1000

/** sync-save 接口的响应 data 类型 */
interface SyncSavePostResponse {
  saveId: string
  updatedAt: number
  endedAt: number | null
  endedReason: EndedReason | null
}

interface SyncSaveGetResponse {
  save: GameSave
  updatedAt: number
}

export interface UseSaveSyncOptions {
  /**
   * 弹确认框（云端新于本地时调用）
   * 默认实现可由调用方注入 useConfirmDialog
   * @returns true 表示用户确认拉取云端覆盖本地
   */
  confirmOverwrite?: (cloudUpdatedAt: number, localUpdatedAt: number) => Promise<boolean>
  /**
   * 成功提示
   */
  onSuccess?: (message: string) => void
  /**
   * 错误提示
   */
  onError?: (message: string) => void
}

export function useSaveSync(options: UseSaveSyncOptions = {}) {
  const store = useGameStore()

  const isSyncing = computed(() => store.isSyncing)

  /**
   * 同步本地与云端存档
   *
   * @returns 同步结果描述（用于调用方自行 toast）
   */
  async function sync(): Promise<{ action: 'noop' | 'uploaded' | 'pulled' | 'error'; message: string }> {
    if (store.isSyncing) {
      return { action: 'noop', message: '同步进行中' }
    }

    const localSave = store.currentSave ?? (await loadSave())
    if (!localSave) {
      return { action: 'error', message: '本地无存档，无法同步' }
    }

    store.setSyncing(true)

    try {
      // 1. 查询云端状态
      let cloud: SyncSaveGetResponse | null = null
      try {
        cloud = await get<SyncSaveGetResponse>(`/api/game/sync-save?saveId=${encodeURIComponent(localSave.saveId)}`)
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 404) {
          // 404: 云端不存在，走首次上传
          cloud = null
        } else {
          throw err
        }
      }

      // 2. 云端不存在 → 上传本地
      if (!cloud) {
        await uploadLocal(localSave)
        return { action: 'uploaded', message: '本地存档已上传至云端' }
      }

      // 3. 比较时间戳
      const localTs = localSave.updatedAt
      const cloudTs = cloud.updatedAt
      const diff = localTs - cloudTs

      if (Math.abs(diff) < TIMESTAMP_TOLERANCE_MS) {
        // 4. 误差范围内：无操作
        return { action: 'noop', message: '本地与云端已是最新' }
      }

      if (diff > 0) {
        // 5. 本地新 → 上传
        await uploadLocal(localSave)
        return { action: 'uploaded', message: '本地存档已同步到云端' }
      }

      // 6. 云端新 → 弹确认框，确认后拉取
      const confirmed = options.confirmOverwrite
        ? await options.confirmOverwrite(cloudTs, localTs)
        : true

      if (!confirmed) {
        return { action: 'noop', message: '已取消拉取云端存档' }
      }

      await pullCloud(cloud.save)
      return { action: 'pulled', message: '云端存档已拉取到本地' }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '同步失败'
      options.onError?.(message)
      return { action: 'error', message }
    } finally {
      store.setSyncing(false)
    }
  }

  /**
   * 上传本地存档到云端
   * 用服务端返回的 updatedAt 写回本地
   */
  async function uploadLocal(localSave: GameSave): Promise<void> {
    // POST body 不含 updatedAt（strict 模式拒绝）
    // 用对象解构剔除 updatedAt，避免 lint 未使用变量告警
    const savePayload: Omit<GameSave, 'updatedAt'> = {
      saveVersion: localSave.saveVersion,
      saveId: localSave.saveId,
      deviceId: localSave.deviceId,
      createdAt: localSave.createdAt,
      character: localSave.character,
      state: localSave.state,
      factions: localSave.factions,
      events: localSave.events,
      advisorMessages: localSave.advisorMessages,
      pendingChainNodes: localSave.pendingChainNodes,
      completedChainIds: localSave.completedChainIds,
      activeChainIds: localSave.activeChainIds,
      ended: localSave.ended,
      endedAt: localSave.endedAt,
      endedReason: localSave.endedReason
    }
    const res = await post<SyncSavePostResponse>('/api/game/sync-save', savePayload)

    // 用服务端权威 updatedAt 写回本地
    const updated: GameSave = {
      ...localSave,
      updatedAt: res.updatedAt,
      endedAt: res.endedAt ?? undefined,
      endedReason: res.endedReason ?? undefined
    }
    await saveSave(updated)
    store.setSave(updated)
  }

  /**
   * 拉取云端存档覆盖本地
   */
  async function pullCloud(cloudSave: GameSave): Promise<void> {
    await saveSave(cloudSave)
    store.setSave(cloudSave)
  }

  return {
    isSyncing,
    sync
  }
}
