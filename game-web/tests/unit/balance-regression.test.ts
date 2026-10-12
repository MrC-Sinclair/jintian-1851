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
 *   - 连推 62 回合（年钟下等于 1851→1913，足够走完全程并触发 1912 结算），
 *     采集 胜率 / 结算回合分布 / 崩溃维度分布 / 链完成数 / 终局年份
 *   - 同时作为后续调权重/产出值的「自动化平衡回归」基线
 *
 * 基线快照（**2026-10-12 年钟标定**：1 回合 = 1 年 + 结局在 1912 年之后结算 +
 *   五维封顶 0-100 + 胜利阈值 85 + 资源托底 0 + 兵员每回合 +15 + 名望封顶与每回合 −3 +
 *   养饷 K=4 + 财政破产后果 + 23 条剧情链，maxTurns 62，200 局）：
 *   baseline    winRate=97.5%  avgTurns=63.0 median=63 range=[63,63] avgPower=89.3
 *               链完成均值=0 最晚年份=1913 逐资源下限=银两0/兵员15/粮草60/名望0
 *               非胜利：time_up 5 局
 *   simple-npc  winRate=31.5%  同样跑满 63 回合；time_up 136、diplomacy_collapse 1
 *
 * ⚠️ 胜率的语义与月钟时代**不可直接比较**：现在 victory = 「六十年中曾锁定中兴 且 未崩溃到 1912」，
 *   旧值是「谁先把 power 推到 85」。97.5% 不代表游戏变简单了 11.5 倍，而是判据换了。
 *   真正变硬的指标是**崩溃率**：关链 200 局只有 1 局崩溃（diplomacy_collapse，且还在 NPC 压力档），
 *   说明"活过六十年"本身不难，难的是"六十年里有没有巅峰"。
 *
 * 剧情链开关（useStoryChains，默认 false，上面即「关链」）：
 *   开链            winRate=100.0% avgTurns=44.0 range=[44,44] avgPower=92.5
 *                   链完成均值=**12.00**（23 条里走完 12 条）最晚年份=1913
 *                   逐资源下限=银两452/兵员15/粮草800/名望19
 *   开链+simple-npc winRate=73.5%  avgTurns=44.0 avgPower=86.0 链完成均值=12.00
 *                   time_up 53 局，逐资源下限=银两344
 *   ✅ 与月钟最大的差别：链完成均值 5.00 → **12.00**，最晚年份 1865 → **1913**。
 *      补的 9 条锚点第一次真的被读到（月钟下 23 条链只用到 5 条，其余全在胜利线之后）。
 *   ⚠️ 遗留问题换了形态：开链组锁定「中兴」的年份实测中位 1882（关链 1887），
 *      即后半场约 30 个回合处于"已成定局、只剩走完"的状态。这是守成阶段缺目标，不是数值问题。
 *   名望五档（史评）在年钟下的实测占比：9% / 30% / 25% / 16% / 20%
 *      （阈值随本轮从 85/65/40/20 重标为 78/60/42/22；600 局合并分位 p10=9 / 中位=54 / p90=77。
 *       刻意**不**动 −3/回合 的衰减率：降到 −2 会让分布整体上移约 63 点、全员撞 100 封顶，
 *       衰减与增益是同一架天平的两端，只能重划刻度，不能单边改。）
 *
 * 月钟历史（2026-10-11 ~ 10-12 上午的标定，**已被上面的年钟快照取代**，保留只为可追溯）：
 *   baseline 86.0% / 37.5 回合 / [23,51] / avgPower 84.8；
 *   开链 100.0% / 22.0 / [22,22] / 链完成 5.00 / 终局 1865；simple-npc 7.0%
 *   当年判定"该做"的三个方向全部被实测否掉，它们正是改时钟的依据：
 *     ① 补锚点（14→23 条链）：开链基线 22.0 / [22,22] / 1865 **一个数都没变** —— 新锚点全在胜利线之后
 *     ② 链首密度闸门（`SimOptions.chainHeadInterval`，K=2…10 全扫）：胜率恒为 100.0%，
 *        而链完成均值随 K 单调下降（5.00→2.96）、终局年份不升反降（1865→1862）。
 *        闸门只让玩家少读剧本，没让玩家走得更远。开关保留，为让这个负结果可复现。
 *     ③ 给胜利加年份门槛：月钟下**没有任何胜利局走到过 1872 年**（关链 p90=1854、开链 1865、
 *        最好的一组 1872），"须 ≥1860"直接把胜率打到 **0.0%**
 *   外交不变量「开启外交不应降低胜率」在 #3 那轮被改写为「降幅 ≤15pt」：月钟下实测 −9.5pt，
 *     年钟下缩到 −2.0pt（97.5% vs 99.5%）—— 局长把外交的财政代价摊薄了，容差不因此收紧。
 *   养饷率标定曲线（**月钟下测的，年钟后未重测**，只作历史参照）：
 *     K=2/3 → 90.0%   K=4 → 86.0%   K=5 → 69.5%   K=6 → 59.0%   K=8 → 19.5%
 *   更早：属性封顶前（阈值 90、资源可为负）99.5% / simple-npc 64.0%；
 *     封顶+阈值 85 之后、资源压力之前 95.5% / avgPower 85.2
 *
 * 意外收获 —— 资源惩罚被长局长救活：月钟下粮草下限 160、兵员 15，「断粮→饥荒」200 局从未触发，
 *   当时归因为"内容侧缺口"。年钟下局长 63 回合，关链粮草下限降到 **60**、simple-npc 档直接见 **0**，
 *   断粮惩罚第一次真的触发。所以那个缺口**有一部分是时钟太短造成的**，#3 的归因需要打折。
 *   银两仍普遍触底（下限 0），破产后果照常咬人。
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
  // 年钟（1 回合 = 1 年）下必须 ≥62 才可能走到 1912 结算；旧的 50 会让所有局在结算前被截断
  maxTurns: 62,
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
      `链完成均值=${r.avgChainsCompleted.toFixed(2)} 最晚年份=${r.maxFinalYear} ` +
      `nonVictory=${JSON.stringify(Object.fromEntries(collapse))}`
  )
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('C1 跨提案联合平衡校验（通关模拟，mock LLM）', () => {
  it('年钟下能走完 1851—1912 全程并稳定结算（胜率≥0.8、无异常崩溃）', () => {
    const store = useGameStore()
    const report = runBatch(store, SEEDS, BASELINE)
    logReport('baseline', report)

    // 游戏可通关（即便 LLM 完全不可用，靠兜底事件池也能稳定取胜）
    expect(report.winRate).toBeGreaterThanOrEqual(0.8)
    // ⚠️ 断言语义随钟改变：旧断言是「avgTurns ≤ 50」（怕通关太快），
    //   年钟 + 1912 结算下**每一局都必须走到年代终点**，所以改成下限。
    //   实测关链 63.0、range=[63,63] —— 方差为 0 是设计使然：结算点固定在 1913 年。
    expect(report.avgTurns).toBeGreaterThanOrEqual(60)
    expect(report.avgTurns).toBeLessThanOrEqual(63)
    // 验收标准：终局年份必须真的越过 1912（月钟下实测没有任何胜利局走到过 1872 年）
    expect(report.maxFinalYear).toBeGreaterThan(1912)
    // 无异常崩溃局
    expect(report.reasonCounts['crash'] ?? 0).toBe(0)
  })

  it('外交开关对比：外交有财政代价，允许降胜率但必须有界（跨提案不变量已改写）', () => {
    const store = useGameStore()
    const withDiplo = runBatch(store, SEEDS, { ...BASELINE, useDiplomacy: true })
    const noDiplo = runBatch(store, SEEDS, { ...BASELINE, useDiplomacy: false })
    logReport('with-diplo', withDiplo)
    logReport('no-diplo', noDiplo)

    // ⚠️ 原不变量「开启外交不应降低胜率」（容差 5pt）在 #3 那轮被改写过：
    //   结盟/通商要花银两，而破产后果（银两 ≤ 0 → 经济 −3 民心 −2）让「花银两」第一次有代价，
    //   月钟下实测 with-diplo 86.0% vs no-diplo 95.5%（−9.5pt）。
    //   **年钟 + 1912 结算下差距缩到 −2.0pt（97.5% vs 99.5%）**：胜利不再由"谁先冲线"决定，
    //   外交的财政代价被 63 回合的长度摊薄。容差 15pt 保留 —— 它防的是"外交变成陷阱"，
    //   这个风险随局长变化随时可能回来，不该因为本轮数字好看就收紧回去。
    expect(withDiplo.winRate).toBeGreaterThanOrEqual(noDiplo.winRate - 0.15)
    // 两条路径都应仍可通关
    expect(withDiplo.winRate).toBeGreaterThanOrEqual(0.8)
    expect(noDiplo.winRate).toBeGreaterThanOrEqual(0.8)
    // 外交机制在两条路径里确实被用上了（否则上面的对比是空的）
    expect(withDiplo.avgDiplomacyActions).toBeGreaterThan(0)
    expect(noDiplo.avgDiplomacyActions).toBe(0)
  })

  it('剧情链开关对比：链是纯增益，年钟下它改为"缩短走完年代所需的回合"', () => {
    const store = useGameStore()
    const chainsOff = runBatch(store, SEEDS, BASELINE)
    const chainsOn = runBatch(store, SEEDS, { ...BASELINE, useStoryChains: true })
    const chainsOnNpc = runBatch(store, SEEDS, {
      ...BASELINE,
      useStoryChains: true,
      npcModel: 'simple'
    })
    logReport('chains-off', chainsOff)
    logReport('chains-on', chainsOn)
    logReport('chains-on+npc', chainsOnNpc)

    expect(chainsOn.reasonCounts['crash'] ?? 0).toBe(0)
    expect(chainsOn.total).toBe(SEEDS.length)
    // 链节点不进 LLM、effects 固定且量级远大于兜底事件，所以开链必然更早撞线
    expect(chainsOn.winRate).toBeGreaterThanOrEqual(chainsOff.winRate)
    expect(chainsOn.avgChainsCompleted).toBeGreaterThan(0)
    expect(chainsOn.avgTurns).toBeLessThan(chainsOff.avgTurns)

    // 年钟下链的作用变了：游戏不再"中途撞线结束"（结算点固定在 1912 之后），
    // 但链首的时光跳跃会把日历往前跳，所以**开链组用更少回合走完全程**（实测 44 vs 63）。
    // 这不算病 —— 月钟时代它才是病（22 回合就必胜、终局 1865 年、六十年走不完）。
    // 仍要盯的一点：链给的是超额属性增益，开链组锁定「中兴」的年份显著更早（实测 1882 vs 关链 1887），
    // 也就是"后半场无事可求"的问题被链放大了 —— 那是守成阶段缺目标，属设计侧，不靠数值掩盖。
    expect(chainsOnNpc.reasonCounts['crash'] ?? 0).toBe(0)
    expect(chainsOnNpc.total).toBe(SEEDS.length)
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
