import { test, expect, type Page, Route } from '@playwright/test'

/**
 * 备选事件角标（generate-event 的整包降级）—— mock-backed 端到端
 *
 * 为什么补这条：后端 LLM 两次都失败时不报错，而是返回预置事件池里的一条
 * （docs/API.md「缓存与降级」：响应顶层 `fallback:true` + `X-Fallback`）。改造前前端走
 * `post()`，顶层标志被剥掉，玩家看到的是一条看起来完全正常的事件 —— 兜底伪装成剧情。
 * 现在把标志接到 store.eventDegraded，事件卡下方显示角标。
 *
 * 打桩方式与本仓库其它 mock-backed 用例一致：只桩非流式 `generate-event`，
 * 流式那次（`?stream=1`）不桩，让它按既有行为失败后回落到非流式。
 * 角标用**常驻角标而不是 toast**：toast 会和同屏的危机提示相互盖掉，
 * 而"这条事件是兜底来的"是本回合持续有效的事实，不是一次性通知。
 */

const GAME_MAIN_URL = '/#/pages/game-main/index'

function buildMockSave(): Record<string, unknown> {
  return {
    saveVersion: 2,
    saveId: '11111111-2222-4333-8444-555555555555',
    deviceId: 'e2e-event-degraded-device',
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
      { id: 'f1', name: '湘军', summary: '地方团练武装', power: 80, relationship: 100, status: 'active' }
    ],
    events: [],
    advisorMessages: [],
    pendingChainNodes: [],
    completedChainIds: [],
    activeChainIds: [],
    ended: false
  }
}

function eventPayload(title: string): Record<string, unknown> {
  return {
    title,
    description: '一段局势描述',
    eventType: '随机',
    options: [
      { id: 'o1', label: '应对一', effects: { military: 3 } },
      { id: 'o2', label: '应对二', effects: { politics: -3 } }
    ]
  }
}

/** 桩非流式 generate-event；fallback=true 时按后端降级形态带上顶层标志 */
async function stubGenerateEvent(page: Page, title: string, fallback: boolean): Promise<void> {
  await page.route('**/api/game/generate-event', (route: Route) => {
    const body: Record<string, unknown> = { ok: true, data: { event: eventPayload(title) } }
    if (fallback) body.fallback = true
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function stubAmbientApis(page: Page): Promise<void> {
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

async function seedAndEnter(page: Page): Promise<void> {
  await page.addInitScript((saveObj) => {
    localStorage.clear()
    localStorage.setItem('game_save', JSON.stringify({ type: 'object', data: saveObj }))
    localStorage.setItem('onboarding_done', 'true')
  }, buildMockSave())
  await page.goto(GAME_MAIN_URL)
  await expect(page.locator('.event-card')).toBeVisible({ timeout: 30_000 })
}

test.describe('备选事件角标（mock-backed，进 CI）', () => {
  test('1. 后端返回 fallback:true：事件卡下方出现备选角标', async ({ page }) => {
    await stubAmbientApis(page)
    await stubGenerateEvent(page, '金田初起', true)
    await seedAndEnter(page)

    const badge = page.locator('.game-main__event-degraded')
    await expect(badge).toBeVisible({ timeout: 15_000 })
    await expect(badge).toContainText('备选事件')
    // 事件本身照常可选：降级不改变玩法，只是加了说明
    await expect(page.locator('.decision-button')).toHaveCount(2)
  })

  test('2. 正常生成的事件不带角标', async ({ page }) => {
    await stubAmbientApis(page)
    await stubGenerateEvent(page, '省城戒严', false)
    await seedAndEnter(page)

    await expect(page.locator('.event-card')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.game-main__event-degraded')).toHaveCount(0)
  })

  test('3. 兜底回合之后进入正常回合：角标随新事件复位', async ({ page }) => {
    let firstCall = true
    await stubAmbientApis(page)
    await page.route('**/api/game/generate-event', (route: Route) => {
      const fallback = firstCall
      firstCall = false
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: { event: eventPayload(fallback ? '金田初起' : '省城戒严') },
          ...(fallback ? { fallback: true } : {})
        })
      })
    })
    await seedAndEnter(page)
    await expect(page.locator('.game-main__event-degraded')).toBeVisible({ timeout: 15_000 })

    // 选一个选项决策 → 下一回合（endTurn 内会再次 startTurn 取新事件）
    await page.locator('.decision-button').first().click()
    await page.locator('.game-main__footer-btn--confirm').click()
    await expect(page.locator('.game-main__footer-btn--next')).toBeVisible({ timeout: 20_000 })
    await page.locator('.game-main__footer-btn--next').click()

    await expect(page.locator('.event-card')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.game-main__event-degraded')).toHaveCount(0)
  })
})
