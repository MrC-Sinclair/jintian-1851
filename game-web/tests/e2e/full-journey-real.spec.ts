/**
 * 真实后端联调整流程闭环测试（不 mock 任何 /api 请求）。
 *
 * 前置条件：
 *  - 后端 dev server 运行在 http://localhost:3000（真实调用 SiliconFlow LLM）
 *  - 前端 dev:h5 通过 Vite proxy 把 /api 转发到 localhost:3000（见 vite.config.ts）
 *  - 启动方式：PLAYWRIGHT_E2E=1 pnpm test:e2e（playwright.config 会以 5180 启动前端）
 *
 * 覆盖业务闭环：
 *  1. character-create 开局（真实调用 init-factions / create-save）
 *  2. 多回合 generate-event → 选择决策 → 确认 → 下一回合（endTurn：NPC行动 + 势力演化 + 回合推进）
 *  3. advisor-briefing 军师简报真实渲染（FocusPanel suggestion）
 *  4. 通过「自由行动」让 LLM 把属性压低以加速触发崩溃结局（避免真实走满 36 回合）
 *  5. 到达 end-game 结局页（闭环完成）
 *
 * 注意：真实 LLM 输出不确定，断言全部为宽松断言（元素存在 / 文本非空），
 * 不校验具体文案；后端 generate-event/npc-actions 均有降级兜底，链路稳定。
 */
import { test, expect, type Page } from '@playwright/test'

const BASE = '/'

async function startNewGame(page: Page) {
  await page.goto(BASE)
  await page.waitForSelector('.home', { timeout: 20000 })

  // 若直接进入 game-main（已有存档且首页已跳转）则无需开局，但仍需跳过引导
  if ((await page.locator('.game-main').count()) > 0) {
    await skipOnboarding(page)
    return
  }

  // 首页点「开始游戏」
  await mouseClick(page, '.home__btn--primary')
  // 若已有存档会弹确认框（ConfirmDialog），点「覆盖并开始」
  await page.waitForTimeout(800)
  const overwrite = page.locator('.confirm-dialog__btn--confirm')
  if ((await overwrite.count()) > 0) {
    await mouseClick(page, '.confirm-dialog__btn--confirm')
  }
  // character-create 三步流程
  await page.waitForSelector('.cc', { timeout: 20000 })
  await mouseClick(page, '.cc__bg-card')
  await mouseClick(page, '.cc__btn--primary')
  // 等待 init-factions 真实返回势力列表（真实 LLM，偶发较慢）
  await page.waitForSelector('.cc__factions .faction-card, .faction-card', { timeout: 90000 })
  // 点击第一个势力卡片触发确认对话框
  await mouseClick(page, '.faction-card')
  // 确认势力弹窗（ConfirmDialog）：点确认按钮
  await page.waitForSelector('.confirm-dialog__btn--confirm', { timeout: 10000 })
  await mouseClick(page, '.confirm-dialog__btn--confirm')
  await page.waitForSelector('.game-main', { timeout: 60000 })

  // 新手引导遮罩（OnboardingOverlay）会延迟首回合 startTurn，需先「跳过」
  await skipOnboarding(page)
}

// 跳过新手引导遮罩，否则首回合事件（startTurn）被延迟、事件卡不渲染
async function skipOnboarding(page: Page) {
  const skipBtn = page.locator('.onboarding-overlay__btn, .onboarding-overlay__btn-text')
  if ((await skipBtn.count()) > 0) {
    await mouseClick(page, '.onboarding-overlay__btn, .onboarding-overlay__btn-text')
    await page.waitForTimeout(500)
  }
}

// uni-app H5 下 Playwright 的 page.click() 偶发不触发 view 的 @click（tap → click 委托问题）。
// 改为真实鼠标坐标点击（与 MCP playwright_click 等价），可靠触发 uni 的 @click 监听。
async function mouseClick(page: Page, selector: string) {
  // 用 Playwright 原生 locator.click：自带 hit-test 与滚动，命中可交互元素（等价 MCP playwright_click）
  await page.locator(selector).first().click({ timeout: 15000 })
}

async function advanceTurn(page: Page) {
  // 先等本回合 startTurn 处理完成（事件生成 + 军师简报）。
  // 处理期间 isProcessingTurn=true，决策按钮处于 disabled 态、且 .game-main__loading 存在。
  // 必须等其结束，否则下方选按钮会因 disabled 一直超时。
  // 注意：waitForFunction 第 2 参数是 arg，选项必须作为第 3 参数传入，否则会用默认 10s 超时。
  await page.waitForFunction(
    () => !document.querySelector('.game-main__loading'),
    undefined,
    { timeout: 60000 }
  )
  // 选第一个「可见」决策选项（点击触发 select）。
  // 页面上可能存在多个 .decision-button（如军师抽屉内），必须点事件卡内可见的那个。
  await page.waitForFunction(
    () => {
      const els = Array.from(document.querySelectorAll('.decision-button'))
      return els.some(
        (e) => e.getClientRects().length > 0 && e.offsetParent !== null && !e.className.includes('decision-button--disabled')
      )
    },
    undefined,
    { timeout: 40000 }
  )
  // 点击可见的第一个决策按钮（命中可见元素，避开隐藏的军师抽屉内按钮）
  await page.locator('.decision-button').filter({ visible: true }).first().click({ timeout: 15000 })
  // 轮询任一可见决策按钮出现 --selected 选中态
  await page.waitForFunction(
    () => {
      const els = Array.from(document.querySelectorAll('.decision-button'))
      return els.some((e) => e.className.includes('decision-button--selected'))
    },
    undefined,
    { timeout: 15000 }
  )

  // 点「确认决策」按钮（原生 click），触发 makeDecision → hasDecided=true
  await mouseClick(page, '.game-main__footer-btn--confirm')

  // 等待「下一回合」按钮出现（hasDecided 后 v-if 切换）
  await page.waitForSelector('.game-main__footer-btn--next', { timeout: 60000 })
  // 点「确认决策」后 hasDecided=true；但 endTurn 真实写库期间 isProcessingTurn 短暂为 true，
  // 按钮可能短暂 disabled，轮询等其非 disabled 再点击推进
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.game-main__footer-btn--next')
      return el && !el.className.includes('game-main__footer-btn--disabled')
    },
    undefined,
    { timeout: 60000 }
  )
  await mouseClick(page, '.game-main__footer-btn--next')
  // 等待 endTurn（NPC行动 + 势力演化 + 回合推进）完成后新事件或结局
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(2000)
}

async function isEnded(page: Page): Promise<boolean> {
  return (await page.locator('.end-game').count()) > 0
}

test.describe('全流程闭环（真实后端联调）', () => {
  test.setTimeout(400_000) // E2E 模式后端 npc-actions 已加速（~8s），整轮 ~16s；含开局 init-factions 留足余量
  test('从开局走到结局页', async ({ page }) => {
    await startNewGame(page)

    // 主页核心面板真实渲染
    await expect(page.locator('.focus-panel')).toBeVisible()
    await expect(page.locator('.goal-panel')).toBeVisible()
    await expect(page.locator('.game-main__turn')).toBeVisible()

    // 验证首回合事件卡 + 军师简报（真实 LLM，可能耗时较长）
    await page.waitForSelector('.game-main__section--event', { timeout: 120000 })
    await expect(page.locator('.game-main__section--event')).toBeVisible()

    // 正常推进 2 回合，验证真实 generate-event / npc-actions / endTurn 链路
    for (let i = 0; i < 2; i++) {
      if (await isEnded(page)) break
      await advanceTurn(page)
    }

    // 若未自然结局，用「自由行动」让 LLM 压低属性，加速触发崩溃结局（避免跑满 36 回合）
    let reachedEnd = await isEnded(page)
    for (let i = 0; i < 8 && !reachedEnd; i++) {
      // 进入循环先判终：正常回合或自由行动期间可能已自然/触发结局并跳转 end-game
      if (await isEnded(page)) { reachedEnd = true; break }
      // 等本回合处理完成（自由行动按钮在处理中点击会被 onShowFreeInput 忽略）
      await page.waitForFunction(
        () => !document.querySelector('.game-main__loading'),
        undefined,
        { timeout: 60000 }
      )
      // 处理完成后再次判终：结局判定在 endTurn 内，可能已在等待期间跳转 end-game
      if (await isEnded(page)) { reachedEnd = true; break }
      // 已结局则 end-game 页无自由行动按钮，直接跳出
      if ((await page.locator('.game-main__footer-btn--free').count()) === 0) {
        reachedEnd = await isEnded(page)
        break
      }
      // 打开自由行动（原生 click）
      await mouseClick(page, '.game-main__footer-btn--free')
      await page.waitForSelector('.game-main__free-input-area', { timeout: 15000 })
      // uni-textarea 是自定义组件，.fill() 不支持，需聚焦后用键盘输入
      const freeArea = page.locator('.game-main__free-input-area').first()
      await freeArea.click()
      await page.keyboard.type('撤掉所有军队，解散兵马，国库空虚，民心尽失，断绝外交')
      await mouseClick(page, '.game-main__btn--primary')
      // 自由输入即本回合「已决策」，提交后点「下一回合」推进（endTurn 会做结局判定）
      await page.waitForSelector('.game-main__footer-btn--next', { timeout: 60000 })
      await page.waitForFunction(
        () => {
          const el = document.querySelector('.game-main__footer-btn--next')
          return el && !el.className.includes('game-main__footer-btn--disabled')
        },
        undefined,
        { timeout: 60000 }
      )
      await mouseClick(page, '.game-main__footer-btn--next')
      await page.waitForTimeout(3000)
      reachedEnd = await isEnded(page)
    }

    // 期望到达结局页（崩溃 / 胜利 / 时光尽头 任一）；宽松断言，只校验元素存在与标题非空
    await expect(page.locator('.end-game')).toBeVisible({ timeout: 60000 })
    const title = (await page.locator('.end-game__title').innerText()).trim()
    expect(title.length).toBeGreaterThan(0)
  })
})
