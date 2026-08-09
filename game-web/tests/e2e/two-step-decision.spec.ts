import { test, expect, type Page } from '@playwright/test'

/**
 * 两步交互决策 E2E 测试（T3.1）
 *
 * 覆盖 tasks.md T4.1：
 *   - 选项点击进入选中态（border + bg + 勾选标记）
 *   - 反悔重选：点已选中项取消选中
 *   - 切换选中：点其他选项切换选中态
 *   - 确认决策按钮 disabled 联动（未选中 disabled，选中后可点击）
 *   - 确认后进入"已决策"态（显示下一回合）
 *
 * Mock 策略：
 *   - page.route 拦截 generate-event / advisor-briefing / npc-actions / resolve-decision / sync-save
 *   - localStorage 注入合法存档 + onboarding_done=true 跳过引导
 *
 * 路由：game-main 在 /#/pages/game-main/index
 */

const GAME_MAIN_URL = '/#/pages/game-main/index'

/** 构造合法 GameSave */
function buildMockSave(): Record<string, unknown> {
  return {
    saveVersion: 1,
    saveId: 'e2e-twostep-' + Math.random().toString(36).slice(2),
    deviceId: 'e2e-device',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    character: {
      background: '文官',
      backgroundPerks: { politics: 5 },
      factionId: 'f1',
      factionName: '湘军',
      factionSummary: '曾国藩创立的地方团练武装'
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

/** 拦截所有 API，避免真实后端依赖 */
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
            title: '金田起义初起',
            description: '太平军在广西起事，威胁南方',
            eventType: '历史剧情',
            options: [
              { id: 'o1', label: '调兵镇压', effects: { military: 5, silver: -100 } },
              { id: 'o2', label: '观望', effects: { politics: -5 } },
              { id: 'o3', label: '求援洋人', effects: { diplomacy: -10 } }
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
  // resolve-decision 返回 effects（选项决策本地应用，自由输入才调此 API）
  await page.route('**/api/game/resolve-decision', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          // 后端 ResolveDecisionResponse：{ effects: {...} }
          effects: { military: 5, silver: -100 }
        }
      })
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

test.describe('两步交互决策（T3.1）', () => {
  test.beforeEach(async ({ page }) => {
    // 注入存档 + 标记引导已完成（跳过引导直接进入游戏）
    // 注意：uni-app H5 的 setStorageSync 写对象时会包装为 {type:'object', data: obj}
    await page.addInitScript((saveObj) => {
      try {
        localStorage.clear()
        localStorage.setItem('game_save', JSON.stringify({ type: 'object', data: saveObj }))
        localStorage.setItem('onboarding_done', 'true')
      } catch {
        /* ignore */
      }
    }, buildMockSave())
    await mockAllApi(page)
  })

  test('1. 初始状态：所有选项未选中，确认决策按钮 disabled', async ({ page }) => {
    await page.goto(GAME_MAIN_URL)

    // 等待事件卡片渲染
    await expect(page.locator('.event-card')).toBeVisible({ timeout: 30_000 })

    // 所有 DecisionButton 均无选中态
    const buttons = page.locator('.decision-button')
    await expect(buttons).toHaveCount(3)
    for (let i = 0; i < 3; i++) {
      await expect(buttons.nth(i)).not.toHaveClass(/decision-button--selected/)
    }

    // 确认决策按钮 disabled
    await expect(page.locator('.game-main__footer-btn--confirm')).toHaveClass(
      /game-main__footer-btn--disabled/
    )
  })

  test('2. 点击选项进入选中态（border + bg + 勾选标记）', async ({ page }) => {
    await page.goto(GAME_MAIN_URL)
    await expect(page.locator('.event-card')).toBeVisible({ timeout: 30_000 })

    // 点第一个选项
    const firstBtn = page.locator('.decision-button').first()
    await firstBtn.click()

    // 验证选中态 class
    await expect(firstBtn).toHaveClass(/decision-button--selected/)

    // 验证勾选标记可见
    await expect(firstBtn.locator('.decision-button__check')).toBeVisible()

    // 确认决策按钮变为可点击（无 disabled class）
    await expect(page.locator('.game-main__footer-btn--confirm')).not.toHaveClass(
      /game-main__footer-btn--disabled/
    )
  })

  test('3. 反悔重选：点已选中项取消选中', async ({ page }) => {
    await page.goto(GAME_MAIN_URL)
    await expect(page.locator('.event-card')).toBeVisible({ timeout: 30_000 })

    const firstBtn = page.locator('.decision-button').first()

    // 选中
    await firstBtn.click()
    await expect(firstBtn).toHaveClass(/decision-button--selected/)

    // 再次点击：取消选中
    await firstBtn.click()
    await expect(firstBtn).not.toHaveClass(/decision-button--selected/)

    // 确认决策按钮重新 disabled
    await expect(page.locator('.game-main__footer-btn--confirm')).toHaveClass(
      /game-main__footer-btn--disabled/
    )
  })

  test('4. 切换选中：点其他选项切换选中态', async ({ page }) => {
    await page.goto(GAME_MAIN_URL)
    await expect(page.locator('.event-card')).toBeVisible({ timeout: 30_000 })

    const firstBtn = page.locator('.decision-button').nth(0)
    const secondBtn = page.locator('.decision-button').nth(1)

    // 选中第一个
    await firstBtn.click()
    await expect(firstBtn).toHaveClass(/decision-button--selected/)
    await expect(secondBtn).not.toHaveClass(/decision-button--selected/)

    // 点第二个：切换选中
    await secondBtn.click()
    await expect(firstBtn).not.toHaveClass(/decision-button--selected/)
    await expect(secondBtn).toHaveClass(/decision-button--selected/)

    // 确认决策按钮仍可点击
    await expect(page.locator('.game-main__footer-btn--confirm')).not.toHaveClass(
      /game-main__footer-btn--disabled/
    )
  })

  test('5. 确认决策后进入"已决策"态，显示"下一回合"按钮', async ({ page }) => {
    await page.goto(GAME_MAIN_URL)
    await expect(page.locator('.event-card')).toBeVisible({ timeout: 30_000 })

    // 选中第一个选项
    await page.locator('.decision-button').first().click()

    // 点确认决策
    await page.locator('.game-main__footer-btn--confirm').click()

    // 等待"下一回合"按钮出现（决策应用 + 状态切换）
    await expect(page.locator('.game-main__footer-btn-text').filter({ hasText: '下一回合' })).toBeVisible({
      timeout: 15_000
    })
  })
})
