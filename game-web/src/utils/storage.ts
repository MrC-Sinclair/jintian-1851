/**
 * @file 本地存档读写封装
 *
 * 所有存档读写必须通过本模块，禁止直接调用 uni.setStorage（spec 强制）。
 * 封装 uni.setStorage/getStorage/removeStorage 异步 API 为 Promise。
 */

import type { GameSave } from '@/types/game'

const STORAGE_KEY = 'game_save'

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
 * @returns 存档对象，不存在返回 null
 * @throws 读取失败或 JSON 解析失败时 reject
 */
export function loadSave(): Promise<GameSave | null> {
  return new Promise((resolve, reject) => {
    uni.getStorage({
      key: STORAGE_KEY,
      success: (res: { data: GameSave }) => {
        if (res?.data && typeof res.data === 'object') {
          resolve(res.data as GameSave)
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
 * @returns 存档对象，不存在返回 null
 */
export function loadSaveSync(): GameSave | null {
  const data = uni.getStorageSync(STORAGE_KEY) as GameSave | undefined
  if (data && typeof data === 'object') {
    return data
  }
  return null
}
