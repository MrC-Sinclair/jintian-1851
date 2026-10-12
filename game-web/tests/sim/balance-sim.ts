/**
 * @file 通关模拟地基（纯函数级，可复用的「自动化平衡回归」底座）
 *
 * 用途：
 *   1. 补 C1 跨提案联合平衡校验：用确定性的「兜底事件池」mock 掉 LLM（generate-event /
 *      npc-actions），离线连推 N 回合，采集 胜率 / 通关回合分布 / 崩溃维度分布。
 *   2. 作为后续「调权重 / 调产出值」的数据依据：改 POWER_WEIGHTS、TURN_YIELD、
 *      DIPLOMACY_RULES 等常量后，重跑本底盘即可对比 winRate / avgTurns 的漂移。
 *
 * 设计要点（与真实回合循环对齐，但不依赖 LLM / 网络 / 本地存储）：
 *   - 事件生成（mock LLM）：从 FALLBACK_POOL 按种子随机选取，等价真实 generate-event 失败降级。
 *   - 玩家决策：chooseOption 启发式「理性玩家」策略——优先补短板维度、规避把任意属性打到 ≤0、
 *     轻微计入资源成本，纯函数、给定事件+状态即确定。
 *   - NPC 行动（mock LLM）：默认 'none'（等价真实 npc-actions 失败降级为空数组）；
 *     提供 'simple' 轻量压力模型用于采集崩溃维度信号（非 C1 严格基线）。
 *   - 回合结算：applyEffects(选项) → 可选 NPC → 破产（产出前）→ applyEffects(回合净流转：产出 − 养饷) →
 *     calcResourcePenalty(断粮/兵溃) → 可选外交 → 「中兴已定」锁定 → turn+1、**date.year+1** → checkEndConditions。
 *     效果应用路径与真实 useTurn 一致（不含 storage/save）。
 *   - 时钟：**1 回合 = 1 年**（与 useTurn 同步改过；旧月钟下 63 回合只推进 5 年，六十年走不完）。
 *     结局只在 year > 1912 时结算，所以模拟里每一局都跑完年代。
 *
 * 剧情链与时光跳跃：由 `useStoryChains` 开关控制，**默认 false**——这样 86.0% 的既有基线
 * 仍是「关链」时测出来的，打开前后两组数字并存，改链不会悄悄抹掉历史标定。
 * 打开后链节点按 `matchNextSimChain` 的规则挤占普通事件（与服务端 generate-event 的
 * pending-chain / time-window 优先级同规则，含「允许未来锚点」这条），年份与链完成度进入视野。
 * 镜像表与服务端真值的一致性由 tests/unit/sim-chain-mirror.test.ts 守卫，漂移即测试红。
 * 仍未建模：AI 军师/谈判的真实 LLM 行为。
 * 资源枯竭惩罚自 2026-10-11 起**已纳入**——此前不建模它，导致「加养饷不影响胜率」这类
 * 结论与真实游戏相反（破产后果才是压胜率的主力）。
 *
 * 确定性：makeRng(seed) 纯函数 + chooseOption 纯函数 ⇒ runSingleGame(seed) 完全可复现。
 */

import type {
  Attributes,
  EndReason,
  EndedReason,
  EventOption,
  GameEvent,
  GameSave,
  Resources
} from '../../src/types/game'
import { useGameStore } from '../../src/stores/game'
import { calcOverallPower, checkEndConditions } from '../../src/utils/end-conditions'
import { calcTurnYield } from '../../src/utils/turn-yield'
import { calcBankruptcyPenalty, calcResourcePenalty } from '../../src/utils/resource-penalty'
import { CRISIS_THRESHOLD, VICTORY_THRESHOLD } from '../../src/utils/constants'

/** 模拟结局（含两种非标准结局，便于统计） */
export type SimReason = EndReason | 'no_victory' | 'crash'

// ====================== 种子随机数（mulberry32，纯函数） ======================
export function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ====================== 兜底事件池（mock LLM 数据源） ======================
// 量级约定对齐 server/runtime/fallback-events.ts（effects ±5~15，资源 ±30~500）。
// 自包含存放，使回归基线不随服务端代码漂移；覆盖 5 类事件、各维正负向均有代表。
export const FALLBACK_POOL: GameEvent[] = [
  // ---------- 民生 ----------
  {
    title: '粮价飞涨',
    description: '入夏连月不雨，粮价三倍，百姓怨声载道。',
    eventType: '民生',
    options: [
      { id: 'a', label: '开仓放粮', effects: { people: 10, silver: -200, food: -50 } },
      { id: 'b', label: '强令平价', effects: { people: 4, economy: -8, reputation: 3 } },
      { id: 'c', label: '置之不理', effects: { people: -12, reputation: -8 } }
    ]
  },
  {
    title: '瘟疫蔓延',
    description: '乡间时疫蔓延，染者数百，事态恐酿大祸。',
    eventType: '民生',
    options: [
      { id: 'a', label: '重金延医', effects: { people: 8, silver: -150, reputation: 5 } },
      { id: 'b', label: '封锁疫区', effects: { people: -3, economy: -6, diplomacy: -4 } },
      { id: 'c', label: '上书请赈', effects: { people: 3, politics: 2, reputation: 2 } }
    ]
  },
  {
    title: '水利失修',
    description: '堤坝冲毁未修，汛期将至，恐淹良田万顷。',
    eventType: '民生',
    options: [
      { id: 'a', label: '征夫抢修', effects: { people: 5, silver: -100, food: -20 } },
      { id: 'b', label: '向富户募捐', effects: { economy: -5, people: 4, reputation: 4 } },
      { id: 'c', label: '听天由命', effects: { people: -8, economy: -10 } }
    ]
  },
  {
    title: '科举风波',
    description: '乡试有人举报考官受贿，士子群情激愤。',
    eventType: '民生',
    options: [
      { id: 'a', label: '严查重办', effects: { politics: 6, people: 4, reputation: 6 } },
      { id: 'b', label: '息事宁人', effects: { politics: -5, reputation: -8 } },
      { id: 'c', label: '上奏复查', effects: { politics: 3, diplomacy: 2 } }
    ]
  },
  {
    title: '灾荒乞赈',
    description: '黄河决口，赤地千里，流民载道。',
    eventType: '民生',
    options: [
      { id: 'a', label: '设粥厂广施', effects: { people: 12, silver: -250, reputation: 8 } },
      { id: 'b', label: '劝富户捐米', effects: { economy: -4, people: 6, reputation: 4 } },
      { id: 'c', label: '遣返原籍', effects: { people: -10, reputation: -6 } }
    ]
  },
  {
    title: '盐引积弊',
    description: '盐政积弊，官盐滞销私盐横行，民食贵盐。',
    eventType: '民生',
    options: [
      { id: 'a', label: '整顿盐政', effects: { economy: 7, politics: 4, reputation: 4 } },
      { id: 'b', label: '维持旧制', effects: { economy: 2, reputation: -2 } },
      { id: 'c', label: '加价摊派', effects: { economy: 3, people: -7, reputation: -5 } }
    ]
  },
  // ---------- 军事 ----------
  {
    title: '兵饷拖欠',
    description: '营中兵饷拖欠三月，士卒怨望，有哗变之虞。',
    eventType: '军事',
    options: [
      { id: 'a', label: '补发兵饷', effects: { military: 8, silver: -300, economy: -5 } },
      { id: 'b', label: '向商人借饷', effects: { military: 5, economy: -4, diplomacy: -2 } },
      { id: 'c', label: '拖延敷衍', effects: { military: -10, people: -3 } }
    ]
  },
  {
    title: '匪患骤起',
    description: '山贼据险为巢，劫掠商旅，近日攻巡检司。',
    eventType: '军事',
    options: [
      { id: 'a', label: '亲率进剿', effects: { military: 6, troops: -50, reputation: 7 } },
      { id: 'b', label: '招安抚遣', effects: { military: -2, people: 3, silver: -80 } },
      { id: 'c', label: '请邻县会剿', effects: { military: 3, diplomacy: -3, reputation: 2 } }
    ]
  },
  {
    title: '新军操练',
    description: '新募之军编练三月，请示购械练洋操。',
    eventType: '军事',
    options: [
      { id: 'a', label: '购洋械练洋操', effects: { military: 12, silver: -400, diplomacy: 2 } },
      { id: 'b', label: '沿用旧制', effects: { military: 2, reputation: 3 } },
      { id: 'c', label: '暂缓再议', effects: { military: -1 } }
    ]
  },
  {
    title: '边警频传',
    description: '北边游牧部落犯边，掳掠人畜。',
    eventType: '军事',
    options: [
      { id: 'a', label: '出塞追击', effects: { military: 8, troops: -80, silver: -100 } },
      { id: 'b', label: '坚壁清野', effects: { military: -2, people: -3, economy: -4 } },
      { id: 'c', label: '遣使通好', effects: { military: -3, diplomacy: 8, silver: 50 } }
    ]
  },
  {
    title: '裁汰绿营',
    description: '议裁绿营老弱兵额以节饷，营中人心惶惶。',
    eventType: '军事',
    options: [
      { id: 'a', label: '稳妥裁汰', effects: { military: 2, economy: 6, reputation: 3 } },
      { id: 'b', label: '暂缓安抚', effects: { military: 4, economy: -3, reputation: 2 } },
      { id: 'c', label: '强行裁撤', effects: { military: -6, reputation: -5, troops: -30 } }
    ]
  },
  {
    title: '海防告警',
    description: '沿海炮台年久失修，敌舰游弋外洋。',
    eventType: '军事',
    options: [
      { id: 'a', label: '拨款修炮台', effects: { military: 7, silver: -300, diplomacy: 2 } },
      { id: 'b', label: '添购铁甲舰', effects: { military: 10, silver: -500, diplomacy: 4 } },
      { id: 'c', label: '以旧台敷衍', effects: { military: -4, reputation: -3 } }
    ]
  },
  // ---------- 外交 ----------
  {
    title: '列强施压',
    description: '西洋公使照会，要求开放本埠为通商口岸。',
    eventType: '外交',
    options: [
      { id: 'a', label: '妥协开放', effects: { diplomacy: 5, economy: 6, people: -8, reputation: -6 } },
      { id: 'b', label: '坚拒整军', effects: { diplomacy: -8, military: 4, people: 5 } },
      { id: 'c', label: '拖延周旋', effects: { diplomacy: -2, politics: 3, economy: -2 } }
    ]
  },
  {
    title: '邻省求援',
    description: '邻省巡抚遣使求援，请借兵三千并粮草。',
    eventType: '外交',
    options: [
      { id: 'a', label: '倾力相助', effects: { diplomacy: 10, troops: -300, food: -100, reputation: 6 } },
      { id: 'b', label: '婉拒赠粮', effects: { diplomacy: 3, food: -30 } },
      { id: 'c', label: '坐视不理', effects: { diplomacy: -8, reputation: -5 } }
    ]
  },
  {
    title: '朝贡使节',
    description: '朝鲜国王遣使赍表入贡，并请兵援内乱。',
    eventType: '外交',
    options: [
      { id: 'a', label: '准贡派兵', effects: { diplomacy: 8, military: -4, troops: -100, reputation: 7 } },
      { id: 'b', label: '受贡却兵', effects: { diplomacy: 2, reputation: 2, economy: 3 } },
      { id: 'c', label: '拒贡断交', effects: { diplomacy: -10, reputation: -6, people: -2 } }
    ]
  },
  {
    title: '教案冲突',
    description: '乡民与教堂起冲突，洋人要求赔银惩凶。',
    eventType: '外交',
    options: [
      { id: 'a', label: '赔银惩凶', effects: { diplomacy: 4, silver: -500, people: -8, reputation: -5 } },
      { id: 'b', label: '据理力争', effects: { diplomacy: 0, silver: -250, politics: 4 } },
      { id: 'c', label: '拒赔力挺', effects: { diplomacy: -10, people: 8, reputation: 5 } }
    ]
  },
  {
    title: '关税交涉',
    description: '洋商以协定关税倾销，本土产业凋敝。',
    eventType: '外交',
    options: [
      { id: 'a', label: '据约加税', effects: { diplomacy: -4, economy: 5, reputation: 4 } },
      { id: 'b', label: '维持税则', effects: { economy: -3, diplomacy: 3, reputation: -2 } },
      { id: 'c', label: '劝用国货', effects: { economy: 4, people: 3, reputation: 3 } }
    ]
  },
  {
    title: '遣使出洋',
    description: '朝廷遣使团出洋考察政法工商。',
    eventType: '外交',
    options: [
      { id: 'a', label: '资助考察', effects: { diplomacy: 6, politics: 5, economy: 3, silver: -200 } },
      { id: 'b', label: '限制权限', effects: { diplomacy: 2, politics: 1 } },
      { id: 'c', label: '闭目塞听', effects: { diplomacy: -3, politics: -2, reputation: -3 } }
    ]
  },
  // ---------- 随机 ----------
  {
    title: '商人献宝',
    description: '胡商献夜明珠，欲换通商特权。',
    eventType: '随机',
    options: [
      { id: 'a', label: '纳珠许通', effects: { economy: 8, diplomacy: 3, reputation: -2 } },
      { id: 'b', label: '纳珠不予', effects: { economy: 2, silver: 200, reputation: -3 } },
      { id: 'c', label: '却珠遣之', effects: { reputation: 5, economy: -2 } }
    ]
  },
  {
    title: '奇书现世',
    description: '书坊售泰西奇书，载格致之学。',
    eventType: '随机',
    options: [
      { id: 'a', label: '购之研习', effects: { politics: 6, economy: 3, silver: -100, reputation: 4 } },
      { id: 'b', label: '禁绝流传', effects: { politics: -3, people: -4, reputation: 2 } },
      { id: 'c', label: '听其自然', effects: { politics: 1, economy: 1 } }
    ]
  },
  // ---------- 历史剧情 ----------
  {
    title: '洋务兴起',
    description: '朝廷下诏兴办洋务，设机器局造船厂。',
    eventType: '历史剧情',
    options: [
      { id: 'a', label: '积极响应', effects: { economy: 8, military: 6, silver: -400, politics: 4 } },
      { id: 'b', label: '从缓徐图', effects: { economy: 2, politics: 1 } },
      { id: 'c', label: '上疏反对', effects: { politics: -3, reputation: 3, diplomacy: -2 } }
    ]
  },
  {
    title: '维新风潮',
    description: '维新诏书频下，裁冗员兴学堂练新军。',
    eventType: '历史剧情',
    options: [
      { id: 'a', label: '赞成新政', effects: { politics: 7, reputation: 6, economy: 4 } },
      { id: 'b', label: '观望骑墙', effects: { politics: -2, reputation: -3 } },
      { id: 'c', label: '联旧党阻', effects: { politics: 4, reputation: -6 } }
    ]
  },
  {
    title: '借款筑路',
    description: '洋行愿贷巨款筑路，然路权抵押。',
    eventType: '历史剧情',
    options: [
      { id: 'a', label: '借洋款自筑', effects: { economy: 8, diplomacy: 4, silver: 200 } },
      { id: 'b', label: '拒借保路权', effects: { economy: -3, diplomacy: -3, reputation: 4 } },
      { id: 'c', label: '官督商办', effects: { economy: 6, politics: 4, silver: -200 } }
    ]
  },
  {
    title: '辛丑议和',
    description: '联军退兵，议和条款沉重，赔款巨万。',
    eventType: '历史剧情',
    options: [
      { id: 'a', label: '忍辱认约', effects: { diplomacy: 5, reputation: -9, silver: -500, people: -7 } },
      { id: 'b', label: '力陈不签', effects: { politics: 6, reputation: 5, diplomacy: -4 } },
      { id: 'c', label: '筹款摊还', effects: { economy: -8, silver: -300, politics: 3 } }
    ]
  }
]

// ====================== 初始存档（确定性基线） ======================
export function buildSimSave(): GameSave {
  return {
    saveVersion: 2,
    saveId: '550e8400-e29b-41d4-a716-446655440000',
    deviceId: 'balance-sim',
    createdAt: 0,
    updatedAt: 0,
    character: {
      background: '文官',
      backgroundPerks: { politics: 5 },
      factionId: 'f1',
      factionName: '清廷',
      factionSummary: '晚清朝廷'
    },
    state: {
      turn: 1,
      date: { year: 1851, month: 1 },
      attributes: { military: 50, economy: 50, politics: 55, people: 50, diplomacy: 50 },
      resources: { silver: 1000, troops: 500, food: 800, reputation: 10 }
    },
    factions: [
      { id: 'f1', name: '清廷', summary: '', power: 70, relationship: 80, status: 'active' },
      { id: 'f2', name: '太平天国', summary: '', power: 60, relationship: -50, status: 'active' },
      { id: 'f3', name: '湘军', summary: '', power: 50, relationship: 20, status: 'active' },
      { id: 'f4', name: '革命党', summary: '', power: 40, relationship: -20, status: 'active' },
      { id: 'f5', name: '北洋', summary: '', power: 45, relationship: 0, status: 'active' },
      { id: 'f6', name: '淮军', summary: '', power: 55, relationship: 30, status: 'active' }
    ],
    events: [],
    advisorMessages: [],
    pendingChainNodes: [],
    completedChainIds: [],
    activeChainIds: [],
    ended: false
  }
}

// ====================== 玩家决策策略（纯函数，理性玩家） ======================
const ATTR_KEYS: Array<keyof Attributes> = ['military', 'economy', 'politics', 'people', 'diplomacy']

/**
 * 在给定事件选项中，为「理性玩家」选最优项。
 * - 属性增量按紧迫度加权：<30 危机(×3) / <50(×1.5) / 其余(×1)
 * - 资源成本轻微扣分（避免无脑烧钱）
 * - 任何会把属性打到 ≤0 的选项重罚（兜底保护，避免自爆）
 */
export function chooseOption(
  event: GameEvent,
  attrs: Attributes,
  res: Resources
): EventOption {
  let best: EventOption = event.options[0]
  let bestScore = -Infinity
  for (const opt of event.options) {
    let score = 0
    for (const d of ATTR_KEYS) {
      const dv = opt.effects[d] ?? 0
      if (dv === 0) continue
      const urgency = attrs[d] < CRISIS_THRESHOLD ? 3 : attrs[d] < 50 ? 1.5 : 1
      score += dv * urgency
    }
    // 资源成本意识（轻量）
    const silverCost = -(opt.effects.silver ?? 0)
    const troopCost = -(opt.effects.troops ?? 0)
    const foodCost = -(opt.effects.food ?? 0)
    score -= silverCost * 0.05 + troopCost * 0.02 + foodCost * 0.03
    // 自爆保护：把任意属性打到 ≤0 重罚
    let unsafe = false
    for (const d of ATTR_KEYS) {
      if (attrs[d] + (opt.effects[d] ?? 0) <= 0) unsafe = true
    }
    if (unsafe) score -= 1000
    if (score > bestScore) {
      bestScore = score
      best = opt
    }
  }
  return best
}

// ====================== 事件选取（mock LLM generate-event） ======================
function pickEvent(rng: () => number, attrs: Attributes, biasShortfall: boolean): GameEvent {
  if (biasShortfall) {
    // 模拟 event-weight-dynamic-adjust：偏向含「当前最低维正向增量」选项的事件
    let lowest = ATTR_KEYS[0]
    for (const d of ATTR_KEYS) if (attrs[d] < attrs[lowest]) lowest = d
    const candidates = FALLBACK_POOL.filter((e) =>
      e.options.some((o) => (o.effects[lowest] ?? 0) > 0)
    )
    const pool = candidates.length > 0 ? candidates : FALLBACK_POOL
    return pool[Math.floor(rng() * pool.length)]
  }
  return FALLBACK_POOL[Math.floor(rng() * FALLBACK_POOL.length)]
}

// ====================== NPC 行动（mock LLM npc-actions） ======================
const NPC_PRESSURE_DIMS: Array<keyof Attributes> = ['military', 'economy', 'politics', 'people', 'diplomacy']

// ====================== 剧情链与时光跳跃（可选建模） ======================

/**
 * 模拟用剧情链定义。
 *
 * **结构与节点 effects 均镜像** `server/server/runtime/story-chains.ts` 的 23 条链 67 个节点，
 * 由 `tests/unit/sim-chain-mirror.test.ts` 与服务端逐项深比对防漂移：服务端改了链内容，
 * 这条测试会红，逼着人**有意识地重新标定基线**，而不是让基线悄悄漂移。
 *
 * 为什么不直接 import 服务端那份：本文件的设计意图是「自包含存放，使回归基线不随服务端内容漂移」
 * （见文件头）。共享对象会让服务端改一个节点数值就静默改变 200 局的胜率；
 * 镜像 + 深比对护栏把「漂移」变成「显式的、需要人来结的账」。
 */
interface SimChainNodeOption {
  id: string
  label: string
  effects: Record<string, number>
}

interface SimChainDef {
  chainId: string
  startYear: number
  nodeCount: number
  prerequisiteChainIds?: string[]
  /** 有序节点，每个节点是一组选项（长度 = 该节点的选项数） */
  nodes: SimChainNodeOption[][]
}

const SIM_CHAINS: readonly SimChainDef[] = [
  {
    chainId: 'tai-ping-tian-guo',
    startYear: 1851,
    nodeCount: 5,
    nodes: [
      [{ id: 'a', label: '请缨率军南征', effects: { military: 8, troops: -200, reputation: 8, diplomacy: 3 } }, { id: 'b', label: '招募乡勇守土', effects: { military: 4, silver: -150, people: 3 } }, { id: 'c', label: '观望局势待变', effects: { military: -2, reputation: -4, diplomacy: -2 } }],
      [{ id: 'a', label: '派兵江防固守', effects: { military: 6, troops: -100, reputation: 5 } }, { id: 'b', label: '遣使议和划江', effects: { diplomacy: 5, politics: 3, reputation: -3 } }, { id: 'c', label: '坐视其坐大', effects: { diplomacy: -5, people: -3 } }],
      [{ id: 'a', label: '趁乱进逼天京', effects: { military: 5, reputation: 8, troops: -80 } }, { id: 'b', label: '按兵不动观变', effects: { politics: 3, reputation: 2 } }, { id: 'c', label: '联捻共抗清廷', effects: { diplomacy: 6, reputation: 4 } }],
      [{ id: 'a', label: '水陆并进规复', effects: { military: 3, reputation: 5, troops: -120 } }, { id: 'b', label: '收缩防线保天京', effects: { military: -1, people: -3 } }, { id: 'c', label: '弃城转移江西', effects: { troops: -100, reputation: 2 } }],
      [{ id: 'a', label: '论功进剿余孽', effects: { military: 10, reputation: 15, people: 5 } }, { id: 'b', label: '招抚散众安民', effects: { people: 8, reputation: 6, silver: -100 } }, { id: 'c', label: '奏报捷音请赏', effects: { politics: 8, reputation: 10 } }],
    ]
  },
  {
    chainId: 'er-ci-ya-pian',
    startYear: 1856,
    nodeCount: 3,
    nodes: [
      [{ id: 'a', label: '强硬拒英要求', effects: { diplomacy: -8, military: 4, reputation: 5 } }, { id: 'b', label: '道歉息事宁人', effects: { diplomacy: 3, reputation: -5, politics: 2 } }, { id: 'c', label: '暗调兵勇备防', effects: { military: 5, silver: -120 } }],
      [{ id: 'a', label: '死守炮台不退', effects: { military: 7, troops: -150, reputation: 8 } }, { id: 'b', label: '退守津城谈判', effects: { diplomacy: 4, reputation: -4 } }, { id: 'c', label: '调僧格林沁勤王', effects: { military: 6, troops: -100, reputation: 6 } }],
      [{ id: 'a', label: '忍辱准约图存', effects: { diplomacy: 6, reputation: -8, people: -5 } }, { id: 'b', label: '力陈不可签约', effects: { politics: 5, reputation: 6, diplomacy: -4 } }, { id: 'c', label: '筹办洋务自强', effects: { economy: 6, military: 4, politics: 3 } }],
    ]
  },
  {
    chainId: 'nian-jun-zhi-luan',
    startYear: 1853,
    nodeCount: 3,
    nodes: [
      [{ id: 'a', label: '分兵堵剿要冲', effects: { military: 6, troops: -120, reputation: 4 } }, { id: 'b', label: '坚壁清野困之', effects: { people: -4, economy: -5, military: 2 } }, { id: 'c', label: '招抚捻首归降', effects: { diplomacy: 5, reputation: 3, politics: 2 } }],
      [{ id: 'a', label: '协同湘军布防', effects: { military: 7, reputation: 6, troops: -100 } }, { id: 'b', label: '建言改剿为防', effects: { politics: 4, military: 2 } }, { id: 'c', label: '按兵静观其变', effects: { military: -2, reputation: -3 } }],
      [{ id: 'a', label: '奏凯论功行赏', effects: { military: 9, reputation: 12, politics: 5 } }, { id: 'b', label: '安抚降众屯田', effects: { people: 7, reputation: 6, silver: -100 } }, { id: 'c', label: '裁撤勇营节饷', effects: { economy: 8, military: -4 } }],
    ]
  },
  {
    chainId: 'tong-zhi-hui-luan',
    startYear: 1862,
    nodeCount: 3,
    nodes: [
      [{ id: 'a', label: '派兵弹压绥靖', effects: { military: 7, troops: -150, people: -3 } }, { id: 'b', label: '分化回汉息争', effects: { diplomacy: 5, people: 4, politics: 3 } }, { id: 'c', label: '闭城自守待援', effects: { military: -3, people: -5 } }],
      [{ id: 'a', label: '助饷供输楚军', effects: { economy: -6, military: 6, reputation: 7 } }, { id: 'b', label: '献策屯垦固本', effects: { economy: 5, people: 4, politics: 3 } }, { id: 'c', label: '按兵观其成效', effects: { reputation: -2, military: -1 } }],
      [{ id: 'a', label: '奏请建省安边', effects: { politics: 8, reputation: 12, diplomacy: 4 } }, { id: 'b', label: '移民实边屯垦', effects: { people: 8, economy: 5, silver: -150 } }, { id: 'c', label: '留兵镇守要隘', effects: { military: 6, troops: -80, reputation: 5 } }],
    ]
  },
  {
    chainId: 'yang-wu-yun-dong',
    startYear: 1861,
    nodeCount: 4,
    nodes: [
      [{ id: 'a', label: '积极参与筹办', effects: { diplomacy: 6, politics: 4, economy: 3 } }, { id: 'b', label: '消极应付了事', effects: { diplomacy: -3, politics: 1 } }, { id: 'c', label: '上疏扩大事权', effects: { politics: 5, reputation: 3 } }],
      [{ id: 'a', label: '斥资入股办厂', effects: { economy: 8, military: 6, silver: -400 } }, { id: 'b', label: '徐图缓进', effects: { economy: 3, politics: 1 } }, { id: 'c', label: '力陈糜费当止', effects: { politics: -3, reputation: 3, diplomacy: -2 } }],
      [{ id: 'a', label: '捐饷添购巨舰', effects: { military: 10, diplomacy: 5, silver: -500 } }, { id: 'b', label: '维持现有规模', effects: { military: 4, reputation: 2 } }, { id: 'c', label: '反对穷兵黩武', effects: { politics: 4, economy: 3, military: -2 } }],
      [{ id: 'a', label: '痛定思痛整军', effects: { military: 4, reputation: -6, silver: -200 } }, { id: 'b', label: '主和新起炉灶', effects: { diplomacy: 4, reputation: -8, people: -5 } }, { id: 'c', label: '上疏变法图存', effects: { politics: 6, reputation: 5 } }],
    ]
  },
  {
    chainId: 'zuo-zong-tang-xin-jiang',
    startYear: 1865,
    nodeCount: 4,
    nodes: [
      [{ id: 'a', label: '请缨西征讨逆', effects: { military: 8, reputation: 8, troops: -200 } }, { id: 'b', label: '主张弃疆保海', effects: { diplomacy: -4, military: -2, reputation: -5 } }, { id: 'c', label: '严守边关待变', effects: { military: 3, troops: -80 } }],
      [{ id: 'a', label: '力挺塞防论', effects: { politics: 6, reputation: 7, diplomacy: 3 } }, { id: 'b', label: '主张海防优先', effects: { military: 3, diplomacy: -2 } }, { id: 'c', label: '调和两防兼顾', effects: { politics: 4, economy: 2 } }],
      [{ id: 'a', label: '筹边改约保疆土', effects: { politics: 9, reputation: 14, diplomacy: 5 } }, { id: 'b', label: '移民屯垦实边', effects: { people: 8, economy: 6, silver: -200 } }, { id: 'c', label: '留重兵镇西域', effects: { military: 7, troops: -120, reputation: 6 } }],
      [{ id: 'a', label: '请即建省固边防', effects: { politics: 7, military: 4, reputation: 5, silver: -200 } }, { id: 'b', label: '先治屯政徐议建置', effects: { economy: 5, food: 200, politics: 2 } }, { id: 'c', label: '仍循军府旧制', effects: { military: 3, politics: -4, reputation: -3 } }],
    ]
  },
  {
    chainId: 'liu-qiu-tai-wan',
    startYear: 1871,
    nodeCount: 4,
    nodes: [
      [{ id: 'a', label: '派兵渡台御侮', effects: { military: 7, troops: -150, reputation: 6 } }, { id: 'b', label: '遣使诘问日本', effects: { diplomacy: 4, politics: 3, reputation: 2 } }, { id: 'c', label: '隐忍回避争端', effects: { diplomacy: -3, reputation: -5 } }],
      [{ id: 'a', label: '忍让维系数十年', effects: { diplomacy: 4, reputation: -6, silver: -200 } }, { id: 'b', label: '力拒条约不成', effects: { politics: 5, reputation: 4, diplomacy: -3 } }, { id: 'c', label: '密图联琉抗衡', effects: { diplomacy: 3, reputation: 3, politics: 2 } }],
      [{ id: 'a', label: '力诘日使争存祀', effects: { diplomacy: -4, politics: 4, reputation: 5 } }, { id: 'b', label: '用延宕策缓其谋', effects: { diplomacy: 5, politics: 3, reputation: -3 } }, { id: 'c', label: '置为缓图不深争', effects: { politics: 2, reputation: -4, silver: 150 } }],
      [{ id: 'a', label: '简任贤员首开帅府', effects: { politics: 6, reputation: 5, silver: -200 } }, { id: 'b', label: '清赋抚番以固疆本', effects: { economy: 5, military: 3, people: 3 } }, { id: 'c', label: '缓议建省以节经费', effects: { economy: 3, politics: -3, reputation: -2, silver: 200 } }],
    ]
  },
  {
    chainId: 'zhong-fa-zhan-zheng',
    startYear: 1883,
    nodeCount: 3,
    nodes: [
      [{ id: 'a', label: '出兵保藩固圉', effects: { military: 7, troops: -150, reputation: 6 } }, { id: 'b', label: '划界罢兵息争', effects: { diplomacy: 5, reputation: -4, politics: 2 } }, { id: 'c', label: '按兵观衅待机', effects: { military: -2, reputation: -3 } }],
      [{ id: 'a', label: '死战御敌雪耻', effects: { military: 6, troops: -180, reputation: 7 } }, { id: 'b', label: '重整残部设防', effects: { military: 4, reputation: 3, silver: -150 } }, { id: 'c', label: '奏请速和止损', effects: { diplomacy: 4, reputation: -5 } }],
      [{ id: 'a', label: '乘胜规复全越', effects: { military: 8, reputation: 10, troops: -120 } }, { id: 'b', label: '见好即收立约', effects: { diplomacy: 5, reputation: -6, people: -3 } }, { id: 'c', label: '奏陈边事善后', effects: { politics: 6, reputation: 5 } }],
    ]
  },
  {
    chainId: 'jia-wu-zhan-zheng',
    startYear: 1894,
    nodeCount: 3,
    prerequisiteChainIds: ['yang-wu-yun-dong'],
    nodes: [
      [{ id: 'a', label: '增兵援朝制日', effects: { military: 7, troops: -200, reputation: 5 } }, { id: 'b', label: '主张两国撤兵', effects: { diplomacy: 4, reputation: -3 } }, { id: 'c', label: '按兵静观其变', effects: { military: -3, reputation: -4 } }],
      [{ id: 'a', label: '决死战保舰队', effects: { military: 8, troops: -250, reputation: 8 } }, { id: 'b', label: '避战保船港内', effects: { military: -5, reputation: -8 } }, { id: 'c', label: '巧设伏击邀击', effects: { military: 5, reputation: 4, troops: -100 } }],
      [{ id: 'a', label: '忍痛准约图存', effects: { diplomacy: 5, reputation: -10, silver: -500, people: -8 } }, { id: 'b', label: '力主迁都再战', effects: { military: 4, reputation: 6, troops: -200 } }, { id: 'c', label: '联俄法制日谋', effects: { diplomacy: 6, politics: 4, reputation: 3 } }],
    ]
  },
  {
    chainId: 'wu-xu-bian-fa',
    startYear: 1898,
    nodeCount: 2,
    nodes: [
      [{ id: 'a', label: '上疏赞成新政', effects: { politics: 7, reputation: 6, economy: 4 } }, { id: 'b', label: '观望骑墙自保', effects: { politics: -2, reputation: -3 } }, { id: 'c', label: '联旧党阻新政', effects: { politics: 4, reputation: -6 } }],
      [{ id: 'a', label: '力保新政未果', effects: { politics: 5, reputation: 4, military: -3 } }, { id: 'b', label: '告退避祸全身', effects: { politics: -1, reputation: -4 } }, { id: 'c', label: '附后党以自固', effects: { politics: 3, reputation: -8, people: -3 } }],
    ]
  },
  {
    chainId: 'yi-he-tuan',
    startYear: 1899,
    nodeCount: 3,
    prerequisiteChainIds: ['wu-xu-bian-fa'],
    nodes: [
      [{ id: 'a', label: '剿抚兼施用之', effects: { military: 4, people: 3, reputation: -3 } }, { id: 'b', label: '纵团以抗外侮', effects: { reputation: 5, diplomacy: -6, people: 5 } }, { id: 'c', label: '力主严剿乱民', effects: { politics: 4, reputation: -5, people: -4 } }],
      [{ id: 'a', label: '勤王护驾抗敌', effects: { military: 7, troops: -200, reputation: 9 } }, { id: 'b', label: '随扈西行进陕', effects: { reputation: -6, politics: 2, diplomacy: 2 } }, { id: 'c', label: '留守安抚地方', effects: { people: 5, reputation: 4, silver: -150 } }],
      [{ id: 'a', label: '忍辱认约救亡', effects: { diplomacy: 5, reputation: -10, silver: -500, people: -8 } }, { id: 'b', label: '力陈不可签约', effects: { politics: 6, reputation: 5, diplomacy: -4 } }, { id: 'c', label: '筹款分期摊还', effects: { economy: -8, silver: -300, politics: 3 } }],
    ]
  },
  {
    chainId: 'ri-e-zhan-zheng',
    startYear: 1904,
    nodeCount: 2,
    nodes: [
      [{ id: 'a', label: '严守中立护民', effects: { diplomacy: 4, people: 4, reputation: 2 } }, { id: 'b', label: '暗助日军逐俄', effects: { diplomacy: 5, reputation: -4, military: 2 } }, { id: 'c', label: '联俄制日自保', effects: { diplomacy: -4, reputation: -3 } }],
      [{ id: 'a', label: '乘势收回权益', effects: { diplomacy: 5, politics: 4, reputation: 4 } }, { id: 'b', label: '隐忍周旋两强', effects: { diplomacy: 3, reputation: -3 } }, { id: 'c', label: '编练新军备边', effects: { military: 6, troops: -100, silver: -150 } }],
    ]
  },
  {
    chainId: 'qing-mo-xin-zheng',
    startYear: 1901,
    nodeCount: 3,
    prerequisiteChainIds: ['yi-he-tuan'],
    nodes: [
      [{ id: 'a', label: '力推新政育才', effects: { politics: 6, economy: 6, reputation: 5 } }, { id: 'b', label: '敷衍因循旧制', effects: { politics: -3, reputation: -4 } }, { id: 'c', label: '倡办实业兴利', effects: { economy: 8, reputation: 4, silver: -150 } }],
      [{ id: 'a', label: '请速开国会', effects: { politics: 7, reputation: 6, people: 4 } }, { id: 'b', label: '缓进筹备立宪', effects: { politics: 3, reputation: 1 } }, { id: 'c', label: '反对虚宪实专', effects: { reputation: 5, politics: -2 } }],
      [{ id: 'a', label: '上疏请改组阁', effects: { politics: 5, reputation: 4, people: 3 } }, { id: 'b', label: '缄默以观后效', effects: { politics: -1, reputation: -3 } }, { id: 'c', label: '暗结立宪力量', effects: { reputation: 6, politics: 3, diplomacy: 2 } }],
    ]
  },
  {
    chainId: 'xin-hai-ge-ming',
    startYear: 1911,
    nodeCount: 3,
    prerequisiteChainIds: ['qing-mo-xin-zheng'],
    nodes: [
      [{ id: 'a', label: '响应起义独立', effects: { reputation: 10, politics: 8, military: 6 } }, { id: 'b', label: '按兵静观其变', effects: { military: -3, reputation: -4 } }, { id: 'c', label: '效忠清廷平乱', effects: { politics: 4, reputation: -8, military: 5 } }],
      [{ id: 'a', label: '促成共和统一', effects: { politics: 8, reputation: 9, people: 6 } }, { id: 'b', label: '拥袁促成和局', effects: { politics: 5, reputation: 3, military: 2 } }, { id: 'c', label: '主战到底裂土', effects: { military: 6, reputation: -5, troops: -150 } }],
      [{ id: 'a', label: '拥护共和新建', effects: { politics: 10, reputation: 12, people: 8 } }, { id: 'b', label: '遗老缅怀故朝', effects: { reputation: -6, politics: -3 } }, { id: 'c', label: '整军经武图强', effects: { military: 8, troops: -100, economy: 4 } }],
    ]
  },
  {
    chainId: 'min-yong-gong-shang',
    startYear: 1872,
    nodeCount: 3,
    prerequisiteChainIds: ['yang-wu-yun-dong'],
    nodes: [
      [{ id: 'a', label: '集股创办官督商办', effects: { economy: 7, politics: 4, reputation: 4, silver: -200 } }, { id: 'b', label: '奏拨帑项官款独办', effects: { economy: 4, politics: 6, silver: -300 } }, { id: 'c', label: '任洋商专其利', effects: { economy: -4, diplomacy: 3, reputation: -3 } }],
      [{ id: 'a', label: '展设电线以通军报', effects: { economy: 5, military: 4, diplomacy: 2, silver: -250 } }, { id: 'b', label: '招集华股开采煤铁', effects: { economy: 6, people: 2, silver: -150 } }, { id: 'c', label: '以电线有碍风水而止', effects: { economy: -3, people: 3, politics: -2 } }],
      [{ id: 'a', label: '拨官款持平周转', effects: { economy: 6, politics: 3, reputation: 5, silver: -300 } }, { id: 'b', label: '任其倒闭以儆取巧', effects: { economy: -5, people: -3, politics: 2 } }, { id: 'c', label: '严究舞弊商董', effects: { politics: 5, economy: 2, reputation: 3, silver: -80 } }],
    ]
  },
  {
    chainId: 'tong-zhi-guang-xu',
    startYear: 1874,
    nodeCount: 3,
    prerequisiteChainIds: ['tong-zhi-hui-luan'],
    nodes: [
      [{ id: 'a', label: '速议迎立以安社稷', effects: { politics: 6, reputation: 4, silver: -100 } }, { id: 'b', label: '疏请简择贤长', effects: { politics: 4, reputation: 3, diplomacy: -3 } }, { id: 'c', label: '观望不言坐视其定', effects: { reputation: -4, politics: -2 } }],
      [{ id: 'a', label: '整饬衙门以应新政', effects: { politics: 6, people: 3, silver: -120 } }, { id: 'b', label: '结援醇邸以固根本', effects: { politics: 4, diplomacy: 3, reputation: -3 } }, { id: 'c', label: '守静待时不预枢要', effects: { economy: 2, reputation: -2 } }],
      [{ id: 'a', label: '延请名儒主讲', effects: { politics: 3, reputation: 4, economy: 2 } }, { id: 'b', label: '兼课天文算学', effects: { politics: 4, economy: 3, diplomacy: 2, silver: -100 } }, { id: 'c', label: '一切循旧例举行', effects: { politics: -2, reputation: -2, economy: 4 } }],
    ]
  },
  {
    chainId: 'yan-tai-tiao-yue',
    startYear: 1875,
    nodeCount: 2,
    prerequisiteChainIds: ['er-ci-ya-pian'],
    nodes: [
      [{ id: 'a', label: '缉凶赔款以全邦交', effects: { diplomacy: 5, politics: -3, reputation: -3, silver: -150 } }, { id: 'b', label: '严诘英人擅入边地', effects: { diplomacy: -5, military: 2, reputation: 5 } }, { id: 'c', label: '缓议托词查办', effects: { diplomacy: -2, politics: 2, reputation: -2 } }],
      [{ id: 'a', label: '签约换约以免兵祸', effects: { diplomacy: 6, economy: 3, reputation: -5, silver: -100 } }, { id: 'b', label: '力争裁去入藏一条', effects: { diplomacy: -3, politics: 5, reputation: 4 } }, { id: 'c', label: '借约促办洋务自强', effects: { economy: 5, military: 3, politics: 2, silver: -200 } }],
    ]
  },
  {
    chainId: 'ding-wu-qi-huang',
    startYear: 1876,
    nodeCount: 3,
    nodes: [
      [{ id: 'a', label: '捐廉劝募急筹赈', effects: { people: 6, reputation: 5, silver: -300 } }, { id: 'b', label: '奏请截留漕粮', effects: { people: 4, politics: 3, diplomacy: -3, food: -200 } }, { id: 'c', label: '讳灾不报以避处分', effects: { people: -8, reputation: -6, politics: 2 } }],
      [{ id: 'a', label: '设厂以工代赈', effects: { people: 7, economy: 3, silver: -200, food: -250 } }, { id: 'b', label: '劝分借粮于富户', effects: { politics: 4, economy: -3, people: 2 } }, { id: 'c', label: '驱遣游民勒令回籍', effects: { military: 2, people: -6, politics: 2 } }],
      [{ id: 'a', label: '力陈捐纳之弊请止', effects: { politics: 6, reputation: 5, economy: -3 } }, { id: 'b', label: '趁势筹饷以济时艰', effects: { economy: 5, silver: 300, politics: -4 } }, { id: 'c', label: '择要举办不废常经', effects: { politics: 2, reputation: 2, economy: 2 } }],
    ]
  },
  {
    chainId: 'ren-wu-jia-shen',
    startYear: 1882,
    nodeCount: 3,
    nodes: [
      [{ id: 'a', label: '迅派劲旅定其乱', effects: { military: 8, reputation: 6, diplomacy: 3, troops: -200 } }, { id: 'b', label: '缓师观望使其自敉', effects: { diplomacy: -4, reputation: -3, silver: 150 } }, { id: 'c', label: '仅遣使臣诘问', effects: { politics: 2, diplomacy: -2 } }],
      [{ id: 'a', label: '出兵速平复其国王', effects: { military: 6, reputation: 8, troops: -150, diplomacy: -3 } }, { id: 'b', label: '与日同心退兵', effects: { diplomacy: 5, politics: 3, reputation: -4 } }, { id: 'c', label: '守成宪不勤远略', effects: { diplomacy: -3, military: -2, economy: 2 } }],
      [{ id: 'a', label: '力争册封旧典独尊', effects: { diplomacy: -5, politics: 5, reputation: 3 } }, { id: 'b', label: '依约互文知照', effects: { diplomacy: 6, economy: 2, politics: -3 } }, { id: 'c', label: '密练新兵为东顾备', effects: { military: 6, silver: -200, troops: -100 } }],
    ]
  },
  {
    chainId: 'jia-shen-yi-shu',
    startYear: 1884,
    nodeCount: 2,
    prerequisiteChainIds: ['yang-wu-yun-dong'],
    nodes: [
      [{ id: 'a', label: '直言极谏争大局', effects: { reputation: 6, politics: -3, diplomacy: -2 } }, { id: 'b', label: '结纳新贵以自固', effects: { politics: 5, reputation: -4 } }, { id: 'c', label: '引疾退避不预枢要', effects: { economy: 2, reputation: -2 } }],
      [{ id: 'a', label: '条陈统筹防务', effects: { military: 5, politics: 4, reputation: 3, silver: -150 } }, { id: 'b', label: '请速筹兵饷', effects: { economy: 4, military: 3, silver: -200 } }, { id: 'c', label: '坐视中枢无人', effects: { diplomacy: -3, politics: -4, reputation: 2 } }],
    ]
  },
  {
    chainId: 'zhong-gu-ao-men',
    startYear: 1887,
    nodeCount: 2,
    nodes: [
      [{ id: 'a', label: '坚拒文字不许永管', effects: { diplomacy: -4, politics: 5, reputation: 3 } }, { id: 'b', label: '签约并索税厘', effects: { economy: 6, diplomacy: 5, reputation: -4, silver: 250 } }, { id: 'c', label: '借约防他国窥伺', effects: { diplomacy: 3, military: 2, economy: 2 } }],
      [{ id: 'a', label: '催勘界址定久远', effects: { politics: 4, diplomacy: 3, silver: -80 } }, { id: 'b', label: '增筑炮台固前哨', effects: { military: 5, diplomacy: -3, silver: -200 } }, { id: 'c', label: '一仍其旧不加深究', effects: { diplomacy: 2, politics: -3, reputation: -2 } }],
    ]
  },
  {
    chainId: 'guang-xu-da-hun',
    startYear: 1889,
    nodeCount: 2,
    prerequisiteChainIds: ['jia-shen-yi-shu'],
    nodes: [
      [{ id: 'a', label: '撙节备采以杜中饱', effects: { economy: 5, politics: 4, reputation: 3, silver: -100 } }, { id: 'b', label: '丰备典礼以彰国体', effects: { reputation: 6, politics: 3, silver: -300 } }, { id: 'c', label: '请速归政以定根本', effects: { politics: 5, reputation: 4, diplomacy: -3 } }],
      [{ id: 'a', label: '调和两宫以安大局', effects: { politics: 6, reputation: 5, diplomacy: 3 } }, { id: 'b', label: '阴附后府以固其位', effects: { politics: 7, reputation: -5 } }, { id: 'c', label: '力陈变计以佐新政', effects: { politics: 5, reputation: 3, economy: 3 } }],
    ]
  },
  {
    chainId: 'xing-zhong-hui',
    startYear: 1892,
    nodeCount: 2,
    nodes: [
      [{ id: 'a', label: '延揽人才以备非常', effects: { reputation: 4, politics: 3, silver: -100 } }, { id: 'b', label: '主农商立国之本', effects: { economy: 5, people: 3, politics: 2 } }, { id: 'c', label: '以其布衣而忽之', effects: { reputation: -3, people: -2, politics: 2, silver: 100 } }],
      [{ id: 'a', label: '密察其党报知其谋', effects: { politics: 5, reputation: 3, military: 2, silver: -100 } }, { id: 'b', label: '申饬海防杜其内衅', effects: { military: 4, politics: 3, silver: -200 } }, { id: 'c', label: '引为同调默加护持', effects: { reputation: 5, diplomacy: 2, politics: -4 } }],
    ]
  },
]

/**
 * 仅供 sim-chain-mirror.test.ts 做漂移守卫用；模拟内部一律直接用 SIM_CHAINS。
 * 导出的是同一份引用，测试改了它等于改了基线 —— 所以那份测试只做只读深比对。
 */
export const SIM_CHAINS_FOR_TEST: readonly SimChainDef[] = SIM_CHAINS

function chainNodeTitle(chainId: string, index: number): string {
  return `${chainId}·第${index + 1}节`
}

/** 构造一个链节点事件（含 chainId/chainNodeId/chainProgress，与 generate-event 下发结构一致） */
function buildChainEvent(chain: SimChainDef, nodeIndex: number, jumpFromYear?: number): GameEvent {
  const options = chain.nodes[nodeIndex].map(
    (o) => ({ id: o.id, label: o.label, effects: { ...o.effects } }) as unknown as EventOption
  )
  const event: GameEvent = {
    title: chainNodeTitle(chain.chainId, nodeIndex),
    description: `模拟剧情链节点（第 ${nodeIndex + 1}/${chain.nodeCount} 节，锚点 ${chain.startYear} 年）。`,
    eventType: '历史剧情',
    chainId: chain.chainId,
    chainNodeId: `node-${nodeIndex + 1}`,
    chainProgress: { current: nodeIndex + 1, total: chain.nodeCount },
    options
  }
  // 时光跳跃只在链首（time-window 路径）判定，与 generate-event 的 buildChainEvent 同规则：
  // 链内后续节点走 pending-chain 接续，日历应停在链开始年代，否则一条 5 节点链会往前推 5 次
  if (jumpFromYear !== undefined && chain.startYear > jumpFromYear) {
    event.eventDate = { year: chain.startYear, month: 1 }
  }
  return event
}

/** 复刻 matchNextChain：取 startYear 不早于当前年的最早一条可触发链（按 startYear + chainId 定序） */
function matchNextSimChain(year: number, completed: string[], active: string[]): SimChainDef | null {
  const candidates = SIM_CHAINS.filter(
    (c) =>
      c.startYear >= year &&
      !completed.includes(c.chainId) &&
      !active.includes(c.chainId) &&
      (c.prerequisiteChainIds ?? []).every((p) => completed.includes(p))
  )
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.startYear - b.startYear || (a.chainId < b.chainId ? -1 : 1))
  return candidates[0]
}

function applySimpleNpc(store: ReturnType<typeof useGameStore>, rng: () => number): void {
  const s = store.currentSave
  if (!s) return
  const selfId = s.character.factionId
  for (const f of s.factions) {
    if (f.status !== 'active' || f.id === selfId) continue
    if (rng() < 0.4) {
      const d = NPC_PRESSURE_DIMS[Math.floor(rng() * NPC_PRESSURE_DIMS.length)]
      store.applyEffects({ [d]: -2 } as Partial<Attributes>)
    }
  }
}

// ====================== 外交次级操作（每回合 1 次） ======================
function tryDiplomacy(store: ReturnType<typeof useGameStore>): boolean {
  const s = store.currentSave
  if (!s) return false
  const selfId = s.character.factionId
  // 优先结盟一个关系达标且未结盟的活跃势力
  const ally = s.factions.find(
    (f) => f.status === 'active' && f.id !== selfId && f.relationship >= 50
  )
  if (ally && store.applyDiplomacyAction(ally.id, '结盟')) return true
  // 否则对任一活跃势力通商（关系建设 + reputation 微增）
  const trade = s.factions.find((f) => f.status === 'active' && f.id !== selfId)
  if (trade && store.applyDiplomacyAction(trade.id, '通商')) return true
  return false
}

// ====================== 单局模拟 ======================
export interface SimOptions {
  /** 随机种子（决定事件序列），runBatch 会逐局覆盖 */
  seed: number
  /** 最大推演回合数（年钟下 62 = 走到 1913 年完成结算；C1 默认 62） */
  maxTurns?: number
  /** 是否叠加玩家主动外交（player-active-diplomacy 提案） */
  useDiplomacy?: boolean
  /** 是否偏向短板事件（模拟 event-weight-dynamic-adjust 的 LLM 行为） */
  biasShortfall?: boolean
  /** NPC 模型：'none' 等价 LLM 失败降级为空；'simple' 轻量压力模型 */
  npcModel?: 'none' | 'simple'
  /**
   * 是否建模剧情链与时光跳跃（默认 false，保持 C1 严格基线可复现）。
   * 打开后：链节点事件按年表触发并可能把日历前跳到锚点年，
   * 于是 `time_up`（年份 > 1912）与链完成度第一次进入模拟视野。
   */
  useStoryChains?: boolean
  /**
   * 链首密度闸门：每 K 回合最多**开启**一条新链，0/不传 = 不限。
   * 链内后续节点走挂起队列接续，不受此闸门影响——治的是"链首连发"，不是链本身。
   *
   * ⚠️ **实测已否掉这个方向，服务端不要照抄**：K=2/3 完全不起作用（链有 3~5 节，
   * 配额在链跑完前不构成约束），K 再大也只是把胜率 100% 维持不变、链完成数与终局年份**双双下降**。
   * 定局的根因是「1 回合 = 1 个月」的时钟，不是事件节奏 —— 见 balance-regression.test.ts 文件头。
   * 保留开关只为让这个结论可复现。
   */
  chainHeadInterval?: number
}

export interface SimOutcome {
  seed: number
  reason: SimReason
  turns: number
  power: number
  attributes: Attributes
  minResource: number
  /** 逐资源下限：聚合值分不清是银两还是兵员见底，而「谁归零」决定断粮/兵溃惩罚是否真会触发 */
  minResources: Resources
  diplomacyActions: number
  /** 完成的剧情链数（`useStoryChains=false` 时恒为 0） */
  chainsCompleted: number
  /** 终局游戏年份：时光跳跃会让它明显大于 turn 数对应的年份 */
  finalYear: number
}

/**
 * 跑一局完整通关模拟（纯函数级：相同 store + seed 可复现）。
 * 直接复用 store 原语（applyEffects / updateState / applyDiplomacyAction / markEnded），
 * 不走 useTurn（避免触发 storage 持久化与真实 LLM 调用）。
 */
export function runSingleGame(
  store: ReturnType<typeof useGameStore>,
  opts: SimOptions
): SimOutcome {
  const {
    seed,
    maxTurns = 62,
    useDiplomacy = true,
    biasShortfall = false,
    npcModel = 'none',
    useStoryChains = false,
    chainHeadInterval = 0
  } = opts
  const rng = makeRng(seed)
  store.setSave(buildSimSave())
  store.resetDiplomacy()

  let diplomacyActions = 0
  let minResource = Infinity
  const minResources: Resources = { silver: Infinity, troops: Infinity, food: Infinity, reputation: Infinity }
  let reason: SimReason = 'continue'
  let crashed = false

  // 剧情链运行时状态（复刻 useGameState.applyEventOption 的记账口径，不依赖 store 持久化）
  const pendingChain: { chainId: string; nodeId: string; scheduledTurn: number }[] = []
  const activeChains: string[] = []
  const completedChains: string[] = []

  try {
    for (let t = 0; t < maxTurns; t++) {
      const s = store.currentSave!
      const turn = s.state.turn
      store.resetDiplomacy()

      // 1. 事件（mock LLM generate-event；可选叠加剧情链与时光跳跃）
      //    优先级与真实实现一致：挂起节点 → 下一条可触发链 → 兜底事件
      let evt: GameEvent
      const dueIdx = useStoryChains ? pendingChain.findIndex((p) => p.scheduledTurn <= turn) : -1
      if (dueIdx >= 0) {
        const due = pendingChain.splice(dueIdx, 1)[0]
        const chain = SIM_CHAINS.find((c) => c.chainId === due.chainId)
        const nodeIndex = Number(due.nodeId.replace('node-', '')) - 1
        evt = chain ? buildChainEvent(chain, nodeIndex) : pickEvent(rng, s.state.attributes, biasShortfall)
      } else {
        // 链首密度闸门：每 K 回合最多**开启**一条新链（链内接续不受限）。
        // 用 (turn, 已开启链数) 判定，不需要新增任何存档字段。
        const startedChains = completedChains.length + activeChains.length
        const headQuota = chainHeadInterval > 0 ? 1 + Math.floor((turn - 1) / chainHeadInterval) : Infinity
        const nextChain =
          useStoryChains && startedChains < headQuota
            ? matchNextSimChain(s.state.date.year, completedChains, activeChains)
            : null
        if (nextChain) {
          evt = buildChainEvent(nextChain, 0, s.state.date.year)
          // 时光跳跃：只往前推、不回拨（与 useTurn.startTurn 同规则）
          if (evt.eventDate) store.updateState({ date: evt.eventDate })
        } else {
          evt = pickEvent(rng, s.state.attributes, biasShortfall)
        }
      }
      store.setEvent(evt)

      // 2. 玩家决策（选项本地应用 effects，不调 LLM）
      const opt = chooseOption(evt, s.state.attributes, s.state.resources)
      store.applyEffects(opt.effects)

      // 2.5 剧情链记账：末节点 → completed；否则把下一节点排到 turn+1
      if (useStoryChains && evt.chainId && evt.chainNodeId) {
        const chainId = evt.chainId
        const chain = SIM_CHAINS.find((c) => c.chainId === chainId)
        const nodeIndex = Number(evt.chainNodeId.replace('node-', '')) - 1
        if (chain && !activeChains.includes(chainId)) activeChains.push(chainId)
        if (chain && nodeIndex + 1 >= chain.nodeCount) {
          const i = activeChains.indexOf(chainId)
          if (i >= 0) activeChains.splice(i, 1)
          if (!completedChains.includes(chainId)) completedChains.push(chainId)
        } else if (chain) {
          pendingChain.push({ chainId, nodeId: `node-${nodeIndex + 2}`, scheduledTurn: turn + 1 })
        }
      }
      store.appendEvent({
        turn,
        eventType: evt.eventType,
        title: evt.title,
        description: evt.description,
        playerChoice: opt.label,
        effects: opt.effects
      })

      // 3. NPC 行动（mock LLM npc-actions）
      if (npcModel === 'simple') applySimpleNpc(store, rng)

      // 3.9 财政破产（银两 ≤ 0）：与 useTurn 同样**必须在产出之前判**，
      //     否则净产出为正时永远触发不了，回归会报出与真实游戏相反的结论
      store.applyEffects(calcBankruptcyPenalty(store.currentSave!.state.resources).effects)

      // 4. 回合资源净流转（产出 − 养饷）：与 useTurn.endTurn 同一时点读在编兵员
      store.applyEffects(calcTurnYield(store.currentSave!.state.resources.troops))

      // 4.5 断粮 / 兵溃：产出之后判（本回合补上了就不算断）
      const pen = calcResourcePenalty(store.currentSave!.state.resources)
      if (pen.reasons.length > 0) store.applyEffects(pen.effects)

      // 5. 玩家主动外交（每回合上限 1 次）
      if (useDiplomacy && tryDiplomacy(store)) diplomacyActions++

      // 6. 资源下限追踪
      const r = store.currentSave!.state.resources
      minResource = Math.min(minResource, r.silver, r.troops, r.food, r.reputation)
      minResources.silver = Math.min(minResources.silver, r.silver)
      minResources.troops = Math.min(minResources.troops, r.troops)
      minResources.food = Math.min(minResources.food, r.food)
      minResources.reputation = Math.min(minResources.reputation, r.reputation)

      // 6.5 「中兴已定」锁定：与 useTurn 3.8 同一时点、同一规则（首次达阈值只记年份不结束）
      const cur0 = store.currentSave!
      if (!cur0.zenithYear && calcOverallPower(cur0.state.attributes) >= VICTORY_THRESHOLD) {
        store.lockZenith(cur0.state.date.year)
      }

      // 7. 推进回合（turn+1，**date.year+1**：1 回合 = 1 年，month 恒为 1）
      const cur = store.currentSave!
      store.updateState({
        turn: cur.state.turn + 1,
        date: { year: cur.state.date.year + 1, month: 1 }
      })

      // 8. 结局判定（崩溃 > 1912 结算：胜利 / 时光尽头 > continue）
      const end = checkEndConditions(store.currentSave!)
      if (end !== 'continue') {
        store.markEnded(end as EndedReason)
        reason = end
        break
      }
    }
  } catch {
    crashed = true
    reason = 'crash'
  }

  const finalSave = store.currentSave!
  const power = calcOverallPower(finalSave.state.attributes)
  if (reason === 'continue') reason = 'no_victory'
  return {
    seed,
    reason,
    turns: finalSave.state.turn,
    power,
    attributes: { ...finalSave.state.attributes },
    minResource: crashed ? NaN : minResource,
    minResources: crashed ? { silver: NaN, troops: NaN, food: NaN, reputation: NaN } : minResources,
    diplomacyActions,
    chainsCompleted: completedChains.length,
    finalYear: finalSave.state.date.year
  }
}

// ====================== 批量采集 ======================
export interface SimReport {
  total: number
  /** 胜利局数 */
  wins: number
  /** 胜率（victory / total），50 回合内未胜利记为失败 */
  winRate: number
  /** 各结局维度计数（含 victory / 各 *collapse / time_up / no_victory / crash） */
  reasonCounts: Record<string, number>
  /** 胜利局的通关回合数 */
  victoryTurns: number[]
  avgTurns: number
  medianTurns: number
  minTurns: number
  maxTurns: number
  avgPower: number
  avgDiplomacyActions: number
  /** 全局资源下限（NaN 表示有崩溃局） */
  minResource: number
  /** 逐资源下限：聚合值分不清是银两还是兵员见底，而「谁归零」决定断粮/兵溃惩罚是否真会触发 */
  minResources: Resources
  /** 平均每局完成的剧情链数（未开链建模时为 0） */
  avgChainsCompleted: number
  /** 单局到达过的最晚年份：时光跳跃是否真的把日历推到了 1912 附近 */
  maxFinalYear: number
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base]
}

/**
 * 对一组种子批量模拟，聚合 胜率 / 通关回合分布 / 崩溃维度分布。
 * 复用同一 store 实例（每局 setSave 重置），确定性可复现。
 */
export function runBatch(
  store: ReturnType<typeof useGameStore>,
  seeds: number[],
  opts: Omit<SimOptions, 'seed'>
): SimReport {
  const outcomes = seeds.map((seed) => runSingleGame(store, { ...opts, seed }))
  const total = outcomes.length
  const victories = outcomes.filter((o) => o.reason === 'victory')
  const reasonCounts: Record<string, number> = {}
  for (const o of outcomes) {
    reasonCounts[o.reason] = (reasonCounts[o.reason] ?? 0) + 1
  }

  const victoryTurns = victories.map((o) => o.turns).sort((a, b) => a - b)
  const avg = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0)

  const minResourceVals = outcomes.map((o) => o.minResource).filter((v) => Number.isFinite(v))
  // 逐资源全局下限（跳过崩溃局的 NaN）：用于判断断粮/兵溃惩罚到底会不会在真实对局中触发
  const finite = outcomes.filter((o) => Number.isFinite(o.minResources.silver))
  const pick = (key: keyof Resources) =>
    finite.length ? Math.min(...finite.map((o) => o.minResources[key])) : NaN
  const minResources: Resources = {
    silver: pick('silver'),
    troops: pick('troops'),
    food: pick('food'),
    reputation: pick('reputation')
  }
  return {
    total,
    wins: victories.length,
    winRate: victories.length / total,
    reasonCounts,
    minResources,
    victoryTurns,
    avgTurns: avg(victoryTurns),
    medianTurns: quantile(victoryTurns, 0.5),
    minTurns: victoryTurns.length ? victoryTurns[0] : 0,
    maxTurns: victoryTurns.length ? victoryTurns[victoryTurns.length - 1] : 0,
    avgPower: avg(outcomes.map((o) => o.power)),
    avgDiplomacyActions: avg(outcomes.map((o) => o.diplomacyActions)),
    avgChainsCompleted: avg(outcomes.map((o) => o.chainsCompleted)),
    maxFinalYear: outcomes.length ? Math.max(...outcomes.map((o) => o.finalYear)) : 0,
    minResource: minResourceVals.length ? Math.min(...minResourceVals) : NaN
  }
}
