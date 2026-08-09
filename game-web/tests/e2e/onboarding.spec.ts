import { test, expect, type Page } from '@playwright/test'

/**
 * 新手引导 OnboardingOverlay E2E 测试
 *
 * 覆盖 tasks.md T4.1：
 *   - 首次进入引导 6 步完整流程（逐步点击"下一步"，验证步骤切换与最后"开始游戏"按钮）
 *   - 跳过流程（任意步点"跳过"立即关闭引导）
 *
 * Mock 策略：
 *   - 不真实启动后端，page.route 拦截 generate-event / advisor-briefing / npc-actions / sync-save
 *   - localStorage 注入合法存档 + 清空 onboarding_done 标志触发引导
 *
 * 路由：uni-app H5 hash 路由，game-main 在 /#/pages/game-main/index
 */

const GAME_MAIN_URL = '/#/pages/game-main/index'

/** 构造合法 GameSave（用于注入 localStorage 触发 game-main 渲染） */
function buildMockSave(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    saveVersion: 1,
    saveId: 'e2e-onboarding-' + Math.random().toString(36).slice(2),
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
    ended: false,
    ...overrides
  }
}

/** 拦截 game-main 启动时的所有 API 请求，避免真实后端依赖 */
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
              { id: 'o2', label: '观望', effects: { politics: -5 } }
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
  await page.route('**/api/game/sync-save**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { saveId: 'e2e', updatedAt: Date.now() } })
    })
  )
}

test.describe('新手引导 OnboardingOverlay', () => {
  test.beforeEach(async ({ page }) => {
    // 清空 localStorage 后注入：合法存档 + onboarding_done 未设置（触发引导）
    // 注意：uni-app H5 的 setStorageSync 写对象时会包装为 {type:'object', data: obj}
    // getStorageOrigin 读取时 parseValue 提取 data 字段，缺少包装会导致 load() 返回 null
    await page.addInitScript((saveObj) => {
      try {
        localStorage.clear()
        localStorage.setItem('game_save', JSON.stringify({ type: 'object', data: saveObj }))
        // onboarding_done 不设置，checkAndStart 会启动引导
      } catch {
        /* ignore */
      }
    }, buildMockSave())
    await mockAllApi(page)
  })

  test('1. 首次进入显示引导覆盖层（步骤 1/6）', async ({ page }) => {
    await page.goto(GAME_MAIN_URL)

    // 等待引导覆盖层出现
    await expect(page.locator('.onboarding-overlay')).toBeVisible({ timeout: 30_000 })

    // 步骤指示器显示 1/6
    await expect(page.locator('.onboarding-overlay__indicator-text')).toContainText('1/6')

    // 第一步标题：欢迎
    await expect(page.locator('.onboarding-overlay__title')).toContainText('欢迎来到金田：1851')

    // 按钮文案：跳过 + 下一步（非最后一步）
    await expect(page.locator('.onboarding-overlay__btn--skip')).toContainText('跳过')
    await expect(page.locator('.onboarding-overlay__btn--next')).toContainText('下一步')
  })

  test('2. 6 步完整流程：逐步点击下一步，最后一步显示"开始游戏"', async ({ page }) => {
    await page.goto(GAME_MAIN_URL)
    await expect(page.locator('.onboarding-overlay')).toBeVisible({ timeout: 30_000 })

    // 6 步标题（与 game-main ONBOARDING_STEPS 一致）
    const titles = [
      '欢迎来到金田：1851',
      '状态面板',
      '当前焦点',
      '事件卡片',
      '军师对话',
      '游戏目标'
    ]

    for (let i = 0; i < titles.length; i++) {
      // 等待标题渲染（步骤切换有 transition）
      await expect(page.locator('.onboarding-overlay__title')).toContainText(titles[i], {
        timeout: 10_000
      })
      await expect(page.locator('.onboarding-overlay__indicator-text')).toContainText(
        `${i + 1}/6`
      )

      if (i < titles.length - 1) {
        // 非最后一步：按钮文案为"下一步"
        await expect(page.locator('.onboarding-overlay__btn--next')).toContainText('下一步')
        await page.locator('.onboarding-overlay__btn--next').click()
      } else {
        // 最后一步：按钮文案变为"开始游戏"
        await expect(page.locator('.onboarding-overlay__btn--next')).toContainText('开始游戏')
      }
    }

    // 点击"开始游戏"完成引导，覆盖层消失
    await page.locator('.onboarding-overlay__btn--next').click()
    await expect(page.locator('.onboarding-overlay')).not.toBeVisible({ timeout: 10_000 })

    // 验证 onboarding_done 已写入 localStorage
    const done = await page.evaluate(() => localStorage.getItem('onboarding_done'))
    expect(done).toBe('true')
  })

  test('3. 跳过流程：任意步点"跳过"立即关闭引导并标记完成', async ({ page }) => {
    await page.goto(GAME_MAIN_URL)
    await expect(page.locator('.onboarding-overlay')).toBeVisible({ timeout: 30_000 })

    // 进入第 2 步
    await page.locator('.onboarding-overlay__btn--next').click()
    await expect(page.locator('.onboarding-overlay__indicator-text')).toContainText('2/6')

    // 点跳过
    await page.locator('.onboarding-overlay__btn--skip').click()

    // 覆盖层消失
    await expect(page.locator('.onboarding-overlay')).not.toBeVisible({ timeout: 10_000 })

    // 跳过也算完成，onboarding_done 写入
    const done = await page.evaluate(() => localStorage.getItem('onboarding_done'))
    expect(done).toBe('true')
  })

  test('4. 已完成引导后再次进入不再显示', async ({ page }) => {
    // 注入 onboarding_done=true，模拟已完成引导
    await page.addInitScript(() => {
      try {
        localStorage.setItem('onboarding_done', 'true')
      } catch {
        /* ignore */
      }
    })
    await page.goto(GAME_MAIN_URL)

    // 引导不应出现
    await expect(page.locator('.onboarding-overlay')).not.toBeVisible({ timeout: 10_000 })
  })
})
