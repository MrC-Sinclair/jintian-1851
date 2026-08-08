# 任务拆分 — 体验优化（improve-ux-playability）

任务按依赖关系排序，分三阶段独立落地。每阶段完成后必须通过对应验证命令才能进入下一阶段。所有代码任务结束前必须运行 `pnpm lint` + `pnpm typecheck`，多端兼容任务必须 H5+小程序双端验证。

> 工作目录约定：前端任务在 `d:\code\codeWork\GAME\game-web\`，后端任务在 `d:\code\codeWork\GAME\server\`。下方命令默认在对应工作目录执行。

## 阶段 1：新手引导 + 目标系统 + 帮助（解决"玩不明白"）

### T1.1 实现 utils/copywriting.ts 文案常量集中管理

- 创建 `game-web/src/utils/copywriting.ts`，导出：
  - `EFFECT_LABELS`：完整词映射（`military`→"军事"、`economy`→"经济"、`politics`→"政治"、`people`→"民心"、`diplomacy`→"外交"、`silver`→"银两"、`troops`→"兵员"、`food`→"粮草"、`reputation`→"名望"）
  - `BUTTON_TEXT`：按钮文案（开始游戏/继续游戏/如何游戏/咨询军师/确认决策/下一回合/自由行动/同步存档/设置）
  - `PHASE_HINTS`：阶段提示（含目标版，如"请选择应对方案，或自己描述想做的事"/"决策已定，进入下一回合"/"局势推演中…"）
  - `TOOLTIP_TEXT`：图标提示（军师/同步/返回/设置/折叠/展开）
  - `RELATIONSHIP_LABELS`：势力关系文案（沿用 FactionCard 现有 formatRelationship 逻辑）
  - `NPC_ACTION_LABELS`：NPC 行动类型文案（扩张/结盟/备战/休养/挑衅/外交）
  - `EVENT_TYPE_LABELS`：事件类型文案（民生/军事/外交/随机/历史剧情/NPC动态）
- **验证**：`tests/unit/copywriting.test.ts` 覆盖所有映射键值存在性与中文非空；`pnpm typecheck` + `pnpm lint` 通过

### T1.2 实现 utils/platform.ts 平台能力封装

- 封装 `getElementRect(selector)`：H5 用 `querySelector + getBoundingClientRect`，小程序/App 用 `uni.createSelectorQuery`
- 封装 `isTouchDevice()`：H5 判断 `matchMedia('(hover: none)')` 或 `navigator.maxTouchPoints>0`；小程序/App 直接 `true`
- 封装 `storageGet/storageSet`：H5 用 `localStorage`，小程序/App 用 `uni.getStorageSync/setStorageSync`（若已有 `storage.ts` 则复用）
- **验证**：`tests/unit/platform.test.ts` mock 三端环境验证分支；`pnpm typecheck` 通过

### T1.3 实现 directives/tooltip.ts v-tooltip 指令

- 创建 `game-web/src/directives/tooltip.ts`，导出 `vTooltip` 指令对象
- **触发逻辑**：
  - 触摸设备（`isTouchDevice()` 为 true）：绑定 `@longpress`（500ms），触发显示浮层；3 秒后自动消失或点击关闭
  - 桌面端：绑定 `@mouseenter` 显示、`@mouseleave` 隐藏
- **浮层渲染**：动态创建 `view` 元素 `position:fixed`，基于 `getElementRect` 计算定位（默认元素上方居中），`z-index:999`，半透明黑底白字，`max-width:80%`，字号 `24rpx`，`padding:16rpx 24rpx`，圆角 `8rpx`
- **指令用法**：`v-tooltip="'军师对话'"`（字符串）或 `v-tooltip="{ content: '...', placement: 'top' }"`（对象，placement 可选 top/bottom）
- **长按与 click 冲突处理**：longpress 触发后设置标志位，下一次 click 事件中 `event.preventDefault()` + `event.stopPropagation()` 阻止误触发
- 在 `main.ts` 注册全局指令 `app.directive('tooltip', vTooltip)`
- **验证**：`tests/unit/tooltip-directive.test.ts` mock 指令钩子验证绑定/解绑/触发；H5 浏览器手动验证 hover 显示；`pnpm typecheck` + `pnpm lint` 通过

### T1.4 实现 components/InfoHint.vue 术语解释组件

- 创建 `game-web/src/components/InfoHint.vue`
- **UI**：小问号圆形图标（直径 `48rpx`≈24px），`bg:#8B1A1A`，白色"?"，点击弹出说明浮层
- **Props**：`title: string`（术语名）、`content: string`（解释文字）
- **交互**：点击切换浮层显隐（移动端友好，非 hover）；点击浮层外区域关闭（`@click.self`）；浮层 `position:fixed` 居中，半透明遮罩
- **浮层内容**：术语标题（粗体）+ 解释段落 + 关闭按钮
- **触摸目标**：问号图标 `min-w/min-h: 48rpx`，浮层关闭按钮 `min-w/min-h: 88rpx`
- **验证**：`tests/component/info-hint.test.ts` 渲染验证点击显隐；`pnpm lint` + `pnpm typecheck` 通过

### T1.5 实现 components/GoalPanel.vue 目标与进度面板

- 创建 `game-web/src/components/GoalPanel.vue`
- **UI 结构**：
  - 折叠态：标题"游戏目标"+ 综合实力进度条缩略（`72/100`）+ 展开图标
  - 展开态：长期目标段落"成就霸业（1851-1912）"+ 胜利条件"综合实力 ≥ 90"+ 失败条件"任一属性 ≤ 0"+ 当前综合实力进度条（标注 90 阈值刻度）+ InfoHint 解释"综合实力"
- **Props**：`attributes: GameAttributes`、`defaultExpanded?: boolean`（默认 false）
- **计算**：`overallPower = (military+economy+politics+people+diplomacy)/5`（抽到 `utils/goal-hint.ts` 复用）
- **进度条**：高度 `16rpx`，背景 `#E5D5B7`，填充 `#8B1A1A`，90 阈值处标记竖线
- **折叠动画**：用 `CollapsibleSection`（T2.1 实现，本任务先内联 `max-height` transition）
- **触摸目标**：标题栏 `min-h: 88rpx`
- **验证**：`tests/component/goal-panel.test.ts` 验证综合实力计算与进度条渲染；`pnpm lint` + `pnpm typecheck` 通过

### T1.6 实现 utils/goal-hint.ts 焦点提示生成

- 创建 `game-web/src/utils/goal-hint.ts`，导出：
  - `calcOverallPower(attributes)`：返回 0-100 数值
  - `getCrisis(attributes)`：返回 `{ attr: 'military', name: '军事', value: 15 } | null`（取 <30 中最低者，无则 null）
  - `generateFocusHint(attributes)`：返回 `{ overallPower, crisis, suggestion }`，suggestion 规则：有 crisis 时"优先应对{crisis.name}危机"，无则"稳步发展各项实力"
- **验证**：`tests/unit/goal-hint.test.ts` 覆盖：综合实力计算边界（0/50/90/100）、crisis 选取（多个<30取最低、无<30返回null）、suggestion 生成；`pnpm typecheck` 通过

### T1.7 实现 components/FocusPanel.vue 当前焦点区块

- 创建 `game-web/src/components/FocusPanel.vue`
- **UI 结构**（始终展开，置顶）：
  - 综合实力进度条（`GoalPanel` 同款，标注当前值/90 阈值）
  - 危机提示行（若有 crisis）：⚠ 红色"军事 15（濒临崩溃）"+ InfoHint 解释
  - 建议行：💡 "本回合建议：{suggestion}"（AI 简报返回时覆盖规则建议）
- **Props**：`attributes`、`briefing?: { summary, suggestion } | null`
- **数据流**：`goal-hint.ts` 计算本地部分，`briefing.suggestion` 存在时覆盖 `suggestion`
- **触摸目标**：InfoHint 复用 T1.4
- **验证**：`tests/component/focus-panel.test.ts` 验证危机渲染/无危机渲染/briefing 覆盖建议；`pnpm lint` + `pnpm typecheck` 通过

### T1.8 实现 components/OnboardingOverlay.vue 新手引导覆盖层

- 创建 `game-web/src/components/OnboardingOverlay.vue`
- **UI 结构**：
  - 全屏半透明遮罩 `position:fixed; inset:0; bg:rgba(0,0,0,0.6); z-index:1000`
  - 引导卡片：标题 + 内容 + 步骤指示（1/6）+ "下一步"/"跳过"按钮
  - 高亮目标区块：`box-shadow: 0 0 0 9999px rgba(0,0,0,0.6)` 外阴影覆盖非高亮区
- **步骤数据**（数据驱动）：
  1. 欢迎+背景："欢迎来到乱世抉择：1851。你将扮演一方势力领袖，在 1851-1912 年间成就霸业。"（无目标高亮）
  2. 状态面板：高亮 StatusPanel，讲解 5 维属性 + 4 资源
  3. 事件卡片：高亮 EventCard，讲解每回合 AI 生成事件
  4. 决策方式：高亮 DecisionButton 区域，讲解选项决策与自由行动
  5. 军师对话：高亮军师按钮，讲解可随时咨询
  6. 目标：高亮 GoalPanel（或 FocusPanel），讲解胜利/失败条件
- **Props**：`steps: OnboardingStep[]`、`targetRefs: Record<string, HTMLElement>`（父组件传入各区块 ref）
- **交互**：下一步前进、跳过直接完成、最后一步显示"开始游戏"
- **触摸目标**：下一步/跳过按钮 `min-w/min-h: 88rpx`
- **状态管理**：完成时 emit `complete` 事件，父组件调 `useOnboarding.markDone()`
- **高亮定位**：步骤切换时调 `getElementRect(targetRef)` 获取位置，设置高亮元素 `style.left/top/width/height`
- **SSR 安全**：`OnboardingOverlay` 仅在 `onMounted` 后渲染（用 `v-if="mounted"`），避免 SSR 水合不匹配
- **验证**：`tests/component/onboarding-overlay.test.ts` 验证步骤前进/跳过/完成回调；H5 浏览器手动验证高亮定位；`pnpm lint` + `pnpm typecheck` 通过

### T1.9 实现 composables/useOnboarding.ts 引导状态管理

- 创建 `game-web/src/composables/useOnboarding.ts`
- **状态**：`isOnboarding`（ref<boolean>，是否正在引导）、`currentStep`（ref<number>）
- **方法**：
  - `checkAndStart()`：读 `storage.get('onboarding_done')`，未完成则 `isOnboarding = true`
  - `markDone()`：`storage.set('onboarding_done', true)`，`isOnboarding = false`
  - `skip()`：同 `markDone()`（跳过也算完成）
  - `next()`/`prev()`：步骤导航
- **localStorage key**：`onboarding_done`（布尔）
- **验证**：`tests/unit/use-onboarding.test.ts` mock storage 验证三路径（未完成启动/已完成跳过/markDone 写入）；`pnpm typecheck` 通过

### T1.10 实现 pages/help/index.vue 帮助页

- 在 `game-web/src/pages.json` 注册路由 `pages/help/index`（标题"如何游戏"）
- 创建 `game-web/src/pages/help/index.vue`
- **内容结构**（`scroll-view` 滚动）：
  - 游戏背景：咸丰元年（1851年）背景介绍，玩家目标
  - 核心概念百科（每项含 InfoHint 复用解释）：
    - 5 类身份（文官/武将/商贾/士绅/宗室）及偏移
    - 5 维属性（军事/经济/政治/民心/外交）及含义
    - 4 项资源（银两/兵员/粮草/名望）及用途
    - 势力关系（-100~100，5 档分级）
    - 事件类型（6 类）及意义
    - NPC 行动（6 种）及后果
  - 胜利与失败：综合实力≥90 胜利、任一属性≤0 失败、1912 年时光尽头
  - 玩法技巧：优先平衡发展、关注危机预警、善用军师、自由行动可解锁隐藏策略
  - FAQ：5-8 条常见问题
- **顶部**：返回按钮（`v-tooltip`）+ 标题
- **触摸目标**：返回按钮 `min-w/min-h: 72rpx`
- **验证**：H5 浏览器手动验证页面渲染与滚动；`pnpm lint` + `pnpm typecheck` 通过

### T1.11 修改 pages/index/index.vue 首页加"如何游戏"入口

- 在首页 4 个按钮下方增加"如何游戏"按钮（跳转 `pages/help/index`）
- 按钮文案用 `BUTTON_TEXT.howToPlay`
- 副标题改白话："咸丰元年（1851年），天下动荡，你将扮演一方势力领袖成就霸业"（保留古风点缀）
- **触摸目标**：按钮 `min-h: 88rpx`
- **验证**：H5 浏览器验证跳转；`pnpm lint` + `pnpm typecheck` 通过

### T1.12 修改 StatusPanel.vue 加综合实力模块 + InfoHint

- 在 StatusPanel 顶部增加综合实力进度条模块（复用 `goal-hint.ts` 的 `calcOverallPower`）
- 进度条标注 90 阈值刻度，值≥90 时绿色、<90 时主题红
- 5 维属性标签旁加 `InfoHint`（解释每维属性含义，如"军事：军队战力、装备水平、将领素质。影响战斗胜负、叛乱镇压"）
- 4 资源标签旁加 `InfoHint`（解释用途）
- 属性颜色规则保持（≥70 绿、30-70 黄、<30 红），<30 时属性名前加 ⚠ 图标
- **验证**：`tests/component/status-panel.test.ts` 更新覆盖综合实力模块与 InfoHint 渲染；`pnpm lint` + `pnpm typecheck` 通过

### T1.13 修改 FactionCard.vue + NpcActionList.vue 加 InfoHint

- FactionCard：势力名称旁加 InfoHint（解释"势力关系"概念）；关系文案用 `RELATIONSHIP_LABELS`
- NpcActionList：标题"天下动静"加 InfoHint（解释 NPC 行动机制）；每种行动类型旁加 InfoHint（解释该行动后果，如"扩张：势力正在扩张领土，可能威胁你的领地"）
- 行动类型文案用 `NPC_ACTION_LABELS`
- **验证**：`tests/component/faction-card.test.ts` + `tests/component/npc-action-list.test.ts` 更新；`pnpm lint` + `pnpm typecheck` 通过

### T1.14 实现 server/api/game/advisor-briefing.post.ts 局势简报

- 创建 `server/api/game/advisor-briefing.post.ts`
- **zod 校验**：`{ saveId: z.string().uuid(), turn: z.number().int().min(1), stateSnapshot: StateSnapshotSchema }`
- **调用**：`Qwen/Qwen3-8B` + `generateObject()` + `createSiliconFlowFetch(false)`（`enable_thinking:false`）
- **schema**：`z.object({ summary: z.string().max(60), suggestion: z.string().max(60) })`
- **超时**：10s（用 `Promise.race` 或 AbortController）
- **失败降级**：返回 `{ ok: true, data: { summary: '', suggestion: '' }, fallback: true }` + header `X-Fallback: true`，不 throw
- **并发锁**：不占用 `concurrency-lock`（无副作用，可并发）
- **rate-limit**：复用现有中间件
- **开关**：`runtimeConfig.enableBriefing` 为 false 时直接返回空简报
- **验证**：`tests/api/advisor-briefing.test.ts` 覆盖正常/参数错误/LLM 失败降级/超时降级/开关关闭；`pnpm typecheck` + `pnpm lint` 通过

### T1.15 修改 game-main/index.vue 集成阶段 1 全部能力

- 在 game-main 顶部增加 `FocusPanel`（始终展开）
- 在底部增加 `GoalPanel`（可折叠，默认折叠）
- `onMounted` 调 `useOnboarding.checkAndStart()`，若 `isOnboarding` 则挂载 `OnboardingOverlay`（传入各区块 ref）
- `useTurn.startTurn()` 内增加：危机检查（属性<30 时 `toast.warning`）+ 调 `advisor-briefing` 获取简报传给 `FocusPanel`
- 顶部同步按钮、底部军师按钮加 `v-tooltip`
- `phaseHint` 改用 `PHASE_HINTS`（含目标版）
- **SSR 安全**：`OnboardingOverlay` 用 `v-if="mounted && isOnboarding"`，`mounted` 在 `onMounted` 设 true
- **验证**：H5 浏览器完整验证：首次进入触发引导→完成→显示 FocusPanel/GoalPanel→危机预警 toast→图标 tooltip；`pnpm lint` + `pnpm typecheck` 通过

### T1.16 阶段 1 全量验证

- 前端：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:component`
- 后端：`cd server && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:api`
- H5 端 `pnpm dev:h5` 浏览器手动验证：
  - 首页点"如何游戏"跳转帮助页
  - 清除 localStorage 后进入 game-main 触发引导
  - 引导 6 步完整走完
  - 跳过引导也可
  - FocusPanel/GoalPanel 渲染正确
  - 危机属性（手动改存档 military=15）触发 toast
  - 图标 hover/长按显示 tooltip
- 微信小程序端 `pnpm dev:mp-weixin` 验证引导与 tooltip（长按触发）
- **验证**：所有命令退出码 0，双端交互正常

## 阶段 2：信息架构重构 + 文案白话化 + 军师主动引导（解决"看不懂"）

### T2.1 实现 components/CollapsibleSection.vue 可折叠区块

- 创建 `game-web/src/components/CollapsibleSection.vue`
- **Props**：`title: string`、`defaultExpanded?: boolean`（默认 true）、`icon?: string`（标题图标 SVG path）
- **UI**：标题栏（可点击，右侧 chevron 旋转动画）+ 内容区
- **折叠动画**：展开 `max-height: 2000rpx; opacity: 1`，折叠 `max-height: 0; opacity: 0; overflow: hidden`，transition `max-height 300ms ease, opacity 200ms ease`
- **emits**：`toggle(expanded: boolean)`
- **触摸目标**：标题栏 `min-h: 88rpx`
- **标题旁可选 InfoHint**：slot `#title-extra`
- **验证**：`tests/component/collapsible-section.test.ts` 验证展开/折叠/toggle 事件；H5 浏览器验证动画；`pnpm lint` + `pnpm typecheck` 通过

### T2.2 重构 game-main/index.vue 信息分区

- 用 `CollapsibleSection` 包裹现有区块：
  - 状态区（StatusPanel + FactionCard 列表）：`defaultExpanded: true`
  - 近况时间线（TurnTimeline）：`defaultExpanded: false`
  - 天下动静（NpcActionList）：`defaultExpanded: false`
- 事件区（EventCard + DecisionButton + 自由行动）：始终展开，**置顶**在 FocusPanel 下方
- GoalPanel：移到底部，可折叠
- FocusPanel：保持置顶
- 调整 `onMounted` 不再立即 `startTurn`，改为引导完成后才 `startTurn`（与 T1.15 协同）
- **SSR 安全**：折叠状态初始值在 `ref` 中设定（不用 `Math.random`），`onMounted` 不改 DOM 结构
- **验证**：H5 浏览器验证：默认显示 FocusPanel+事件区+状态区，近况/天下动静折叠；点击折叠展开有动画；`pnpm lint` + `pnpm typecheck` 通过

### T2.3 文案白话化 — 修改各组件文案

- **全局**：所有硬编码文案字符串改用 `copywriting.ts` 常量
- **pages/index/index.vue**：副标题"咸丰元年，天下动荡"→"咸丰元年（1851年），天下动荡，你将扮演一方势力领袖成就霸业"
- **pages/character-create/index.vue**：loading"军师推演中"→"正在生成可选势力…"；loading"军师正在推演天下大势…"→"AI 正在基于你的身份生成势力，约 3-8 秒"
- **game-main/index.vue**：phaseHint 用 `PHASE_HINTS`；"决策已定，请进入下一回合"→"决策已定，进入下一回合"
- **AdvisorDrawer.vue**：空状态"有何难处，可向军师道来"→"有问题可问我，比如"我该优先发展什么？""当前局势如何？""；placeholder"请言明所思"→"描述你想问的问题"
- **DecisionButton.vue**：effects 标签用 `EFFECT_LABELS`（"军+10"→"军事+10"）
- **NpcActionList.vue**：effects 标签同上；"天下暂无事端"→"本回合各方暂无行动"
- **TurnTimeline.vue**："尚无往事可记"→"还没有历史记录"
- **EventCard.vue**："可选对策"→"应对方案"
- **剧情文案保留**：事件描述、结局文案、军师对话回复内容不改（AI 生成）
- **验证**：H5 浏览器逐页验证文案；`pnpm lint` + `pnpm typecheck` 通过

### T2.4 修改 DecisionButton.vue effects 完整词

- `DecisionButton.vue` 第 52-62 行 `LABELS` 单字缩写改用 `copywriting.ts` 的 `EFFECT_LABELS`
- effects 标签渲染："军事+10"（绿底）、"银两-200"（红底）
- 标签字号 `24rpx`，`flex-wrap: wrap`
- **验证**：`tests/component/decision-button.test.ts` 更新验证完整词；`pnpm lint` + `pnpm typecheck` 通过

### T2.5 修改 server/utils/prompts/advisor-chat.ts 新玩家引导加强

- 在提示词中增加条件分支：
  ```
  如果当前是玩家前 3 回合（turn <= 3）：
  - 多用白话，少用文言
  - 主动解释专业术语（如提到"军事"时补充"即军队战力"）
  - 给出具体可执行建议（如"建议本回合选择提升军事的选项"）
  - 语气鼓励，降低新玩家挫败感
  ```
- 提示词接收 `turn` 参数（已有），增加引导段落
- **不改变**流式协议与 token 预算（仅 prompt 文本变化）
- **验证**：`tests/unit/prompts.test.ts` 更新验证新玩家引导段落存在；`pnpm typecheck` 通过

### T2.6 修改 useAdvisor.ts + AdvisorDrawer.vue 局势简报展示

- `useTurn.startTurn()` 内调 `advisor-briefing` 后，将简报存入 `useAdvisor.briefing` ref
- `AdvisorDrawer` 打开时，若 `briefing` 存在且本回合未展示过，自动在消息列表顶部插入一条 assistant 消息（标签"局势简报"）
- 简报消息样式与普通军师回复区分（浅色背景 + "局势简报"角标）
- 玩家后续追问时，简报作为上下文传给 `advisor-chat`
- **验证**：`tests/unit/use-advisor.test.ts` 更新验证简报插入；`pnpm typecheck` 通过

### T2.7 修改 TurnTimeline.vue 补全选择记录

- `TurnTimeline` 现仅显示回合数+类型+标题
- **改造**：每条历史记录增加"你的选择"行（玩家当时选的选项文案 或 自由输入摘要）+ effects 摘要（如"军事+10, 银两-200"）
- **数据源**：`save.history` 数组每项需含 `playerChoice: string`、`appliedEffects: object`（若现有 `history` 结构不含，需同步改 `types/game.ts` 与 `useTurn` 写入逻辑）
- effects 摘要用 `EFFECT_LABELS` 渲染
- **触摸目标**：每条记录 `min-h: 88rpx`
- **验证**：`tests/component/turn-timeline.test.ts` 更新验证选择记录渲染；`pnpm typecheck` 通过

### T2.8 修改 NpcActionList.vue 突出对玩家影响

- 每条 NPC 行动下方增加"对你影响"行：
  - 若 effects 含负值属性变化（如 `military: -5`）：红色"军事 -5"
  - 若 effects 含正值：绿色"经济 +3"
  - 若无影响：灰色"暂无直接影响"
- effects 用 `EFFECT_LABELS` 完整词
- **验证**：`tests/component/npc-action-list.test.ts` 更新验证影响行渲染；`pnpm typecheck` 通过

### T2.9 修改 types/game.ts 补充类型

- `GameSave.history` 数组项类型增加 `playerChoice: string`、`appliedEffects: Partial<GameAttributes & GameResources>`
- 新增 `OnboardingStep` 类型：`{ target: string, title: string, content: string }`
- 新增 `BriefingResult` 类型：`{ summary: string, suggestion: string }`
- 新增 `FocusHint` 类型：`{ overallPower: number, crisis: { attr: string, name: string, value: number } | null, suggestion: string }`
- **向后兼容**：现有 `history` 项无 `playerChoice` 时，`TurnTimeline` 渲染兜底"（无记录）"
- **验证**：`pnpm typecheck` 通过；现有 `useTurn` 写入 history 处同步补充字段

### T2.10 阶段 2 全量验证

- 前端：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:component`
- 后端：`cd server && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:api`
- H5 端手动验证：
  - game-main 默认显示 FocusPanel+事件+状态，近况/天下动静折叠
  - 折叠展开动画流畅
  - effects 显示完整词
  - 文案白话化生效
  - 军师抽屉打开显示局势简报
  - 历史时间线显示选择记录
  - NPC 行动显示对玩家影响
- 微信小程序端验证折叠动画与文案
- **验证**：所有命令退出码 0，双端正常

## 阶段 3：交互反馈打磨（解决"交互不好"）

### T3.1 修改 DecisionButton.vue + game-main 两步交互

- **DecisionButton.vue**：
  - 增加 `selected: boolean` prop，选中态 `border: 4rpx solid #8B1A1A` + `bg: #FFF8E7`
  - 未选中 `border: 2rpx solid #D4C5A0`
  - emit `select` 事件（不直接应用 effects）
- **game-main/index.vue**：
  - 维护 `selectedOptionId: ref<string | null>(null)`
  - `onSelectOption(id)` 设置 `selectedOptionId`（支持切换，点已选中项取消选中）
  - 底部"确认决策"按钮 `disabled = !selectedOptionId && !freeInputText`
  - 确认时调 `useTurn.makeDecision(selectedOptionId || { freeInput: freeInputText })`
  - 确认后清空 `selectedOptionId`，进入"已决策"态显示"下一回合"
- **stores/game.ts**：增加 `selectedOptionId` 状态（便于跨组件同步）
- **验证**：`tests/component/decision-button.test.ts` 更新验证选中态；`tests/unit/use-turn.test.ts` 验证两步流程；H5 浏览器验证可反悔重选；`pnpm lint` + `pnpm typecheck` 通过

### T3.2 修改 useTurn.ts 危机预警 + 简报触发

- `startTurn()` 内增加危机检查：
  ```ts
  const crisis = getCrisis(state.attributes)
  if (crisis) {
    toast.warning(`${crisis.name}濒临崩溃（当前 ${crisis.value}），需尽快应对`)
  }
  ```
- `startTurn()` 内增加简报调用（与 generate-event 并行）：
  ```ts
  const briefingPromise = api.post('/api/game/advisor-briefing', { saveId, turn, stateSnapshot })
  const eventPromise = api.post('/api/game/generate-event', { saveId, turn, stateSnapshot })
  const [event, briefing] = await Promise.all([eventPromise, briefingPromise.catch(() => null)])
  ```
- 简报失败不阻断（catch 返回 null）
- **验证**：`tests/unit/use-turn.test.ts` 更新验证危机 toast 与简报并行；`pnpm typecheck` 通过

### T3.3 图标 tooltip 全覆盖

- 检查所有纯图标按钮（无文字），加 `v-tooltip`：
  - game-main：同步按钮、军师按钮、折叠/展开图标
  - index：设置按钮、返回按钮
  - help：返回按钮
  - settings：各操作图标
  - character-create：返回按钮
  - AdvisorDrawer：关闭按钮、发送按钮
- **验证**：Grep 搜索 `class="[^"]*icon[^"]*"` 与 SVG 按钮交叉确认无遗漏；H5 浏览器 hover 验证；小程序长按验证；`pnpm lint` 通过

### T3.4 错误文案友好化

- **game-main/index.vue**：
  - "事件生成失败，请点击「自由行动」继续"→"局势推演出错，正在重试…"（自动重试 1 次）
  - "startTurn 失败：xxx"→"网络异常，请重试"（错误详情 `console.error`）
- **useTurn.ts**：所有 `onError` 回调文案白话化，技术错误码 `console.error` 保留
- **useAdvisor.ts**："军师沉默"占位保留（已有古风感，可接受）+ 补充"可重新提问"
- **utils/api.ts**：网络错误统一返回友好文案"网络连接失败，请检查网络"
- **验证**：H5 浏览器模拟断网验证文案；`pnpm lint` + `pnpm typecheck` 通过

### T3.5 阶段 3 全量验证

- 前端：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:component`
- H5 端手动验证：
  - 选项点击进入选中态，可切换，确认后才生效
  - 属性<30 回合开始触发 toast
  - 所有图标 hover 显示 tooltip
  - 模拟断网显示友好错误
- 微信小程序端验证长按 tooltip 与选项两步交互
- **验证**：所有命令退出码 0，双端正常

## 阶段 4：E2E 测试 + 文档同步

### T4.1 E2E 测试覆盖核心新流程

- 新增 `tests/e2e/onboarding.spec.ts`：首次进入引导 6 步完整流程 + 跳过流程
- 新增 `tests/e2e/help-page.spec.ts`：首页→如何游戏→帮助页渲染验证
- 新增 `tests/e2e/two-step-decision.spec.ts`：选项选中→反悔重选→确认决策完整流程
- 新增 `tests/e2e/crisis-warning.spec.ts`：手动注入低属性存档→回合开始触发 toast
- 修改现有 `tests/e2e/character-create.spec.ts`：文案白话化断言更新
- **验证**：`cd game-web && pnpm test:e2e` 全部通过

### T4.2 更新 docs/game-design.md

- 补充"综合实力 UI 展示规则"章节：GoalPanel/FocusPanel 进度条展示、90 阈值刻度
- 补充"危机预警阈值"章节：属性<30 触发 toast.warning，取最低项
- 补充"文案规范"章节：功能文案白话、剧情文案古风的边界
- **验证**：与 `copywriting.ts` 实现一致

### T4.3 更新 docs/API.md

- 新增 `POST /api/game/advisor-briefing` 路由规格（请求/响应/错误码）
- **验证**：与 `advisor-briefing.post.ts` 实现一致

### T4.4 全量最终验证

- 前端：`cd game-web && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:component && pnpm test:e2e`
- 后端：`cd server && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:api`
- 构建验证：`cd game-web && pnpm build:h5 && pnpm build:mp-weixin`
- H5 + 微信小程序双端完整流程验证：首页→如何游戏→开始游戏→引导→回合（焦点/事件/选项两步/军师简报/危机预警）→折叠展开→结局
- **验证**：所有命令退出码 0；H5 产物可部署；小程序产物可上传体验版
