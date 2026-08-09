/**
 * @file storage.ts 单元测试
 *
 * 覆盖 save/load/clear 三组操作
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { clearSave, loadSave, loadSaveSync, saveSave } from '../../src/utils/storage'
import type { GameSave } from '../../src/types/game'

const STORAGE_KEY = 'game_save'

function createMockSave(): GameSave {
  return {
    saveVersion: 1,
    saveId: '550e8400-e29b-41d4-a716-446655440000',
    deviceId: 'test-device-id',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    character: {
      background: '文官',
      backgroundPerks: { politics: 5 },
      factionId: 'f1',
      factionName: '清廷',
      factionSummary: '晚清朝廷'
    },
    state: {
      turn: 1,
      date: { year: 1851, month: 1 },
      attributes: {
        military: 50,
        economy: 50,
        politics: 55,
        people: 50,
        diplomacy: 50
      },
      resources: {
        silver: 1000,
        troops: 500,
        food: 300,
        reputation: 30
      }
    },
    factions: [
      {
        id: 'f1',
        name: '清廷',
        summary: '晚清朝廷',
        power: 70,
        relationship: 100,
        status: 'active'
      }
    ],
    events: [],
    advisorMessages: [],
    ended: false
  }
}

beforeEach(() => {
  if (typeof uni !== 'undefined' && uni.removeStorageSync) {
    uni.removeStorageSync(STORAGE_KEY)
  }
})

describe('saveSave + loadSave', () => {
  it('保存后读取应返回相同存档', async () => {
    const save = createMockSave()
    await saveSave(save)
    const loaded = await loadSave()
    expect(loaded).not.toBeNull()
    expect(loaded?.saveId).toBe(save.saveId)
    expect(loaded?.character.factionName).toBe('清廷')
    expect(loaded?.state.turn).toBe(1)
  })

  it('未保存时读取应返回 null', async () => {
    const loaded = await loadSave()
    expect(loaded).toBeNull()
  })
})

describe('clearSave', () => {
  it('清除后读取应返回 null', async () => {
    const save = createMockSave()
    await saveSave(save)
    expect(await loadSave()).not.toBeNull()

    await clearSave()
    expect(await loadSave()).toBeNull()
  })
})

describe('loadSaveSync', () => {
  it('同步读取已保存的存档', async () => {
    const save = createMockSave()
    await saveSave(save)
    const loaded = loadSaveSync()
    expect(loaded).not.toBeNull()
    expect(loaded?.saveId).toBe(save.saveId)
  })

  it('未保存时同步读取返回 null', () => {
    expect(loadSaveSync()).toBeNull()
  })
})

describe('saveSave 错误处理', () => {
  it('存储失败应 reject', async () => {
    // 临时替换 setStorage 让它 fail
    const original = uni.setStorage
    ;(uni as any).setStorage = ({ fail }: any) =>
      fail && fail({ errMsg: 'storage full' })

    await expect(saveSave(createMockSave())).rejects.toThrow('存档保存失败')

    // 恢复
    ;(uni as any).setStorage = original
  })
})
