import { test, expect, type Page } from '@playwright/test'

/**
 * 危机预警 E2E 测试（T1.15 / T3.2）
 *
 * 覆盖 tasks.md T4.1：
 *   - 注入低属性存档（military < 30）→ 进入 game-main → 回合开始触发 toast.warning
 *   - toast 文案包含属性中文名 + 数值 + "濒临崩溃"提示
 *
 * 触发链路：
 *   game-main onMounted → useTurn.startTurn → getCrisis(state) 检测属性<30
 *   → onCrisis 回调 → toast.warning(`${name} ${value}（濒临崩溃…）`)
 *
 * Mock 策略：
 *   - localStorage 注入 military=15 的存档（远低于 30 阈值）
 *   - page.route 拦截所有 API
 *   - onboarding_done=true 跳过引导（直接 startTurn）
 */

const GAME_MAIN_URL = '/#/pages/game-main/index'

/** 构造低属性存档（military=15 触发危机） */
function buildCrisisSave(): Record<string, unknown> {
  return {
    saveVersion: 1,
    saveId: 'e2e-crisis-' + Math.random().toString(36).slice(2),
    deviceId: 'e2e-device',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    character: {
      background: '武将',
      backgroundPerks: { military: 10 },
      factionId: 'f1',
      factionName: '湘军',
      factionSummary: '曾国藩创立的地方团练武装'
    },
    state: {
      turn: 2,
      date: { year: 1851, month: 2 },
      // military=15 触发危机（<30）；其他属性正常避免多个 toast 干扰断言
      attributes: { military: 15, economy: 50, politics: 50, people: 50, diplomacy: 50 },
      resources: { silver: 1000, troops: 500, food: 800, reputation: 20 }
    },
    factions: [
      {
        id: 'f1',
        name: '湘军',
        summary: '曾国藩创立的地方团练武装',
        power: 75,
        relationship: 10,
        status: 'active'
      }
    ],
    events: [],
    advisorMessages: [],
    ended: false
  }
}

/** 拦截所有 API */
async function mockAllApi(page: Page): Promise<void> {
  await page.route('**/api/game/generate-event', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          // 后端 GenerateEventResponse 包装：{ event: {...} }
          event: {
            title: '太平军压境',
            description: '太平军逼近，军事告急',
            eventType: '军事',
            options: [
              { id: 'o1', label: '调兵迎击', effects: { military: 5 } },
              { id: 'o2', label: '坚守不出', effects: { politics: -5 } }
            ]
          }
        }
      })
    })
  )
  await page.route('**/api/game/advisor-briefing', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: { summary: '军事告急', suggestion: '优先提升军事' }
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
  await page.route('**/api/game/sync-save**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { saveId: 'e2e', updatedAt: Date.now() } })
    })
  )
}

test.describe('危机预警 toast（T1.15/T3.2）', () => {
  test.beforeEach(async ({ page }) => {
    // 注入低属性存档 + 跳过引导
    // 注意：uni-app H5 的 setStorageSync 写对象时会包装为 {type:'object', data: obj}
    await page.addInitScript((saveObj) => {
      try {
        localStorage.clear()
        localStorage.setItem('game_save', JSON.stringify({ type: 'object', data: saveObj }))
        localStorage.setItem('onboarding_done', 'true')
      } catch {
        /* ignore */
      }
    }, buildCrisisSave())
    await mockAllApi(page)
  })

  test('1. 低属性存档进入游戏，回合开始触发 warning toast', async ({ page }) => {
    await page.goto(GAME_MAIN_URL)

    // 等待 toast 出现（startTurn 异步触发危机检查）
    const warningToast = page.locator('.toast--warning').first()
    await expect(warningToast).toBeVisible({ timeout: 30_000 })

    // toast 文案包含"军事"和"15"和"濒临崩溃"
    const message = warningToast.locator('.toast__message')
    await expect(message).toContainText('军事')
    await expect(message).toContainText('15')
    await expect(message).toContainText('濒临崩溃')
  })

  test('2. 危机预警 toast 自动消失（duration 后）', async ({ page }) => {
    await page.goto(GAME_MAIN_URL)

    // 等待 toast 出现
    const warningToast = page.locator('.toast--warning').first()
    await expect(warningToast).toBeVisible({ timeout: 30_000 })

    // toast 默认 duration 3000ms，等待消失（最多 10s 容错）
    await expect(warningToast).not.toBeVisible({ timeout: 10_000 })
  })
})
