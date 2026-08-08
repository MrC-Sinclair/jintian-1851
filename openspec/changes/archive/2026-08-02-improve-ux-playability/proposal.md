> **状态：已归档（代码已交付，2026-07-23）**
> 归档方式：原地标记完成，目录保持原位作历史记录
> 代码交付：4 阶段全部落地，709 测试通过，H5 + 小程序构建成功
> 残余任务（非代码，已提取到 `openspec/pre-launch-checklist.md` 跟踪）：
>   - T4.4 第 4 项：H5 + 微信小程序双端完整流程浏览器手动验证（首页→结局全流程）

## Why

MVP 上线后玩家反馈集中三痛点：**「玩不明白、看不懂、交互不好」**。经全面代码审查（见 `openspec/changes/improve-ux-playability/review-evidence.md` 暗引用），根因诊断如下：

- **玩不明白（极高）**：全局无新手引导/onboarding/教程/帮助页；胜利条件（综合实力≥90）、失败条件（任一属性≤0）在 UI 中完全不展示；无目标/任务系统，`phaseHint` 仅描述当前阶段不告知长期目标；首页只有 4 个操作按钮无"如何游戏"入口。
- **看不懂（高）**：5 维属性、4 资源、势力关系、NPC 行动、事件类型等大量术语无 tooltip 解释；effects 用单字缩写"军+10/银-200"需反复对照；综合实力（5 维平均）未在 UI 显示玩家不知胜利进度；game-main 一屏堆 7 个区块信息密度过高；文案偏文言风（"咸丰元年天下动荡""请言明所欲为之事"）新玩家不友好。
- **交互不好（中）**：选项点击无二次确认（[game-main/index.vue#L303-L308](file:///d:/code/codeWork/GAME/game-web/src/pages/game-main/index.vue) 立即生效易误点）；纯图标按钮（军师/同步/返回）无 tooltip 移动端无 hover 玩家不懂含义；属性<30 仅标红无主动危机预警；历史时间线只显示标题无玩家当时选择记录；NPC 行动 effects 未突出"已作用到你身上"。

本变更采用**综合方案分三阶段**落地：阶段 1 解决"玩不明白"（新手引导+目标系统+帮助），阶段 2 解决"看不懂"（信息架构重构+文案白话化+军师主动引导），阶段 3 解决"交互不好"（二次确认+危机预警+时间线补全+图标 tooltip）。每阶段可独立验证、独立发布。改动幅度为**大范围重构**：新增 3 个页面/区块、6 个组件，重构 game-main 信息分区，改造 phaseHint 为目标系统，调整军师 AI 为主动引导。

## What Changes

### 阶段 1：新手引导 + 目标系统 + 帮助（解决"玩不明白"）

- **新增 onboarding-tutorial 能力**：首次进入 game-main 触发交互式引导覆盖层（`OnboardingOverlay.vue`），分 6 步高亮讲解：①背景与目标 ②状态面板（5维属性+4资源）③事件卡片 ④决策方式（选项/自由行动）⑤军师对话 ⑥胜利/失败条件。`localStorage` 标记 `onboarding_done` 避免重复；支持"跳过"和"下一步"；前 3 回合额外显示"新手提示"角标引导玩家尝试军师。
- **新增 goal-system 能力**：新增 `GoalPanel.vue` 展示长期目标（成就霸业）、胜利条件（综合实力≥90）、失败条件（任一属性≤0）、当前综合实力进度条；`StatusPanel` 增加综合实力模块（5维平均，标注胜利阈值90）；`phaseHint` 升级为带目标的阶段提示（如"军事濒临崩溃，建议优先应对"）；属性<30 时回合开始 `toast.warning` 危机预警。
- **新增 help-system 能力**：首页增加"如何游戏"按钮跳转新增页面 `pages/help/index.vue`（游戏背景、5类身份、5维属性、4资源、势力关系、事件类型、NPC行动、胜利/失败条件百科 + FAQ）；新增 `InfoHint.vue` 组件（小问号图标，点击弹出术语说明），覆盖 StatusPanel/FactionCard/NpcActionList 所有关键术语；新增 `v-tooltip` 指令（移动端长按 500ms 触发，桌面端 hover 触发），覆盖军师/同步/返回/设置等纯图标按钮。

### 阶段 2：信息架构重构 + 文案白话化 + 军师主动引导（解决"看不懂"）

- **修改 turn-engine 能力（MODIFIED）**：game-main 信息分区重构为可折叠区块——状态区（默认展开）/ 近况时间线（默认折叠）/ 天下动静（默认折叠）/ 事件区（始终展开，置顶）/ 军师（浮动按钮）。新增"当前焦点"区块置顶：综合实力进度条 + 最紧急危机（属性<30 标红）+ 本回合建议（基于局势）。降低一屏信息密度，玩家按需展开次要区块。
- **文案规范化（MODIFIED）**：功能性文案全改白话——按钮"开始游戏/继续游戏/咨询军师/确认决策/下一回合"；提示"请选择对策或自由行动"→"选择一个应对方案，或自己描述想做的事"；effects 缩写改完整词"军+10"→"军事+10"、"银-200"→"银两-200"；placeholder"请言明所欲为之事"→"描述你想做什么（最多200字）"；副标题"咸丰元年，天下动荡"→"咸丰元年（1851年），天下动荡，你将扮演一方势力领袖成就霸业"。剧情文案保留古风：事件描述、结局文案、军师对话保留文言营造氛围。
- **修改 ai-advisor 能力（MODIFIED）**：新回合开始时军师主动发一条"局势简报"（免费，不占玩家对话配额，基于当前局势 50 字内）；空状态文案改引导性"有问题可问我，比如'我该优先发展什么？''当前局势如何？'"；军师提示词增加：对新玩家（前3回合）多给具体可执行建议、少用文言、主动解释术语。

### 阶段 3：交互反馈打磨（解决"交互不好"）

- **修改 turn-engine（MODIFIED）**：选项点击改为"先选中后确认"两步交互（DecisionButton 点击高亮选中态，底部"确认决策"按钮才真正应用 effects，支持反悔重选）；危机属性 toast 预警（属性<30 回合开始 `toast.warning`「军事濒临崩溃（当前15），需尽快应对」）；历史时间线补全（TurnTimeline 显示玩家当时选择 + effects 摘要）；NPC 行动 effects 突出（NpcActionList 增加"对你影响"行，标红负面影响/标绿正面影响）。
- **图标 tooltip 全覆盖（MODIFIED）**：军师/同步/返回/设置/折叠等纯图标按钮均加 `v-tooltip` 文字提示。
- **错误文案友好化（MODIFIED）**：技术错误改白话（"事件生成失败，请点击自由行动继续"→"局势推演出错，正在重试…"/"startTurn 失败：xxx"→"网络异常，请重试"）；保留错误码到 console 便于排查。

## Capabilities

### New Capabilities

- `onboarding-tutorial`：首次进入游戏的交互式引导覆盖层，6 步高亮讲解核心概念，localStorage 标记避免重复，支持跳过
- `goal-system`：目标与进度系统——长期目标展示、综合实力进度条、胜利/失败条件说明、危机预警 toast、带目标的阶段提示
- `help-system`：帮助与术语解释系统——独立帮助页（百科+FAQ）、`InfoHint` 术语解释组件、`v-tooltip` 指令（移动端长按/桌面端 hover）

### Modified Capabilities

- `turn-engine`（信息架构 + 交互细节）：game-main 改可折叠分区 + "当前焦点"置顶区块；选项改"先选中后确认"两步交互；危机属性预警；历史时间线补全选择记录；NPC 影响突出
- `ai-advisor`（主动引导）：新回合军师主动发局势简报；空状态引导文案；新玩家（前3回合）提示词加强引导
- 文案规范（跨能力）：功能性文案白话化，effects 改完整词，剧情文案保留古风

## Impact

| 层级 | 影响 |
| --- | --- |
| 前端页面 | 新增 `pages/help/index.vue`（帮助页）；修改 `pages/index/index.vue`（加"如何游戏"入口）、`pages/game-main/index.vue`（信息分区重构+焦点区块+引导触发）、`pages/character-create/index.vue`（文案白话化）、`pages/end-game/index.vue`（文案微调） |
| 前端组件 | 新增 `OnboardingOverlay.vue`、`GoalPanel.vue`、`InfoHint.vue`、`FocusPanel.vue`（当前焦点区块）；修改 `StatusPanel.vue`（加综合实力模块+InfoHint）、`FactionCard.vue`（加InfoHint+文案）、`EventCard.vue`（文案）、`DecisionButton.vue`（改两步交互+effects完整词）、`TurnTimeline.vue`（补全选择记录）、`NpcActionList.vue`（突出影响+InfoHint）、`AdvisorDrawer.vue`（空状态引导文案） |
| 前端指令 | 新增 `v-tooltip` 自定义指令（`directives/tooltip.ts`，移动端长按 500ms / 桌面端 hover） |
| 前端状态 | `stores/game.ts` 增加 `onboardingDone`、`selectedOptionId`（选中态）、`focusHint`（焦点提示）状态 |
| 前端 composable | 新增 `useOnboarding.ts`；修改 `useTurn.ts`（危机预警+军师简报触发）、`useAdvisor.ts`（局势简报逻辑） |
| 前端工具 | 新增 `utils/copywriting.ts`（文案常量集中管理，effects 标签映射完整词） |
| 后端 | `server/utils/prompts/advisor-chat.ts` 修改提示词（新玩家引导加强）；新增 `server/api/game/advisor-briefing.post.ts`（局势简报，非流式 generateObject，50字内）；其余后端无变更 |
| 数据库 | 无变更（onboarding 状态存 localStorage，不入库） |
| AI 调用 | 每回合新增 1 次"局势简报"调用（`generateObject`，约 200-400 tokens，用 `Qwen/Qwen3-8B` + `enable_thinking:false`，延迟 1-2s，成本≈0.0002元/回合）；可配置开关，默认开 |
| 多端兼容 | `v-tooltip` 移动端用 `@longpress` 事件（uni-app 内置）+ 浮层定位；桌面端用 `@mouseenter/@mouseleave`；`OnboardingOverlay` 用 `position:fixed` 全屏覆盖三端通用；可折叠区块用 `max-height`+`overflow:hidden`+`transition`（AGENTS.md 规范） |
| 测试 | 新增 `OnboardingOverlay`/`GoalPanel`/`InfoHint`/`FocusPanel` 组件测试；新增 `v-tooltip` 指令测试；新增 `copywriting.ts` 单元测试；修改 `DecisionButton` 两步交互测试；E2E 覆盖首次进入引导流程 + 帮助页访问 + 危机预警触发 |
| 文档 | 同步更新 `docs/game-design.md`（补充综合实力 UI 展示规则、危机预警阈值）、`docs/API.md`（新增 advisor-briefing 路由） |
