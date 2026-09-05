/**
 * @file e2e-test-mode 单元测试
 *
 * 安全相关：生产环境必须恒为 false（防止伪造 x-e2e-test-mode 请求头触发测试后门）
 */
import { afterEach, describe, expect, it } from 'vitest'
import { isE2eTestMode } from '../../server/utils/e2e-test-mode'

const ORIGINAL_NODE_ENV = process.env.NODE_ENV

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV
})

describe('isE2eTestMode', () => {
  it('dev/test 环境 + 请求头 x-e2e-test-mode=1 → 生效', () => {
    process.env.NODE_ENV = 'development'
    expect(isE2eTestMode('1')).toBe(true)

    process.env.NODE_ENV = 'test'
    expect(isE2eTestMode('1')).toBe(true)
  })

  it('请求头非 1（缺失/其他值）→ 不生效', () => {
    process.env.NODE_ENV = 'development'
    expect(isE2eTestMode(undefined)).toBe(false)
    expect(isE2eTestMode('0')).toBe(false)
    expect(isE2eTestMode('true')).toBe(false)
  })

  it('生产环境恒为 false（即使请求头为 1）', () => {
    process.env.NODE_ENV = 'production'
    expect(isE2eTestMode('1')).toBe(false)
    expect(isE2eTestMode(undefined)).toBe(false)
  })
})
