# 任务：平衡模拟底盘打通剧情链（可选开关 + 镜像守卫 + 新基线）

> 验证命令与结果如实记录，未执行的项标注为未做而非打勾。全部改动位于 `game-web/tests/`，无生产代码。

## 1. 镜像表落地（先对真值，不许臆造）

- [x] 定义 `SimChainDef` / `SimChainNodeOption` 与 `SIM_CHAINS` 镜像表：**14 条链 / 42 个节点**，
      与服务端 `story-chains.ts` 条数一致（`grep -c "^    chainId: '"` 双向均为 14、nodeId 均为 42）
- [x] 节点选项的 `effects` 逐条从服务端真值拼接，不写近似数值
- [x] 中途回退一次：早期版本用手写近似 effects，量出「开链胜率 0%」——那测的是我编的数据；
      换成真值后翻为 100% / 22 回合，**方向相反**。近似值在本底盘里比缺值更危险
- [x] 导出只读别名 `SIM_CHAINS_FOR_TEST` 供守卫测试使用（模拟内部仍直接用 `SIM_CHAINS`）

## 2. 触发规则复刻（与服务端逐条对照，不是"看起来像"）

- [x] `matchNextSimChain`：条件 `startYear >= 当前年` + 未完成 + 未激活 + 前置链全部完成，
      同年份按 `startYear` 升序 + `chainId` 字典序取第一条 —— 对照 `generate-event.ts:matchNextChain`
- [x] 专门核实过「`>=` 是不是写反了」：服务端确实是 `>=`（`allowChainFutureAnchor` 语义，
      时光跳跃的跳跃目标就是下一条链的 `startYear`），镜像忠实复刻，**不是 bug**
- [x] `buildChainEvent`：只在 time-window（链首）路径判定时光跳跃，
      链内后续节点走 pending-chain 接续 → 不设 `eventDate`，否则一条 5 节点链会把日历前推 5 次
- [x] 时光跳跃只往前推不回拨（`chain.startYear > jumpFromYear` 才写 `eventDate`），与 `useTurn.startTurn` 同规则
- [x] 链记账（2.5 步）：末节点 → `completedChains`；否则把下一节点以 `scheduledTurn = turn + 1` 挂入 `pendingChain`
- [x] 事件优先级：挂起节点 → 下一条可触发链 → 兜底事件（与真实 `generate-event` 一致）

## 3. 可测量与开关

- [x] `SimOptions.useStoryChains?: boolean`，默认 `false`
- [x] `SimOutcome` 新增 `chainsCompleted` / `finalYear`；`SimReport` 新增 `avgChainsCompleted` / `maxFinalYear`
- [x] 资源惩罚**保持无条件**（不加开关）：86.0% 基线本身就是含惩罚的数字，
      再开一档「关惩罚」等于维护没人跑的分支 —— 此点与需求原文「可选启用剧情链与资源惩罚」有意偏离，见 proposal 决策表
- [x] 文件头声明改写：从「仍未建模剧情链与时光跳跃」改为「由 `useStoryChains` 控制，默认关」，
      并写明惩罚已纳入、仍未建模的是 AI 军师/谈判的真实 LLM 行为

## 4. 基线重跑（200 局/组）

> ⚠️ 本节数字是 **14 条链**时的标定；链补到 23 条后由 `story-chain-anchors-and-completion` 重标定
> （开链链完成均值 6.00 → 5.00；开链+NPC 100.0%/42.6/13.47/1911 → 98.5%/46.0/13.79/1892）。
> **关链基线 86.0% 两组一致、逐位不变**，这条不受链条数影响。

- [x] 关链（原基线）：winRate=86.0% wins=172 avgTurns=37.5 median=37 range=[23,51] avgPower=84.8
      逐资源下限=银两0/兵员15/粮草160/名望0 —— **与改动前逐位相同**，证明默认关闭真的不改行为
- [x] 开链：winRate=**100.0%** wins=200 avgTurns=**22.0** range=**[22,22]** 链完成均值=6.00 最晚年份=1865
      逐资源下限=银两668/兵员115/粮草800/名望19，非胜利结局 `{}`
- [x] 开链 + simple NPC：100.0% / 42.6 回合 / 链完成 13.47 / 走到 1911 年
- [x] 关链 + simple NPC：7.0% / 47.4 回合 / 最晚年份 1855
- [x] 以上四组写入 `balance-regression.test.ts` 文件头快照，含 ⚠️ 挤占效应说明
- [x] 复跑两组确认确定性（同种子两次完全一致，非偶然命中）

## 5. 守卫与回归

- [x] 新增 `tests/unit/sim-chain-mirror.test.ts`（3 用例）：链条数 / 逐链结构 / 逐节点逐选项 effects 深比对
- [x] 新增 `balance-regression` 对比用例「剧情链开关对比」：断言只锁关系
      （开链 ≥ 关链、链完成数 > 0、开链 avgTurns 更短、无 crash），**不**把 22 回合定局锁成要求
- [x] `npm run lint`（`lint:js` + `lint:css` 并行）= 0；`npm run typecheck`（`vue-tsc --noEmit`）= 0
- [x] `npm run test:unit` = 0：**29 文件 / 461 用例全绿**（含 balance-regression 5 用例 8.8s）
- [x] 临时探针 `tests/unit/tmp-chain-baseline.test.ts` 已删除；`git status` 确认工作区无 tmp 残留

## 6. 未做 / 遗留

- [ ] 未跑 `pnpm test:e2e`：本轮无渲染与交互改动（纯测试底盘）
- [ ] 未跑 `pnpm build`：无 `src/` 改动
- [ ] **剧情链连发导致 22 回合定局** → 属 #4（链完成度参与结局 + 1872-1882/1884-1893 锚点断档）的产品决策，
      本提案只如实记录，不改服务端优先级、不加链的密度闸门
- [ ] 镜像表是「人肉拼接」：将来若链体量继续增长，考虑改由脚本从 `story-chains.ts` 生成镜像
      （生成 + 守卫两者取一即可，现状是手写 + 守卫）
