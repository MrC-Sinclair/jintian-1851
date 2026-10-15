/**
 * @file device-credential 单元测试
 *
 * 覆盖：换取与缓存 / 并发去重 / 服务端拒绝后停止重试 / 网络失败可重试 / ownerParam 兼容参数 /
 * 401 凭据失效后清缓存自愈一次（withCredentialRetry）
 *
 * 每个用例用 vi.resetModules() 取干净的模块实例：
 * enrollmentBlocked 与凭据内存副本都是模块级状态，不复位会跨用例泄漏。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ post: vi.fn() }))

// 只 mock 拿证明要用到的那一个导出：device-credential 不碰 storage 的其它能力
const storageMocks = vi.hoisted(() => ({ readOwnershipProof: vi.fn(() => null as unknown) }))

vi.mock('../../src/utils/api', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/api')>('../../src/utils/api')
  return { ...actual, post: apiMocks.post }
})

vi.mock('../../src/utils/storage', () => ({ readOwnershipProof: storageMocks.readOwnershipProof }))

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
  storageMocks.readOwnershipProof.mockReset()
  storageMocks.readOwnershipProof.mockReturnValue(null)
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

describe('withCredentialRetry（凭据失效自愈）', () => {
  it('凭据有效：直接执行，不额外注册也不重试', async () => {
    const { credential, identity } = await freshModules()
    identity.setDeviceCredential(TOKEN)
    const call = vi.fn(async (token: string) => token)

    expect(await credential.withCredentialRetry(call)).toBe(TOKEN)
    expect(call).toHaveBeenCalledTimes(1)
    expect(apiMocks.post).not.toHaveBeenCalled()
  })

  it('401 且服务端已无该凭据：清缓存后重注册，用新凭据重试一次', async () => {
    const { credential, identity } = await freshModules()
    identity.setDeviceCredential(TOKEN)
    apiMocks.post.mockResolvedValueOnce({ deviceId: 'dev-1', token: TOKEN_B })
    const call = vi
      .fn<(token: string) => Promise<string>>()
      .mockRejectedValueOnce(new ApiError('INVALID_DEVICE_TOKEN', '凭据无效', 401))
      .mockImplementationOnce(async (token: string) => `ok:${token}`)

    expect(await credential.withCredentialRetry(call)).toBe(`ok:${TOKEN_B}`)
    expect(call).toHaveBeenCalledTimes(2)
    // 第一次带坏凭据，第二次带新换来的凭据
    expect(call.mock.calls[0][0]).toBe(TOKEN)
    expect(call.mock.calls[1][0]).toBe(TOKEN_B)
    expect(identity.getDeviceCredential()).toBe(TOKEN_B)
  })

  it('401 且重新注册被判为已绑定：第二次拿到空串，由调用方回落兼容通道', async () => {
    const { credential, identity } = await freshModules()
    identity.setDeviceCredential(TOKEN)
    apiMocks.post.mockRejectedValue(new ApiError('CREDENTIAL_EXISTS', '已绑定', 409))
    const tokens: string[] = []
    const call = vi.fn(async (token: string) => {
      tokens.push(token)
      if (tokens.length === 1) throw new ApiError('INVALID_DEVICE_TOKEN', '凭据无效', 401)
      return token
    })

    // 坏凭据已清空，注册又被拒 → 第二次是「无凭据」形态，ownerParam 会带上自声明 deviceId
    expect(await credential.withCredentialRetry(call)).toBe('')
    expect(tokens).toEqual([TOKEN, ''])
    expect(identity.getDeviceCredential()).toBe('')
  })

  it('重试仍 401：照抛，不再循环打服务端', async () => {
    const { credential, identity } = await freshModules()
    identity.setDeviceCredential(TOKEN)
    apiMocks.post.mockRejectedValue(new ApiError('NETWORK', '网络异常', 0))
    const call = vi.fn(async () => {
      throw new ApiError('INVALID_DEVICE_TOKEN', '凭据无效', 401)
    })

    await expect(credential.withCredentialRetry(call)).rejects.toThrow('凭据无效')
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('非 INVALID_DEVICE_TOKEN 的错误不自愈，也不误清本地凭据', async () => {
    const { credential, identity } = await freshModules()
    identity.setDeviceCredential(TOKEN)
    const call = vi.fn(async () => {
      throw new ApiError('CONCURRENT_REQUEST', '请勿重复提交', 409)
    })

    await expect(credential.withCredentialRetry(call)).rejects.toThrow('请勿重复提交')
    expect(call).toHaveBeenCalledTimes(1)
    expect(identity.getDeviceCredential()).toBe(TOKEN)
    expect(apiMocks.post).not.toHaveBeenCalled()
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

// 服务端开启 DEVICE_AUTH_REQUIRE_POSSESSION 后，"已有云端存档却首次注册"的设备
// 必须证明持有该存档（saveId + createdAt）。观测期不会返回这个码，所以这三条
// 覆盖的是重试路径本身，而不是线上默认行为。
describe('PROOF_REQUIRED 的持有证明重试', () => {
  it('本地有档：带 proof 重试一次并成功换取凭据', async () => {
    const { credential, identity } = await freshModules()
    storageMocks.readOwnershipProof.mockReturnValueOnce({ saveId: 'save-1', createdAt: 1700000000000 })
    apiMocks.post
      .mockRejectedValueOnce(new ApiError('PROOF_REQUIRED', '需提供 saveId 与 createdAt', 403))
      .mockResolvedValueOnce({ deviceId: 'dev-1', token: TOKEN })

    const token = await credential.ensureCredential()

    expect(token).toBe(TOKEN)
    expect(apiMocks.post).toHaveBeenCalledTimes(2)
    expect(apiMocks.post).toHaveBeenLastCalledWith('/api/game/device-credential', {
      deviceId: identity.getDeviceId(),
      proof: { saveId: 'save-1', createdAt: 1700000000000 }
    })
  })

  it('本地无档可证明：不空转重试，并停止后续注册', async () => {
    const { credential } = await freshModules()
    apiMocks.post.mockRejectedValueOnce(new ApiError('PROOF_REQUIRED', '需提供 saveId 与 createdAt', 403))

    expect(await credential.ensureCredential()).toBe('')
    expect(apiMocks.post).toHaveBeenCalledTimes(1)
    // blocked 生效后连请求都不该再发（本地没有档，重试一万次也拿不出证明）
    expect(await credential.ensureCredential()).toBe('')
    expect(apiMocks.post).toHaveBeenCalledTimes(1)
  })

  it('带了证明仍被拒（本地档与云端不符）：到此为止，不再第三次请求', async () => {
    const { credential } = await freshModules()
    storageMocks.readOwnershipProof.mockReturnValueOnce({ saveId: 'save-1', createdAt: 1 })
    apiMocks.post
      .mockRejectedValueOnce(new ApiError('PROOF_REQUIRED', '需提供', 403))
      .mockRejectedValueOnce(new ApiError('PROOF_REQUIRED', '证明不符', 403))

    expect(await credential.ensureCredential()).toBe('')
    expect(apiMocks.post).toHaveBeenCalledTimes(2)
  })
})
