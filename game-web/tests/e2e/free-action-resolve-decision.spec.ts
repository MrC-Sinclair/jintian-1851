import { test, expect, type Page, Route } from '@playwright/test'

/**
 * 自由行动（resolve-decision）分支 —— mock-backed 端到端
 *
 * 为什么补这个：现有 story-chain-flow / two-step-decision 都在**选项决策**路径上打桩，
 * 自由输入这条分支（点「自由行动」→ 描述想做的事 → resolve-decision 解析 effects +
 * factionEffects）在 CI 里没被端到端走过；而它有两个只靠单元测试盖不住的东西：
 *   1. 后端返回的 factionEffects 要经过 store 的 clamp（关系 ±20、实力 ±30）与
 *      面板/反馈区的渲染联动，属于跨层链路；
 *   2. 失败路径的错误体是 Nitro `createError` 的**嵌套信封**（业务错误在顶层 data 下），
 *      前端 api.ts 的 unwrapErrorEnvelope 要真的把它还原成 ApiError.message，且 game-main 的
 *      onError 要把这个 message 做成 toast —— 补这条测试时正是这里漏了一层：UI 把 makeDecision
 *      的文案固定覆盖成"网络连接失败"，玩家会误以为是自己断网而不是行动被判无果。
 *      这条在单测里是 mock，在 e2e 里才是真链路。
 *
 * 数值都是确定化的（不依赖 LLM）：effects={silver:-80, military:5} → 银两 1000→920、
 * military 60→65；factionEffects={relationshipDelta:6, powerDelta:-12} → 目标势力
 * 关系 10→16（面板关系条 (16+100)/2=58%）、实力 70→58。
 */

const GAME_MAIN_URL = '/#/pages/game-main/index'
const TARGET_FACTION_ID = 'f2'
const TARGET_FACTION_NAME = '太平天国'

interface FreeActionPlan {
  /** true 时按线上 createError 的嵌套信封返回 400 */
  fail: boolean
}

function buildMockSave(): Record<string, unknown> {
  return {
    saveVersion: 2,
    saveId: '11111111-2222-4333-8444-555555555555',
    deviceId: 'e2e-free-action-device',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    character: {
      background: '武将',
      backgroundPerks: { military: 5 },
      factionId: 'f1',
      factionName: '湘军',
      factionSummary: '地方团练武装'
    },
    state: {
      turn: 1,
      date: { year: 1851, month: 1 },
      attributes: { military: 60, economy: 50, politics: 50, people: 50, diplomacy: 50 },
      resources: { silver: 1000, troops: 500, food: 800, reputation: 20 }
    },
    factions: [
      {
        id: 'f1',
        name: '湘军',
        summary: '地方团练武装',
        power: 80,
        relationship: 100,
        status: 'active'
      },
      {
        id: TARGET_FACTION_ID,
        name: TARGET_FACTION_NAME,
        summary: '起事于广西的军队',
        power: 70,
        relationship: 10,
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

/** 除 resolve-decision 外全部打桩成稳定值，让 game-main 能渲染到可决策态 */
async function stubAmbientApis(page: Page): Promise<void> {
  await page.route('**/api/game/generate-event', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          event: {
            title: '金田初起',
            description: '太平军在广西起事，逼近省城',
            eventType: '历史剧情',
            options: [
              { id: 'o1', label: '调兵镇压', effects: { military: 5 } },
              { id: 'o2', label: '观望', effects: { politics: -5 } }
            ]
          }
        }
      })
    })
  )
  await page.route('**/api/game/advisor-briefing', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { summary: '局势平稳', suggestion: '稳步发展' } })
    })
  )
  await page.route('**/api/game/npc-actions', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { actions: [] } })
    })
  )
  await page.route('**/api/game/sync-save*', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { saveId: 'e2e', updatedAt: Date.now() } })
    })
  )
}

/**
 * resolve-decision 打桩，并把收到的请求体留在数组里供断言
 *
 * 失败分支刻意用嵌套信封（顶层没有 ok，业务错误在 data 下）—— 这是线上实测过的
 * H3/Nitro 序列化形态，不是臆造：前端不解这一层就只能报"响应格式异常"。
 */
async function stubResolveDecision(
  page: Page,
  plan: FreeActionPlan,
  seen: Record<string, unknown>[]
): Promise<void> {
  await page.route('**/api/game/resolve-decision', (route: Route) => {
    seen.push(route.request().postDataJSON() as Record<string, unknown>)
    if (plan.fail) {
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: true,
          statusCode: 400,
          statusMessage: 'INVALID_DECISION',
          message: 'INVALID_DECISION',
          data: {
            ok: false,
            error: { code: 'INVALID_DECISION', message: '这段行动描述无法判定后果' }
          }
        })
      })
      return
    }
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          effects: { silver: -80, military: 5 },
          factionEffects: [
            { factionId: TARGET_FACTION_ID, relationshipDelta: 6, powerDelta: -12 }
          ]
        }
      })
    })
  })
}

async function seedSaveAndEnterGame(page: Page): Promise<void> {
  await page.addInitScript((saveObj) => {
    localStorage.clear()
    localStorage.setItem('game_save', JSON.stringify({ type: 'object', data: saveObj }))
    localStorage.setItem('onboarding_done', 'true')
  }, buildMockSave())
  await page.goto(GAME_MAIN_URL)
  await expect(page.locator('.event-card')).toBeVisible({ timeout: 30_000 })
}

/** 打开自由行动输入区并填内容 */
async function typeFreeAction(page: Page, text: string): Promise<void> {
  await page.locator('.game-main__footer-btn--free').click()
  await expect(page.locator('.game-main__free-input')).toBeVisible({ timeout: 10_000 })
  await page.locator('.game-main__free-input-area textarea').fill(text)
}

async function submitFreeAction(page: Page): Promise<void> {
  await page.locator('.game-main__free-input-actions .game-main__btn--primary').click()
}

async function readResource(page: Page, index = 0): Promise<number> {
  const text = await page
    .locator('.status-panel__resource')
    .nth(index)
    .locator('.status-panel__resource-value')
    .textContent()
  return Number.parseInt((text ?? '0').replace(/[^0-9-]/g, ''), 10)
}

/** 读回落到 localStorage 的存档（uni-app H5 的 setStorageSync 会包一层 {type,data}） */
async function readPersistedSave(page: Page): Promise<Record<string, any>> {
  const raw = await page.evaluate(() => localStorage.getItem('game_save'))
  return JSON.parse(raw ?? '{}').data ?? {}
}

test.describe('自由行动 resolve-decision（mock-backed，进 CI）', () => {
  test('1. 空输入禁用提交；成功提交后按后端 effects 精确扣减并进入已决策态', async ({ page }) => {
    const seen: Record<string, unknown>[] = []
    const plan: FreeActionPlan = { fail: false }
    await stubAmbientApis(page)
    await stubResolveDecision(page, plan, seen)
    await seedSaveAndEnterGame(page)

    // 空输入：提交按钮处于禁用态（不点，只验样式绑定）
    await page.locator('.game-main__footer-btn--free').click()
    await expect(page.locator('.game-main__free-input')).toBeVisible({ timeout: 10_000 })
    await expect(
      page.locator('.game-main__free-input-actions .game-main__btn--primary')
    ).toHaveClass(/game-main__btn--disabled/)

    await page.locator('.game-main__free-input-area textarea').fill('亲往大营督练新军，并捐银八十万')
    await expect(
      page.locator('.game-main__free-input-actions .game-main__btn--primary')
    ).not.toHaveClass(/game-main__btn--disabled/)

    const silverBefore = await readResource(page, 0)
    await submitFreeAction(page)

    // 请求体：playerDecision 是原文（≤200 不截），且带上当前事件与势力快照
    await expect
      .poll(() => seen.length, { timeout: 15_000 })
      .toBe(1)
    expect(seen[0]).toMatchObject({
      saveId: '11111111-2222-4333-8444-555555555555',
      turn: 1,
      playerDecision: '亲往大营督练新军，并捐银八十万'
    })
    expect(Array.isArray((seen[0] as { factions?: unknown[] }).factions)).toBe(true)

    // 银两精确 -80
    await expect
      .poll(async () => readResource(page, 0), { timeout: 20_000 })
      .toBe(silverBefore - 80)

    // 势力微调反馈区（数据来自后端 factionEffects，name 由 store 按 factionId 映射）
    const feedback = page.locator('.game-main__faction-feedback')
    await expect(feedback).toBeVisible({ timeout: 10_000 })
    await expect(feedback).toContainText(TARGET_FACTION_NAME)
    await expect(feedback).toContainText('关系 +6')
    await expect(feedback).toContainText('实力 -12')

    // 已决策态：出现「下一回合」按钮
    await expect(page.locator('.game-main__footer-btn--next')).toBeVisible({ timeout: 10_000 })

    // 落盘一致性：关系 10+6=16、实力 70-12=58、银两 920 都进了 localStorage 存档
    const saved = await readPersistedSave(page)
    const target = (saved.factions as Record<string, any>[]).find((f) => f.id === TARGET_FACTION_ID)
    expect(target.relationship).toBe(16)
    expect(target.power).toBe(58)
    expect(saved.state.resources.silver).toBe(920)
  })

  test('2. 后端降级/超限的 factionEffects 会被 store clamp，且不改势力状态字段', async ({ page }) => {
    const seen: Record<string, unknown>[] = []
    await stubAmbientApis(page)
    // 越界值：关系 +999、实力 +999（后端已 sanitize，这里验前端第二道 clamp ±20/±30）
    await page.route('**/api/game/resolve-decision', (route: Route) => {
      seen.push(route.request().postDataJSON() as Record<string, unknown>)
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            effects: { silver: -10 },
            factionEffects: [
              { factionId: TARGET_FACTION_ID, relationshipDelta: 999, powerDelta: 999, status: 'allied' }
            ]
          }
        })
      })
    })
    await seedSaveAndEnterGame(page)

    await typeFreeAction(page, '倾银行贿以求和')
    await submitFreeAction(page)
    await expect(page.locator('.game-main__faction-feedback')).toBeVisible({ timeout: 10_000 })
    // clamp 后是 +20 / +30，不是 +999
    await expect(page.locator('.game-main__faction-feedback')).toContainText('关系 +20')
    await expect(page.locator('.game-main__faction-feedback')).toContainText('实力 +30')

    const saved = await readPersistedSave(page)
    const target = (saved.factions as Record<string, any>[]).find((f) => f.id === TARGET_FACTION_ID)
    expect(target.relationship).toBe(30) // 10 + 20
    expect(target.power).toBe(100) // 70 + 30
    // 软性微调不得改 status：仍为 active，不能因为 LLM 给了 allied 就结盟
    expect(target.status).toBe('active')
  })

  test('3. 失败分支：createError 嵌套信封被还原成服务端 code/message，决策不生效且可重试', async ({ page }) => {
    const seen: Record<string, unknown>[] = []
    const plan: FreeActionPlan = { fail: true }
    await stubAmbientApis(page)
    await stubResolveDecision(page, plan, seen)
    await seedSaveAndEnterGame(page)

    const silverBefore = await readResource(page, 0)
    await typeFreeAction(page, '召集群臣密议')
    await submitFreeAction(page)

    // toast 必须显示服务端 message —— 只有信封拆包成功且 UI 不再覆盖文案才会
    await expect(page.locator('.toast')).toContainText('这段行动描述无法判定后果', { timeout: 10_000 })

    // 决策未生效：没有已决策态、没扣银两、输入区还在（可改后再交）
    await expect(page.locator('.game-main__footer-btn--next')).toHaveCount(0)
    expect(await readResource(page, 0)).toBe(silverBefore)
    await expect(page.locator('.game-main__free-input')).toBeVisible()

    // 切成成功再提交：证明失败没有把这一回合锁死
    plan.fail = false
    await submitFreeAction(page)
    await expect(page.locator('.game-main__footer-btn--next')).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(async () => readResource(page, 0), { timeout: 20_000 })
      .toBe(silverBefore - 80)
  })

  test('4. 超长输入按 200 字截断后再发请求', async ({ page }) => {
    const seen: Record<string, unknown>[] = []
    await stubAmbientApis(page)
    await stubResolveDecision(page, { fail: false }, seen)
    await seedSaveAndEnterGame(page)

    await typeFreeAction(page, '银'.repeat(250))
    await submitFreeAction(page)
    await expect
      .poll(() => seen.length, { timeout: 15_000 })
      .toBe(1)
    const decision = (seen[0] as { playerDecision: string }).playerDecision
    expect(decision.length).toBe(200)
    expect(decision).toBe('银'.repeat(200))
  })
})
