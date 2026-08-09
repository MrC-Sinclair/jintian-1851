import { test, expect, type Page } from '@playwright/test'

/**
 * character-create 开局流程 E2E 测试
 *
 * 覆盖完整开局流程：选身份 → loading → 选势力 → 确认 → 跳转 game-main
 *
 * Mock 策略：
 *   - 用 page.route() 拦截 /api/game/init-factions，不真实启动后端
 *   - initSave 走本地存储（uni.setStorage → localStorage），无需 mock
 *
 * 路由说明：
 *   uni-app H5 默认 hash 路由，URL 形如 http://localhost:5180/#/pages/character-create/index
 */

const CHARACTER_CREATE_URL = '/#/pages/character-create/index'

/** 5 种身份名称（与 character-create/index.vue BACKGROUNDS 一致） */
const BACKGROUNDS = ['文官', '武将', '商贾', '士绅', '宗室']

/** mock init-factions 成功响应的 6 个势力 */
const MOCK_FACTIONS = [
  {
    id: 'f1',
    name: '太平天国',
    summary: '洪秀全领导的农民起义政权',
    initialPower: 80,
    initialRelationship: -20
  },
  {
    id: 'f2',
    name: '湘军',
    summary: '曾国藩创立的地方团练武装',
    initialPower: 75,
    initialRelationship: 10
  },
  {
    id: 'f3',
    name: '淮军',
    summary: '李鸿章统率的近代化军队',
    initialPower: 70,
    initialRelationship: 0
  },
  {
    id: 'f4',
    name: '清廷',
    summary: '摇摇欲坠的大清帝国中央',
    initialPower: 90,
    initialRelationship: -50
  },
  {
    id: 'f5',
    name: '洋人',
    summary: '西方列强的坚船利炮',
    initialPower: 85,
    initialRelationship: 20
  },
  {
    id: 'f6',
    name: '捻军',
    summary: '活跃于北方的流民武装',
    initialPower: 60,
    initialRelationship: -10
  }
]

/**
 * 拦截 init-factions 请求，返回成功响应
 * @param delayMs 模拟网络/AI 推演延迟
 */
async function mockInitFactionsSuccess(page: Page, delayMs = 0): Promise<void> {
  await page.route('**/api/game/init-factions', async (route) => {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: { factions: MOCK_FACTIONS }
      })
    })
  })
}

/**
 * 拦截 init-factions 请求，返回错误响应
 */
async function mockInitFactionsError(
  page: Page,
  message = '势力推演失败'
): Promise<void> {
  await page.route('**/api/game/init-factions', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message }
      })
    })
  })
}

test.describe('character-create 开局流程', () => {
  test.beforeEach(async ({ page }) => {
    // 清除本地存档，避免上次测试的存档干扰
    await page.addInitScript(() => {
      try {
        localStorage.clear()
      } catch {
        /* ignore */
      }
    })
  })

  test('1. 页面加载显示 5 张身份卡片', async ({ page }) => {
    await page.goto(CHARACTER_CREATE_URL)

    // 验证 5 张身份卡片
    await expect(page.locator('.cc__bg-card')).toHaveCount(5)

    // 验证 5 种身份名称均可见
    for (const bg of BACKGROUNDS) {
      await expect(
        page.locator('.cc__bg-card').filter({ hasText: bg })
      ).toBeVisible()
    }

    // 验证步骤指示器当前在第 1 步（身份）
    await expect(page.locator('.cc__step').first()).toHaveClass(
      /cc__step--current/
    )
  })

  test('2. 点击身份卡片高亮并进入势力选择', async ({ page }) => {
    await mockInitFactionsSuccess(page)
    await page.goto(CHARACTER_CREATE_URL)

    // 点击「文官」卡片
    const wenCard = page.locator('.cc__bg-card').filter({ hasText: '文官' })
    await wenCard.click()

    // 验证选中态高亮
    await expect(wenCard).toHaveClass(/cc__bg-card--selected/)

    // 点击「下一步」按钮
    await page.locator('.cc__btn--primary').click()

    // 验证进入步骤 2（loading 或势力卡片出现）
    await expect(
      page.locator('.cc__loading, .faction-card').first()
    ).toBeVisible()

    // 步骤指示器当前在第 2 步（势力）
    await expect(page.locator('.cc__step').nth(1)).toHaveClass(
      /cc__step--current/
    )
  })

  test('3. 势力选择页显示 loading 后加载 6 个势力卡片', async ({ page }) => {
    // mock 延迟 500ms，验证 loading 态
    await mockInitFactionsSuccess(page, 500)
    await page.goto(CHARACTER_CREATE_URL)

    // 选身份 + 下一步
    await page.locator('.cc__bg-card').filter({ hasText: '文官' }).click()
    await page.locator('.cc__btn--primary').click()

    // 验证 loading 出现
    // T4.1：文案白话化更新（copywriting.ts characterCreate.factionLoading）
    await expect(page.locator('.cc__loading')).toBeVisible()
    await expect(page.locator('.cc__loading-text')).toContainText('正在生成可选势力')
    await expect(page.locator('.cc__loading-hint')).toContainText('AI 正在基于你的身份生成势力')

    // 等待 loading 消失，6 个势力卡片出现
    await expect(page.locator('.faction-card')).toHaveCount(6)
    await expect(page.locator('.cc__loading')).not.toBeVisible()
  })

  test('4. 点击势力卡片弹确认对话框，确认后跳转 game-main', async ({ page }) => {
    await mockInitFactionsSuccess(page)
    await page.goto(CHARACTER_CREATE_URL)

    // 选身份 + 下一步
    await page.locator('.cc__bg-card').filter({ hasText: '文官' }).click()
    await page.locator('.cc__btn--primary').click()

    // 等待势力卡片加载完成
    await expect(page.locator('.faction-card')).toHaveCount(6)

    // 点击第一个势力卡片
    await page.locator('.faction-card').first().click()

    // 验证确认对话框出现
    await expect(page.locator('.confirm-dialog')).toBeVisible()
    await expect(page.locator('.confirm-dialog__title')).toContainText(
      '确认势力'
    )

    // 点击确认按钮
    await page.locator('.confirm-dialog__btn--confirm').click()

    // 验证跳转到 game-main 页面（uni.redirectTo 改变 hash）
    await expect(page).toHaveURL(/game-main/, { timeout: 15_000 })
  })

  test('5. init-factions 返回错误时显示降级提示和重试按钮', async ({ page }) => {
    await mockInitFactionsError(page, '势力推演失败')
    await page.goto(CHARACTER_CREATE_URL)

    // 选身份 + 下一步
    await page.locator('.cc__bg-card').filter({ hasText: '文官' }).click()
    await page.locator('.cc__btn--primary').click()

    // 验证错误提示出现
    await expect(page.locator('.cc__error')).toBeVisible()
    await expect(page.locator('.cc__error-text')).toContainText('势力推演失败')

    // 验证重试按钮存在
    await expect(page.locator('.cc__error .cc__btn')).toBeVisible()
    await expect(page.locator('.cc__error .cc__btn-text')).toContainText('重试')
  })

  /**
   * 回归测试（防"遮罩穿透触发确认势力框"bug）
   *
   * 历史 bug：点 InfoHint 问号打开浮层后，点击浮层遮罩（modal 外）会冒泡触发
   * FactionCard 的 select 事件，错误弹出"确认势力"弹窗。
   *
   * 修复：InfoHint overlay 的 onOverlayClick 显式 e.stopPropagation() + close()。
   */
  test('6. InfoHint 浮层打开时点击遮罩只关闭浮层，不弹确认对话框（防穿透回归）', async ({
    page
  }) => {
    await mockInitFactionsSuccess(page)
    await page.goto(CHARACTER_CREATE_URL)

    // 选身份 + 下一步
    await page.locator('.cc__bg-card').filter({ hasText: '文官' }).click()
    await page.locator('.cc__btn--primary').click()

    // 等待势力卡片加载
    await expect(page.locator('.faction-card')).toHaveCount(6)

    // 1. 点击第一张势力卡片的问号打开浮层
    const firstFaction = page.locator('.faction-card').first()
    await firstFaction.locator('.info-hint__icon').click()
    await expect(page.locator('.info-hint__overlay')).toBeVisible()

    // 2. 点击浮层遮罩（modal 外）
    // 选一个不在 modal 内的坐标（视口上方，避免命中 modal）
    const overlay = page.locator('.info-hint__overlay')
    const box = await overlay.boundingBox()
    expect(box).not.toBeNull()
    // 点击 overlay 顶部区域（避开 modal 居中位置）
    await page.mouse.click(box!.x + box!.width / 2, box!.y + 20)

    // 3. 浮层已关闭
    await expect(page.locator('.info-hint__overlay')).toHaveCount(0)

    // 4. 关键断言：「确认势力」对话框**未**弹出（冒泡已被拦截）
    await expect(page.locator('.confirm-dialog')).toHaveCount(0)
  })
})
