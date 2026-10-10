/**
 * @file C1 跨提案联合平衡校验（通关模拟，LLM 由兜底事件池 mock）
 *
 * C1 约定（见 openspec/changes/archive/2026-08-07-* 下的 proposal.md / design.md）：
 *   三份平衡提案（event-weight-dynamic-adjust / resource-per-turn-yield /
 *   weighted-overall-power）全部落地后，跑标准通关路径，对比胜利回合数 / 崩溃率，
 *   避免单看合理、合看失序。此处把玩家主动外交（player-active-diplomacy）一并纳入。
 *
 * 本测试复用 tests/sim/balance-sim.ts 纯函数底盘：
 *   - 用兜底事件池 mock 掉 generate-event / npc-actions（真实降级路径），离线可复现
 *   - 连推 50 回合，采集 胜率 / 通关回合分布 / 崩溃维度分布
 *   - 同时作为后续调权重/产出值的「自动化平衡回归」基线
 *
 * 基线快照（2026-10-11，五维封顶 0-100 + 胜利阈值 85 + 资源托底 0 + 兵员每回合 +15 之后，200 局）：
 *   baseline    winRate=95.5%  avgTurns=36.2 median=35 range=[23,51] avgPower=85.2
 *               逐资源下限=银两0/兵员15/粮草180/名望9
 *   simple-npc  winRate=40.5%  avgTurns=46.3 median=47 range=[35,51] avgPower=82.5
 *               逐资源下限=银两0/兵员15/粮草160/名望9
 *   对比历史：属性封顶前（阈值 90、资源可为负）baseline 99.5% / simple-npc 64.0%。
 *   银两普遍触底 0 但无任何后果、粮草与兵员在最优打法下几乎不归零——
 *   「断粮→饥荒」「兵溃」两条惩罚在模拟里接近休眠，缺口在内容侧
 *   （以粮草/兵员为代价的事件太少），不靠近似数值掩盖。
 *   注意 bot 走的是「优先补短板、规避属性归零」的近最优策略，其胜率是**上界**，
 *   不能直接当作人类玩家的胜率。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '../../src/stores/game'
import {
  runBatch,
  runSingleGame,
  type SimOptions,
  type SimReport
} from '../sim/balance-sim'

/** 200 个种子，足够给出统计稳定的胜率估计 */
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1)

/** 严格 C1 基线：LLM 完全不可用（npc=none），含外交，不偏向短板事件 */
const BASELINE: Omit<SimOptions, 'seed'> = {
  maxTurns: 50,
  useDiplomacy: true,
  biasShortfall: false,
  npcModel: 'none'
}

function logReport(label: string, r: SimReport): void {
  // 崩溃维度分布（非胜利结局）
  const collapse = Object.entries(r.reasonCounts)
    .filter(([k]) => k !== 'victory')
    .sort((a, b) => b[1] - a[1])
  console.log(
    `[balance-regression ${label}] total=${r.total} winRate=${(r.winRate * 100).toFixed(1)}% ` +
      `wins=${r.wins} avgTurns=${r.avgTurns.toFixed(1)} medianTurns=${r.medianTurns.toFixed(1)} ` +
      `turnRange=[${r.minTurns},${r.maxTurns}] avgPower=${r.avgPower.toFixed(1)} ` +
      `avgDiplomacy=${r.avgDiplomacyActions.toFixed(1)} minResource=${Number.isFinite(r.minResource) ? r.minResource.toFixed(0) : 'NaN'} ` +
      `逐资源下限=银两${r.minResources.silver.toFixed(0)}/兵员${r.minResources.troops.toFixed(0)}` +
      `/粮草${r.minResources.food.toFixed(0)}/名望${r.minResources.reputation.toFixed(0)} ` +
      `nonVictory=${JSON.stringify(Object.fromEntries(collapse))}`
  )
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('C1 跨提案联合平衡校验（通关模拟，mock LLM）', () => {
  it('50 回合内可稳定通关（胜率≥0.9），且采集回合/崩溃分布', () => {
    const store = useGameStore()
    const report = runBatch(store, SEEDS, BASELINE)
    logReport('baseline', report)

    // 游戏可通关（即便 LLM 完全不可用，靠兜底事件池也能稳定取胜）
    expect(report.winRate).toBeGreaterThanOrEqual(0.9)
    // 胜利回合合理：既非瞬间通关（退化），也不超时（50 回合上限内收敛）
    expect(report.avgTurns).toBeGreaterThanOrEqual(5)
    expect(report.avgTurns).toBeLessThanOrEqual(50)
    // 无异常崩溃局
    expect(report.reasonCounts['crash'] ?? 0).toBe(0)
  })

  it('外交开关对比：开启玩家主动外交不应降低胜率（跨提案不变量）', () => {
    const store = useGameStore()
    const withDiplo = runBatch(store, SEEDS, { ...BASELINE, useDiplomacy: true })
    const noDiplo = runBatch(store, SEEDS, { ...BASELINE, useDiplomacy: false })
    logReport('with-diplo', withDiplo)
    logReport('no-diplo', noDiplo)

    // 外交是次级操作，改的是 faction 字段而非 5 维属性，不应拖慢/削弱主平衡
    expect(withDiplo.winRate).toBeGreaterThanOrEqual(noDiplo.winRate - 0.05)
    // 两条路径都应稳定可通关
    expect(withDiplo.winRate).toBeGreaterThanOrEqual(0.9)
    expect(noDiplo.winRate).toBeGreaterThanOrEqual(0.9)
  })

  // 注：event-weight-dynamic-adjust 的「短板偏置」依赖 LLM 实时生成「对症」事件，
  // 静态兜底事件池无法忠实还原（粗粒度 proxy 会产生误导信号），故 C1 基线刻意采用
  // 均匀池（= LLM 完全不可用的最坏情况），以其作为可通关性的下界保证。

  it('崩溃维度采集：simple NPC 压力下仍能跑通并记录分布（信息性，不要求高胜率）', () => {
    const store = useGameStore()
    const report = runBatch(store, SEEDS, { ...BASELINE, npcModel: 'simple' })
    logReport('simple-npc', report)

    // 仅保证模拟可跑通、无异常崩溃；崩溃维度分布供后续回归对比
    expect(report.reasonCounts['crash'] ?? 0).toBe(0)
    expect(report.total).toBe(SEEDS.length)
  })

  it('底盘确定性：同种子两次运行结果完全一致（纯函数级保证）', () => {
    const store = useGameStore()
    const a = runSingleGame(store, { ...BASELINE, seed: 42 })
    const b = runSingleGame(store, { ...BASELINE, seed: 42 })
    expect(a.reason).toBe(b.reason)
    expect(a.turns).toBe(b.turns)
    expect(a.power).toBeCloseTo(b.power, 6)
    expect(a.attributes).toEqual(b.attributes)
  })
})
