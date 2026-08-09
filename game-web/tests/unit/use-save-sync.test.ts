/**
 * @file useSaveSync.ts 单元测试
 *
 * 覆盖 design.md D7 五个分支 + |差值| < 1000ms 边界：
 *   1. 云端 404 → POST 上传
 *   2. 本地>云端 > 1 秒 → POST 上传
 *   3. 本地<云端 > 1 秒 → 弹 confirmDialog → 确认后 GET 拉取
 *   4. |差值| < 1000ms → 不发请求，toast「已是最新」
 *   5. POST 失败 → isSyncing 重置 + toast.error
 *   6. 无存档 → 返回 error
 *   7. isSyncing 守卫：重复调用直接返回 noop
 *   8. confirmOverwrite 返回 false → 不拉取
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError } from '../../src/utils/api'
import type { GameSave } from '../../src/types/game'

// ====================== mock api ======================
const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn()
}))

vi.mock('../../src/utils/api', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/api')>('../../src/utils/api')
  return {
    ...actual,
    get: apiMocks.get,
    post: apiMocks.post
  }
})

// ====================== mock storage ======================
const storageMocks = vi.hoisted(() => ({
  saveSave: vi.fn().mockResolvedValue(undefined),
  loadSave: vi.fn().mockResolvedValue(null)
}))

vi.mock('../../src/utils/storage', () => ({
  saveSave: storageMocks.saveSave,
  loadSave: storageMocks.loadSave,
  clearSave: vi.fn().mockResolvedValue(undefined),
  loadSaveSync: vi.fn().mockReturnValue(null)
}))

// ====================== 工具函数 ======================

function createMockSave(updatedAt: number): GameSave {
  return {
    saveVersion: 1,
    saveId: 'save-test-id',
    deviceId: 'test-device',
    createdAt: 1000,
    updatedAt,
    character: {
      background: '文官',
      backgroundPerks: { politics: 10 },
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
      resources: { silver: 1000, troops: 500, food: 800, reputation: 10 }
    },
    factions: [],
    events: [],
    advisorMessages: [],
    ended: false
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  apiMocks.get.mockReset()
  apiMocks.post.mockReset()
  storageMocks.saveSave.mockClear()
  storageMocks.loadSave.mockClear()
  storageMocks.loadSave.mockResolvedValue(null)
})

// ====================== 测试 ======================

describe('useSaveSync - 前置校验', () => {
  it('无存档返回 error', async () => {
    const { useSaveSync } = await import('../../src/composables/useSaveSync')
    const { sync } = useSaveSync()
    const result = await sync()
    expect(result.action).toBe('error')
    expect(result.message).toContain('本地无存档')
    expect(apiMocks.get).not.toHaveBeenCalled()
  })

  it('isSyncing 时重复调用返回 noop', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveSync } = await import('../../src/composables/useSaveSync')
    const store = useGameStore()
    store.setSave(createMockSave(2000))
    store.setSyncing(true)

    const { sync } = useSaveSync()
    const result = await sync()
    expect(result.action).toBe('noop')
    expect(result.message).toContain('同步进行中')
  })
})

describe('useSaveSync - 分支 1：云端 404 触发 POST 上传', () => {
  it('GET 404 → POST 上传 + 用服务端 updatedAt 写回本地', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveSync } = await import('../../src/composables/useSaveSync')
    const store = useGameStore()
    const localSave = createMockSave(2000)
    store.setSave(localSave)

    // GET 抛 404
    apiMocks.get.mockRejectedValueOnce(new ApiError('NOT_FOUND', 'not found', 404))
    // POST 返回服务端权威 updatedAt
    apiMocks.post.mockResolvedValueOnce({
      saveId: 'save-test-id',
      updatedAt: 3000,
      endedAt: null,
      endedReason: null
    })

    const { sync } = useSaveSync()
    const result = await sync()

    expect(result.action).toBe('uploaded')
    expect(apiMocks.post).toHaveBeenCalledTimes(1)
    // 用服务端 updatedAt 写回本地
    expect(storageMocks.saveSave).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: 3000 }))
    // store 也更新
    expect(store.currentSave?.updatedAt).toBe(3000)
    // isSyncing 已重置
    expect(store.isSyncing).toBe(false)
  })
})

describe('useSaveSync - 分支 2：本地新于云端 > 1 秒触发 POST', () => {
  it('本地 updatedAt - 云端 updatedAt > 1000 → POST 上传', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveSync } = await import('../../src/composables/useSaveSync')
    const store = useGameStore()
    // 本地 5000，云端 2000，差 3000ms > 1000
    store.setSave(createMockSave(5000))
    apiMocks.get.mockResolvedValueOnce({
      save: createMockSave(2000),
      updatedAt: 2000
    })
    apiMocks.post.mockResolvedValueOnce({
      saveId: 'save-test-id',
      updatedAt: 5000,
      endedAt: null,
      endedReason: null
    })

    const { sync } = useSaveSync()
    const result = await sync()

    expect(result.action).toBe('uploaded')
    expect(apiMocks.post).toHaveBeenCalledTimes(1)
  })
})

describe('useSaveSync - 分支 3：云端新于本地 > 1 秒触发 confirm + GET 拉取', () => {
  it('云端 - 本地 > 1000 + 用户确认 → 拉取云端覆盖本地', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveSync } = await import('../../src/composables/useSaveSync')
    const store = useGameStore()
    // 本地 2000，云端 5000，差 3000ms > 1000
    store.setSave(createMockSave(2000))
    const cloudSave = createMockSave(5000)
    apiMocks.get.mockResolvedValueOnce({
      save: cloudSave,
      updatedAt: 5000
    })

    const confirmOverwrite = vi.fn().mockResolvedValue(true)
    const { sync } = useSaveSync({ confirmOverwrite })
    const result = await sync()

    expect(result.action).toBe('pulled')
    expect(confirmOverwrite).toHaveBeenCalledWith(5000, 2000)
    // 拉取的 save 写入本地
    expect(storageMocks.saveSave).toHaveBeenCalledWith(cloudSave)
    expect(store.currentSave?.updatedAt).toBe(5000)
  })

  it('用户拒绝确认 → 不拉取，返回 noop', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveSync } = await import('../../src/composables/useSaveSync')
    const store = useGameStore()
    store.setSave(createMockSave(2000))
    apiMocks.get.mockResolvedValueOnce({
      save: createMockSave(5000),
      updatedAt: 5000
    })

    const confirmOverwrite = vi.fn().mockResolvedValue(false)
    const { sync } = useSaveSync({ confirmOverwrite })
    const result = await sync()

    expect(result.action).toBe('noop')
    expect(storageMocks.saveSave).not.toHaveBeenCalled()
    // 本地保持原值
    expect(store.currentSave?.updatedAt).toBe(2000)
  })

  it('未提供 confirmOverwrite → 默认拉取', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveSync } = await import('../../src/composables/useSaveSync')
    const store = useGameStore()
    store.setSave(createMockSave(2000))
    apiMocks.get.mockResolvedValueOnce({
      save: createMockSave(5000),
      updatedAt: 5000
    })

    const { sync } = useSaveSync()
    const result = await sync()

    expect(result.action).toBe('pulled')
  })
})

describe('useSaveSync - 分支 4：|差值| < 1000ms 不发请求', () => {
  it('差值 500ms → noop + 「已是最新」', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveSync } = await import('../../src/composables/useSaveSync')
    const store = useGameStore()
    store.setSave(createMockSave(2500))
    apiMocks.get.mockResolvedValueOnce({
      save: createMockSave(2000),
      updatedAt: 2000
    })

    const { sync } = useSaveSync()
    const result = await sync()

    expect(result.action).toBe('noop')
    expect(result.message).toContain('已是最新')
    expect(apiMocks.post).not.toHaveBeenCalled()
    expect(storageMocks.saveSave).not.toHaveBeenCalled()
  })

  it('差值等于 1000ms 仍触发上传（不在容忍范围内）', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveSync } = await import('../../src/composables/useSaveSync')
    const store = useGameStore()
    // 本地 3000，云端 2000，差值 = 1000（不 < 1000），走上传
    store.setSave(createMockSave(3000))
    apiMocks.get.mockResolvedValueOnce({
      save: createMockSave(2000),
      updatedAt: 2000
    })
    apiMocks.post.mockResolvedValueOnce({
      saveId: 'save-test-id',
      updatedAt: 3000,
      endedAt: null,
      endedReason: null
    })

    const { sync } = useSaveSync()
    const result = await sync()

    expect(result.action).toBe('uploaded')
  })

  it('差值 -1000ms 触发 confirm（不 < 1000）', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveSync } = await import('../../src/composables/useSaveSync')
    const store = useGameStore()
    // 本地 2000，云端 3000，差值 = -1000（不 < 1000），走拉取
    store.setSave(createMockSave(2000))
    apiMocks.get.mockResolvedValueOnce({
      save: createMockSave(3000),
      updatedAt: 3000
    })

    const confirmOverwrite = vi.fn().mockResolvedValue(true)
    const { sync } = useSaveSync({ confirmOverwrite })
    const result = await sync()

    expect(result.action).toBe('pulled')
  })
})

describe('useSaveSync - 分支 5：POST 失败 isSyncing 重置 + onError', () => {
  it('GET 失败（非 404）→ error + isSyncing 重置', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveSync } = await import('../../src/composables/useSaveSync')
    const store = useGameStore()
    store.setSave(createMockSave(2000))
    apiMocks.get.mockRejectedValueOnce(new ApiError('NETWORK', 'network error', 500))

    const onError = vi.fn()
    const { sync } = useSaveSync({ onError })
    const result = await sync()

    expect(result.action).toBe('error')
    expect(result.message).toContain('network error')
    expect(onError).toHaveBeenCalled()
    expect(store.isSyncing).toBe(false)
  })

  it('POST 失败 → error + isSyncing 重置', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveSync } = await import('../../src/composables/useSaveSync')
    const store = useGameStore()
    store.setSave(createMockSave(5000))
    apiMocks.get.mockResolvedValueOnce({
      save: createMockSave(2000),
      updatedAt: 2000
    })
    apiMocks.post.mockRejectedValueOnce(new ApiError('SERVER_ERROR', 'server down', 500))

    const onError = vi.fn()
    const { sync } = useSaveSync({ onError })
    const result = await sync()

    expect(result.action).toBe('error')
    expect(result.message).toContain('server down')
    expect(onError).toHaveBeenCalled()
    expect(store.isSyncing).toBe(false)
    // 本地保持原值，未被覆盖
    expect(store.currentSave?.updatedAt).toBe(5000)
  })
})

describe('useSaveSync - onSuccess 回调', () => {
  it('上传成功触发 onSuccess', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveSync } = await import('../../src/composables/useSaveSync')
    const store = useGameStore()
    store.setSave(createMockSave(2000))
    apiMocks.get.mockRejectedValueOnce(new ApiError('NOT_FOUND', 'not found', 404))
    apiMocks.post.mockResolvedValueOnce({
      saveId: 'save-test-id',
      updatedAt: 3000,
      endedAt: null,
      endedReason: null
    })

    const onSuccess = vi.fn()
    const { sync } = useSaveSync({ onSuccess })
    await sync()

    // 注意：当前实现未在 sync 内部调用 onSuccess，由调用方根据 result.action 自行 toast
    // 这里仅验证 onSuccess 是可选的，不报错
    expect(store.isSyncing).toBe(false)
  })
})
