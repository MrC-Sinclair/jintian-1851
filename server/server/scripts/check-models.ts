/**
 * @file 模型可用性校验脚本
 *
 * 验证 4 个模型在硅基流动 SiliconFlow 的可用性：
 *   1. GET /v1/models 校验 modelId 都在返回列表中，缺失则 exit(1)
 *   2. generateObject 冒烟测试：对 Qwen/Qwen3-8B 调用一次，验证硅基流动返回可解析为合法 JSON
 *      失败则 exit(2) 并输出错误详情
 *
 * 运行：`pnpm tsx server/scripts/check-models.ts`（package.json 已注册为 `pnpm check-models`）
 *
 * 退出码：
 *   - 0：全部通过
 *   - 1：模型列表校验失败（modelId 缺失或 API Key 无效）
 *   - 2：generateObject 冒烟测试失败（structuredOutputs 在硅基流动不可用）
 *   - 3：环境变量缺失（OPENAI_API_KEY）
 */

import { createOpenAI } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import { AVAILABLE_MODELS } from '../config/models'
import { createSiliconFlowFetch } from '../utils/siliconflow-fetch'

const apiKey = process.env.OPENAI_API_KEY
const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.siliconflow.cn/v1'

if (!apiKey) {
  console.error('[check-models] ❌ 缺少环境变量 OPENAI_API_KEY')
  process.exit(3)
}

async function checkModelList(): Promise<void> {
  console.log(`[check-models] 1️⃣ GET ${baseUrl}/models 校验 4 个 modelId`)

  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })

  if (!res.ok) {
    console.error(`[check-models] ❌ /v1/models 返回 ${res.status}`)
    console.error(await res.text())
    process.exit(1)
  }

  const data = (await res.json()) as { data?: Array<{ id: string }> }
  const remoteIds = new Set((data.data ?? []).map((m) => m.id))

  const missing: string[] = []
  for (const model of AVAILABLE_MODELS) {
    if (!remoteIds.has(model.value)) {
      missing.push(model.value)
    } else {
      console.log(`[check-models]   ✅ ${model.value}`)
    }
  }

  if (missing.length > 0) {
    console.error(`[check-models] ❌ 缺失模型：${missing.join(', ')}`)
    process.exit(1)
  }
}

async function checkGenerateObject(): Promise<void> {
  console.log('[check-models] 2️⃣ generateObject 冒烟测试（Qwen/Qwen3-8B）')

  // 验证 providerOptions.openai.structuredOutputs: false 在硅基流动的可用性
  // my-chat 未使用 generateObject，本脚本提前验证
  const openai = createOpenAI({
    apiKey,
    baseURL: baseUrl,
    fetch: createSiliconFlowFetch(false) // 冒烟测试关闭思考，加快响应
  })

  // ⚠️ @ai-sdk/openai v2 默认走 Responses API（/v1/responses），硅基流动不支持
  // 必须用 openai.chat() 走 Chat Completions API（/v1/chat/completions）
  const model = openai.chat('Qwen/Qwen3-8B')

  try {
    const { object } = await generateObject({
      model,
      schema: z.object({
        title: z.string().describe('标题'),
        value: z.number().describe('数值')
      }),
      prompt: '生成一个测试对象，title 为"测试"，value 为 42。',
      providerOptions: {
        openai: { structuredOutputs: false }
      }
    })

    if (typeof object.title !== 'string' || typeof object.value !== 'number') {
      console.error('[check-models] ❌ generateObject 返回结构不符合 schema')
      console.error(JSON.stringify(object, null, 2))
      process.exit(2)
    }

    console.log(`[check-models]   ✅ 返回：${JSON.stringify(object)}`)
  } catch (err) {
    console.error('[check-models] ❌ generateObject 调用失败：')
    console.error(err)
    process.exit(2)
  }
}

async function main(): Promise<void> {
  console.log(`[check-models] 🔍 开始校验硅基流动模型（baseURL=${baseUrl}）\n`)
  await checkModelList()
  console.log('')
  await checkGenerateObject()
  console.log('\n[check-models] 🎉 全部校验通过')
}

main().catch((err) => {
  console.error('[check-models] ❌ 未捕获异常：', err)
  process.exit(1)
})
