# ai-event-engine 规格变更（历史锚点补齐 14→23）

## MODIFIED Requirements

### Requirement: 历史剧情链数据文件

服务端 MUST 维护 `server/server/runtime/story-chains.ts`，导出 23 条预定义历史剧情链。

#### Scenario: 剧情链数据结构

WHEN 检查 `story-chains.ts` 的 `STORY_CHAINS` 导出
THEN 包含 23 条剧情链，覆盖 1851-1912 关键历史节点
AND 每条剧情链结构：
  ```typescript
  {
    chainId: string              // 唯一 ID，如 'tai-ping-tian-guo'
    title: string                // 剧情链名，如"太平天国兴亡"
    description: string          // 剧情链简介
    startYear: number            // 触发起始年份（如 1851）
    endYear: number              // 触发结束年份（如 1864）
    nodes: ChainNode[]           // 节点列表，至少 2 个
    prerequisiteChainIds?: string[]  // 前置剧情链 ID（可选）
  }
  ```

#### Scenario: 节点数据结构

WHEN 检查 `ChainNode` 结构
THEN 每节点含：
  ```typescript
  {
    nodeId: string               // 节点 ID，剧情链内唯一
    triggerTurnOffset: number    // 相对剧情链首节点的回合偏移（首节点为 0）
    event: GameEvent             // 节点事件（含 title/description/options/effects）
    nextNodeIds: string[]        // 下一节点 ID 数组（MVP 阶段为单元素数组）
    isLastNode: boolean          // 是否为最后节点（用于标记剧情链完成）
  }
  ```
AND `event.options[].nextChainNodeId`（可选）—— 选择该选项后下回合触发的节点 ID，若不填则按 `nextNodeIds[0]` 默认推进

#### Scenario: 23 条剧情链清单

WHEN 检查 `STORY_CHAINS` 数组
THEN 必须包含以下 23 条剧情链（chainId → title → startYear → 节点数）：
  - `tai-ping-tian-guo` → 太平天国兴亡 → 1851 → 5 节点
  - `er-ci-ya-pian` → 第二次鸦片战争 → 1856 → 3 节点
  - `nian-jun-zhi-luan` → 捻军之乱 → 1853 → 3 节点
  - `tong-zhi-hui-luan` → 同治回乱 → 1862 → 3 节点
  - `yang-wu-yun-dong` → 洋务运动 → 1861 → 4 节点
  - `zuo-zong-tang-xin-jiang` → 左宗棠收复新疆 → 1865 → **4 节点**（后补「新疆建省」）
  - `liu-qiu-tai-wan` → 琉球台湾事件 → 1871 → **4 节点**（后补「废琉置县」「台湾建省」）
  - `zhong-fa-zhan-zheng` → 中法战争 → 1883 → 3 节点
  - `jia-wu-zhan-zheng` → 甲午战争 → 1894 → 3 节点
  - `wu-xu-bian-fa` → 戊戌变法 → 1898 → 2 节点
  - `yi-he-tuan` → 义和团运动 → 1899 → 3 节点
  - `ri-e-zhan-zheng` → 日俄战争 → 1904 → 2 节点
  - `qing-mo-xin-zheng` → 清末新政 → 1901 → 3 节点
  - `xin-hai-ge-ming` → 辛亥革命 → 1911 → 3 节点
  - `min-yong-gong-shang` → 民用工矿与商股 → 1872 → 3 节点
  - `tong-zhi-guang-xu` → 同光接替 → 1874 → 3 节点
  - `yan-tai-tiao-yue` → 滇案与烟台条约 → 1875 → 2 节点
  - `ding-wu-qi-huang` → 丁戊奇荒 → 1876 → 3 节点
  - `ren-wu-jia-shen` → 朝鲜壬午甲申 → 1882 → 3 节点
  - `jia-shen-yi-shu` → 甲申易枢 → 1884 → 2 节点
  - `zhong-gu-ao-men` → 中葡北京条约 → 1887 → 2 节点
  - `guang-xu-da-hun` → 大婚与亲政 → 1889 → 2 节点
  - `xing-zhong-hui` → 兴中会前夜 → 1892 → 2 节点
AND 测试 MUST NOT 硬编码条数：链清单从 `STORY_CHAINS` 取，条数随之变化
    （此前 `story-chains-meta.test.ts` 与 `copywriting.test.ts` 把 14 写死，一补链就静默过期）

#### Scenario: 前置剧情链依赖

WHEN 检查 `prerequisiteChainIds` 字段
THEN 以下 9 组剧情链必须有前置依赖：
  - `jia-wu-zhan-zheng` 前置 `yang-wu-yun-dong`（甲午战败需要洋务运动先发生）
  - `yi-he-tuan` 前置 `wu-xu-bian-fa`（义和团兴起与戊戌变法失败有关）
  - `qing-mo-xin-zheng` 前置 `yi-he-tuan`（庚子后变法是辛丑条约的直接后果）
  - `xin-hai-ge-ming` 前置 `qing-mo-xin-zheng`（皇族内阁失望引发革命）
  - `min-yong-gong-shang` 前置 `yang-wu-yun-dong`（民用工矿起于洋务厂局之后）
  - `tong-zhi-guang-xu` 前置 `tong-zhi-hui-luan`（同治朝的终结以其标榜的回乱平定为界）
  - `yan-tai-tiao-yue` 前置 `er-ci-ya-pian`（滇案是第二次鸦片战争后续约压力的延续）
  - `jia-shen-yi-shu` 前置 `yang-wu-yun-dong`（中枢改组是洋务失去统筹者的直接后果）
  - `guang-xu-da-hun` 前置 `jia-shen-yi-shu`（大婚亲政的帝党后党之分源于新中枢班底）

## ADDED Requirements

### Requirement: 历史锚点不得留下十年级断档
`STORY_CHAINS` 的 `startYear` 集合 MUST 保证 1851—1912 之间**不存在 10 年以上的空档**，
单测 SHALL 计算最大断档并断言其上界。

#### Scenario: 两段已知的十年洞必须被填
- **WHEN** 取所有 `startYear` 落在 1872—1882 / 1884—1893 的链
- **THEN** 两段各至少 5 条 / 4 条（补齐前两段均为 **0 条**，1871 与 1883 是两个孤立锚点）

#### Scenario: 最大断档有界且失败信息可定位
- **WHEN** 排序后的相邻锚点间隔超过上界（当前 7 年）
- **THEN** 测试失败，并在消息里报出是哪一年到哪一年
- **AND** 当前最大断档是 1904→1911（1905—1910 废科举/同盟会/预备立宪/国会请愿/保路仍未成链）

### Requirement: 既有链的触发时机不得被悄悄改变
新增剧情链 MAY 声明 `prerequisiteChainIds`，但 MUST NOT 给**已上线的链**新增前置。

#### Scenario: 为什么禁止
- **WHEN** 有人想给一条既有链补前置以让剧情更连贯
- **THEN** 不予采纳 —— 既有链原本是「到年份即触发」，加前置后变成「等前置跑完才触发」，
      这是玩家可感知的行为变更，必须单独立项并重跑平衡，不能夹在内容补齐里做

### Requirement: 前端链元数据镜像必须含 startYear 并被守卫
`game-web/src/data/story-chains.ts` 的 `ChainMeta` MUST 含 `startYear`，
且 `mirror-consistency.test.ts` SHALL 逐链深比对 chainId / title / description / **startYear** / 节点顺序与节点标题。

#### Scenario: 漂移的后果由测试承担
- **WHEN** 服务端改了某条链的标题、简介、`startYear` 或增删了节点
- **THEN** 镜像守卫失败并指出具体链与字段
- **AND** `CHAIN_LABELS`（事件卡/时间线的链名映射）由 `CHAIN_META` **派生**，
      所以它不会成为第三份需要手工维护的副本

### Requirement: 同主题内容不得重复登场
新增节点或新链若与既有链的某节主题相同，MUST 先收紧既有节点的文案，或改为在既有链上扩节点。

#### Scenario: 实例：1884 新疆建省
- **WHEN** 要为「1884 新疆建省」补内容
- **THEN** 不新开链 —— 既有「收复伊犁」节点的 description 里**已写着**"新疆建省"、
      选项 a 原名"筹边建省安民"，另开一条会同题读两遍
- **AND** 做法是把该节点文案收紧为只讲改约，再把建省续成该链第 4 节

#### Scenario: 实例：民用工业与洋务运动
- **WHEN** 新链 `min-yong-gong-shang` 与既有 `yang-wu-yun-dong` 年代相邻
- **THEN** 以「军用厂局 vs 民用商股」显式分工，节点标题与文案不得互相覆盖（江南制造局 / 轮船招商局）
