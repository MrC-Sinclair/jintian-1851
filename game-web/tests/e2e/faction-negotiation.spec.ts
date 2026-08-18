import { test, expect, type Page } from '@playwright/test'

/**
 * 与 NPC 势力自然语言谈判 — 浏览器端到端冒烟测试（faction-negotiation 提案）
 *
 * 覆盖流程：首页 → 开局（身份+势力）→ game-main → 打开外交面板 → 写信谈判
 *   → 填信（明确请对方开价）→ 遣使送信 → 对方还价（条件卡片）→ 接受条件
 *   → 断言：成交摘要 + 银两按条件定价扣减 + 谈判配额用尽（谈判剩余 0）。
 *
 * 依赖真实 SiliconFlow LLM（server/.env 已配置），faction-negotiate 在
 * x-e2e-test-mode: 1 下运行（Agent 步数压 1、8s 超时）。
 *
 * 注意：信件明确"请开个价"引导 Agent 走 counter 路径；若 LLM 直接应允/拒绝
 * （无还价），本用例按真实 LLM 行为软跳过成交断言（test.skip 条件跳过）。
 */

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

/** 读取状态面板银两数值（首个资源项，formatNumber 可能带千分位逗号） */
async function readSilver(page: Page): Promise<number> {
  const text = await page
    .locator('.status-panel__resource')
    .first()
    .locator('.status-panel__resource-value')
    .textContent()
  return Number.parseInt((text ?? '0').replace(/[^0-9-]/g, ''), 10)
}

test('写信谈判：还价 → 接受条件 → 资源扣减与配额用尽（浏览器端到端）', async ({ page }) => {
  // 真实 LLM 多次调用（init-factions / generate-event / faction-negotiate×2）整体耗时较长
  test.setTimeout(240_000)

  // 1. 首页 → 开始游戏 → 选身份 → 选势力 → 确认
  await page.goto('/')
  await mouseClick(page, '.home__btn--primary')
  await mouseClick(page, '.cc__bg-card')
  await mouseClick(page, '.cc__btn--primary')
  await expect(page.getByText('天下群雄', { exact: true })).toBeVisible({ timeout: 60000 })
  await page.waitForSelector('.faction-card', { timeout: 60000 })
  await mouseClick(page, '.faction-card')
  const confirm = page.locator('.confirm-dialog__btn--confirm')
  await expect(confirm).toBeVisible({ timeout: 30000 })
  await mouseClick(page, '.confirm-dialog__btn--confirm')

  // 2. 进入 game-main：关引导 → 等事件 → 等回合处理完成
  await page.waitForSelector('.game-main', { timeout: 60000 })
  await dismissOnboarding(page)
  await page.waitForSelector('.game-main__section--event', { timeout: 120000 })
  await page.waitForFunction(
    () => !document.querySelector('.game-main__loading'),
    undefined,
    { timeout: 60000 }
  )

  // 3. 记录谈判前银两
  const silverBefore = await readSilver(page)

  // 4. 打开外交面板 → 第一个势力卡「写信谈判」
  await mouseClick(page, '.game-main__footer-btn--diplomacy')
  await page.waitForSelector('.diplomacy-panel', { timeout: 15000 })
  await mouseClick(page, '.diplomacy-panel__action--letter')

  // 5. 填信（明确请对方开价，引导 counter 路径）
  //    insertText 直接派发 input 事件（CJK 免 IME 干扰，比逐键 type 可靠）
  await page.waitForSelector('.negotiation-dialog', { timeout: 15000 })
  const LETTER = '久闻贵军威名，愿以白银结好。若蒙不弃，还请开个价码，如数奉上，绝无二话。'
  const textarea = page.locator('.negotiation-dialog__textarea')
  await textarea.click()
  await page.keyboard.insertText(LETTER)
  // 校验录入完整（v-model 计数器 = 字数/200），不完整则快速失败而非卡在后续等待
  await expect(page.locator('.negotiation-dialog__count')).toHaveText(`${LETTER.length}/200`, {
    timeout: 10_000
  })

  // 6. 遣使送信（compose 阶段唯一主按钮）
  await mouseClick(page, '.negotiation-dialog__btn--primary')

  // 7. 等回信：要么出现条件卡片（counter），要么直接结束（accept/reject）
  const dealCard = page.locator('.negotiation-dialog__deal-card')
  const endBtn = page.locator('.negotiation-dialog__btn', { hasText: '结束谈判' })
  await Promise.race([
    dealCard.first().waitFor({ state: 'visible', timeout: 90000 }),
    endBtn.first().waitFor({ state: 'visible', timeout: 90000 })
  ])
  test.skip(
    !(await dealCard.first().isVisible()),
    'Agent 未还价（直接应允/拒绝），无成交路径可断言，软跳过'
  )

  // 8. 从条件卡片解析定价（代价：银两 N）
  const dealText = (await dealCard.first().textContent()) ?? ''
  const priceMatch = dealText.match(/银两\s*(\d+)/)
  expect(priceMatch).not.toBeNull()
  const price = Number.parseInt(priceMatch![1], 10)

  // 9. 接受条件 → settle 裁定 → done 阶段出现成交摘要
  await page.locator('.negotiation-dialog__actions .negotiation-dialog__btn', { hasText: '接受条件' }).click()
  await expect(page.locator('.negotiation-dialog__reply-card', { hasText: '谈判成交' })).toBeVisible({
    timeout: 90000
  })

  // 10. 银两按定价精确扣减（StatusPanel 数值有过渡动画，用 poll 等待终值）
  await expect
    .poll(async () => readSilver(page), { timeout: 20000 })
    .toBe(silverBefore - price)

  // 11. 谈判配额用尽：外交面板标题显示「谈判剩余 0」
  await expect(page.locator('.diplomacy-panel__remaining')).toContainText('谈判剩余 0')
})
