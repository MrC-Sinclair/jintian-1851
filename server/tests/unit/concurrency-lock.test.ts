/**
 * @file concurrency-lock 单元测试
 *
 * 模拟并发验证只调一次
 */

import { afterEach, describe, expect, it } from 'vitest'
import { acquireLock, clearLocks, isLocked } from '../../server/utils/concurrency-lock'

afterEach(() => {
  clearLocks()
})

describe('concurrency-lock', () => {
  it('首次获取锁后释放，isLocked 应为 false', async () => {
    const release = await acquireLock('save-1')
    expect(isLocked('save-1')).toBe(true)
    release()
    expect(isLocked('save-1')).toBe(false)
  })

  it('并发请求串行执行（不重叠）', async () => {
    const executionOrder: string[] = []

    async function task(label: string, duration: number) {
      const release = await acquireLock('save-2')
      try {
        executionOrder.push(`${label}-start`)
        await new Promise((r) => setTimeout(r, duration))
        executionOrder.push(`${label}-end`)
      } finally {
        release()
      }
    }

    await Promise.all([task('A', 50), task('B', 30), task('C', 20)])

    // 三个任务应串行执行：A start → A end → B start → B end → C start → C end
    expect(executionOrder).toEqual([
      'A-start',
      'A-end',
      'B-start',
      'B-end',
      'C-start',
      'C-end'
    ])
  })

  it('不同 saveId 并行执行（互不阻塞）', async () => {
    const startTimes: number[] = []
    const release1 = await acquireLock('save-A')
    const release2 = await acquireLock('save-B')
    // 两个 saveId 同时持锁，应都返回 release 函数
    expect(typeof release1).toBe('function')
    expect(typeof release2).toBe('function')
    startTimes.push(Date.now())
    release1()
    release2()
    expect(isLocked('save-A')).toBe(false)
    expect(isLocked('save-B')).toBe(false)
  })

  it('锁释放后下一个 acquire 立即返回', async () => {
    const release = await acquireLock('save-3')
    release()

    const start = Date.now()
    const release2 = await acquireLock('save-3')
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(50)
    release2()
  })

  it('异常时锁也释放', async () => {
    async function failingTask() {
      const release = await acquireLock('save-4')
      try {
        throw new Error('boom')
      } finally {
        release()
      }
    }

    await expect(failingTask()).rejects.toThrow('boom')
    expect(isLocked('save-4')).toBe(false)
  })
})
