/**
 * @file sync-save API 集成测试
 *
 * 覆盖首次上传 / 二次覆盖 / 并发 / strict 拒绝 / 拉取 / 参数错误
 *      / 凭据属主裁决（写入的 device_id 取凭据反查值，不取 body 自声明）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 用 vi.hoisted 创建链式 mock，供 vi.mock 工厂引用
const dbMock = vi.hoisted(() => {
  const returningMock = vi.fn(() => [
    {
      saveId: '550e8400-e29b-41d4-a716-446655440000',
      updatedAt: new Date('2026-01-01'),
      endedAt: null,
      endedReason: null
    }
  ])
  const onConflictMock = vi.fn(() => ({ returning: returningMock }))
  const valuesMock = vi.fn(() => ({ onConflictDoUpdate: onConflictMock }))
  const insertMock = vi.fn(() => ({ values: valuesMock }))

  const limitMock = vi.fn((): any[] => [])
  const whereMock = vi.fn(() => ({ limit: limitMock }))
  const fromMock = vi.fn(() => ({ where: whereMock }))
  const selectMock = vi.fn(() => ({ from: fromMock }))

  return {
    db: { insert: insertMock, select: selectMock },
    returningMock,
    limitMock,
    insertMock,
    selectMock,
    valuesMock,
    onConflictMock
  }
})

vi.mock('../../server/db', () => ({ db: dbMock.db }))

import handler from '../../server/api/game/sync-save'

const readBodyMock = (globalThis as any).readBody as ReturnType<typeof vi.fn>
const getQueryMock = (globalThis as any).getQuery as ReturnType<typeof vi.fn>
const getHeaderMock = (globalThis as any).getHeader as ReturnType<typeof vi.fn>
const SAVE_ID = '550e8400-e29b-41d4-a716-446655440000'

// 双轨开关：覆盖 setup 的固定 mock，用例改字段、beforeEach 复位
const authConfig = { deviceAuthEnforced: false, deviceAuthAllowFirstBind: true }
;(globalThis as any).useRuntimeConfig = () => authConfig

/** 让 `x-device-token` 反查命中 ownerDeviceId（select→from→where→limit 的第一次 limit 调用） */
function stubTokenLookup(token: string, ownerDeviceId: string): void {
  getHeaderMock.mockImplementation((_: unknown, name: string) =>
    name === 'x-device-token' ? token : undefined
  )
  dbMock.limitMock.mockImplementationOnce(() => [{ deviceId: ownerDeviceId }])
}

function makeEvent(): any {
  return { node: { res: { write: vi.fn(async () => {}), end: vi.fn() } } }
}

function makeSaveData(overrides = {}): any {
  return {
    saveVersion: 1,
    saveId: SAVE_ID,
    deviceId: 'device-1',
    createdAt: 1700000000000,
    character: {
      background: '文官',
      backgroundPerks: { politics: 5 },
      factionId: 'qing-ting',
      factionName: '清廷',
      factionSummary: '大清朝廷'
    },
    state: {
      turn: 1,
      date: { year: 1851, month: 1 },
      attributes: { military: 50, economy: 50, politics: 50, people: 50, diplomacy: 50 },
      resources: { silver: 1000, troops: 500, food: 200, reputation: 30 }
    },
    factions: [
      {
        id: 'qing-ting',
        name: '清廷',
        summary: '大清朝廷',
        power: 70,
        relationship: 50,
        status: 'active'
      }
    ],
    events: [],
    advisorMessages: [],
    ended: false,
    ...overrides
  }
}

describe('POST/GET /api/game/sync-save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // mockClear 不回收 mockImplementation，必须显式复位，否则凭据会漏到下一个用例
    getHeaderMock.mockImplementation(() => undefined)
    authConfig.deviceAuthEnforced = false
    authConfig.deviceAuthAllowFirstBind = true
    ;(globalThis as any).getMethod = vi.fn(() => 'POST')
    dbMock.returningMock.mockReturnValue([
      {
        saveId: SAVE_ID,
        updatedAt: new Date('2026-01-01'),
        endedAt: null,
        endedReason: null
      }
    ])
    dbMock.limitMock.mockReturnValue([])
  })

  describe('POST 上传/覆盖', () => {
    it('首次上传：返回 ok + saveId + updatedAt', async () => {
      readBodyMock.mockResolvedValueOnce(makeSaveData())

      const res = (await handler(makeEvent())) as any
      expect(res.ok).toBe(true)
      expect(res.data.saveId).toBe(SAVE_ID)
      expect(res.data.updatedAt).toBeTypeOf('number')
      expect(dbMock.insertMock).toHaveBeenCalledTimes(1)
    })

    it('二次覆盖：走 onConflictDoUpdate', async () => {
      readBodyMock.mockResolvedValueOnce(makeSaveData())

      await handler(makeEvent())

      expect(dbMock.valuesMock).toHaveBeenCalledTimes(1)
      expect(dbMock.onConflictMock).toHaveBeenCalledTimes(1)
    })

    it('strict 模式拒绝 updatedAt 字段', async () => {
      readBodyMock.mockResolvedValueOnce(makeSaveData({ updatedAt: 1700000000000 }))

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(400)
      expect(res.data.error.message).toContain('updatedAt')
    })

    it('zenithYear（年钟新增字段）被 schema 接受并原样入库', async () => {
      // saveDataSchema 是 strictObject：新字段不显式声明就会把带它的存档整条 400 拒掉。
      // 这条用例守的是"以后再加存档字段记得同步 schema"。
      readBodyMock.mockResolvedValueOnce(makeSaveData({ zenithYear: 1882 }))

      const res = (await handler(makeEvent())) as any
      expect(res.ok).toBe(true)
      expect(dbMock.valuesMock).toHaveBeenCalledTimes(1)
      // valuesMock 是零参签名的 vi.fn，直接下标访问过不了 typecheck（仓库既有写法一致）
      const valuesArg = (dbMock.valuesMock.mock.calls as unknown as any[][])[0][0]
      expect(valuesArg.saveData.zenithYear).toBe(1882)
    })

    it('zenithYear 非正整数仍被拒', async () => {
      readBodyMock.mockResolvedValueOnce(makeSaveData({ zenithYear: 0 }))

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(400)
      expect(res.data.error.code).toBe('INVALID_PARAMS')
    })

    it('参数错误：saveId 非 UUID', async () => {
      readBodyMock.mockResolvedValueOnce(makeSaveData({ saveId: 'bad' }))

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(400)
      expect(res.data.error.code).toBe('INVALID_PARAMS')
    })

    it('saveVersion 2（扩充事件引擎 v2 存档）被接受', async () => {
      readBodyMock.mockResolvedValueOnce(
        makeSaveData({
          saveVersion: 2,
          pendingChainNodes: [{ chainId: 'tai-ping-tian-guo', nodeId: 'node-1', scheduledTurn: 2 }],
          completedChainIds: [],
          activeChainIds: []
        })
      )

      const res = (await handler(makeEvent())) as any
      expect(res.ok).toBe(true)
      expect(dbMock.insertMock).toHaveBeenCalledTimes(1)
    })

    it('参数错误：saveVersion 为未支持的值（如 3）', async () => {
      readBodyMock.mockResolvedValueOnce(makeSaveData({ saveVersion: 3 as any }))

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(400)
    })

    it('DB 写入失败：返回 500', async () => {
      dbMock.insertMock.mockImplementationOnce(() => {
        throw new Error('DB down')
      })
      readBodyMock.mockResolvedValueOnce(makeSaveData())

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(500)
      expect(res.data.error.code).toBe('DB_ERROR')
    })

    it('并发：两次 POST 都成功（无锁，DB 层 ON CONFLICT）', async () => {
      readBodyMock.mockResolvedValueOnce(makeSaveData())
      readBodyMock.mockResolvedValueOnce(makeSaveData())

      const [res1, res2] = await Promise.all([handler(makeEvent()), handler(makeEvent())])
      expect((res1 as any).ok).toBe(true)
      expect((res2 as any).ok).toBe(true)
      expect(dbMock.insertMock).toHaveBeenCalledTimes(2)
    })

    it('属主校验：onConflictDoUpdate 携带 setWhere(deviceId) 原子条件', async () => {
      readBodyMock.mockResolvedValueOnce(makeSaveData())

      await handler(makeEvent())

      const config = (dbMock.onConflictMock.mock.calls as any[][])[0][0] as any
      expect(config.setWhere).toBeDefined()
    })

    it('属主校验：saveId 已存在且属于其他设备 → 403 SAVE_FORBIDDEN', async () => {
      // setWhere 条件排除他人存档时 returning 返回 0 行
      dbMock.returningMock.mockReturnValueOnce([])
      readBodyMock.mockResolvedValueOnce(makeSaveData())

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(403)
      expect(res.data.error.code).toBe('SAVE_FORBIDDEN')
    })

    it('凭据属主裁决：写入的 device_id 取凭据反查值，不取 body 自声明', async () => {
      // 攻击者拿自己设备的合法凭据，却把 body 里的 deviceId 填成受害者
      stubTokenLookup('tok-owner', 'device-owner')
      readBodyMock.mockResolvedValueOnce(makeSaveData({ deviceId: 'device-victim' }))

      const res = (await handler(makeEvent())) as any
      expect(res.ok).toBe(true)
      const values = (dbMock.valuesMock.mock.calls as any[][])[0][0] as Record<string, unknown>
      expect(values.deviceId).toBe('device-owner')
    })

    it('凭据无效：401 且不写库（不降级采信 body 的 deviceId）', async () => {
      getHeaderMock.mockImplementation((_: unknown, name: string) =>
        name === 'x-device-token' ? 'tok-bogus' : undefined
      )
      dbMock.limitMock.mockReturnValue([])
      readBodyMock.mockResolvedValueOnce(makeSaveData())

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(401)
      expect(res.data.error.code).toBe('INVALID_DEVICE_TOKEN')
      expect(dbMock.insertMock).not.toHaveBeenCalled()
    })

    it('收紧后（enforced=true）无凭据上传一律 401', async () => {
      authConfig.deviceAuthEnforced = true
      readBodyMock.mockResolvedValueOnce(makeSaveData())

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(401)
      expect(res.data.error.code).toBe('DEVICE_TOKEN_REQUIRED')
      expect(dbMock.insertMock).not.toHaveBeenCalled()
    })
  })

  describe('GET 拉取', () => {
    it('拉取成功：返回存档数据', async () => {
      ;(globalThis as any).getMethod = vi.fn(() => 'GET')
      getQueryMock.mockReturnValueOnce({ saveId: SAVE_ID, deviceId: 'device-1' })
      const saveData = makeSaveData()
      dbMock.limitMock.mockReturnValueOnce([
        { saveData, updatedAt: new Date('2026-01-01') }
      ])

      const res = (await handler(makeEvent())) as any
      expect(res.ok).toBe(true)
      expect(res.data.save).toEqual(saveData)
      expect(res.data.updatedAt).toBeTypeOf('number')
    })

    it('拉取不存在：404', async () => {
      ;(globalThis as any).getMethod = vi.fn(() => 'GET')
      getQueryMock.mockReturnValueOnce({ saveId: SAVE_ID, deviceId: 'device-1' })
      dbMock.limitMock.mockReturnValueOnce([])

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(404)
      expect(res.data.error.code).toBe('SAVE_NOT_FOUND')
    })

    it('属主校验：deviceId 与存档归属不匹配 → 404（与不存在同响应，不泄漏存在性）', async () => {
      ;(globalThis as any).getMethod = vi.fn(() => 'GET')
      getQueryMock.mockReturnValueOnce({ saveId: SAVE_ID, deviceId: 'device-other' })
      dbMock.limitMock.mockReturnValueOnce([])

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(404)
      expect(res.data.error.code).toBe('SAVE_NOT_FOUND')
    })

    it('拉取参数错误：saveId 缺失', async () => {
      ;(globalThis as any).getMethod = vi.fn(() => 'GET')
      getQueryMock.mockReturnValueOnce({ deviceId: 'device-1' })

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(400)
    })

    it('拉取参数错误：deviceId 缺失（属主校验必填）', async () => {
      ;(globalThis as any).getMethod = vi.fn(() => 'GET')
      getQueryMock.mockReturnValueOnce({ saveId: SAVE_ID })

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(400)
    })

    it('拉取参数错误：saveId 非 UUID', async () => {
      ;(globalThis as any).getMethod = vi.fn(() => 'GET')
      getQueryMock.mockReturnValueOnce({ saveId: 'not-uuid', deviceId: 'device-1' })

      const res = (await handler(makeEvent())) as any
      expect(res.statusCode).toBe(400)
    })
  })

  it('不支持的方法：405', async () => {
    ;(globalThis as any).getMethod = vi.fn(() => 'DELETE')
    const res = (await handler(makeEvent())) as any
    expect(res.statusCode).toBe(405)
    expect(res.data.error.code).toBe('METHOD_NOT_ALLOWED')
  })
})
