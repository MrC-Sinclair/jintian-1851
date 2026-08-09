/**
 * @file 前端剧情链元数据镜像
 *
 * 与后端 `server/server/runtime/story-chains.ts` 保持 chainId / title / description /
 * 节点顺序一致，但**只含元数据**（不含节点 event 的完整 effects）。
 *
 * 设计取舍（见 openspec/changes/expand-event-engine/design.md D3 + T3.2/T4）：
 *   - 后端是剧情链的"真值来源"（含节点 event 与 effects），前端不可修改。
 *   - 前端只需：按 chainId 查标题、按节点顺序计算"第 X/Y 节"、判断是否为末节点、
 *     求下一节点 ID。这些都能从链的有序节点列表推导，无需复制 effects。
 *   - 为避免 42 节点 × effects 的双份维护漂移，前端仅镜像元数据；
 *     `tests/unit/story-chains-meta.test.ts` 校验元数据与后端 chainId/标题/节点数一致。
 *
 * 线性链约定（design.md D2）：MVP 阶段每条链节点严格按历史顺序排列，
 * "下一节点" = 有序列表中的下一个元素，末节点 = 列表最后一个。
 */

/** 单个剧情链节点的元数据（不含 event 细节） */
export interface ChainNodeMeta {
  /** 节点 ID（与后端 nodeId 一致） */
  nodeId: string
  /** 节点事件标题（与后端 event.title 一致，供 UI 展示"下一节点标题"） */
  title: string
}

/** 单条剧情链元数据 */
export interface ChainMeta {
  chainId: string
  title: string
  description: string
  /** 有序节点列表（按历史时间轴排列，长度 = 总节数） */
  nodes: ChainNodeMeta[]
}

/**
 * 14 条历史剧情链元数据（顺序与后端 STORY_CHAINS 一致）
 */
export const CHAIN_META: Record<string, ChainMeta> = {
  'tai-ping-tian-guo': {
    chainId: 'tai-ping-tian-guo',
    title: '太平天国兴亡',
    description: '洪秀全于广西金田举旗反清，建号太平天国，十四年兴衰，搅动半壁江山。',
    nodes: [
      { nodeId: 'node-1', title: '金田起义' },
      { nodeId: 'node-2', title: '定都天京' },
      { nodeId: 'node-3', title: '天京事变' },
      { nodeId: 'node-4', title: '安庆失守' },
      { nodeId: 'node-5', title: '天京陷落' }
    ]
  },
  'er-ci-ya-pian': {
    chainId: 'er-ci-ya-pian',
    title: '第二次鸦片战争',
    description: '亚罗号事件点燃战火，英法联军北上，焚圆明园，逼签北京条约，国门洞开更深。',
    nodes: [
      { nodeId: 'node-1', title: '亚罗号事件' },
      { nodeId: 'node-2', title: '大沽口之战' },
      { nodeId: 'node-3', title: '北京条约' }
    ]
  },
  'nian-jun-zhi-luan': {
    chainId: 'nian-jun-zhi-luan',
    title: '捻军之乱',
    description: '皖豫捻众聚散无常，流动作战十余年，赖湘淮诸军合力，方告荡平。',
    nodes: [
      { nodeId: 'node-1', title: '捻军起事' },
      { nodeId: 'node-2', title: '曾国藩督师' },
      { nodeId: 'node-3', title: '捻军覆灭' }
    ]
  },
  'tong-zhi-hui-luan': {
    chainId: 'tong-zhi-hui-luan',
    title: '同治回乱',
    description: '陕甘回众起事，连年兵燹，左宗棠平定西北，设新疆行省以固边圉。',
    nodes: [
      { nodeId: 'node-1', title: '陕甘回乱起' },
      { nodeId: 'node-2', title: '左宗棠平乱' },
      { nodeId: 'node-3', title: '收复西北' }
    ]
  },
  'yang-wu-yun-dong': {
    chainId: 'yang-wu-yun-dong',
    title: '洋务运动',
    description: '师夷长技以自强，设局造械、练新军、兴学堂，三十年求富求强，终验于甲午。',
    nodes: [
      { nodeId: 'node-1', title: '总理衙门设立' },
      { nodeId: 'node-2', title: '江南制造局' },
      { nodeId: 'node-3', title: '北洋水师成军' },
      { nodeId: 'node-4', title: '甲午战败' }
    ]
  },
  'zuo-zong-tang-xin-jiang': {
    chainId: 'zuo-zong-tang-xin-jiang',
    title: '左宗棠收复新疆',
    description: '阿古柏窃据新疆，俄英觊觎，左宗棠舆榇西征，力撑塞防，终复故土。',
    nodes: [
      { nodeId: 'node-1', title: '阿古柏入侵' },
      { nodeId: 'node-2', title: '海防塞防之争' },
      { nodeId: 'node-3', title: '收复伊犁' }
    ]
  },
  'liu-qiu-tai-wan': {
    chainId: 'liu-qiu-tai-wan',
    title: '琉球台湾事件',
    description: '琉球漂民遇害，日本借端兴兵犯台，清廷隐忍立约，琉球自此渐亡于日。',
    nodes: [
      { nodeId: 'node-1', title: '牡丹社事件' },
      { nodeId: 'node-2', title: '北京专条' }
    ]
  },
  'zhong-fa-zhan-zheng': {
    chainId: 'zhong-fa-zhan-zheng',
    title: '中法战争',
    description: '法图越南，战端起于中南半岛，马尾败绩而镇南关捷，不败而败，条约损权。',
    nodes: [
      { nodeId: 'node-1', title: '越南冲突' },
      { nodeId: 'node-2', title: '马尾海战' },
      { nodeId: 'node-3', title: '镇南关大捷' }
    ]
  },
  'jia-wu-zhan-zheng': {
    chainId: 'jia-wu-zhan-zheng',
    title: '甲午战争',
    description: '朝鲜东学党起事，中日兵戎相见，黄海喋血，马关签约，东亚格局为之一变。',
    nodes: [
      { nodeId: 'node-1', title: '朝鲜东学党' },
      { nodeId: 'node-2', title: '黄海海战' },
      { nodeId: 'node-3', title: '马关条约' }
    ]
  },
  'wu-xu-bian-fa': {
    chainId: 'wu-xu-bian-fa',
    title: '戊戌变法',
    description: '康有为梁启超倡维新，光绪下诏更法，百日而败，六君子血溅菜市口。',
    nodes: [
      { nodeId: 'node-1', title: '明定国是' },
      { nodeId: 'node-2', title: '戊戌政变' }
    ]
  },
  'yi-he-tuan': {
    chainId: 'yi-he-tuan',
    title: '义和团运动',
    description: '义和团"扶清灭洋"蔓延京津，引来八国联军，辛丑签约，国几不国。',
    nodes: [
      { nodeId: 'node-1', title: '义和团兴起' },
      { nodeId: 'node-2', title: '八国联军' },
      { nodeId: 'node-3', title: '辛丑条约' }
    ]
  },
  'ri-e-zhan-zheng': {
    chainId: 'ri-e-zhan-zheng',
    title: '日俄战争',
    description: '日俄争锋于东北，清廷宣告中立，战后日本继俄据南满，东北益危。',
    nodes: [
      { nodeId: 'node-1', title: '旅顺攻防' },
      { nodeId: 'node-2', title: '朴茨茅斯和约' }
    ]
  },
  'qing-mo-xin-zheng': {
    chainId: 'qing-mo-xin-zheng',
    title: '清末新政',
    description: '庚子后清廷推行新政，废科举、练新军、预备立宪，然皇族内阁失信，革命遂起。',
    nodes: [
      { nodeId: 'node-1', title: '庚子后变法' },
      { nodeId: 'node-2', title: '立宪运动' },
      { nodeId: 'node-3', title: '皇族内阁' }
    ]
  },
  'xin-hai-ge-ming': {
    chainId: 'xin-hai-ge-ming',
    title: '辛亥革命',
    description: '武昌枪声一响，各省响应，南北议和，清帝退位，两千年帝制终结。',
    nodes: [
      { nodeId: 'node-1', title: '武昌起义' },
      { nodeId: 'node-2', title: '南北议和' },
      { nodeId: 'node-3', title: '清帝退位' }
    ]
  }
}

/** 取剧情链元数据（不存在返回 null） */
export function getChainMeta(chainId: string): ChainMeta | null {
  return CHAIN_META[chainId] ?? null
}

/** 取节点在链中的索引（从 0 开始）；不存在返回 -1 */
export function getNodeIndex(chainId: string, nodeId: string): number {
  const meta = getChainMeta(chainId)
  if (!meta) return -1
  return meta.nodes.findIndex((n) => n.nodeId === nodeId)
}

/** 取节点事件标题（不存在返回 null） */
export function getNodeTitle(chainId: string, nodeId: string): string | null {
  const meta = getChainMeta(chainId)
  if (!meta) return null
  return meta.nodes.find((n) => n.nodeId === nodeId)?.title ?? null
}

/** 是否为末节点（线性链末节点 = 有序列表最后一个） */
export function isLastNode(chainId: string, nodeId: string): boolean {
  const meta = getChainMeta(chainId)
  if (!meta) return false
  const idx = meta.nodes.findIndex((n) => n.nodeId === nodeId)
  if (idx < 0) return false
  return idx === meta.nodes.length - 1
}

/** 取下一节点 ID（线性链 = 有序列表下一元素）；末节点或不存在返回 null */
export function getNextNodeId(chainId: string, nodeId: string): string | null {
  const meta = getChainMeta(chainId)
  if (!meta) return null
  const idx = meta.nodes.findIndex((n) => n.nodeId === nodeId)
  if (idx < 0 || idx + 1 >= meta.nodes.length) return null
  return meta.nodes[idx + 1].nodeId
}

/**
 * 计算剧情进度（第 current/total 节）
 * @returns { current, total }，节点不存在返回 null
 */
export function getChainProgress(
  chainId: string,
  nodeId: string
): { current: number; total: number } | null {
  const meta = getChainMeta(chainId)
  if (!meta) return null
  const idx = meta.nodes.findIndex((n) => n.nodeId === nodeId)
  if (idx < 0) return null
  return { current: idx + 1, total: meta.nodes.length }
}
