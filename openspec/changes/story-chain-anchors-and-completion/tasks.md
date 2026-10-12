# 任务：补齐 1872—1893 历史锚点 + 链完成度进结局

> 验证命令与结果如实记录，未执行的项标注为未做而非打勾。

## 1. 服务端链内容（14→23 条链、42→67 节点）

- [x] 新增 9 条链：`min-yong-gong-shang`(1872/3)、`tong-zhi-guang-xu`(1874/3)、
      `yan-tai-tiao-yue`(1875/2)、`ding-wu-qi-huang`(1876/3)、`ren-wu-jia-shen`(1882/3)、
      `jia-shen-yi-shu`(1884/2)、`zhong-gu-ao-men`(1887/2)、`guang-xu-da-hun`(1889/2)、
      `xing-zhong-hui`(1892/2)
- [x] 后补 3 个节点：左宗棠链 +「新疆建省」(node-4)、琉球链 +「废琉置县」(node-3) +「台湾建省」(node-4)
- [x] **中途纠偏**：原计划为 1884「新疆建省」开新节点，动手前发现既有「收复伊犁」节点的
      description 里**已经写着**"新疆建省"、选项 a 就叫"筹边建省安民" —— 直接加会同题读两遍。
      改法：先把原节点文案收紧为只讲改约（选项 a 改「筹边改约保疆土」），再把建省续成第 4 节
- [x] 新增 5 组前置依赖（**只挂在新链上，不给任何既有链补前置**）：
      `min-yong-gong-shang`/`jia-shen-yi-shu` → `yang-wu-yun-dong`；`tong-zhi-guang-xu` → `tong-zhi-hui-luan`；
      `yan-tai-tiao-yue` → `er-ci-ya-pian`；`guang-xu-da-hun` → `jia-shen-yi-shu`。前置组数 4→9
- [x] `endYear` 顺带更正（左宗棠 1878→1884、琉球 1874→1885）。核实过该字段**当前无任何消费者**
      （`grep endYear` 只命中类型定义与本文件），改它不影响触发
- [x] 文件头计数 14→23，并写明「数组顺序不是触发顺序」（服务端按 `startYear >= 当前年` 排序取链）
- [x] 两处选项/文案错字自查更正（「儇取巧」→「儆取巧」、「铑政」→「用人行政」）

## 2. 前端链元数据镜像同步

- [x] `src/data/story-chains.ts` 的 `CHAIN_META` 由**脚本从服务端生成**后拼接（23 条 / 67 节点），
      不手抄 —— 手写这个体量必错，而抄错正是守卫要防的事
- [x] `ChainMeta` 新增 `startYear` 字段（完成度分母要用），注释写明与后端一致
- [x] `mirror-consistency.test.ts` 增加 `startYear` 逐链比对；文件头点名的"第三处镜像"
      （`balance-sim` 的 `SIM_CHAINS`）与它实际覆盖的两处不符 → 一并更正
- [x] `CHAIN_LABELS`（事件卡 / 时间线的链名）**无需改动**：它由 `CHAIN_META` 派生，自动覆盖 23 条

## 3. 完成度进结局（A+B 方案：派生展示，不动判定）

- [x] `end-conditions.ts` 新增 `getChainCompletion(save | null)` / `getChainTier(completion)` + 三档称号
- [x] 分母 = **终局年份之前可达链数**（不是 23）；`completed` 只取「可达 ∩ 已完成」
- [x] `reachable < 3` 或 `completed === 0` → 不给称号（1/1=100% 不该被吹成满级）
- [x] `save === null` 返回全零结构（结局页 `save` 是 `onMounted` 才载入的，模板要能直接取值）
- [x] 结局页新增「历史进程」块：`亲历 N/M 段史事（至 X 年）` + 称号 + 中文链名 + 未收束段数，附 6 个 SCSS 类
- [x] **刻意不做**：不改 `endedReason` 枚举、不落库、不进 `checkEndConditions`
      （`ended_reason` 虽是自由 TEXT 能塞新值，但会牵动两张 `Record<EndedReason,…>` 文案表、
      `isFailureEnd` 配色、既有存档可读性，收益不值）

## 4. 模拟与基线重标定

- [x] `tests/sim/balance-sim.ts` 的 `SIM_CHAINS` 同样由脚本从服务端生成后拼接（23 条链 67 节点）
- [x] `sim-chain-mirror.test.ts` 3 用例全绿（结构 + 逐节点逐选项 effects 深比对）
- [x] **关链基线逐位不变**：86.0% / avgTurns 37.5 / median 37 / [23,51] / 银两0·兵员15·粮草160·名望0
- [x] 开链重标定：100.0% / 22.0 / **[22,22]** / 链完成 **5.00**（原 6.00，因左宗棠链多了一节没跑完）/
      最晚年份仍 1865 / 银两668·兵员115·粮草800·名望19
- [x] 开链 + simple NPC：由 100.0%/42.6/13.47/1911 变为 **98.5%/46.0/[29,51]/13.79/1892**（3 局不胜）
- [x] 关链 + simple NPC：7.0% / 47.4 / 1855（不变）
- [x] 四组数字写入 `balance-regression.test.ts` 文件头快照，并记下一条**关键负结果**：
      ⚠️ 14→23 条链之后开链定局的 22.0 / [22,22] / 1865 **一个数都没变** ——
      新锚点全在 1865 年以后，而游戏在 1865 就结束了。补内容既没加重也没治好挤占，
      它治不好，只有密度闸门能治。这条是 #4 交付给设计侧的最硬证据
- [x] 对比用例的注释同步（6/14 → 5/23）

## 5. 测试

- [x] server `story-chains.test.ts`：清单与前置表更新，**新增 2 条断档守卫**
      （两段十年洞各 ≥5/≥4 条；最大断档 ≤7 年且失败消息报出年份）→ 9 用例全绿
- [x] **新增 `server/tests/unit/story-chain-tradeoffs.test.ts`**：把 #5 为兜底事件池建的
      「严格占优选项」检测器复用到剧情链上。首跑抓到 **9 处占优**，其中 8 处是我这次新写的选项
      （改法：给被压制的选项补一项只有它才有的收益，如「缓议建省以节经费」补 `silver:+200`、
      「阴附后府以固其位」政治 4→7），修完后守卫范围内 0 违规
      - 余下 1 处是**既有债**：`liu-qiu-tai-wan/node-1`「遣使诘问日本」占优于「隐忍回避争端」，
        与 #5 的处理口径一致 —— 记录并豁免，不夹在内容补齐里改已上线数值
      - 守卫范围显式限定为「9 条新链 + 3 个后补节点」，并自带 4 条自检用例（含"缺维度按 0 比较"）
- [x] 修完 effects 后**镜像守卫当场变红**（`链 liu-qiu-tai-wan 第 3 节选项 c effects 漂移`），
      重新生成 SIM_CHAINS 后转绿 —— 这是 #11 那道守卫第一次真的发挥作用，不是摆设
- [x] game-web `end-conditions.test.ts`：新增 9 条完成度用例，含
      **关键不变量「完成度高低完全不改变 `checkEndConditions` 结果」**
- [x] 顺手拆掉三处硬编码链数的维护税：`story-chains-meta.test.ts` 写死 14、`copywriting.test.ts`
      写死 14 → 改为从服务端真值派生比对（一补链就红不是断言有效，是维护税）
- [x] 顺手更正 `end-conditions.test.ts` 里两处「阈值 90」的过期标题/注释（实际阈值 85 已改过好几个月）
- [x] `npm run test:unit`（game-web）= 0：**29 文件 / 470 用例全绿**
- [x] `npm run lint` = 0；`npm run typecheck`（`vue-tsc --noEmit`）= 0
- [x] server `npm run lint` / `typecheck` / `test:unit` / `test:api` 均 = 0（api 12 文件 138 用例）
- [x] 临时探针与生成物全部删除：`server/tests/unit/tmp-emit-sim-chains.test.ts`、
      `server/tests/unit/tmp-emit.test.ts`、`game-web/tests/unit/tmp-chain-recal.test.ts`、
      `game-web/tests/unit/tmp-chain-dominance.test.ts`、`game-web/tests/e2e/tmp-shot.spec.ts`、
      两份 .txt、截图 png、`test-results/`；`git status` 复核无残留

## 5.5 成本核查（内容体量涨了 64%）

- [x] `STORY_CHAINS` 在服务端只有两个消费者：`findChainNode`（按 id 取节点）与 `matchNextChain`
      （筛候选）——**没有任何 prompt 注入整份链表**，所以补链不增加 token 成本
- [x] 反而略降：链命中路径不调 LLM，链内容变多意味着同等回合数里走 LLM 的比例下降
- [x] `docs/ai-cost.md` 无需改动（该文档不含链条数相关表述）

## 6. 浏览器验证（UI 改动必做）

- [x] 新增 `tests/e2e/end-game-chain-progress.spec.ts`（6 用例）：中文链名渲染、
      分母随年份变化、未来链不列出、可达<3 不给称号、旧档缺字段不崩、完成度不改结局称号
- [x] 首跑 2 红，均为**测试自身问题**而非应用缺陷，已修：
      ① 同一 test 内两次 `goto` 同一 hash 路由不会重载页面（uni-app H5 用 hash 路由），
         第二次注入的存档读不到 → 改为每个存档各开一个新 page（init script 是 per-page 的）；
      ② `text=中兴大业` 命中标题与结局文案两个节点（strict mode violation）→ 改用类名定位
- [x] 修后 `npx playwright test end-game-chain-progress` = **6 passed (5.6s)**
- [x] 真机渲染复核：结局页截图确认「历史进程」块位于「史评」之下、虚线分隔一致、
      称号用绿色与史评的朱红区分、13 条链名折两行居中不溢出、「另有 2 段未及收束」正常显示
- [x] 临时截图 spec 与产物已删除（`tmp-shot.spec.ts` / `tmp-end-chains.png` / `test-results/`）
- [x] 全量 `npx playwright test`（11 spec，含新增这份）= **exit 0**，无回归

## 7. 未做 / 遗留

- [ ] **链密度闸门**（本轮最硬的遗留）：开链 200 局仍全部在第 22 回合必胜、终局 1865 年，
      23 条链只用到 5 条。要让玩家走到 1912，必须在 `generate-event` 侧限制链首频率
      （例如每 K 回合一条，或链首之间强制插入 N 个普通事件）。这是行为变更，需单独提案并重跑平衡
- [ ] 三段断档仍未成链：1895—1897（公车上书/强学会）、1902—1903（癸卯学制/苏报案）、
      **1905—1910（废科举、同盟会、五大臣出洋、预备立宪、国会请愿、保路）** ——
      最后一段是辛亥的正面铺陈，价值最高，建议单独一条 4 节点链（当前最大断档 1904→1911 就是它）
- [ ] `endYear` 字段目前无消费者；完成度展示若要改按「endYear 已过」口径，需先给它接上判定
- [ ] 镜像仍是「脚本生成 + 守卫」两件套，生成脚本用完即删未固化；链体量继续涨应考虑把生成器留在仓库里
- [ ] 未跑 `pnpm build`
