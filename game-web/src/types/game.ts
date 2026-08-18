/**
 * @file 游戏类型定义
 *
 * 来源：design.md D6 + specs/local-save/ai-event-engine/ai-npc-faction/character-creation spec.md
 */

/** 玩家身份（开局选择，5 类） */
export type Background = '文官' | '武将' | '商贾' | '士绅' | '宗室'

/** 事件类型（5 类 + npc 用于历史记录 + 系统用于回合自动产出记录） */
export type EventType = '民生' | '军事' | '外交' | '随机' | '历史剧情' | 'npc' | '系统'

/** 势力状态 */
export type FactionStatus = 'active' | 'destroyed' | 'allied'

/** NPC 行动类型 */
export type NpcActionType = '扩张' | '结盟' | '备战' | '休养' | '挑衅' | '外交'

/** 玩家主动外交动作（与 NPC 的 NpcActionType 区分，来源：player-active-diplomacy 提案） */
export type PlayerDiplomacyAction = '结盟' | '宣战' | '行贿' | '通商' | '离间' | '质子'

/** 军师对话角色 */
export type AdvisorRole = 'user' | 'assistant'

/**
 * 结局类型
 * - 'continue' 表示游戏继续（非真正结局）
 * - 其余为真正结局，触发后存档标记 ended=true
 */
export type EndReason =
  | 'continue'
  | 'military_collapse'
  | 'economy_collapse'
  | 'politics_collapse'
  | 'people_collapse'
  | 'diplomacy_collapse'
  | 'victory'
  | 'time_up'

/** 已触发的结局类型（排除 'continue'） */
export type EndedReason = Exclude<EndReason, 'continue'>

/** 5 维属性 */
export interface Attributes {
  military: number
  economy: number
  politics: number
  people: number
  diplomacy: number
}

/** 4 资源 */
export interface Resources {
  silver: number
  troops: number
  food: number
  reputation: number
}

/** 游戏内时间（按月推进，1851-1 ~ 1912-12） */
export interface GameDate {
  year: number
  month: number
}

/** 状态快照（用于 LLM 上下文 + 缓存键计算，不含 events/advisorMessages） */
export interface StateSnapshot {
  turn: number
  date: GameDate
  attributes: Attributes
  resources: Resources
}

/** 势力（NPC） */
export interface Faction {
  id: string
  name: string
  summary: string
  power: number
  relationship: number
  status: FactionStatus
  /** 最近一次行动描述（用于历史展示，可选） */
  lastAction?: string
}

/** 事件选项（含预定义 effects，玩家选择后直接应用） */
export interface EventOption {
  id: string
  label: string
  effects: Partial<Attributes & Resources>
  /** 选择该选项后下回合触发的剧情链节点 ID（仅剧情链事件有值） */
  nextChainNodeId?: string
}

/** AI 生成的事件结构（generate-event 接口返回） */
export interface GameEvent {
  title: string
  description: string
  eventType: Exclude<EventType, 'npc'>
  options: EventOption[]
  /** 本事件所属剧情链 ID（仅剧情链事件有值） */
  chainId?: string
  /** 本节点 ID（仅剧情链事件有值） */
  chainNodeId?: string
  /** 剧情进度（如 2/5，仅剧情链事件有值） */
  chainProgress?: { current: number; total: number }
}

/** 历史事件记录（GameSave.events 数组元素） */
export interface HistoryEvent {
  turn: number
  eventType: EventType
  title: string
  description: string
  /** 玩家最终选择（resolve-decision 返回的选项 title 或自由输入摘要） */
  playerChoice: string
  /** 玩家决策应用的最终 effects（T2.9 补充，向后兼容：旧存档可能无此字段） */
  appliedEffects?: Partial<Attributes & Resources>
  /** 玩家决策应用的最终 effects（保留旧字段名兼容，新代码应优先用 appliedEffects） */
  effects: Partial<Attributes & Resources>
  /** 所属剧情链 ID（仅剧情链事件有值） */
  chainId?: string
  /** 所属剧情链节点 ID（仅剧情链事件有值） */
  chainNodeId?: string
}

/**
 * 自由行动对势力的「软性微调」结果（resolve-decision 出参 factionEffects 元素）
 *
 * 来源：/api/game/resolve-decision 的 data.factionEffects
 * 约束（后端 design.md D2）：仅 relationshipDelta（±20）/powerDelta（±30），禁止改 status
 */
export interface FreeFactionEffect {
  factionId: string
  relationshipDelta?: number
  powerDelta?: number
}

// ====================== 谈判（faction-negotiation 提案） ======================

/** 谈判表态：应允 / 拒绝 / 还价（仅 letter 阶段可返回 counter） */
export type NegotiationStance = 'accept' | 'reject' | 'counter'

/** 兑换表 deal id（与 server/server/utils/negotiation-deals.ts 镜像） */
export type NegotiationDealId = 'gift-deal' | 'trade-deal' | 'truce-deal' | 'alliance-deal'

/** Agent 提出的条件（dealId ∈ 兑换表，price 为 silver 定价，后端已 clamp 区间） */
export interface NegotiationDeal {
  dealId: NegotiationDealId
  price: number
}

/**
 * faction-negotiate 出参（两阶段同构，settle 无 deal 字段）
 * 来源：/api/game/faction-negotiate 的 data
 */
export interface FactionNegotiateResponse {
  stance: NegotiationStance
  /** 回信（≤200 字） */
  reply: string
  /** 信件软性关系影响（后端已 clamp ±10） */
  relationshipDelta: number
  /** 仅 letter 阶段 stance='counter' 时存在 */
  deal?: NegotiationDeal
}

/** NPC 行动（npc-actions 接口返回） */
export interface NpcAction {  factionId: string
  factionName: string
  action: NpcActionType
  /** 行动目标（扩张目标地、结盟对象等，可选） */
  target?: string
  description: string
  /** 对玩家势力的影响（可选） */
  effects: Partial<Attributes & Resources>
}

/** 军师对话消息 */
export interface AdvisorMessage {
  role: AdvisorRole
  content: string
  turn: number
  timestamp: number
  /**
   * T2.6：标记为局势简报消息
   *
   * 由 useTurn.startTurn 获取 advisor-briefing 后，AdvisorDrawer 打开时自动插入一条
   * assistant 消息并置 isBriefing=true。渲染时显示「局势简报」角标 + 浅色背景区分。
   * 旧存档消息无此字段，按普通消息渲染（向后兼容）。
   */
  isBriefing?: boolean
}

/** 玩家身份与势力信息 */
export interface Character {
  background: Background
  /** 身份带来的初始属性偏移 */
  backgroundPerks: Record<string, number>
  factionId: string
  factionName: string
  /** 势力简介（AI 生成） */
  factionSummary: string
}

/** 挂起的剧情链节点（存档中的运行时状态） */
export interface PendingChainNode {
  chainId: string
  nodeId: string
  /** 计划触发的回合数 */
  scheduledTurn: number
}

/** 剧情链节点 */
export interface ChainNode {
  nodeId: string
  /** 相对剧情链首节点的回合偏移（首节点为 0） */
  triggerTurnOffset: number
  event: GameEvent
  /** 下一节点 ID 数组（MVP 阶段为单元素数组，预留 DAG 扩展） */
  nextNodeIds: string[]
  /** 是否为最后节点（用于标记剧情链完成） */
  isLastNode: boolean
}

/** 历史剧情链 */
export interface StoryChain {
  chainId: string
  title: string
  description: string
  /** 触发起始年份 */
  startYear: number
  /** 触发结束年份 */
  endYear: number
  nodes: ChainNode[]
  /** 前置剧情链 ID（可选，需全部完成后才能触发本链） */
  prerequisiteChainIds?: string[]
}

/** 本地存档结构（版本化） */
export interface GameSave {
  /** 存档结构版本，便于后续迁移 */
  saveVersion: 2
  /** UUID，云端同步主键 */
  saveId: string
  /** 设备指纹 */
  deviceId: string
  /** 存档创建时间戳 */
  createdAt: number
  /** 最后修改时间戳（本地，与云端 updated_at 不同步） */
  updatedAt: number

  character: Character
  state: StateSnapshot
  factions: Faction[]
  /** 历史事件（最近 50 条） */
  events: HistoryEvent[]
  /** 军师对话（最近 20 条） */
  advisorMessages: AdvisorMessage[]

  /** 挂起的剧情链节点（玩家选择带 nextChainNodeId 的选项后入队） */
  pendingChainNodes: PendingChainNode[]
  /** 已完成的剧情链 ID */
  completedChainIds: string[]
  /** 进行中的剧情链 ID */
  activeChainIds: string[]

  /** 结局标志（与 endedAt/endedReason 同步设置） */
  ended: boolean
  /** 游戏结束时间戳（仅 ended=true 时有值） */
  endedAt?: number
  /** 结局原因（仅 ended=true 时有值） */
  endedReason?: EndedReason
}

/**
 * AI 局势简报结果（T2.9 新增）
 *
 * 来源：/api/game/advisor-briefing 接口返回的 data 字段
 * 消费：FocusPanel 展示 suggestion，AdvisorDrawer 插入"局势简报"消息
 */
export interface BriefingResult {
  /** 局势摘要（一句话概述当前局势，可选展示） */
  summary: string
  /** AI 给出的本回合建议（覆盖 FocusPanel 的规则 suggestion） */
  suggestion: string
}

/**
 * 新手引导步骤（T2.9 新增，re-export 自 OnboardingOverlay 组件）
 *
 * 来源：components/OnboardingOverlay.vue 中的 OnboardingStep
 * 集中到 types/game.ts 便于其他模块引用
 */
export type { OnboardingStep } from '@/components/OnboardingOverlay.vue'

/**
 * 当前焦点提示（T2.9 新增，re-export 自 goal-hint 工具）
 *
 * 来源：utils/goal-hint.ts 中的 FocusHint
 * 包含综合实力、危机预警、规则建议
 */
export type { FocusHint } from '@/utils/goal-hint'
