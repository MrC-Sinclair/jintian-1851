/**
 * @file 本地存档读写封装
 *
 * 所有存档读写必须通过本模块，禁止直接调用 uni.setStorage（spec 强制）。
 * 封装 uni.setStorage/getStorage/removeStorage 异步 API 为 Promise。
 *
 * 健壮性：读取时做最小结构校验，损坏存档（写一半/字段缺失/版本异常）
 * 备份到 `game_save_corrupted` 并清除主键，返回 null 引导重新开局，
 * 避免坏数据流入 store 引发 undefined 访问（可通过 db:studio 或调试工具取回备份排查）。
 */

import type { GameSave } from '@/types/game'

const STORAGE_KEY = 'game_save'
/** 损坏存档隔离备份 key（人工排查用，不参与正常读写） */
const CORRUPTED_BACKUP_KEY = 'game_save_corrupted'

/**
 * 存档最小结构校验（字段级，防 JSON 半截/版本错乱数据流入 store）
 *
 * 只校验"缺了必然崩溃"的关键字段**类型**，不校验业务取值（空数组/数值范围是
 * v1 兼容与迁移逻辑的职责，见 useGameState.migrateSaveV1ToV2）。
 *
 * 导出：JSON 导入（存档管理）复用同一校验，保证导入与本地读取口径一致。
 */
export function isValidSaveShape(data: unknown): data is GameSave {
  if (!data || typeof data !== 'object') return false
  const s = data as Record<string, unknown>
  return (
    typeof s.saveId === 'string' &&
    s.saveId.length > 0 &&
    typeof s.deviceId === 'string' &&
    typeof s.createdAt === 'number' &&
    (s.saveVersion === 1 || s.saveVersion === 2) &&
    typeof s.character === 'object' &&
    s.character !== null &&
    typeof s.state === 'object' &&
    s.state !== null &&
    Array.isArray(s.factions) &&
    Array.isArray(s.events) &&
    Array.isArray(s.advisorMessages)
  )
}

/** 隔离损坏存档：备份原始数据 → 移除主键（失败不阻断，返回 null 已足够安全） */
function quarantineCorrupted(data: unknown): void {
  try {
    uni.setStorageSync(CORRUPTED_BACKUP_KEY, data)
    uni.removeStorageSync(STORAGE_KEY)
    console.warn('[storage] 本地存档结构校验失败，已备份至 game_save_corrupted 并清除主存档')
  } catch (err) {
    console.warn('[storage] 损坏存档隔离失败:', err)
  }
}

/**
 * 保存存档到本地存储
 * @param save 完整存档对象
 * @throws 存储失败时 reject（如超出 10MB 上限）
 */
export function saveSave(save: GameSave): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.setStorage({
      key: STORAGE_KEY,
      data: save,
      success: () => resolve(),
      fail: (err) => reject(new Error(`存档保存失败: ${err?.errMsg ?? 'unknown'}`))
    })
  })
}

/**
 * 读取本地存档
 * @returns 存档对象，不存在或结构损坏返回 null（损坏数据自动隔离备份）
 * @throws 读取失败时 reject
 */
export function loadSave(): Promise<GameSave | null> {
  return new Promise((resolve, reject) => {
    uni.getStorage({
      key: STORAGE_KEY,
      success: (res: { data: GameSave }) => {
        if (res?.data && isValidSaveShape(res.data)) {
          resolve(res.data)
        } else if (res?.data && typeof res.data === 'object') {
          // 有数据但结构非法：隔离 + 按"无存档"处理
          quarantineCorrupted(res.data)
          resolve(null)
        } else {
          resolve(null)
        }
      },
      fail: (err: { errMsg?: string }) => {
        // key 不存在是正常情况，返回 null 而非 reject
        if (err?.errMsg?.includes('data not found') || err?.errMsg?.includes('key not found')) {
          resolve(null)
        } else {
          reject(new Error(`存档读取失败: ${err?.errMsg ?? 'unknown'}`))
        }
      }
    })
  })
}

/**
 * 清除本地存档（不可逆，需配合 ConfirmDialog 守卫）
 */
export function clearSave(): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.removeStorage({
      key: STORAGE_KEY,
      success: () => resolve(),
      fail: (err) => reject(new Error(`存档清除失败: ${err?.errMsg ?? 'unknown'}`))
    })
  })
}

/**
 * 同步读取本地存档（用于初始化时阻塞读取）
 * @returns 存档对象，不存在或结构损坏返回 null（损坏数据自动隔离备份）
 */
export function loadSaveSync(): GameSave | null {
  const data = uni.getStorageSync(STORAGE_KEY) as GameSave | undefined
  if (data && isValidSaveShape(data)) {
    return data
  }
  if (data && typeof data === 'object') {
    quarantineCorrupted(data)
  }
  return null
}

/**
 * 只读「持有证明」需要的两个字段：saveId + createdAt
 *
 * 故意不复用 loadSaveSync：它在校验失败时会**隔离删除主存档**，而取证明只是注册重试
 * 的一条鉴权旁路，不该有删档的副作用。这里只读值、不做结构判定、更不动存储。
 *
 * @returns 本地有档返回 { saveId, createdAt }，没有或字段异常返回 null
 */
export function readOwnershipProof(): { saveId: string; createdAt: number } | null {
  try {
    const s = uni.getStorageSync(STORAGE_KEY) as
      | { saveId?: unknown; createdAt?: unknown }
      | undefined
    if (
      s &&
      typeof s.saveId === 'string' &&
      s.saveId.length > 0 &&
      typeof s.createdAt === 'number'
    ) {
      return { saveId: s.saveId, createdAt: s.createdAt }
    }
  } catch (err) {
    console.warn('[storage] 读取持有证明字段失败:', err)
  }
  return null
}
