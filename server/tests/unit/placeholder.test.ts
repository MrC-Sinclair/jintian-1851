import { describe, it, expect } from 'vitest'

// 占位测试，验证 Vitest 工具链正常工作
describe('placeholder', () => {
  it('should pass basic assertion', () => {
    expect(1 + 1).toBe(2)
  })

  it('should have useRuntimeConfig mock', () => {
    expect(useRuntimeConfig()).toBeDefined()
    expect(useRuntimeConfig().llmModel).toBe('Qwen/Qwen3-8B')
  })
})
