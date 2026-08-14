/**
 * @file 模型配置单元测试
 *
 * 验证 4 模型存在与 capabilities 正确
 */

import { describe, expect, it } from 'vitest'
import {
  ALLOWED_MODEL_VALUES,
  AVAILABLE_MODELS,
  getModelCapabilities
} from '../../server/config/models'

describe('models config', () => {
  it('应有 4 个模型', () => {
    expect(AVAILABLE_MODELS).toHaveLength(4)
  })

  it('Qwen3-8B 配置正确', () => {
    const m = AVAILABLE_MODELS.find((x) => x.value === 'Qwen/Qwen3-8B')
    expect(m).toBeDefined()
    expect(m?.label).toBe('Qwen3-8B')
    expect(m?.capabilities).toEqual({
      vision: false,
      deepThinking: true,
      toggleableThinking: true,
      toolCalling: true
    })
  })

  it('DeepSeek-R1-0528-Qwen3-8B 配置正确', () => {
    const m = AVAILABLE_MODELS.find((x) => x.value === 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B')
    expect(m).toBeDefined()
    expect(m?.label).toBe('DeepSeek-R1-0528-Qwen3-8B')
    expect(m?.capabilities).toEqual({
      vision: false,
      deepThinking: true,
      toggleableThinking: false,
      toolCalling: false
    })
  })

  it('GLM-Z1-9B-0414 配置正确（THUDM/ 前缀，非 zai-org/）', () => {
    const m = AVAILABLE_MODELS.find((x) => x.value === 'THUDM/GLM-Z1-9B-0414')
    expect(m).toBeDefined()
    expect(m?.label).toBe('GLM-Z1-9B-0414')
    expect(m?.capabilities).toEqual({
      vision: false,
      deepThinking: true,
      toggleableThinking: false,
      toolCalling: false
    })
  })

  it('Qwen3.5-4B 配置正确（原生多模态）', () => {
    const m = AVAILABLE_MODELS.find((x) => x.value === 'Qwen/Qwen3.5-4B')
    expect(m).toBeDefined()
    expect(m?.label).toBe('Qwen3.5-4B')
    expect(m?.capabilities).toEqual({
      vision: true,
      deepThinking: true,
      toggleableThinking: true,
      toolCalling: true
    })
  })

  it('ALLOWED_MODEL_VALUES 应包含全部 4 个模型值', () => {
    expect(ALLOWED_MODEL_VALUES.size).toBe(4)
    expect(ALLOWED_MODEL_VALUES.has('Qwen/Qwen3-8B')).toBe(true)
    expect(ALLOWED_MODEL_VALUES.has('deepseek-ai/DeepSeek-R1-0528-Qwen3-8B')).toBe(true)
    expect(ALLOWED_MODEL_VALUES.has('THUDM/GLM-Z1-9B-0414')).toBe(true)
    expect(ALLOWED_MODEL_VALUES.has('Qwen/Qwen3.5-4B')).toBe(true)
  })

  it('getModelCapabilities 应返回正确的能力', () => {
    const qwen3 = getModelCapabilities('Qwen/Qwen3-8B')
    expect(qwen3.toggleableThinking).toBe(true)
    expect(qwen3.toolCalling).toBe(true)

    const r1 = getModelCapabilities('deepseek-ai/DeepSeek-R1-0528-Qwen3-8B')
    expect(r1.toggleableThinking).toBe(false)
    expect(r1.toolCalling).toBe(false)

    const glm = getModelCapabilities('THUDM/GLM-Z1-9B-0414')
    expect(glm.toggleableThinking).toBe(false)
    expect(glm.toolCalling).toBe(false)

    const qwen35 = getModelCapabilities('Qwen/Qwen3.5-4B')
    expect(qwen35.vision).toBe(true)
    expect(qwen35.toggleableThinking).toBe(true)
  })

  it('getModelCapabilities 未知模型应返回默认能力（toolCalling=true）', () => {
    const unknown = getModelCapabilities('unknown/model')
    expect(unknown).toEqual({
      vision: false,
      deepThinking: false,
      toggleableThinking: false,
      toolCalling: true
    })
  })
})
