/**
 * @file 文案常量集中管理
 *
 * 统一管理游戏中所有面向玩家的文案，避免分散在各组件硬编码导致不一致。
 * 文案规范（design.md D6）：
 * - 功能性文案（按钮、提示、标签）用白话，确保新手秒懂
 * - 剧情文案（事件描述、结局、军师对话）保留古风营造氛围
 * - effects 标签用完整词（"军事+10"）而非单字缩写（"军+10"）
 *
 * 来源：原 openspec 提案 improve-ux-playability/tasks.md T1.1
 */

import { CHAIN_META } from '@/data/story-chains'
import type { PlayerDiplomacyAction } from '@/types/game'

/**
 * effects 属性/资源键 → 完整中文名映射
 *
 * 替代原 DecisionButton.vue / NpcActionList.vue 中分散的单字缩写 LABELS
 * （"军"→"军事"、"银"→"银两" 等），降低新玩家理解门槛。
 */
export const EFFECT_LABELS: Record<string, string> = {
  military: '军事',
  economy: '经济',
  politics: '政治',
  people: '民心',
  diplomacy: '外交',
  silver: '银两',
  troops: '兵员',
  food: '粮草',
  reputation: '名望'
}

/** 按钮文案（功能性，白话） */
export const BUTTON_TEXT = {
  startGame: '开始游戏',
  continueGame: '继续游戏',
  howToPlay: '如何游戏',
  syncSave: '同步存档',
  settings: '设置',
  advisor: '军师',
  confirmDecision: '确认决策',
  nextTurn: '下一回合',
  freeAction: '自由行动',
  back: '返回',
  close: '关闭',
  diplomacy: '外交',
  /** P0-4：事件推演失败后的重试按钮 */
  retryEvent: '重新推演'
} as const

/** 阶段提示（phaseHint，带目标版） */
export const PHASE_HINTS = {
  /** 等待决策 */
  awaitingDecision: '选择一个应对方案，或自己描述想做的事',
  /** 决策完成 */
  decided: '决策已定，进入下一回合',
  /** 推演中 */
  thinking: '局势推演中…',
  /** 存在危机时追加（{attr} 替换为属性中文名） */
  crisisSuffix: (attr: string) => `，${attr}濒临崩溃，建议优先应对`
} as const

/** 图标按钮 tooltip 文案（覆盖纯图标按钮） */
export const TOOLTIP_TEXT = {
  advisor: '军师对话',
  sync: '同步存档',
  back: '返回',
  settings: '设置',
  collapse: '折叠',
  expand: '展开',
  close: '关闭',
  send: '发送',
  /** P0-6 帮助入口 tooltip */
  help: '如何游戏'
} as const

/**
 * 势力关系文案（-100 ~ 100）
 *
 * 沿用 FactionCard.vue 原 formatRelationship 逻辑，5 档分级。
 */
export function formatRelationshipLabel(v: number): string {
  if (v > 50) return `盟友 +${v}`
  if (v > 0) return `友好 +${v}`
  if (v === 0) return '中立'
  if (v > -50) return `紧张 ${v}`
  return `敌对 ${v}`
}

/** 势力关系分级（用于颜色/样式判断） */
export type RelationshipLevel = 'ally' | 'friendly' | 'neutral' | 'tense' | 'hostile'

/** 根据关系值返回分级（用于样式判断，替代 FactionCard 内联逻辑） */
export function getRelationshipLevel(v: number): RelationshipLevel {
  if (v > 50) return 'ally'
  if (v > 0) return 'friendly'
  if (v === 0) return 'neutral'
  if (v > -50) return 'tense'
  return 'hostile'
}

/** NPC 行动类型文案（已是中文，此处集中管理便于扩展） */
export const NPC_ACTION_LABELS: Record<string, string> = {
  扩张: '扩张',
  结盟: '结盟',
  备战: '备战',
  休养: '休养',
  挑衅: '挑衅',
  外交: '外交'
}

/**
 * NPC 行动后果解释（供 NpcActionList 行动类型旁 InfoHint 使用）
 *
 * 解释该行动对玩家局势的潜在影响，帮助新手理解为何要关注。
 */
export const NPC_ACTION_EXPLANATIONS: Record<string, string> = {
  扩张: '扩张：势力正在扩张领土，可能威胁你的领地与资源产地，关系紧张时尤需警惕。',
  结盟: '结盟：势力之间结成同盟，可能联手对付你或其敌人，改变格局。',
  备战: '备战：势力整军备战，战争风险升高，邻接势力尤需防备。',
  休养: '休养：势力休养生息，恢复实力，暂时不会主动出击，是积蓄期。',
  挑衅: '挑衅：势力对你或他人挑衅，关系将迅速恶化，可能引发冲突。',
  外交: '外交：势力开展外交活动，可能拉拢盟友或孤立对手，影响你的处境。'
}

/**
 * 玩家主动外交动作文案（player-active-diplomacy 提案 T5，集中管理便于扩展）
 *
 * 已是中文，此处集中管理便于组件统一引用与后续调文案。
 */
export const DIPLOMACY_ACTION_LABELS: Record<PlayerDiplomacyAction, string> = {
  结盟: '结盟',
  宣战: '宣战',
  行贿: '行贿',
  通商: '通商',
  离间: '离间',
  质子: '质子'
}

/**
 * 外交动作禁用原因文案（P0-6：禁用原因提示）
 *
 * 点击禁用按钮时按具体原因给出针对性提示，替代笼统的"不可用"。
 * 判定顺序与 store.applyDiplomacyAction 二次校验一致，避免 UI 与后端口径漂移。
 */
export const DIPLOMACY_DISABLED_TEXT = {
  /** 回合推演中（防并发） */
  turnProcessing: '回合推演中，请稍候再试',
  /** 本回合外交次数已用尽 */
  actionQuotaUsed: '本回合外交次数已用尽，下回合可再次发动',
  /** 势力已灭 */
  factionDestroyed: (name: string) => `「${name}」已灭，无从外交`,
  /** 关系门槛不足（action 用中文动作名） */
  relationshipTooLow: (name: string, action: string, required: number) =>
    `与「${name}」关系不足，需达到 ${required} 才能发动「${action}」`,
  /** 资源不足（shortage 形如"银两 100"或"银两 100、兵员 50"） */
  resourceShortage: (shortage: string) => `资源不足：还差${shortage}`,
  /** 写信：本回合谈判次数已用尽 */
  letterQuotaUsed: '本回合谈判次数已用尽，下回合可再写信',
  /** 写信：势力已灭 */
  letterFactionDestroyed: (name: string) => `「${name}」已灭，无从通信`
} as const

/**
 * 玩家主动外交动作解释（供按钮 tooltip，帮助新手理解门槛与效果）
 */
export const DIPLOMACY_ACTION_EXPLANATIONS: Record<PlayerDiplomacyAction, string> = {
  结盟: '结盟：与势力结为盟友（需关系≥50、耗银两名望），大幅提升关系并锁定盟友状态。',
  宣战: '宣战：与势力开战，关系降至敌对（-100），下回合对方将转为挑衅/备战。',
  行贿: '行贿：贿赂势力（耗银两），小幅改善关系。',
  通商: '通商：开通贸易（耗银两），改善关系并提升名望。',
  离间: '离间：挑拨削弱目标势力实力（耗银两名望），降低其 power。',
  质子: '质子：送出质子（耗兵员），改善关系以示诚意。'
}

/** 事件类型文案（已是中文，此处集中管理便于扩展） */
export const EVENT_TYPE_LABELS: Record<string, string> = {
  民生: '民生',
  军事: '军事',
  外交: '外交',
  随机: '随机',
  历史剧情: '历史剧情',
  npc: 'NPC动态',
  系统: '系统'
}

/**
 * 术语解释文案（供 InfoHint 组件使用）
 *
 * 与 help 页百科内容保持一致，禁止多处硬编码不同解释。
 */
export const TERM_EXPLANATIONS = {
  // 5 维属性
  military: '军事：军队战力、装备水平、将领素质。影响战斗胜负、叛乱镇压。低于 30 濒临崩溃。',
  economy: '经济：财政收入、商业繁荣、税基厚薄。影响银两支撑、洋务兴办。低于 30 濒临崩溃。',
  politics: '政治：吏治清明、政令通畅、官僚效率。影响决策执行、科举选拔。低于 30 濒临崩溃。',
  people: '民心：百姓拥护、社会稳定。影响兵源补给、叛乱概率。低于 30 濒临崩溃。',
  diplomacy: '外交：与列强、邻省、朝廷关系。影响战争干预、外援争取。低于 30 濒临崩溃。',
  // 4 资源
  silver: '银两：货币储备，用于购械、赈灾、行贿。消耗后通过经济属性回复。',
  troops: '兵员：可调动兵力，影响军事行动规模。消耗后需招募补充。',
  food: '粮草：军粮民食，断粮会触发饥荒事件。消耗后需经济属性支撑补给。',
  reputation: '名望：朝野声望，影响 NPC 态度与结局评分。通过决策积累。',
  // 综合概念
  overallPower: '综合实力：5 维属性（军事+经济+政治+民心+外交）加权平均，政治与民心权重更高（治世之要），取值 0-100。达到 85 触发胜利结局。',
  relationship: '势力关系：-100（敌对）到 100（盟友），影响 NPC 对你的态度与行动。可通过决策与外交改善。',
  npcAction: '天下动静：每回合其他势力会自主行动（扩张、结盟、备战等），可能影响你的属性与资源。',
  eventType: '事件类型：每回合 AI 生成不同类型事件（民生/军事/外交/随机/历史剧情），需选择应对方案。',
  crisis: '危机预警：当某项属性低于 30 时触发，需尽快应对，否则属性归零将导致游戏失败。'
} as const

/** 空状态文案（白话化） */
export const EMPTY_TEXT = {
  npcActions: '本回合各方暂无行动',
  timeline: '还没有历史记录',
  advisor: '有问题可问我，比如"我该优先发展什么？""当前局势如何？"'
} as const

/**
 * 系统事件文案（资源产出机制提案）
 *
 * 每回合自动产出的资源以系统历史事件形式记录于 timeline，文案集中管理避免硬编码。
 */
export const SYSTEM_EVENT = {
  // 刻意不写死数字：银两是「产出 − 养饷」的净额，随在编兵员每回合变化，
  // 具体数额由该条历史事件的 effects 承载展示
  // 1 回合 = 1 年，故措辞用"本年"而非"本月"
  turnYield: '本年赋税入库、练兵补员，并按在编兵员发饷（兵多则饷重）',
  /** 势力实力归零 → 覆灭（game-design.md FactionStatus.destroyed 的触发条件） */
  factionDestroyed: '势力覆灭',
  /** 综合实力首次达阈值：锁定「中兴」评价，但游戏继续走到 1912 年结算 */
  zenithLocked: '中兴已定：实力臻于极盛，然天下大势仍在推移，须守住这副局面直到时局终了'
} as const

/**
 * NPC 行动累计影响文案（2026-08-06-npc-action-cumulative-impact）
 *
 * 汇总卡片标题与空态，集中管理避免组件硬编码。
 * 标题用于「天下动静」顶部"本回合累计影响"汇总卡；
 * 空态在累计值全 0 / 无有效 effects 时显示。
 */
export const NPC_CUMULATIVE_IMPACT = {
  title: '本回合累计影响',
  empty: '本回合各方按兵不动，暂无累计影响'
} as const

// ====================== 剧情链文案（expand-event-engine T4.4） ======================

/**
 * 剧情链 ID → 中文标题映射（与 STORY_CHAINS / CHAIN_META 一致）
 *
 * 由前端元数据镜像 CHAIN_META 派生，避免标题在 copywriting 与数据文件两处维护漂移。
 */
export const CHAIN_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(CHAIN_META).map((m) => [m.chainId, m.title])
)

/**
 * 剧情进度角标文案：「剧情 {current}/{total}」
 * 用于 EventCard 右上角角标、FocusPanel 待续提示等。
 */
export function CHAIN_PROGRESS_LABEL(current: number, total: number): string {
  return `剧情 ${current}/${total}`
}

/**
 * 剧情待续提示文案：「下回合将触发：{chainTitle} 第 {current}/{total} 节」
 * 用于 FocusPanel 顶部"剧情待续"提示条。
 */
export function CHAIN_PENDING_LABEL(
  chainTitle: string,
  current: number,
  total: number
): string {
  return `下回合将触发：${chainTitle} 第 ${current}/${total} 节`
}

/** 点击展开详情提示文案 */
export const CHAIN_EXPAND_LABEL = '点击查看详情'

/** 错误文案（白话化，技术错误码仅 console.error） */
export const ERROR_TEXT = {
  // P0-4：推演失败 toast 与阶段区提示文案区分（toast 即时提示，提示区带重试按钮）
  eventFailed: '局势推演未成功，请重试',
  eventRetryFailed: '局势推演失败，请检查网络后重试',
  networkError: '网络连接失败，请检查网络',
  advisorFailed: '军师暂时无法回应，可重新提问',
  startTurnFailed: '网络异常，请重试',
  briefingFailed: '局势简报生成失败，已使用默认建议'
} as const

/**
 * 各页面文案（T2.3 集中管理，替代各组件硬编码）
 *
 * 按页面/组件分组，便于查找与维护。
 */
export const PAGE_TEXT = {
  /** 首页文案 */
  index: {
    subtitle: '咸丰元年（1851年），天下动荡，你将扮演一方势力领袖成就霸业'
  },
  /** 角色创建页文案 */
  characterCreate: {
    factionLoading: '正在生成可选势力…',
    factionLoadingHint: 'AI 正在基于你的身份生成势力，约 3-8 秒'
  },
  /** game-main 文案 */
  gameMain: {
    freeActionTitle: '自由行动',
    freeActionPlaceholder: '请言明所欲为之事（最多 200 字）',
    freeActionCancel: '取消',
    freeActionSubmit: '提交',
    decisionApplied: '决策已应用',
    factionEffectTitle: '势力动向',
    /** 处理中 spinner 兜底文案（选项决策等未设置具体阶段时显示） */
    processingFallback: '推演中…'
  },
  /** EventCard 文案 */
  eventCard: {
    optionsTitle: '应对方案',
    /** 剧情链事件提示：选择方案或自由行动均可推进剧情（仅 chainId 事件显示） */
    chainHint: '历史剧情：选择应对方案或自由行动回应后，剧情将推进'
  },
  /** AdvisorDrawer 文案 */
  advisorDrawer: {
    placeholder: '描述你想问的问题'
  },
  /** 信息分区标题（T2.2 CollapsibleSection 用） */
  sections: {
    status: '状态',
    timeline: '近况时间线',
    npcActions: '天下动静'
  },
  /** 同步存档冲突确认（index/settings/game-main 共用，避免三处重复硬编码） */
  syncConfirm: {
    title: '云端存档较新',
    message: (cloudDate: string) => `云端存档更新时间：${cloudDate}\n是否拉取覆盖本地？`,
    pull: '拉取云端',
    keep: '保留本地'
  },
  /** 设置页·云端存档列表（多存档管理） */
  saveList: {
    title: '云端存档',
    refresh: '刷新',
    empty: '暂无云端存档，可在游戏中手动同步上传',
    loadFailed: '存档列表拉取失败',
    switch: '切换',
    export: '导出',
    delete: '删除',
    endedBadge: '已结局',
    inProgressBadge: '进行中',
    turnLabel: (turn: number) => `回合 ${turn}`,
    switchConfirm: {
      title: '切换存档',
      message: (name: string) =>
        `切换到「${name}」将覆盖当前本地进度（云端不受影响）。\n\n确认切换？`
    },
    deleteConfirm: {
      title: '删除云端存档',
      message: (name: string) =>
        `将永久删除「${name}」的云端存档${'，'}本地同步副本一并清除。\n\n此操作不可恢复，确认删除？`
    },
    switchDone: '存档已切换',
    deleteDone: '存档已删除',
    exportHint: '存档 JSON 已复制到剪贴板，可粘贴到聊天/备忘录备份',
    importFailedPrefix: '导入失败'
  }
} as const
