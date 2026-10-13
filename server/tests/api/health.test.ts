/**
 * @file GET /api/health API 集成测试
 *
 * 覆盖：DB 正常 / DB 抛错 / DB 探针超时 / 响应体形状 / 备份新鲜度三态
 * 重点断言两件事：
 *   1. 「DB 不可用必须返 503」——容器 healthcheck 靠它把 postgres 故障变成可见信号
 *   2. 「备份 stale 不改状态码」——caddy 依赖 app healthy，让备份故障返 503 会把静态站一起卡住
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

/** 指向某个备份状态文件（或留空表示未配置） */
function setBackupConfig(file: string | undefined): void {
  ;(globalThis as any).useRuntimeConfig = () => ({
    backupStatusFile: file ?? '',
    backupMaxAgeHours: 30
  })
}

describe('GET /api/health', () => {
  let dir = ''

  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.executeMock.mockImplementation(async () => [{ '?column?': 1 }])
    setBackupConfig(undefined)
    dir = mkdtempSync(join(tmpdir(), 'jintian-health-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
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

  it('响应体不泄漏环境信息（无 env / 连接串 / 版本 / 文件路径）', async () => {
    const res = (await handler(makeEvent())) as any
    expect(Object.keys(res.data).sort()).toEqual([
      'backup',
      'backupAgeHours',
      'db',
      'probeMs',
      'status',
      'uptimeSec'
    ])
    expect(JSON.stringify(res)).not.toMatch(/postgres|sw_game|NODE_ENV|\.\.\/backups/)
  })

  // ===== 备份新鲜度：状态字段，不参与状态码 =====

  it('未配置状态文件 → backup=disabled（开发期与单测默认，不报警）', async () => {
    setBackupConfig(undefined)
    const res = (await handler(makeEvent())) as any

    expect(res.ok).toBe(true)
    expect(res.data.backup).toBe('disabled')
    expect(res.data.backupAgeHours).toBeNull()
    expect(setResponseStatusMock).not.toHaveBeenCalled()
  })

  it('配了路径但文件不存在 → backup=missing，仍然 200', async () => {
    setBackupConfig(join(dir, 'nope.json'))
    const res = (await handler(makeEvent())) as any

    expect(res.ok).toBe(true)
    expect(res.data.backup).toBe('missing')
    expect(res.data.backupDetail).toContain('状态文件')
    expect(setResponseStatusMock).not.toHaveBeenCalled()
  })

  it('备份新鲜 → backup=fresh 并给出小时数', async () => {
    writeFileSync(
      join(dir, 'health-status.json'),
      JSON.stringify({
        ok: true,
        lastAttemptAt: new Date().toISOString(),
        lastSuccessAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
        file: 'jintian-x.sql.gz',
        bytes: 4096,
        error: null
      })
    )
    setBackupConfig(join(dir, 'health-status.json'))

    const res = (await handler(makeEvent())) as any
    expect(res.data.backup).toBe('fresh')
    expect(res.data.backupAgeHours).toBeCloseTo(2, 0)
  })

  it('备份过期：状态码与 ok 都不动（改了就会连累 caddy 起不来）', async () => {
    writeFileSync(
      join(dir, 'health-status.json'),
      JSON.stringify({
        ok: false,
        lastAttemptAt: new Date().toISOString(),
        lastSuccessAt: new Date(Date.now() - 40 * 3600_000).toISOString(),
        error: 'pg_dump 失败'
      })
    )
    setBackupConfig(join(dir, 'health-status.json'))

    const res = (await handler(makeEvent())) as any
    expect(res.ok).toBe(true)
    expect(res.data.status).toBe('ok')
    expect(res.data.backup).toBe('stale')
    expect(res.data.backupDetail).toContain('pg_dump 失败')
    expect(setResponseStatusMock).not.toHaveBeenCalled()
  })

  it('DB 挂了 + 备份也过期：仍按 DB 走 503，备份状态一并带出（两个故障不互相掩盖）', async () => {
    writeFileSync(
      join(dir, 'health-status.json'),
      JSON.stringify({
        ok: true,
        lastAttemptAt: new Date().toISOString(),
        lastSuccessAt: new Date(Date.now() - 99 * 3600_000).toISOString()
      })
    )
    setBackupConfig(join(dir, 'health-status.json'))
    dbMock.executeMock.mockRejectedValueOnce(new Error('connection refused'))

    const res = (await handler(makeEvent())) as any
    expect(setResponseStatusMock).toHaveBeenCalledWith(expect.anything(), 503)
    expect(res.ok).toBe(false)
    expect(res.data.db).toBe('down')
    expect(res.data.backup).toBe('stale')
  })
})
