import { test, expect } from '@playwright/test'

/**
 * 帮助页（如何游戏）E2E 测试
 *
 * 覆盖 tasks.md T4.1：
 *   - 首页 → 点"如何游戏" → 跳转帮助页 → 渲染验证（核心章节）
 *   - 帮助页各 section 完整渲染（5 类身份 / 5 维属性 / 4 资源 / 势力关系 / 事件类型 / NPC 行动 / 胜负 / 玩法技巧 / FAQ）
 *   - 返回按钮回到首页
 *
 * 路由：uni-app H5 hash 路由，首页 /#/，帮助页 /#/pages/help/index
 */

const HOME_URL = '/#/'
const HELP_URL = '/#/pages/help/index'

test.describe('帮助页（如何游戏）', () => {
  test.beforeEach(async ({ page }) => {
    // 清空存档，避免"继续游戏"按钮拦截导航
    await page.addInitScript(() => {
      try {
        localStorage.clear()
      } catch {
        /* ignore */
      }
    })
  })

  test('1. 首页"如何游戏"按钮跳转帮助页', async ({ page }) => {
    await page.goto(HOME_URL)

    // 点"如何游戏"按钮（home__btn--ghost）
    await page.locator('.home__btn--ghost').click()

    // URL 切换到帮助页
    await expect(page).toHaveURL(/help/, { timeout: 15_000 })

    // 帮助页标题可见
    await expect(page.locator('.help__title')).toContainText('如何游戏')
  })

  test('2. 帮助页直接访问渲染所有核心 section', async ({ page }) => {
    await page.goto(HELP_URL)

    // 等待帮助页渲染（首次编译较慢）
    await expect(page.locator('.help__title')).toBeVisible({ timeout: 30_000 })

    // 9 大 section 标题（与 help/index.vue BACKGROUNDS_HELP/ATTRIBUTES_HELP/... 对齐）
    const sectionTitles = [
      '游戏背景',
      '五类身份',
      '五维属性',
      '四项资源',
      '势力关系',
      '事件类型',
      '天下动静（NPC 行动）',
      '胜利与失败',
      '玩法技巧',
      '常见问题'
    ]

    for (const title of sectionTitles) {
      await expect(
        page.locator('.help__section-title').filter({ hasText: title })
      ).toBeVisible()
    }
  })

  test('3. 五类身份 section 渲染 5 张卡片（与 character-create 一致）', async ({ page }) => {
    await page.goto(HELP_URL)
    await expect(page.locator('.help__title')).toBeVisible({ timeout: 30_000 })

    // 5 种身份名称
    const backgrounds = ['文官', '武将', '商贾', '士绅', '宗室']
    for (const bg of backgrounds) {
      await expect(
        page.locator('.help__section').filter({ hasText: '五类身份' }).locator('.help__item-name').filter({ hasText: bg })
      ).toBeVisible()
    }
  })

  test('4. 五维属性 + 四项资源 section 含 InfoHint 提示组件', async ({ page }) => {
    await page.goto(HELP_URL)
    await expect(page.locator('.help__title')).toBeVisible({ timeout: 30_000 })

    // 5 维属性 + 4 资源 = 9 个 InfoHint（.info-hint）
    // InfoHint 组件类名为 .info-hint
    const infoHintCount = await page.locator('.info-hint').count()
    expect(infoHintCount).toBeGreaterThanOrEqual(9)
  })

  test('5. 玩法技巧 section 渲染 5 条技巧', async ({ page }) => {
    await page.goto(HELP_URL)
    await expect(page.locator('.help__title')).toBeVisible({ timeout: 30_000 })

    // 5 条技巧（.help__tip）
    await expect(page.locator('.help__tip')).toHaveCount(5)
  })

  test('6. FAQ section 渲染 7 条问答', async ({ page }) => {
    await page.goto(HELP_URL)
    await expect(page.locator('.help__title')).toBeVisible({ timeout: 30_000 })

    // 7 条 FAQ（.help__faq）
    await expect(page.locator('.help__faq')).toHaveCount(7)

    // 每条 FAQ 含 Q: 和 A: 标记
    await expect(page.locator('.help__faq-q').first()).toContainText(/Q：/)
    await expect(page.locator('.help__faq-a').first()).toContainText(/A：/)
  })

  test('7. 返回按钮回到首页', async ({ page }) => {
    // 先从首页进入帮助页，建立导航历史（uni.navigateBack 依赖历史栈）
    await page.goto(HOME_URL)
    await page.locator('.home__btn--ghost').click()
    await expect(page).toHaveURL(/help/, { timeout: 15_000 })
    await expect(page.locator('.help__title')).toBeVisible({ timeout: 30_000 })

    // 点返回按钮
    await page.locator('.help__back').click()

    // URL 回到首页
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
  })

  test('8. InfoHint 问号图标点击可打开并关闭浮层', async ({ page }) => {
    await page.goto(HELP_URL)
    await expect(page.locator('.help__title')).toBeVisible({ timeout: 30_000 })

    const firstIcon = page.locator('.info-hint__icon').first()
    await expect(firstIcon).toBeVisible()

    // 点击图标打开浮层
    await firstIcon.click()
    const overlay = page.locator('.info-hint__overlay').first()
    await expect(overlay).toBeVisible()

    // 点击关闭按钮关闭浮层
    await page.locator('.info-hint__close').first().click()
    await expect(overlay).toBeHidden()

    // 等待 500ms 后再次打开，验证没有进入「关不掉」死循环
    await page.waitForTimeout(500)
    await firstIcon.click()
    await expect(overlay).toBeVisible()

    // 点击遮罩关闭浮层
    await overlay.click({ position: { x: 10, y: 10 } })
    await expect(overlay).toBeHidden()
  })

  test('9. InfoHint 浮层关闭后不会自动重新打开', async ({ page }) => {
    await page.goto(HELP_URL)
    await expect(page.locator('.help__title')).toBeVisible({ timeout: 30_000 })

    const firstIcon = page.locator('.info-hint__icon').first()
    await firstIcon.click()
    const overlay = page.locator('.info-hint__overlay').first()
    await expect(overlay).toBeVisible()

    // 关闭浮层
    await page.locator('.info-hint__close').first().click()
    await expect(overlay).toBeHidden()

    // 关键断言：等待 1s，确认没有 ghost click 重新打开浮层
    await page.waitForTimeout(1000)
    await expect(overlay).toBeHidden()
  })
})
