import { test, expect, type Page } from '@playwright/test'

/**
 * story-chain-flow 完整剧情链流程 E2E 测试（expand-event-engine T5.2）
 *
 * 覆盖 tasks.md T5.2 场景：
 *   玩家身份"武将" + 势力"湘军" → 进入 1851-1 → 触发金田起义剧情 →
 *   选择"出兵镇压" → 下回合触发"定都天京"节点 → 验证 EventCard 显示剧情进度角标 →
 *   完成 5 节点 → 验证 completedChainIds 含 tai-ping-tian-guo
 *
 * Mock 策略（与 character-create / two-step-decision 一致）：
 *   - page.route 拦截所有 API，不依赖真实后端
 *   - generate-event 拦截器是**有状态**的：读取请求体里的 pendingChainNodes，
 *     命中则返回对应剧情链节点（X-Event-Source: pending-chain）；
 *     首回合（pending 为空）返回 node-1（模拟时间窗口匹配，X-Event-Source: time-window）；
 *     链已 completed 且 pending 为空时返回普通兜底事件（不携带 chainId）。
 *   - localStorage 注入合法 v2 存档 + onboarding_done=true 跳过引导
 *
 * 路由：game-main 在 /#/pages/game-main/index
 */

const GAME_MAIN_URL = '/#/pages/game-main/index'

/** 太平天国兴亡 5 节点（与 server/server/runtime/story-chains.ts 严格一致） */
const NODE_SEQUENCE = [
  { nodeId: 'node-1', title: '金田起义', badge: '剧情 1/5', optionA: '出兵镇压' },
  { nodeId: 'node-2', title: '定都天京', badge: '剧情 2/5', optionA: '派兵江防固守' },
  { nodeId: 'node-3', title: '天京事变', badge: '剧情 3/5', optionA: '趁乱进逼天京' },
  { nodeId: 'node-4', title: '安庆失守', badge: '剧情 4/5', optionA: '水陆并进规复' },
  { nodeId: 'node-5', title: '天京陷落', badge: '剧情 5/5', optionA: '论功进剿余孽' }
] as const

/** 剧情链事件最小结构（E2E 断言只关心展示字段 + 选项 nextChainNodeId 推进） */
interface ChainNodeEvent {
  title: string
  description: string
  eventType: '历史剧情'
  options: Array<{
    id: string
    label: string
    effects: Record<string, number>
    nextChainNodeId?: string
  }>
  chainId: string
  chainNodeId: string
  chainProgress: { current: number; total: number }
}

function buildChainNode(nodeId: string, current: number): ChainNodeEvent {
  // option 'a' 文案跟随 NODE_SEQUENCE 中每个节点的期望（与测试点击文案一致），
  // 仅 node-1 显式携带 nextChainNodeId，其余节点依赖前端 getNextNodeId 线性推进
  const optionALabel = NODE_SEQUENCE.find((n) => n.nodeId === nodeId)!.optionA
  const optionA =
    nodeId === 'node-1'
      ? { id: 'a', label: optionALabel, effects: { military: 8, troops: -200 }, nextChainNodeId: 'node-2' }
      : { id: 'a', label: optionALabel, effects: { military: 5 }, nextChainNodeId: undefined }
  return {
    title: NODE_SEQUENCE.find((n) => n.nodeId === nodeId)!.title,
    description: '（E2E 模拟事件）剧情链节点事件描述。',
    eventType: '历史剧情',
    options: [
      optionA as ChainNodeEvent['options'][number],
      { id: 'b', label: '观望', effects: { politics: 3 } },
      { id: 'c', label: '回避', effects: { diplomacy: -3 } }
    ],
    chainId: 'tai-ping-tian-guo',
    chainNodeId: nodeId,
    chainProgress: { current, total: 5 }
  }
}

const CHAIN_NODES: Record<string, ChainNodeEvent> = {
  'node-1': buildChainNode('node-1', 1),
  'node-2': buildChainNode('node-2', 2),
  'node-3': buildChainNode('node-3', 3),
  'node-4': buildChainNode('node-4', 4),
  'node-5': buildChainNode('node-5', 5)
}

/** 链已完成且 pending 为空时返回的普通兜底事件（不携带 chainId） */
const FALLBACK_EVENT = {
  title: '江南大旱',
  description: '（E2E 模拟）年份推移后的普通民生事件。',
  eventType: '民生' as const,
  options: [
    { id: 'a', label: '开仓赈灾', effects: { people: 5, silver: -100 } },
    { id: 'b', label: '祈祷求雨', effects: { people: 2 } }
  ]
}

/** 构造合法 v2 GameSave（武将 + 湘军，1851-1） */
function buildV2Save(): Record<string, unknown> {
  return {
    saveVersion: 2,
    saveId: 'e2e-chain-' + Math.random().toString(36).slice(2),
    deviceId: 'e2e-device',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    character: {
      background: '武将',
      backgroundPerks: { military: 10, politics: -5, people: 5 },
      factionId: 'f2',
      factionName: '湘军',
      factionSummary: '曾国藩创立的地方团练武装'
    },
    state: {
      turn: 1,
      date: { year: 1851, month: 1 },
      attributes: { military: 60, economy: 50, politics: 45, people: 55, diplomacy: 50 },
      resources: { silver: 1000, troops: 500, food: 800, reputation: 20 }
    },
    factions: [
      {
        id: 'f1',
        name: '太平天国',
        summary: '洪秀全领导的农民起义政权',
        power: 80,
        relationship: -20,
        status: 'active'
      },
      {
        id: 'f4',
        name: '清廷',
        summary: '摇摇欲坠的大清帝国中央',
        power: 90,
        relationship: -50,
        status: 'active'
      }
    ],
    events: [],
    advisorMessages: [],
    pendingChainNodes: [],
    completedChainIds: [],
    activeChainIds: [],
    ended: false
  }
}

/** 拦截所有 API（generate-event 有状态，其余返回固定成功体） */
async function mockChainFlowApi(page: Page): Promise<void> {
  await page.route('**/api/game/generate-event', async (route) => {
    let body: {
      pendingChainNodes?: Array<{ chainId: string; nodeId: string; scheduledTurn: number }>
      completedChainIds?: string[]
    } = {}
    try {
      body = (await route.request().postDataJSON()) as typeof body
    } catch {
      /* ignore parse error */
    }
    const pending = Array.isArray(body.pendingChainNodes) ? body.pendingChainNodes! : []
    let event: unknown
    let source: string
    if (pending.length > 0) {
      // 挂起节点优先（三层触发第一优先）
      const node = CHAIN_NODES[pending[0].nodeId]
      event = node ?? FALLBACK_EVENT
      source = 'pending-chain'
    } else if (
      Array.isArray(body.completedChainIds) &&
      body.completedChainIds!.includes('tai-ping-tian-guo')
    ) {
      // 链已完成 → 普通兜底事件（不携带 chainId，模拟时间窗口不再命中）
      event = FALLBACK_EVENT
      source = 'llm'
    } else {
      // 首回合：时间窗口命中 startYear=1851 → node-1
      event = CHAIN_NODES['node-1']
      source = 'time-window'
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'X-Event-Source': source },
      body: JSON.stringify({ ok: true, data: { event } })
    })
  })

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
      body: JSON.stringify({ ok: true, data: { actions: [] } })
    })
  )
  await page.route('**/api/game/resolve-decision', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { effects: {} } })
    })
  )
  await page.route('**/api/game/sync-save**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { saveId: 'e2e-chain', updatedAt: Date.now() } })
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

/** 选第一个选项（按文案定位 option 'a'）+ 点击「确认决策」 */
async function selectOptionAndConfirm(page: Page, optionLabel: string): Promise<void> {
  await page.locator('.decision-button', { hasText: optionLabel }).first().click()
  await expect(page.locator('.game-main__footer-btn--confirm')).toBeVisible()
  await page.locator('.game-main__footer-btn--confirm').click()
}

/** 点击「下一回合」并等待新回合事件渲染完成 */
async function clickNextTurnAndWait(page: Page, nextTitle: string): Promise<void> {
  await expect(page.locator('.game-main__footer-btn--next')).toBeVisible()
  await page.locator('.game-main__footer-btn--next').click()
  // 下一回合会触发 endTurn + startTurn（含 spinner），等待新事件标题出现
  await expect(page.locator('.event-card__title')).toContainText(nextTitle, { timeout: 30_000 })
}

test.describe('story-chain-flow 完整剧情链流程（T5.2）', () => {
  test.beforeEach(async ({ page }) => {
    await mockChainFlowApi(page)
  })

  test('1. 进入 1851-1 首回合：金田起义 + 剧情进度角标 1/5 + 链名「太平天国兴亡」', async ({
    page
  }) => {
    await injectSaveAndGoto(page)

    // EventCard 渲染金田起义
    await expect(page.locator('.event-card__title')).toContainText('金田起义', { timeout: 30_000 })

    // T4.1：剧情进度角标（右上角）显示「剧情 1/5」
    await expect(page.locator('.event-card__chain-badge')).toContainText('剧情 1/5')

    // T4.1：剧情链名（顶部左侧）显示「太平天国兴亡」
    await expect(page.locator('.event-card__chain-title')).toContainText('太平天国兴亡')

    // 首回合 pendingChainNodes 为空 → FocusPanel「剧情待续」不显示
    await expect(page.locator('.focus-panel__pending')).toHaveCount(0)
  })

  test('2. 选择「出兵镇压」→ FocusPanel 显示「剧情待续 1 条」→ 下回合触发「定都天京」2/5', async ({
    page
  }) => {
    await injectSaveAndGoto(page)
    await expect(page.locator('.event-card__title')).toContainText('金田起义', { timeout: 30_000 })

    // 选择「出兵镇压」（option 'a'，携带 nextChainNodeId: node-2）并确认
    await selectOptionAndConfirm(page, '出兵镇压')

    // T4.3：确认后 pendingChainNodes 入队 → FocusPanel「剧情待续」显示，计数 1 条
    await expect(page.locator('.focus-panel__pending')).toBeVisible()
    await expect(page.locator('.focus-panel__pending-title')).toContainText('剧情待续')
    await expect(page.locator('.focus-panel__pending-count')).toContainText('1 条')

    // 点击下一回合 → 第二节点「定都天京」触发
    await clickNextTurnAndWait(page, '定都天京')

    // T4.1：第二节点角标「剧情 2/5」
    await expect(page.locator('.event-card__chain-badge')).toContainText('剧情 2/5')
    await expect(page.locator('.event-card__chain-title')).toContainText('太平天国兴亡')
  })

  test('3. 展开「剧情待续」详情：显示下一节点标题「定都天京」与「第 2 回合将触发」', async ({
    page
  }) => {
    await injectSaveAndGoto(page)
    await expect(page.locator('.event-card__title')).toContainText('金田起义', { timeout: 30_000 })

    await selectOptionAndConfirm(page, '出兵镇压')

    // 点击提示条展开详情
    await expect(page.locator('.focus-panel__pending')).toBeVisible()
    await page.locator('.focus-panel__pending').click()

    // 详情区显示下一节点（node-2 定都天京），进度文案「剧情 1/5」（node-2 在链中序号 1）
    await expect(page.locator('.focus-panel__pending-item-title')).toContainText('太平天国兴亡')
    await expect(page.locator('.focus-panel__pending-item-next')).toContainText('定都天京')
    await expect(page.locator('.focus-panel__pending-item-next')).toContainText('第 2 回合')
  })

  test('4. 完整 5 节点流程 → 存档 completedChainIds 含 tai-ping-tian-guo', async ({ page }) => {
    await injectSaveAndGoto(page)
    await expect(page.locator('.event-card__title')).toContainText('金田起义', { timeout: 30_000 })

    // 依次走过 5 个节点：每节点断言标题 + 角标 → 选 option 'a' 确认 → 下一回合
    for (let i = 0; i < NODE_SEQUENCE.length; i++) {
      const node = NODE_SEQUENCE[i]
      // 等待并断言当前节点事件
      await expect(page.locator('.event-card__title')).toContainText(node.title, { timeout: 30_000 })
      await expect(page.locator('.event-card__chain-badge')).toContainText(node.badge)
      await expect(page.locator('.event-card__chain-title')).toContainText('太平天国兴亡')

      // 选该节点 option 'a' 并确认决策
      await selectOptionAndConfirm(page, node.optionA)

      // 点击下一回合推进（末节点也点击，触发 endTurn 持久化 completedChainIds）
      await expect(page.locator('.game-main__footer-btn--next')).toBeVisible()
      await page.locator('.game-main__footer-btn--next').click()
      // 末节点之后会出现兜底普通事件（链已完成），等待其渲染完成
      if (i < NODE_SEQUENCE.length - 1) {
        await expect(page.locator('.event-card__title')).toContainText(NODE_SEQUENCE[i + 1].title, {
          timeout: 30_000
        })
      } else {
        await expect(page.locator('.event-card__title')).toContainText('江南大旱', { timeout: 30_000 })
      }
    }

    // 验证本地存档 completedChainIds 已包含 tai-ping-tian-guo（末节点 makeDecision 完成链 + endTurn 持久化）
    await page.waitForFunction(
      () => {
        try {
          const raw = JSON.parse(localStorage.getItem('game_save') || '{}')
          const save = raw?.data
          return (
            Array.isArray(save?.completedChainIds) &&
            save.completedChainIds.includes('tai-ping-tian-guo')
          )
        } catch {
          return false
        }
      },
      undefined,
      { timeout: 15_000 }
    )

    const completed = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('game_save') || '{}')
      return raw?.data?.completedChainIds
    })
    expect(completed).toContain('tai-ping-tian-guo')
  })
})
