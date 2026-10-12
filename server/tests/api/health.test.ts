/**
 * @file GET /api/health API 集成测试
 *
 * 覆盖：DB 正常 / DB 抛错 / DB 探针超时 / 响应体形状
 * 重点断言「DB 不可用必须返 503」——容器 healthcheck 靠它把 postgres 故障变成可见信号
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => {
  const executeMock = vi.fn(async () => [{ '?column?': 1 }])
  return { db: { execute: executeMock }, executeMock }
})

vi.mock('../../server/db', () => ({ db: dbMock.db }))

import handler from '../../server/api/health.get'

const setResponseStatusMock = (globalThis as any).setResponseStatus as ReturnType<typeof vi.fn>

function makeEvent(): any {
  return { node: { res: { write: vi.fn(async () => {}), end: vi.fn() } } }
}

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.executeMock.mockImplementation(async () => [{ '?column?': 1 }])
  })

  it('DB 可用：返回 ok:true + status=ok + db=up，且不改写状态码', async () => {
    const res = (await handler(makeEvent())) as any

    expect(res.ok).toBe(true)
    expect(res.data).toMatchObject({ status: 'ok', db: 'up' })
    expect(res.data.probeMs).toBeTypeOf('number')
    expect(res.data.uptimeSec).toBeTypeOf('number')
    expect(setResponseStatusMock).not.toHaveBeenCalled()
    // 探针是一次真实查询，不是「进程在监听」的空断言
    expect(dbMock.executeMock).toHaveBeenCalledTimes(1)
  })

  it('DB 抛错：返回 503 + ok:false + db=down（容器据此转 unhealthy）', async () => {
    dbMock.executeMock.mockRejectedValueOnce(new Error('connection refused'))

    const res = (await handler(makeEvent())) as any

    expect(setResponseStatusMock).toHaveBeenCalledWith(expect.anything(), 503)
    expect(res.ok).toBe(false)
    expect(res.data.status).toBe('degraded')
    expect(res.data.db).toBe('down')
  })

  it('DB 探针超时同样按不可用处理：不因为「进程还活着」就报 200', async () => {
    vi.useFakeTimers()
    try {
      // 永不 resolve 的查询：只能靠 3s 超时兜住
      dbMock.executeMock.mockImplementation(() => new Promise(() => {}))
      const pending = handler(makeEvent()) as Promise<any>

      await vi.advanceTimersByTimeAsync(3500)
      const res = await pending

      expect(setResponseStatusMock).toHaveBeenCalledWith(expect.anything(), 503)
      expect(res.data.db).toBe('down')
    } finally {
      vi.useRealTimers()
    }
  })

  it('响应体不泄漏环境信息（无 env / 连接串 / 版本）', async () => {
    const res = (await handler(makeEvent())) as any
    expect(Object.keys(res.data).sort()).toEqual(['db', 'probeMs', 'status', 'uptimeSec'])
    expect(JSON.stringify(res)).not.toMatch(/postgres|sw_game|NODE_ENV/)
  })
})
