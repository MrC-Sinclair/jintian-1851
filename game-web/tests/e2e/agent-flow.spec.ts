import { test, expect, type Page } from '@playwright/test'

/**
 * agent-flow 端到端测试（agent-architecture-upgrade T5.1）
 *
 * 覆盖 agent 化架构上线后的四条关键用户可见链路：
 *   1. 军师对话调用 get-recent-events 工具 → 返回历史事件并在回复中引用
 *      （验证 useAdvisor 的 onToolCall/onToolResult → AdvisorDrawer 工具气泡）
 *   2. NPC 多 Agent 并行决策差异化：不同势力产出不同行动类型（扩张=敌意红 / 外交=友好绿）
 *    （后端 npc-actions 差异化逻辑已在单测覆盖，此处验证前端差异化渲染）
 *   3. 工具调用气泡 UI：展开详情可见工具名 + 参数 + 结果
 *   4. NPC 决策失败卡片：某势力决策失败 → 红色「决策失败」角标卡片，计数包含失败项
 *
 * Mock 策略（与 story-chain-flow / two-step-decision 一致）：
 *   - page.route 拦截所有 API，不依赖真实后端
 *   - advisor-chat 走自定义 SSE 协议（delta / tool-call / tool-result / [DONE]）
 *   - localStorage 注入合法 v2 存档 + onboarding_done=true 跳过引导
 *
 * 路由：game-main 在 /#/pages/game-main/index
 */

const GAME_MAIN_URL = '/#/pages/game-main/index'

/** 构造合法 v2 存档（文官 + 清廷，含两个 active NPC 势力：太平天国 / 清廷） */
function buildV2Save(): Record<string, unknown> {
  return {
    saveVersion: 2,
    saveId: 'e2e-agent-' + Math.random().toString(36).slice(2),
    deviceId: 'e2e-device',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    character: {
      background: '文官',
      backgroundPerks: { politics: 5 },
      factionId: 'f2',
      factionName: '清廷',
      factionSummary: '摇摇欲坠的大清帝国中央'
    },
    state: {
      turn: 1,
      date: { year: 1851, month: 1 },
      attributes: { military: 50, economy: 50, politics: 55, people: 50, diplomacy: 50 },
      resources: { silver: 1000, troops: 500, food: 800, reputation: 20 }
    },
    factions: [
      {
        id: 'f1',
        name: '太平天国',
        summary: '洪秀全领导的农民起义政权',
        power: 80,
        relationship: -50,
        status: 'active'
      },
      {
        id: 'f2',
        name: '清廷',
        summary: '摇摇欲坠的大清帝国中央',
        power: 90,
        relationship: -20,
        status: 'active'
      }
    ],
    events: [
      {
        turn: 1,
        eventType: '民生',
        title: '去年江淮大旱',
        description: '江淮一带大旱，饥民遍野。',
        playerChoice: '赈济灾民',
        effects: {},
        chainId: undefined,
        chainNodeId: undefined
      }
    ],
    advisorMessages: [],
    pendingChainNodes: [],
    completedChainIds: [],
    activeChainIds: [],
    ended: false
  }
}

/** 通用回合事件（每次 generate-event 返回，含 3 个选项供决策） */
const MOCK_EVENT = {
  title: '江南税赋之争',
  description: '（E2E 模拟）地方士绅与朝廷就税赋摊派产生分歧。',
  eventType: '民生' as const,
  options: [
    { id: 'o1', label: '轻徭薄赋', effects: { people: 5, silver: -100 } },
    { id: 'o2', label: '加征以充军', effects: { silver: 200, people: -8 } },
    { id: 'o3', label: '维持旧制', effects: { politics: 3 } }
  ]
}

/** 组装 SSE 文本：各 frame 以双换行分隔，整体以双换行结尾（processSSEText 要求） */
function buildSSE(frames: string[]): string {
  return frames.map((f) => `data: ${f}`).join('\n\n') + '\n\n'
}

/** 默认军师回复（无工具调用）：一段普通古风回复 + [DONE] */
const DEFAULT_ADVISOR_SSE = buildSSE([
  '{"delta":"主公，当前局势尚可，宜稳守根基，徐图进取。"}',
  '[DONE]'
])

/** 工具调用型军师回复：先调 get-recent-events，再回带历史事件 */
const TOOL_CALL_ADVISOR_SSE = buildSSE([
  '{"type":"tool-call","toolName":"get-recent-events","args":{"limit":10}}',
  '{"type":"tool-result","toolName":"get-recent-events","result":{"events":[{"turn":1,"eventType":"民生","title":"去年江淮大旱","description":"江淮一带大旱，饥民遍野。","target":null,"action":null,"effects":{}}]}}',
  '{"delta":"主公，臣已查阅近来史事，去岁有「去年江淮大旱」一事，民心受扰，宜早作赈济之备。"}',
  '[DONE]'
])

/** 拦截所有 API；advisorSSE 可覆盖（默认普通回复） */
async function mockAgentApi(
  page: Page,
  opts: {
    advisorSSE?: string
    npcActions?: unknown
  } = {}
): Promise<void> {
  const npcBody =
    opts.npcActions ??
    {
      ok: true,
      data: {
        actions: [
          {
            factionId: 'f1',
            factionName: '太平天国',
            action: '扩张',
            target: '江南',
            description: '太平军沿江东进，连克数城。',
            effects: { people: -5, military: -3 }
          },
          {
            factionId: 'f2',
            factionName: '清廷',
            action: '外交',
            description: '清廷遣使联络各方，稳固朝局。',
            effects: { diplomacy: 3 }
          }
        ]
      }
    }

  await page.route('**/api/game/generate-event', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { event: MOCK_EVENT } })
    })
  )

  await page.route('**/api/game/advisor-briefing', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: { summary: '局势平稳', suggestion: '稳步发展各项实力' }
      })
    })
  )

  await page.route('**/api/game/npc-actions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(npcBody)
    })
  )

  await page.route('**/api/game/resolve-decision', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { effects: { military: 5, silver: -100 } } })
    })
  )

  await page.route('**/api/game/sync-save**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { saveId: 'e2e-agent', updatedAt: Date.now() } })
    })
  )

  await page.route('**/api/game/advisor-chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: opts.advisorSSE ?? DEFAULT_ADVISOR_SSE
    })
  )
}

/** 注入 v2 存档 + 跳过引导，进入 game-main */
async function injectSaveAndGoto(page: Page): Promise<void> {
  await page.addInitScript((saveObj) => {
    try {
      localStorage.clear()
      localStorage.setItem('game_save', JSON.stringify({ type: 'object', data: saveObj }))
      localStorage.setItem('onboarding_done', 'true')
    } catch {
      /* ignore */
    }
  }, buildV2Save())
  await page.goto(GAME_MAIN_URL)
}

/** 选第一个选项并确认决策（进入已决策态，显示「下一回合」） */
async function selectOptionAndConfirm(page: Page): Promise<void> {
  await page.locator('.decision-button').first().click()
  await expect(page.locator('.game-main__footer-btn--confirm')).toBeVisible()
  await page.locator('.game-main__footer-btn--confirm').click()
}

/** 点击「下一回合」：触发 endTurn（npc-actions）+ startTurn（新事件），等待天下动静区块出现 */
async function clickNextTurnAndWaitNpc(page: Page): Promise<void> {
  await expect(page.locator('.game-main__footer-btn--next')).toBeVisible()
  await page.locator('.game-main__footer-btn--next').click()
  // endTurn 拉取 NPC 行动后持久化展示，区块标题「天下动静」出现
  await expect(
    page.locator('.collapsible-section__header', { hasText: '天下动静' })
  ).toBeVisible({ timeout: 30_000 })
}

/** 展开「天下动静」折叠区 */
async function expandNpcSection(page: Page): Promise<void> {
  await page.locator('.collapsible-section__header', { hasText: '天下动静' }).click()
}

test.describe('agent-flow 架构化链路（T5.1）', () => {
  test.beforeEach(async ({ page }) => {
    await mockAgentApi(page)
  })

  test('1. 军师调用 get-recent-events 工具 → 返回历史事件并写入回复', async ({ page }) => {
    await mockAgentApi(page, { advisorSSE: TOOL_CALL_ADVISOR_SSE })
    await injectSaveAndGoto(page)
    await expect(page.locator('.event-card')).toBeVisible({ timeout: 30_000 })

    // 打开军师抽屉
    await page.locator('.game-main__footer-btn--advisor').click()
    await expect(page.locator('.advisor-drawer')).toBeVisible()

    // 输入并发送一条会触发工具调用的提问
    await page.locator('.advisor-drawer__textarea').locator('textarea').fill('近些时日，可曾有大事件发生？')
    await page.locator('.advisor-drawer__send').click()

    // 工具调用完成 → 气泡状态变为 done（get-recent-events → 历史事件）
    await expect(page.locator('.advisor-tool--done')).toBeVisible({ timeout: 15_000 })

    // 回复文本引用了工具返回的历史事件（去年江淮大旱）
    await expect(
      page.locator('.advisor-msg--assistant', { hasText: '去年江淮大旱' })
    ).toBeVisible({ timeout: 15_000 })
  })

  test('2. NPC 多 Agent 决策差异化：不同势力产出不同行动类型（敌意红 / 友好绿）', async ({
    page
  }) => {
    await injectSaveAndGoto(page)
    await expect(page.locator('.event-card')).toBeVisible({ timeout: 30_000 })

    // 走完一回合（决策 + 下一回合），触发 npc-actions
    await selectOptionAndConfirm(page)
    await clickNextTurnAndWaitNpc(page)
    await expandNpcSection(page)

    // 两个势力均渲染
    await expect(
      page.locator('.npc-action-item__faction', { hasText: '太平天国' })
    ).toBeVisible()
    await expect(page.locator('.npc-action-item__faction', { hasText: '清廷' })).toBeVisible()

    // 差异化：太平天国「扩张」= 敌意（红），清廷「外交」= 友好（绿）
    await expect(page.locator('.npc-action-item__action--aggressive')).toBeVisible()
    await expect(page.locator('.npc-action-item__action--friendly')).toBeVisible()
  })

  test('3. 工具调用气泡 UI：展开详情可见工具名 + 参数 + 结果', async ({ page }) => {
    await mockAgentApi(page, { advisorSSE: TOOL_CALL_ADVISOR_SSE })
    await injectSaveAndGoto(page)
    await expect(page.locator('.event-card')).toBeVisible({ timeout: 30_000 })

    await page.locator('.game-main__footer-btn--advisor').click()
    await expect(page.locator('.advisor-drawer')).toBeVisible()

    await page.locator('.advisor-drawer__textarea').locator('textarea').fill('把近来发生的大事说与我听。')
    await page.locator('.advisor-drawer__send').click()

    // 工具容器 + 完成气泡可见
    await expect(page.locator('.advisor-tools')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.advisor-tool--done')).toBeVisible({ timeout: 15_000 })

    // 点击气泡展开详情
    await page.locator('.advisor-tool--done').click()
    await expect(page.locator('.advisor-tool__detail')).toBeVisible({ timeout: 10_000 })

    // 详情展示工具名（原始名 get-recent-events）+ 结果含历史事件
    await expect(page.locator('.advisor-tool__detail-line', { hasText: 'get-recent-events' })).toBeVisible()
    await expect(
      page.locator('.advisor-tool__detail-line', { hasText: '去年江淮大旱' })
    ).toBeVisible()
  })

  test('4. NPC 决策失败卡片：某势力决策失败 → 红色「决策失败」角标，计数含失败项', async ({
    page
  }) => {
    // 仅 f1 决策失败，无成功行动
    await mockAgentApi(page, {
      npcActions: { ok: true, data: { actions: [], failedFactionIds: ['f1'] } }
    })
    await injectSaveAndGoto(page)
    await expect(page.locator('.event-card')).toBeVisible({ timeout: 30_000 })

    await selectOptionAndConfirm(page)
    await clickNextTurnAndWaitNpc(page)
    await expandNpcSection(page)

    // 失败卡片（红色边框 + 角标）
    await expect(page.locator('.npc-action-item--failed')).toBeVisible()
    await expect(page.locator('.npc-action-item__fail-badge', { hasText: '决策失败' })).toBeVisible()
    // 失败卡片显示解析出的势力名（太平天国）
    await expect(page.locator('.npc-action-item--failed .npc-action-item__faction', { hasText: '太平天国' })).toBeVisible()

    // 计数包含失败项（0 成功 + 1 失败 = 共 1 则）
    await expect(page.locator('.npc-action-list__count', { hasText: '共 1 则' })).toBeVisible()
  })
})
