# 任务：把名望接上

> 验证命令与结果如实记录，未执行的项标注为未做而非打勾。

## 1. 刻度修正：名望封顶 + 每回合衰减

- [x] `game-web/src/utils/constants.ts`：新增 `REPUTATION_MAX = 100`，注释写明「只给名望封顶，
      银两/兵员/粮草是存量计数没有刻度语义」
- [x] `TURN_YIELD` 增 `reputation: -3`，注释记录实测依据（毛漂移 +4.40/回合、封顶不衰减则 100% 撞顶、
      −3 档预测中位 56）与副作用（结盟/离间花 10 点名望，攒够更难）
- [x] `game-web/src/stores/game.ts`：`applyEffects` 在资源托底 0 之后追加名望封顶 100
- [x] 确认 `applyEffects` 是资源变动的**唯一入口**（`grep 'resources:'` 只有它一处写），
      所以事件 / 回合产出 / 按钮外交 / 谈判扣费四条路径都被封顶覆盖
- 验证：`cd game-web && pnpm lint && pnpm typecheck` ✅（exit 0）

## 2. 档位表（单一真值 + 镜像）

- [x] `constants.ts` 定义 `HistoryRating`（min / label / remark / npcStance）与五档 `HISTORY_RATINGS`
- [x] `server/server/utils/reputation-bands.ts` 后端镜像：纯数据零 import，附 `getReputationBand()`
- [x] 刻意让前端副本也带 `npcStance`：表结构一致才能用 `toEqual` 一把梭深比较
      （拆成两种结构就退化成注释约定，正是仓库此前用 mirror-consistency 测试要解决的问题）
- [x] 划线先按线性近似预测（85/65/40/20），**落地后再实测校验**：
      终局名望 min=0 / p10=23 / p25=42 / 中位=59 / p75=74 / p90=88 / max=100，约 4% 撞顶，
      五档占比 ≈ 12% / 28% / 35% / 15% / 10% → 与预测吻合（预测中位 56 vs 实测 59），**未调整划线**
- 验证：`cd game-web && pnpm exec vitest run tests/unit/mirror-consistency.test.ts` ✅（深比较 + 降序/兜底断言）

## 3. (a) NPC 态度注入

- [x] `server/server/utils/prompts/npc-agent.ts`：注入
      `玩家如今的朝野名望：{label}。{npcStance}。`，位置在关系值行之后、决策目标行之前
- [x] 缺字段防御：`ctx.stateSnapshot.resources?.reputation ?? 0`（客户端漏传时落最低档而非炸掉整回合）
- [x] 文件头补写「名望注入」段，并记录此前 reputation 出现 0 次、承诺未落地
- 验证：`cd server && pnpm test:unit` ✅（`npc-agent-prompt.test.ts` 14 例通过，新增 5 例：
      注入恒存在 / 高低档倾向相反 / 缺字段兜底 / 不改变 relationship 派生的 goal / 位置在 JSON 要求之前）

## 4. (b) 结局史评展示

- [x] `game-web/src/utils/end-conditions.ts`：新增 `getHistoryRating()`，
      注释写明「只展示、不计入判定」的实测理由（计入会把 95.5% 抬到 100%）
- [x] `game-web/src/pages/end-game/index.vue`：hero 区新增史评区块（称号 + 评语），
      用 `v-if="save"` 避免存档未加载时闪一下「身败名裂」；配套 SCSS 4 个类
- 验证：`cd game-web && pnpm test:unit && pnpm test:component` ✅（448 / 354）
- **真浏览器验证（390×844 chromium，起 dev:h5 + 临时 e2e 注入 ended 存档，跑完即删）** ✅ 5 例全过：
  - 胜利 + 名望 90 → hero 区渲染「史评 / 天下归心 / 口碑载道，四方望风而归。」，控制台零报错
  - 崩溃 + 名望 5 → 「身败名裂」，且 `end-game--failure` 配色类未被新区块破坏
  - 边界 85 → 最高档；边界 84 → 次高档（两个 test 分开写：hash 路由下同一 test 内二次 goto
    不会重新加载页面，`addInitScript` 换不掉存档）
  - StatusPanel 里名望不再出现三位数（封顶落地）
  - 截图目视确认：390px 下虚线分隔 + 主题红称号 + 斜体评语，排版无溢出
- 验证：`cd game-web && PLAYWRIGHT_E2E=1 pnpm exec playwright test`（全量 e2e）✅ **37/37 passed**

## 5. 平衡与回归

- [x] 重跑 `pnpm exec vitest run tests/unit`（含 balance-regression 200 局 ×3 组）✅
- [x] **胜率零漂移**：baseline 95.5% / avgTurns 36.2 / avgPower 85.2 与改动前完全一致；
      simple-npc 40.5% 亦一致。唯一变化是逐资源下限里名望 9 → 0（衰减早于事件收入到账）
- [x] 同步改写三处因衰减而失败的用例（属**预期内行为变更**，非回归）：
      - `turn-yield.test.ts`：产出断言加 `reputation: -3`
      - `use-turn.test.ts`：系统事件 `effects` 断言 ×2 同步
      - `negotiation-balance.test.ts`：fixture 补一笔 `reputation: +4` 的「事件名望收入」并注明原因
        ——该 fixture 只跑 TURN_YIELD 不跑事件，−3 衰减会让名望第 4 回合归零，
        alliance-deal 的 5~10 点名望代价永远付不起（`alliedCount` 归 0）。
        这是 fixture 缺收入来源，不是平衡被打穿
- [x] `balance-regression.test.ts` 文件头基线快照：名望下限 9→0 更新，并新增本次对照段
      （零漂移结论 + 落地后终局名望分布 + 五档占比 + 「哪天动了就是有人把 reputation 塞进判定」的告警语）

## 6. 文档同步

- [x] `docs/game-design.md`：资源表名望行改为「0-100 封顶，每回合 −3 衰减；影响 NPC 态度与结局史评」；
      数值平衡节补「名望封顶 + 衰减」的实测依据；结局判定规则后新增「史评档位」小节
      （五档表 + 实测占比 + 为什么不参与判定 + 后端共用同一张表）
- [x] `docs/ai-cost.md`：`npc-actions` 输入 ~1200 → ~1250、单次 ¥0.000595 → ¥0.000612，
      并同步典型回合 ¥0.002222 / 自由输入回合 ¥0.002887 / 单局 ¥0.112 / 月度 ¥3360 /
      升级混合块 ¥0.002875 / 告警阈值表引用的日均值
- [x] `openspec/changes/reputation-wiring/`：proposal + tasks + `specs/turn-engine` 与 `specs/ai-npc-faction` delta

## 7. 遗留

- [ ] 内容侧名望量级：净 +301 的正向偏置仍在，衰减是在数值侧对冲而非根治；
      与 #3「资源压力与破产后果」一并决定要不要改事件量级
- [ ] `game-design.md` 仍有一处旧值：`综合实力 0-100` 段落写着「需提升 40 点达到胜利阈值 90」，
      而 `VICTORY_THRESHOLD` 已是 85 —— 属 #10 openspec 补记（封顶与阈值 90→85 那一项）要一并纠正的文档脱节
- [ ] 名望对 NPC 的影响目前是**纯文案偏置**，LLM 是否真的因此行为不同，需要跑真 LLM 观察
      （模拟底盘 `balance-sim` 用静态兜底事件池 mock 掉 LLM，测不出来）
