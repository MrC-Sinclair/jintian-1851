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
 *   - 回合结算：applyEffects(选项) → 可选 NPC → applyEffects(TURN_YIELD) → 可选外交 →
 *     turn+1 → checkEndConditions。效果应用路径与真实 useTurn 一致（不含 storage/save）。
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
import { CRISIS_THRESHOLD } from '../../src/utils/constants'

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
  /** 最大推演回合数（C1 默认 50） */
  maxTurns?: number
  /** 是否叠加玩家主动外交（player-active-diplomacy 提案） */
  useDiplomacy?: boolean
  /** 是否偏向短板事件（模拟 event-weight-dynamic-adjust 的 LLM 行为） */
  biasShortfall?: boolean
  /** NPC 模型：'none' 等价 LLM 失败降级为空；'simple' 轻量压力模型 */
  npcModel?: 'none' | 'simple'
}

export interface SimOutcome {
  seed: number
  reason: SimReason
  turns: number
  power: number
  attributes: Attributes
  minResource: number
  diplomacyActions: number
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
  const { seed, maxTurns = 50, useDiplomacy = true, biasShortfall = false, npcModel = 'none' } = opts
  const rng = makeRng(seed)
  store.setSave(buildSimSave())
  store.resetDiplomacy()

  let diplomacyActions = 0
  let minResource = Infinity
  let reason: SimReason = 'continue'
  let crashed = false

  try {
    for (let t = 0; t < maxTurns; t++) {
      const s = store.currentSave!
      const turn = s.state.turn
      store.resetDiplomacy()

      // 1. 事件（mock LLM generate-event）
      const evt = pickEvent(rng, s.state.attributes, biasShortfall)
      store.setEvent(evt)

      // 2. 玩家决策（选项本地应用 effects，不调 LLM）
      const opt = chooseOption(evt, s.state.attributes, s.state.resources)
      store.applyEffects(opt.effects)
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

      // 4. 回合资源自动产出（resource-per-turn-yield 提案）
      store.applyEffects(calcTurnYield())

      // 5. 玩家主动外交（每回合上限 1 次）
      if (useDiplomacy && tryDiplomacy(store)) diplomacyActions++

      // 6. 资源下限追踪
      const r = store.currentSave!.state.resources
      minResource = Math.min(minResource, r.silver, r.troops, r.food, r.reputation)

      // 7. 推进回合（turn+1，date 月份+1）
      const cur = store.currentSave!
      const nextMonth = cur.state.date.month + 1
      const nextDate =
        nextMonth > 12
          ? { year: cur.state.date.year + 1, month: 1 }
          : { year: cur.state.date.year, month: nextMonth }
      store.updateState({ turn: cur.state.turn + 1, date: nextDate })

      // 8. 结局判定（崩溃 > 胜利 > 时光尽头 > continue）
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
    diplomacyActions
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
  return {
    total,
    wins: victories.length,
    winRate: victories.length / total,
    reasonCounts,
    victoryTurns,
    avgTurns: avg(victoryTurns),
    medianTurns: quantile(victoryTurns, 0.5),
    minTurns: victoryTurns.length ? victoryTurns[0] : 0,
    maxTurns: victoryTurns.length ? victoryTurns[victoryTurns.length - 1] : 0,
    avgPower: avg(outcomes.map((o) => o.power)),
    avgDiplomacyActions: avg(outcomes.map((o) => o.diplomacyActions)),
    minResource: minResourceVals.length ? Math.min(...minResourceVals) : NaN
  }
}
