/**
 * @file useSaveList.ts 单元测试
 *
 * 覆盖：列表拉取与守卫 / 切换（含错误与防重复）/ 删除（含删除当前本地档）/
 *       导出（H5 Blob 路径）/ 导入（JSON 解析 + 结构校验 + 写入）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError } from '../../src/utils/api'
import type { GameSave } from '../../src/types/game'

// ====================== mock api ======================
const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  del: vi.fn()
}))

vi.mock('../../src/utils/api', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/api')>('../../src/utils/api')
  return {
    ...actual,
    get: apiMocks.get,
    del: apiMocks.del
  }
})

// ====================== mock device-credential ======================
// 默认返回空凭据 = 走服务端双轨兼容通道（URL 里仍带 deviceId）；
// 用例可覆盖成返回一个 token，断言 URL 不再声明 deviceId。
// 必须 mock：setup 里的 uni.request 是空 vi.fn()，真注册会永久挂住。
const credentialMocks = vi.hoisted(() => ({ ensureCredential: vi.fn() }))

vi.mock('../../src/utils/device-credential', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/device-credential')>(
    '../../src/utils/device-credential'
  )
  return {
    ...actual,
    ensureCredential: credentialMocks.ensureCredential,
    // 调用点已改走 withCredentialRetry，它内部调的是同模块真 ensureCredential，
    // 只 mock 前者拦不住。这里只做「取凭据 → 执行」的透传，
    // 401 清缓存重试的语义由 tests/unit/device-credential.test.ts 专门覆盖。
    withCredentialRetry: async <T>(call: (token: string) => Promise<T>): Promise<T> =>
      call(await credentialMocks.ensureCredential())
  }
})

// ====================== mock storage（保留真实 isValidSaveShape 供导入复用） ======================
const storageMocks = vi.hoisted(() => ({
  saveSave: vi.fn().mockResolvedValue(undefined),
  clearSave: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../src/utils/storage', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/storage')>(
    '../../src/utils/storage'
  )
  return {
    ...actual,
    saveSave: storageMocks.saveSave,
    clearSave: storageMocks.clearSave
  }
})

// ====================== 工具函数 ======================

function createMockSave(saveId = 'save-list-id', updatedAt = 2000): GameSave {
  return {
    saveVersion: 1,
    saveId,
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
      turn: 3,
      date: { year: 1851, month: 3 },
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

function makeListItem(saveId: string, overrides: Record<string, unknown> = {}) {
  return {
    saveId,
    saveVersion: 2,
    updatedAt: 5000,
    endedAt: null,
    endedReason: null,
    summary: { background: '武将', factionName: '湘军', turn: 7, ended: false },
    ...overrides
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  apiMocks.get.mockReset()
  apiMocks.del.mockReset()
  credentialMocks.ensureCredential.mockReset().mockResolvedValue('')
  storageMocks.saveSave.mockClear().mockResolvedValue(undefined)
  storageMocks.clearSave.mockClear().mockResolvedValue(undefined)
  // jsdom 无 URL.createObjectURL/revokeObjectURL，导出测试需要（beforeEach 重置防泄漏）
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
})

// ====================== 测试 ======================

describe('useSaveList - fetchList', () => {
  it('成功拉取列表并更新 saves', async () => {
    const { useSaveList } = await import('../../src/composables/useSaveList')
    const items = [makeListItem('a'), makeListItem('b')]
    apiMocks.get.mockResolvedValueOnce({ saves: items })

    const { fetchList, saves } = useSaveList()
    const res = await fetchList()

    expect(res).toHaveLength(2)
    expect(saves.value).toEqual(items)
    expect(apiMocks.get).toHaveBeenCalledWith(expect.stringContaining('/api/game/saves?limit=20'))
    // 无凭据 → 兼容通道：deviceId 作为 query 兜底声明（收紧后这条回落会被服务端拒绝）
    expect(apiMocks.get).toHaveBeenCalledWith(expect.stringContaining('&deviceId='))
  })

  it('拿到凭据时 URL 不再声明 deviceId（属主由 x-device-token 反查，不落进 URL/浏览器历史）', async () => {
    const { useSaveList } = await import('../../src/composables/useSaveList')
    credentialMocks.ensureCredential.mockResolvedValue('a'.repeat(64))
    apiMocks.get.mockResolvedValueOnce({ saves: [makeListItem('a')] })

    const { fetchList } = useSaveList()
    await fetchList()

    expect(apiMocks.get).toHaveBeenCalledWith('/api/game/saves?limit=20')
  })

  it('isLoading 期间重复调用直接返回缓存，不重复请求', async () => {
    const { useSaveList } = await import('../../src/composables/useSaveList')
    let resolveGet: (v: { saves: unknown[] }) => void = () => {}
    apiMocks.get.mockImplementationOnce(
      () => new Promise((resolve) => (resolveGet = resolve))
    )

    const { fetchList, isLoading } = useSaveList()
    const first = fetchList()
    expect(isLoading.value).toBe(true)
    const second = await fetchList() // 挂起期间调用 → 走守卫
    resolveGet({ saves: [makeListItem('a')] })
    const res = await first

    expect(apiMocks.get).toHaveBeenCalledTimes(1)
    expect(second).toEqual([])
    expect(res).toHaveLength(1)
    expect(isLoading.value).toBe(false)
  })
})

describe('useSaveList - switchSave', () => {
  it('成功：拉全量 → 写本地 → 更新 store → isMutating 重置', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveList } = await import('../../src/composables/useSaveList')
    const store = useGameStore()
    const cloud = createMockSave('cloud-save', 9000)
    apiMocks.get.mockResolvedValueOnce({ save: cloud, updatedAt: 9000 })

    const { switchSave } = useSaveList()
    const res = await switchSave('cloud-save')

    expect(res.ok).toBe(true)
    expect(apiMocks.get).toHaveBeenCalledWith(
      expect.stringContaining('sync-save?saveId=cloud-save&deviceId=')
    )
    expect(storageMocks.saveSave).toHaveBeenCalledWith(cloud)
    expect(store.currentSave?.saveId).toBe('cloud-save')
  })

  it('API 失败：ok=false + 服务端 message，本地不动', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveList } = await import('../../src/composables/useSaveList')
    const store = useGameStore()
    store.setSave(createMockSave('local-save'))
    apiMocks.get.mockRejectedValueOnce(new ApiError('SAVE_NOT_FOUND', '云端未找到此存档', 404))

    const { switchSave } = useSaveList()
    const res = await switchSave('cloud-save')

    expect(res.ok).toBe(false)
    expect(res.message).toContain('云端未找到')
    expect(store.currentSave?.saveId).toBe('local-save')
  })

  it('isMutating 守卫：进行中重复调用返回操作进行中', async () => {
    const { useSaveList } = await import('../../src/composables/useSaveList')
    let resolveGet: (v: unknown) => void = () => {}
    apiMocks.get.mockImplementationOnce(() => new Promise((resolve) => (resolveGet = resolve)))

    const { switchSave, isMutating } = useSaveList()
    const first = switchSave('a')
    const second = await switchSave('b') // 挂起期间调用 → 守卫拦截
    resolveGet({ save: createMockSave('a'), updatedAt: 1 })
    await first

    expect(second.ok).toBe(false)
    expect(second.message).toContain('操作进行中')
    expect(isMutating.value).toBe(false)
  })
})

describe('useSaveList - deleteSave', () => {
  it('删除非当前档：调 DELETE 且本地列表同步移除，本地存档不动', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveList } = await import('../../src/composables/useSaveList')
    const store = useGameStore()
    store.setSave(createMockSave('local-save'))
    apiMocks.del.mockResolvedValueOnce({ saveId: 'cloud-a', deleted: true })

    const { deleteSave, saves } = useSaveList()
    saves.value = [makeListItem('cloud-a'), makeListItem('cloud-b')]
    const res = await deleteSave('cloud-a')

    expect(res.ok).toBe(true)
    expect(apiMocks.del).toHaveBeenCalledWith(
      expect.stringContaining('saveId=cloud-a&deviceId=')
    )
    expect(saves.value.map((s) => s.saveId)).toEqual(['cloud-b'])
    expect(storageMocks.clearSave).not.toHaveBeenCalled()
    expect(store.currentSave?.saveId).toBe('local-save')
  })

  it('删除当前本地档：同步清本地 + store 置空（防幽灵存档）', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveList } = await import('../../src/composables/useSaveList')
    const store = useGameStore()
    store.setSave(createMockSave('local-save'))
    apiMocks.del.mockResolvedValueOnce({ saveId: 'local-save', deleted: true })

    const { deleteSave } = useSaveList()
    const res = await deleteSave('local-save')

    expect(res.ok).toBe(true)
    expect(storageMocks.clearSave).toHaveBeenCalledTimes(1)
    expect(store.currentSave).toBeNull()
  })

  it('删除失败（404）：ok=false + message', async () => {
    const { useSaveList } = await import('../../src/composables/useSaveList')
    apiMocks.del.mockRejectedValueOnce(new ApiError('SAVE_NOT_FOUND', '云端未找到此存档', 404))

    const { deleteSave } = useSaveList()
    const res = await deleteSave('no-such')

    expect(res.ok).toBe(false)
    expect(res.message).toContain('云端未找到')
  })
})

describe('useSaveList - exportSave（H5 路径，jsdom uniPlatform=h5）', () => {
  it('成功：createObjectURL + 下载触发', async () => {
    const { useSaveList } = await import('../../src/composables/useSaveList')
    const cloud = createMockSave('export-me')
    apiMocks.get.mockResolvedValueOnce({ save: cloud, updatedAt: 1 })

    const { exportSave } = useSaveList()
    const res = await exportSave('export-me')

    expect(res.ok).toBe(true)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    // 延后 revoke，不立即调用
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })

  it('下载环境异常：ok=false + 提示', async () => {
    const { useSaveList } = await import('../../src/composables/useSaveList')
    apiMocks.get.mockResolvedValueOnce({ save: createMockSave('x'), updatedAt: 1 })
    ;(URL.createObjectURL as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('no blob support')
    })

    const { exportSave } = useSaveList()
    const res = await exportSave('x')

    expect(res.ok).toBe(false)
    expect(res.message).toContain('导出存档失败')
  })
})

describe('useSaveList - importSave', () => {
  it('非法 JSON：ok=false', async () => {
    const { useSaveList } = await import('../../src/composables/useSaveList')
    const { importSave } = useSaveList()

    const res = await importSave('{not-json')
    expect(res.ok).toBe(false)
    expect(res.message).toContain('JSON')
  })

  it('结构校验失败（缺关键字段）：ok=false，不写本地', async () => {
    const { useSaveList } = await import('../../src/composables/useSaveList')
    const { importSave } = useSaveList()

    const res = await importSave(JSON.stringify({ saveId: 'x', foo: 1 }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain('结构校验失败')
    expect(storageMocks.saveSave).not.toHaveBeenCalled()
  })

  it('合法存档：写入本地 + 更新 store', async () => {
    const { useGameStore } = await import('../../src/stores/game')
    const { useSaveList } = await import('../../src/composables/useSaveList')
    const store = useGameStore()
    const imported = createMockSave('imported-save')

    const { importSave } = useSaveList()
    const res = await importSave(JSON.stringify(imported))

    expect(res.ok).toBe(true)
    expect(storageMocks.saveSave).toHaveBeenCalledWith(imported)
    expect(store.currentSave?.saveId).toBe('imported-save')
  })
})
