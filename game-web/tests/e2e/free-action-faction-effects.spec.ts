import { test, expect, type Page } from '@playwright/test'

/**
 * 自由行动打通势力关系与实力 — 浏览器端到端冒烟测试
 *
 * 覆盖流程：首页 → 开局（身份+势力）→ 进入 game-main → 打开自由行动输入
 *   → 填入指向「关系最友好势力」的决策 → 提交 → 断言「势力动向」反馈区出现且含关系变化。
 *
 * 依赖真实 SiliconFlow LLM（server/.env 已配置），resolve-decision 会返回 factionEffects。
 *
 * 交互范式参考 full-journey-real.spec.ts：
 *   - uni-app H5 下 Playwright 用 locator.click() 可稳定触发 view 的 @click；
 *   - 点自由按钮前必须等 .game-main__loading 消失（isProcessingTurn=false，否则 onShowFreeInput 被守卫忽略）；
 *   - uni-textarea 是自定义组件，.fill() 不支持，需 click 后 keyboard.type()。
 */

// uni-app H5 下 Playwright 的 locator.click() 可稳定触发 view 的 @click 监听
async function mouseClick(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().click({ timeout: 15000 })
}

/** 关闭可能出现的新手引导遮罩（不阻塞则忽略）。引导层会延迟首回合 startTurn，必须先关 */
async function dismissOnboarding(page: Page): Promise<void> {
  const skip = page.locator('.onboarding-overlay__btn--skip')
  try {
    await skip.first().waitFor({ state: 'visible', timeout: 15000 })
    await skip.first().click({ timeout: 5000 })
  } catch {
    /* 本回合无引导层则忽略 */
  }
}

test('自由行动影响势力关系与实力（浏览器端到端）', async ({ page }) => {
  // 真实 LLM 多次调用（init-factions / generate-event / resolve-decision）整体耗时较长，放宽测试超时
  test.setTimeout(240_000)

  // 1. 首页 → 开始游戏
  await page.goto('/')
  await mouseClick(page, '.home__btn--primary')

  // 2. 步骤 1：选身份「武将」→ 下一步
  await mouseClick(page, '.cc__bg-card')
  await mouseClick(page, '.cc__btn--primary')

  // 3. 步骤 2：等待势力推演完成，点击第一个势力卡
  await expect(page.getByText('天下群雄', { exact: true })).toBeVisible({ timeout: 60000 })
  await page.waitForSelector('.faction-card', { timeout: 60000 })
  await mouseClick(page, '.faction-card')

  // 4. 确认势力弹窗 → 确定
  const confirm = page.locator('.confirm-dialog__btn--confirm')
  await expect(confirm).toBeVisible({ timeout: 30000 })
  await mouseClick(page, '.confirm-dialog__btn--confirm')

  // 5. 进入 game-main：先等页面挂载，再关闭新手引导层（否则 startTurn 延迟、事件卡不渲染）
  await page.waitForSelector('.game-main', { timeout: 60000 })
  await dismissOnboarding(page)
  await page.waitForSelector('.game-main__section--event', { timeout: 120000 })
  await expect(page.locator('.game-main__section--event')).toBeVisible({ timeout: 120000 })

  // 6. 等本回合处理完成（自由行动按钮在处理中点击会被 onShowFreeInput 忽略）
  await page.waitForFunction(
    () => !document.querySelector('.game-main__loading'),
    undefined,
    { timeout: 60000 }
  )

  // 7. 打开自由行动输入（无需读具体势力名：自由行动 prompt 已注入 factions 关系值，
  //    LLM 能根据「关系最友好的势力」自行解析目标并返回 factionEffects）
  await mouseClick(page, '.game-main__footer-btn--free')
  await page.waitForSelector('.game-main__free-input-area', { timeout: 15000 })
  const freeArea = page.locator('.game-main__free-input-area').first()
  await freeArea.click()
  await page.keyboard.type('我想暗中资助当前与我关系最友好的那个势力，并输送银两粮草以结善缘')

  // 8. 提交自由行动（原生 click 触发 onSubmitFreeInput → makeDecision）
  await mouseClick(page, '.game-main__btn--primary')

  // 9. 断言决策应用后，「势力动向」反馈区出现并包含关系变化（自由行动对势力的软性微调）
  const feedback = page.locator('.game-main__faction-feedback')
  await expect(feedback).toBeVisible({ timeout: 60000 })
  await expect(page.locator('.game-main__faction-feedback-title')).toHaveText('势力动向')
  // 关系变化文本形如「关系 +15」
  await expect(page.locator('.game-main__faction-feedback-delta').first()).toContainText('关系')
})
