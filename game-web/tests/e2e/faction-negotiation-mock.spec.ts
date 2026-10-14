import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * 写信谈判 —— mock-backed 端到端（不依赖真实后端与 LLM）
 *
 * 为什么单独写这个文件：原有的 faction-negotiation.spec.ts 标题带 `[real-backend]`，
 * 被 CI 的 `--grep-invert "real-backend"` 排除，所以**谈判整条 UI 流程在 CI 里零覆盖**；
 * 而它靠真 LLM 还必须对"还价/直接应允/降级"三种随机结局做 test.skip ——
 * 恰恰把最容易写错的分支（降级不扣配额、settle 降级仍算作罢）跳过去了。
 *
 * 这里用 page.route 打桩 faction-negotiate，把结局**确定化**，因此能断言精确数值：
 * 前端兑换表（utils/constants.ts NEGOTIATION_DEALS）与后端同款线性缩放，
 * gift-deal 的 cost.silver=[60,120]、effect.relationship=[10,20]，
 * 价格 90 → ratio=(90-60)/(120-60)=0.5 → 关系增益 round(10+0.5×10)=15，
 * 信件 delta 4 → 合计 +19，目标势力关系 10 → 29，银两 1000 → 910。
 *
 * 三条用例分别钉住三种结局：
 *   1. counter → 接受：卡片数值、精确扣减、配额归零、入档摘要
 *   2. letter 降级（fallback）：不消耗配额、可重发成功 —— 真后端用例只能软跳过的那支
 *   3. settle 降级：仍算作罢、不退配额、银两不动
 */

const GAME_MAIN_URL = '/#/pages/game-main/index'
const TARGET_FACTION_ID = 'f2'
const TARGET_FACTION_NAME = '太平天国'

/** 谈判打桩计划：letter/settle 两阶段各自返回什么，可由用例改写 */
interface NegotiationPlan {
  letterFallback: boolean
  settleFallback: boolean
  /** letter 阶段是否还价（false 表示直接应允，无 deal） */
  counter: boolean
}

function buildMockSave(): Record<string, unknown> {
  return {
    saveVersion: 2,
    saveId: '11111111-2222-4333-8444-555555555555',
    deviceId: 'e2e-negotiation-device',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    character: {
      background: '武将',
      backgroundPerks: { military: 5 },
      factionId: 'f1',
      factionName: '湘军',
      factionSummary: '曾国藩创立的地方团练武装'
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

/** 谈判以外的端点全部打桩成"无事发生"，让 game-main 能稳定渲染 */
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
            description: '太平军在广西起事',
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
 * faction-negotiate 打桩：按 phase 分流
 *
 * 降级用 `{ ok: true, fallback: true }` —— 这是服务端的真实形态（api.ts 把顶层
 * fallback 一起带出），不是 HTTP 错误：客户端据此"不消耗配额 / 仅算信件影响"。
 */
async function stubNegotiation(page: Page, plan: NegotiationPlan): Promise<void> {
  await page.route('**/api/game/faction-negotiate', (route: Route) => {
    const body = route.request().postDataJSON() as { phase: string }
    if (body.phase === 'letter') {
      if (plan.letterFallback) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            fallback: true,
            data: { stance: 'reject', reply: '', relationshipDelta: 0 }
          })
        })
        return
      }
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: plan.counter
            ? {
                stance: 'counter',
                reply: '欲结好，先备白银九十万。',
                relationshipDelta: 4,
                deal: { dealId: 'gift-deal', price: 90 }
              }
            : { stance: 'accept', reply: '愿与贵军修好。', relationshipDelta: 4 }
        })
      })
      return
    }
    // settle 阶段
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        ...(plan.settleFallback ? { fallback: true } : {}),
        data: plan.settleFallback
          ? { stance: 'reject', reply: '……', relationshipDelta: 4 }
          : { stance: 'accept', reply: '成交，从此互不侵犯。', relationshipDelta: 4 }
      })
    })
  })
}

/** 进入 game-main 并打开目标势力的谈判弹窗 */
async function openNegotiation(page: Page): Promise<void> {
  await page.goto(GAME_MAIN_URL)
  await expect(page.locator('.event-card')).toBeVisible({ timeout: 30_000 })
  await page.locator('.game-main__footer-btn--diplomacy').click()
  await expect(page.locator('.diplomacy-panel')).toBeVisible({ timeout: 15_000 })
  await page
    .locator('.diplomacy-panel__faction', { hasText: TARGET_FACTION_NAME })
    .locator('.diplomacy-panel__action--letter')
    .click()
  await expect(page.locator('.negotiation-dialog')).toBeVisible({ timeout: 15_000 })
}

/** 填信：uni-app H5 把 class 落在 <uni-textarea> 外层，fill 必须打在原生 textarea 上；
 *  且 fill 是整体覆盖 —— 降级回到写信页时草稿还在，用 insertText 会变成两遍字数 */
async function writeLetter(page: Page): Promise<void> {
  const LETTER = '久闻贵军威名，愿以白银结好。若蒙不弃，还请开个价码。'
  await page.locator('.negotiation-dialog__textarea textarea').fill(LETTER)
  await expect(page.locator('.negotiation-dialog__count')).toHaveText(`${LETTER.length}/200`, {
    timeout: 10_000
  })
}

async function readSilver(page: Page): Promise<number> {
  const text = await page
    .locator('.status-panel__resource')
    .first()
    .locator('.status-panel__resource-value')
    .textContent()
  return Number.parseInt((text ?? '0').replace(/[^0-9-]/g, ''), 10)
}

test.describe('写信谈判（mock-backed，进 CI）', () => {
  test('1. 还价→接受：条件卡片按兑换表缩放，银两精确扣减，配额归零', async ({ page }) => {
    await page.addInitScript((saveObj) => {
      localStorage.clear()
      localStorage.setItem('game_save', JSON.stringify({ type: 'object', data: saveObj }))
      localStorage.setItem('onboarding_done', 'true')
    }, buildMockSave())
    await stubAmbientApis(page)
    await stubNegotiation(page, { letterFallback: false, settleFallback: false, counter: true })

    await openNegotiation(page)
    const silverBefore = await readSilver(page)
    // 谈判前配额未用：面板显示「谈判剩余 1」
    await expect(page.locator('.diplomacy-panel__remaining')).toContainText('谈判剩余 1')

    await writeLetter(page)
    await page.locator('.negotiation-dialog__btn--primary').click()
    await expect(page.locator('.negotiation-dialog__loading')).toBeVisible({ timeout: 15_000 })

    // counter → 条件卡片：数值来自前端兑换表，不来自 LLM
    const dealCard = page.locator('.negotiation-dialog__deal-card')
    await expect(dealCard).toBeVisible({ timeout: 15_000 })
    await expect(dealCard).toContainText('馈赠通好')
    await expect(dealCard).toContainText(/银两\s*90/)
    // ratio=0.5 → round(10+0.5×10)=15
    await expect(dealCard).toContainText('关系 +15')

    await page
      .locator('.negotiation-dialog__actions .negotiation-dialog__btn', { hasText: '接受条件' })
      .click()

    // 成交摘要 + 银两精确扣 90
    await expect(page.locator('.negotiation-dialog__reply-card')).toContainText('谈判成交', {
      timeout: 15_000
    })
    await expect(page.locator('.negotiation-dialog__delta')).toHaveText(
      '谈判成交：按银两 90 结算（关系变化已入档）'
    )
    await expect
      .poll(async () => readSilver(page), { timeout: 20_000 })
      .toBe(silverBefore - 90)

    // 关系实际入档：10 + (信件 4 + 兑换 15) = 29 → 面板关系条宽度 (29+100)/2 = 64.5%
    // 弹窗是在外交面板之上打开的，关掉弹窗后面板仍在原处 —— 不能再点一次底部按钮
    // （实测：再点会被 game-main__diplomacy-mask 拦住并超时）
    await page.locator('.negotiation-dialog__btn--primary').last().click()
    await expect(page.locator('.negotiation-dialog')).toHaveCount(0)
    const targetRow = page.locator('.diplomacy-panel__faction', { hasText: TARGET_FACTION_NAME })
    await expect(targetRow.locator('.diplomacy-panel__bar-fill')).toHaveAttribute(
      'style',
      /width:\s*64\.5%/
    )
    // 配额用尽
    await expect(page.locator('.diplomacy-panel__remaining')).toContainText('谈判剩余 0')
  })

  test('2. letter 降级：不消耗配额、可重发成功（真后端用例只能软跳过的那支）', async ({ page }) => {
    const plan: NegotiationPlan = { letterFallback: true, settleFallback: false, counter: true }
    await page.addInitScript((saveObj) => {
      localStorage.clear()
      localStorage.setItem('game_save', JSON.stringify({ type: 'object', data: saveObj }))
      localStorage.setItem('onboarding_done', 'true')
    }, buildMockSave())
    await stubAmbientApis(page)
    await stubNegotiation(page, plan)

    await openNegotiation(page)
    const silverBefore = await readSilver(page)
    await writeLetter(page)

    await page.locator('.negotiation-dialog__btn--primary').click()

    // 降级：回到写信页 + warning toast，且不置位配额
    await expect(page.locator('.negotiation-dialog__textarea')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.toast')).toContainText('信使途中受阻', { timeout: 10_000 })
    await expect(page.locator('.negotiation-dialog__deal-card')).toHaveCount(0)
    await expect(page.locator('.diplomacy-panel__remaining')).toContainText('谈判剩余 1')
    expect(await readSilver(page)).toBe(silverBefore)

    // 把桩切成成功，重发必须能走通 —— 证明降级没把配额吞掉
    plan.letterFallback = false
    await writeLetter(page)
    await page.locator('.negotiation-dialog__btn--primary').click()
    await expect(page.locator('.negotiation-dialog__deal-card')).toBeVisible({ timeout: 15_000 })
  })

  test('3. settle 降级：算作罢、不退已耗配额、银两不动', async ({ page }) => {
    await page.addInitScript((saveObj) => {
      localStorage.clear()
      localStorage.setItem('game_save', JSON.stringify({ type: 'object', data: saveObj }))
      localStorage.setItem('onboarding_done', 'true')
    }, buildMockSave())
    await stubAmbientApis(page)
    await stubNegotiation(page, { letterFallback: false, settleFallback: true, counter: true })

    await openNegotiation(page)
    const silverBefore = await readSilver(page)
    await writeLetter(page)
    await page.locator('.negotiation-dialog__btn--primary').click()
    await expect(page.locator('.negotiation-dialog__deal-card')).toBeVisible({ timeout: 15_000 })

    await page
      .locator('.negotiation-dialog__actions .negotiation-dialog__btn', { hasText: '接受条件' })
      .click()

    // settle 降级文案 + 不扣银两（deal 未执行），配额仍算用掉
    await expect(page.locator('.negotiation-dialog__delta')).toContainText('对方未有回音', {
      timeout: 15_000
    })
    expect(await readSilver(page)).toBe(silverBefore)
    await page.locator('.negotiation-dialog__btn--primary').last().click()
    await expect(page.locator('.negotiation-dialog')).toHaveCount(0)
    await expect(page.locator('.diplomacy-panel__remaining')).toContainText('谈判剩余 0')
  })
})
