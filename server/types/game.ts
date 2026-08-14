/**
 * @file 服务端游戏类型定义
 *
 * 与前端 game-web/src/types/game.ts 镜像，独立维护避免跨工程依赖。
 * 修改任一处时必须同步另一处（spec 强制）。
 */

export type Background = '文官' | '武将' | '商贾' | '士绅' | '宗室'
export type EventType = '民生' | '军事' | '外交' | '随机' | '历史剧情' | 'npc'
export type FactionStatus = 'active' | 'destroyed' | 'allied'
export type NpcActionType = '扩张' | '结盟' | '备战' | '休养' | '挑衅' | '外交'
export type AdvisorRole = 'user' | 'assistant'

export interface Attributes {
  military: number
  economy: number
  politics: number
  people: number
  diplomacy: number
}

export interface Resources {
  silver: number
  troops: number
  food: number
  reputation: number
}

export interface GameDate {
  year: number
  month: number
}

export interface StateSnapshot {
  turn: number
  date: GameDate
  attributes: Attributes
  resources: Resources
}

export interface Faction {
  id: string
  name: string
  summary: string
  power: number
  relationship: number
  status: FactionStatus
  lastAction?: string
}

export interface EventOption {
  id: string
  label: string
  effects: Partial<Attributes & Resources>
  /** 选择该选项后下回合触发的剧情链节点 ID（仅剧情链事件有值） */
  nextChainNodeId?: string
}

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

/** 挂起的剧情链节点（存档中的运行时状态） */
export interface PendingChainNode {
  chainId: string
  nodeId: string
  /** 计划触发的回合数 */
  scheduledTurn: number
}

export interface HistoryEvent {
  turn: number
  eventType: EventType
  title: string
  description: string
  playerChoice: string
  effects: Partial<Attributes & Resources>
  /** 所属剧情链 ID（仅剧情链事件有值） */
  chainId?: string
  /** 所属剧情链节点 ID（仅剧情链事件有值） */
  chainNodeId?: string
}

export interface NpcAction {
  factionId: string
  factionName: string
  action: NpcActionType
  target?: string
  description: string
  effects: Partial<Attributes & Resources>
}

export interface AdvisorMessage {
  role: AdvisorRole
  content: string
  turn: number
  timestamp: number
}

export interface Character {
  background: Background
  backgroundPerks: Record<string, number>
  factionId: string
  factionName: string
  factionSummary: string
}

export interface GameSave {
  saveVersion: 2
  saveId: string
  deviceId: string
  createdAt: number
  updatedAt: number
  character: Character
  state: StateSnapshot
  factions: Faction[]
  events: HistoryEvent[]
  advisorMessages: AdvisorMessage[]
  /** 挂起的剧情链节点（玩家选择带 nextChainNodeId 的选项后入队） */
  pendingChainNodes: PendingChainNode[]
  /** 已完成的剧情链 ID */
  completedChainIds: string[]
  /** 进行中的剧情链 ID */
  activeChainIds: string[]
  ended: boolean
  endedAt?: number
  endedReason?: string
}
