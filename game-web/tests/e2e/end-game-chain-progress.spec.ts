/**
 * @file E2E：结局页「历史进程」（剧情链完成度）渲染
 *
 * 覆盖 #4(a)：完成度以派生值出现在结局页，且
 *   - 分母按**终局年份之前可达的链数**算，不是硬编码总数
 *   - 可达链数 < 3 时**不给称号**（1/1=100% 不该被吹成满级）
 *   - 旧存档（无 completedChainIds 字段）不崩、按 0 条处理
 *
 * 手法与 story-chain-flow.spec.ts 一致：localStorage 注入合法 v2 存档 + onboarding_done 跳引导。
 * 结局页只读本地存档，无需 mock 任何 API。
 */
import { expect, test, type Page } from '@playwright/test'

const END_GAME_URL = '/#/pages/end-game/index'

function buildEndedSave(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    saveVersion: 2,
    saveId: 'e2e-chains-' + Math.random().toString(36).slice(2),
    deviceId: 'e2e-device',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    character: {
      background: '武将',
      backgroundPerks: {},
      factionId: 'f4',
      factionName: '淮军',
      factionSummary: ''
    },
    state: {
      turn: 30,
      date: { year: 1912, month: 1 },
      attributes: { military: 88, economy: 86, politics: 90, people: 84, diplomacy: 82 },
      resources: { silver: 500, troops: 800, food: 600, reputation: 70 }
    },
    factions: [],
    events: [],
    advisorMessages: [],
    pendingChainNodes: [],
    completedChainIds: ['tai-ping-tian-guo', 'nian-jun-zhi-luan', 'yang-wu-yun-dong'],
    activeChainIds: ['jia-wu-zhan-zheng'],
    ended: true,
    endedAt: Date.now(),
    endedReason: 'victory',
    ...overrides
  }
}

async function openEndPage(page: Page, save: Record<string, unknown> | null): Promise<void> {
  await page.addInitScript((saveObj) => {
    localStorage.clear()
    if (saveObj) {
      localStorage.setItem('game_save', JSON.stringify({ type: 'object', data: saveObj }))
    }
    localStorage.setItem('onboarding_done', 'true')
  }, save)
  await page.goto(END_GAME_URL)
  await page.waitForLoadState('networkidle')
}

test.describe('结局页 历史进程（剧情链完成度）', () => {
  test('给出「亲历 N/M 段史事」与中文链名', async ({ page }) => {
    await openEndPage(page, buildEndedSave())

    await expect(page.locator('text=历史进程')).toBeVisible()
    // 分母不断言具体数字：链数会变（14→23 就是这次改的），只锁"分子/分母"这个口径
    await expect(page.locator('text=/亲历 \\d+\\/\\d+ 段史事/')).toBeVisible()
    await expect(page.locator('text=太平天国兴亡')).toBeVisible()
    await expect(page.locator('text=洋务运动')).toBeVisible()
    // 进行中的链单独计一句，不和完成数混在一起
    await expect(page.locator('text=另有 1 段未及收束')).toBeVisible()
  })

  test('终局年份决定分母：1865 年之前可达的链少于 1912 年', async ({ page }) => {
    // 同一个 test 里两次 goto 同一个 hash 路由**不会重载页面**（uni-app H5 用 hash 路由），
    // 第二次注入的存档根本读不到。所以每个存档各开一个新 page，init script 是 per-page 的。
    const save = buildEndedSave()
    const baseState = save.state as Record<string, unknown>

    async function denominatorOf(p: Page, year: number): Promise<number> {
      await openEndPage(p, { ...save, state: { ...baseState, date: { year, month: 1 } } })
      const text = await p.locator('.end-game__chains-count').innerText()
      return Number((text.match(/\/(\d+)/) ?? [])[1])
    }

    const earlyDenom = await denominatorOf(page, 1865)
    const latePage = await page.context().newPage()
    const lateDenom = await denominatorOf(latePage, 1912)
    await latePage.close()

    expect(earlyDenom).toBeGreaterThan(0)
    // 1865 之前可达的链必然少于 1912 之前，否则"按年份取分母"没生效
    expect(earlyDenom).toBeLessThan(lateDenom)
  })

  test('未到年代的链即使标记完成也不列出', async ({ page }) => {
    const save = buildEndedSave({
      state: {
        turn: 2,
        date: { year: 1852, month: 6 },
        attributes: { military: 50, economy: 50, politics: 50, people: 50, diplomacy: 50 },
        resources: { silver: 100, troops: 100, food: 100, reputation: 5 }
      },
      completedChainIds: ['tai-ping-tian-guo', 'xin-hai-ge-ming']
    })
    await openEndPage(page, save)
    await expect(page.locator('text=亲历 1/')).toBeVisible()
    await expect(page.locator('text=辛亥革命')).toHaveCount(0)
  })

  test('可达链数不足 3 条时不给称号', async ({ page }) => {
    const save = buildEndedSave({
      state: {
        turn: 2,
        date: { year: 1852, month: 6 },
        attributes: { military: 50, economy: 50, politics: 50, people: 50, diplomacy: 50 },
        resources: { silver: 100, troops: 100, food: 100, reputation: 5 }
      },
      completedChainIds: ['tai-ping-tian-guo'],
      activeChainIds: []
    })
    await openEndPage(page, save)
    // 1/1 = 100%，但样本太小，不该显示「亲历全局」
    await expect(page.locator('text=亲历全局')).toHaveCount(0)
    await expect(page.locator('.end-game__chains-count')).toBeVisible()
  })

  test('旧存档缺 completedChainIds 字段时不崩，按 0 条处理', async ({ page }) => {
    const save = buildEndedSave()
    delete save.completedChainIds
    delete save.activeChainIds
    await openEndPage(page, save)
    await expect(page.locator('text=历史进程')).toBeVisible()
    await expect(page.locator('.end-game__chains-count')).toContainText('0/')
  })

  test('完成度不改变结局称号：victory 仍是 victory', async ({ page }) => {
    await openEndPage(page, buildEndedSave({ completedChainIds: [], activeChainIds: [] }))
    // 用类名定位：'中兴大业' 同时出现在标题与 victory 结局文案里，text= 会命中两个节点
    await expect(page.locator('.end-game__title')).toHaveText('中兴大业')
    // 史评块仍在（两层展示互不覆盖）
    await expect(page.locator('.end-game__rating')).toBeVisible()
  })

  test('年钟：存档带 zenithYear 时结局页交代锁定年份', async ({ page }) => {
    await openEndPage(page, buildEndedSave({ zenithYear: 1882 }))
    await expect(page.locator('text=中兴已定')).toBeVisible()
    await expect(page.locator('text=1882 年')).toBeVisible()
  })

  test('从未锁定的存档不显示「中兴已定」行', async ({ page }) => {
    await openEndPage(page, buildEndedSave({ endedReason: 'time_up' }))
    await expect(page.locator('text=中兴已定')).toHaveCount(0)
  })
})
