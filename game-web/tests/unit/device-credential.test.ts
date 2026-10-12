/**
 * @file device-credential 单元测试
 *
 * 覆盖：换取与缓存 / 并发去重 / 服务端拒绝后停止重试 / 网络失败可重试 / ownerParam 兼容参数
 *
 * 每个用例用 vi.resetModules() 取干净的模块实例：
 * enrollmentBlocked 与凭据内存副本都是模块级状态，不复位会跨用例泄漏。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ post: vi.fn() }))

vi.mock('../../src/utils/api', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/api')>('../../src/utils/api')
  return { ...actual, post: apiMocks.post }
})

import { ApiError } from '../../src/utils/api'

const TOKEN = 'a'.repeat(64)
const TOKEN_B = 'b'.repeat(64)

async function freshModules() {
  vi.resetModules()
  localStorage.clear()
  const credential = await import('../../src/utils/device-credential')
  const identity = await import('../../src/utils/device-id')
  identity.clearDeviceCredential()
  return { credential, identity }
}

beforeEach(() => {
  apiMocks.post.mockReset()
})

describe('ensureCredential', () => {
  it('无缓存时注册成功：返回凭据并持久化', async () => {
    const { credential, identity } = await freshModules()
    apiMocks.post.mockResolvedValueOnce({ deviceId: 'dev-1', token: TOKEN })

    const token = await credential.ensureCredential()
    expect(token).toBe(TOKEN)
    expect(identity.getDeviceCredential()).toBe(TOKEN)
    expect(apiMocks.post).toHaveBeenCalledWith('/api/game/device-credential', {
      deviceId: identity.getDeviceId()
    })
  })

  it('已有缓存时不再请求', async () => {
    const { credential, identity } = await freshModules()
    identity.setDeviceCredential(TOKEN)

    expect(await credential.ensureCredential()).toBe(TOKEN)
    expect(apiMocks.post).not.toHaveBeenCalled()
  })

  it('并发调用只发一次注册请求（防重复提交守卫）', async () => {
    const { credential } = await freshModules()
    let resolvePost: (v: { deviceId: string; token: string }) => void = () => {}
    apiMocks.post.mockImplementationOnce(
      () => new Promise((resolve) => (resolvePost = resolve))
    )

    const first = credential.ensureCredential()
    const second = credential.ensureCredential()
    resolvePost({ deviceId: 'dev-1', token: TOKEN })

    expect(await first).toBe(TOKEN)
    expect(await second).toBe(TOKEN)
    expect(apiMocks.post).toHaveBeenCalledTimes(1)
  })

  it('该 deviceId 已绑定（409）：返回空串且停止重试', async () => {
    const { credential } = await freshModules()
    apiMocks.post.mockRejectedValue(new ApiError('CREDENTIAL_EXISTS', '已绑定', 409))

    expect(await credential.ensureCredential()).toBe('')
    expect(await credential.ensureCredential()).toBe('')
    // 第二次调用被 blocked 拦下，不再打服务端
    expect(apiMocks.post).toHaveBeenCalledTimes(1)
  })

  it('注册已关闭（403 ENROLLMENT_CLOSED）：同样停止重试', async () => {
    const { credential } = await freshModules()
    apiMocks.post.mockRejectedValue(new ApiError('ENROLLMENT_CLOSED', '关闭', 403))

    await credential.ensureCredential()
    await credential.ensureCredential()
    expect(apiMocks.post).toHaveBeenCalledTimes(1)
  })

  it('网络失败不置 blocked：下次同步仍会尝试注册', async () => {
    const { credential } = await freshModules()
    apiMocks.post
      .mockRejectedValueOnce(new ApiError('NETWORK', '网络异常', 0))
      .mockResolvedValueOnce({ deviceId: 'dev-1', token: TOKEN_B })

    expect(await credential.ensureCredential()).toBe('')
    expect(await credential.ensureCredential()).toBe(TOKEN_B)
    expect(apiMocks.post).toHaveBeenCalledTimes(2)
  })

  it('服务端返回畸形凭据时不落缓存', async () => {
    const { credential, identity } = await freshModules()
    apiMocks.post.mockResolvedValueOnce({ deviceId: 'dev-1', token: 'short' })

    expect(await credential.ensureCredential()).toBe('')
    expect(identity.getDeviceCredential()).toBe('')
  })
})

describe('ownerParam（双轨兼容参数）', () => {
  it('有凭据：不声明 deviceId，属主由请求头证明', async () => {
    const { credential } = await freshModules()
    expect(credential.ownerParam(TOKEN, 'dev-1')).toBe('')
  })

  it('无凭据：回落成 query 里的自声明', async () => {
    const { credential } = await freshModules()
    expect(credential.ownerParam('', 'dev-1')).toBe('&deviceId=dev-1')
  })

  it('需要 URL 编码', async () => {
    const { credential } = await freshModules()
    expect(credential.ownerParam('', 'a b&c')).toBe('&deviceId=a%20b%26c')
  })

  it('两者都没有：返回空串（由服务端按缺参报错，不拼出空参数）', async () => {
    const { credential } = await freshModules()
    expect(credential.ownerParam('', '')).toBe('')
  })

  it('分隔符可换（作为首个查询参数时用 ? 之后的形态）', async () => {
    const { credential } = await freshModules()
    expect(credential.ownerParam('', 'dev-1', '')).toBe('deviceId=dev-1')
  })
})
