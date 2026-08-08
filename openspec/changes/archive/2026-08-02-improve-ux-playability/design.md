# 体验优化（improve-ux-playability）— 技术设计

## Goals

- **玩家 30 秒内理解游戏目标**：首次进入通过 onboarding 6 步引导 + GoalPanel 常驻目标展示，玩家无需查阅文档即知"要做什么、怎样算赢、怎样算输"
- **术语零理解门槛**：所有专业术语（5维属性、4资源、势力关系、NPC行动、事件类型）均有 `InfoHint` 问号图标点击解释；effects 用完整词（"军事+10"非"军+10"）
- **信息密度可控**：game-main 一屏从 7 区块降为 3 核心（焦点+事件+操作）+ 3 可折叠（状态/近况/天下动静），玩家按需展开
- **交互可反悔**：选项改为"先选中后确认"两步交互，支持反悔重选，避免误点
- **危机主动提示**：属性<30 时回合开始 toast.warning，玩家不会"不知不觉输掉"
- **三端一致体验**：H5/微信小程序/App 三端引导、tooltip、折叠动画均可用，不依赖某一端独有 API
- **遵循 AGENTS.md 规范**：触摸目标≥36px/44px、按压 active:scale-95、自定义对话框/Toast、`max-height`+`transition` 折叠、`<TransitionGroup>` 动画

## Non-Goals

- **不做**：任务/成就/勋章系统（MVP 仅做目标展示与危机预警，不做任务列表）
- **不做**：多语言 i18n（仍中文唯一）
- **不做**：BGM/音效/CG 立绘
- **不做**：战斗动画、过场动画
- **不做**：新手引导的视频/语音教程（仅图文交互式引导）
- **不做**：A/B 测试框架（引导内容固定，后续按数据手动迭代）
- **不做**：用户行为埋点分析后台（仅 localStorage 记录 onboarding 完成状态）
- **不做**：改写全部剧情文案（事件描述/结局/军师对话保留古风，仅功能文案白话化）

## Architecture

### 改造后目录结构（仅列变更部分，`★` 新增 `✏️` 修改）

```
d:\code\codeWork\GAME\
├── game-web/src/
│   ├── pages/
│   │   ├── index/index.vue              ✏️ 加"如何游戏"入口
│   │   ├── game-main/index.vue          ✏️ 信息分区重构 + 焦点区块 + 引导触发
│   │   ├── character-create/index.vue   ✏️ 文案白话化
│   │   ├── help/index.vue               ★ 新增帮助页
│   │   ├── settings/index.vue           ✏️ 文案微调
│   │   └── end-game/index.vue           ✏️ 文案微调
│   ├── components/
│   │   ├── OnboardingOverlay.vue        ★ 新手引导覆盖层
│   │   ├── GoalPanel.vue                ★ 目标与进度面板
│   │   ├── FocusPanel.vue               ★ 当前焦点区块（综合实力+危机+建议）
│   │   ├── InfoHint.vue                 ★ 术语解释问号组件
│   │   ├── CollapsibleSection.vue       ★ 可折叠区块通用组件
│   │   ├── StatusPanel.vue              ✏️ 加综合实力模块 + InfoHint
│   │   ├── FactionCard.vue              ✏️ 加 InfoHint + 文案
│   │   ├── EventCard.vue                ✏️ 文案
│   │   ├── DecisionButton.vue           ✏️ 两步交互 + effects 完整词
│   │   ├── TurnTimeline.vue             ✏️ 补全选择记录
│   │   ├── NpcActionList.vue            ✏️ 突出影响 + InfoHint
│   │   └── AdvisorDrawer.vue            ✏️ 空状态引导文案
│   ├── directives/
│   │   └── tooltip.ts                   ★ v-tooltip 自定义指令
│   ├── composables/
│   │   ├── useOnboarding.ts             ★ 引导状态管理
│   │   ├── useTurn.ts                   ✏️ 危机预警 + 军师简报触发
│   │   └── useAdvisor.ts                ✏️ 局势简报逻辑
│   ├── stores/
│   │   └── game.ts                      ✏️ 加 onboardingDone/selectedOptionId/focusHint
│   ├── utils/
│   │   ├── copywriting.ts               ★ 文案常量 + effects 标签映射
│   │   └── goal-hint.ts                 ★ 焦点提示生成（综合实力/危机/建议）
│   └── types/
│       └── game.ts                      ✏️ 加 OnboardingStep/BriefingResult 类型
├── server/
│   ├── api/game/
│   │   └── advisor-briefing.post.ts     ★ 局势简报（非流式 generateObject）
│   └── utils/prompts/
│       └── advisor-chat.ts              ✏️ 新玩家引导加强
└── docs/
    ├── game-design.md                   ✏️ 补充 UI 展示规则
    └── API.md                           ✏️ 新增 advisor-briefing 路由
```

### game-main 改造后信息层级（从上到下）

```
┌─────────────────────────────────────┐
│ 顶部栏：回合数 + 日期 + 同步(v-tooltip)│
├─────────────────────────────────────┤
│ FocusPanel（置顶，始终展开）          │  ← 新增
│  综合实力进度条 ▓▓▓▓▓░░░ 72/100       │
│  ⚠ 危机：军事 15（濒临崩溃）           │
│  💡 建议：本回合优先提升军事            │
├─────────────────────────────────────┤
│ EventCard（始终展开，核心交互）        │
│  [事件类型] 事件标题                   │
│  事件描述...                          │
│  ┌─────────────────────────────┐    │
│  │ DecisionButton（选中态高亮）  │    │  ← 两步交互
│  │  选项文案                    │    │
│  │  军事+10  银两-200            │    │  ← effects 完整词
│  └─────────────────────────────┘    │
│  [自由行动输入框]（可展开）            │
├─────────────────────────────────────┤
│ CollapsibleSection：状态详情（默认展开）│
│  StatusPanel（含综合实力模块 + InfoHint）│
│  FactionCard 列表（含 InfoHint）       │
├─────────────────────────────────────┤
│ CollapsibleSection：近况时间线（默认折叠）│  ← 补全选择记录
│  TurnTimeline（含玩家选择 + effects）   │
├─────────────────────────────────────┤
│ CollapsibleSection：天下动静（默认折叠） │  ← 突出影响
│  NpcActionList（含"对你影响"行 + InfoHint）│
├─────────────────────────────────────┤
│ GoalPanel（可折叠，默认折叠，角标显示进度）│  ← 新增
│  长期目标：成就霸业                    │
│  胜利：综合实力≥90                    │
│  失败：任一属性≤0                     │
├─────────────────────────────────────┤
│ 底部固定栏：军师(v-tooltip) | 确认决策/下一回合 │
└─────────────────────────────────────┘
```

### 数据流（关键改造点）

1. **首次进入 game-main**：`useOnboarding.checkAndStart()` → 读 `localStorage.onboarding_done` → 未完成则挂载 `OnboardingOverlay`，完成后写 `onboarding_done=true` 并触发首次 `startTurn`
2. **回合开始**：`useTurn.startTurn()` → 生成事件 → **新增**：检查危机属性 → 属性<30 时 `toast.warning` → **新增**：调用 `advisor-briefing` 获取局势简报 → 渲染 FocusPanel
3. **玩家决策**：点击 DecisionButton → `selectedOptionId` 高亮（不立即生效）→ 点底部"确认决策" → `useTurn.makeDecision(selectedOptionId)` → 应用 effects → 记录到 history（含选择+effects）
4. **军师对话**：打开 AdvisorDrawer → 自动展示局势简报（首条）→ 玩家可继续追问

## Decisions

### D1：onboarding 用覆盖层 vs 内嵌提示 vs 独立教程页

**决策：覆盖层（OnboardingOverlay）+ 前置帮助页入口**

理由：
- 独立教程页（方案B）玩家看完进入游戏仍忘，且额外增加页面跳转
- 内嵌提示（方案C）碎片化，难以系统讲解 6 个概念
- 覆盖层（方案A）可在真实游戏界面高亮对应区块，边看边对照，记忆最深
- 但覆盖层只首次触发，老玩家或跳过者无补救 → 首页加"如何游戏"入口跳 help 页作为持久参考
- `position:fixed` 全屏覆盖 + `z-index:1000` + 半透明遮罩，三端通用（uni-app `view` 支持 fixed）

**实现要点**：
- 高亮目标区块用 `box-shadow: 0 0 0 9999px rgba(0,0,0,0.6)`（外阴影覆盖非高亮区），点击穿透到目标区块的 `ref` 定位
- 步骤数据驱动：`steps: Array<{ target: string, title: string, content: string }>`，便于迭代文案
- 触摸目标：下一步/跳过按钮 `min-w/min-h: 44px`

### D2：v-tooltip 移动端用长按 vs 点击 vs 不做移动端

**决策：移动端长按 500ms 触发 + 桌面端 hover 触发**

理由：
- 移动端无 hover，点击又会被按钮自身 click 拦截
- 长按 500ms 是移动端常见"显示更多操作"约定（微信消息长按、浏览器长按图片）
- uni-app `@longpress` 事件三端通用（H5/小程序/App 均支持），无需 polyfill
- 桌面端保留 hover，鼠标用户无额外操作成本
- 长按触发后浮层 3 秒自动消失，或点击任意位置关闭

**实现要点**：
- 指令 `v-tooltip="'文字'"`，binding.value 为字符串
- 浮层用 `position:fixed` + 动态计算位置（基于元素 `getBoundingClientRect`）
- 浮层 `z-index:999`，半透明黑底白字，`max-width: 80%`
- 纯图标按钮必须加，违反 AGENTS.md "图标按钮提示"规范会阻断

### D3：选项两步交互 vs 一步确认 + Undo

**决策：两步交互（先选中后确认）**

理由：
- 一步确认 + Undo（方案B）需要维护历史栈，effects 已应用后回滚涉及多个属性/资源，复杂且易错
- 两步交互（方案A）在确认前不应用任何 effects，零回滚成本，符合"预防胜于治疗"
- 选中态用 `selectedOptionId` 高亮（边框+背景变化），底部按钮文案"确认决策"明确
- 自由行动模式：textarea 输入后点"确认决策"才调 `resolve-decision`
- 支持反悔：选中后可点其他选项切换，或切到自由行动模式

**实现要点**：
- `DecisionButton` 接收 `selected` prop，emit `select` 事件
- 父组件 `game-main` 维护 `selectedOptionId`，底部按钮 `disabled = !selectedOptionId && !freeInputText`
- 确认后清空 `selectedOptionId` 进入"已决策"态，显示"下一回合"

### D4：局势简报用流式 vs 非流式

**决策：非流式 `generateObject`**

理由：
- 简报仅 50 字内，流式首 token 延迟（1-3s）反而比整体返回（1-2s）更慢感知
- 非流式 `generateObject` 可用 zod schema 约束结构（`{ summary: string, suggestion: string }`），便于 FocusPanel 渲染
- 简报与军师对话不同：对话是玩家主动长文本交互需流式，简报是系统主动短文本无需流式
- 成本：`generateObject` 约 200-400 tokens，用 `Qwen/Qwen3-8B` + `enable_thinking:false`，≈0.0002元/回合
- 失败降级：返回空简报，FocusPanel 只显示综合实力+危机，不阻断游戏

**实现要点**：
- `POST /api/game/advisor-briefing`，zod 校验 `{ saveId, turn, stateSnapshot }`
- 返回 `{ ok: true, data: { summary, suggestion } }`
- 复用 `siliconflow-fetch.ts` 的 `createSiliconFlowFetch(false)` 注入 `enable_thinking:false`
- 前端 `useTurn.startTurn()` 内并行调用（与 generate-event 并发，不串行），失败降级不阻断

### D5：FocusPanel 建议生成 vs 纯展示

**决策：基于规则的本地生成 + AI 简报辅助**

理由：
- 纯 AI 建议（方案A）每回合多一次 LLM 调用，成本与延迟增加
- 纯规则建议（方案B）死板，"军事低就提升军事"缺乏语境
- 折中：规则生成"最紧急危机"（属性<30 取最低项）+ AI 简报给"本回合建议"（已由 D4 的 advisor-briefing 返回 suggestion 字段）
- 规则部分在 `utils/goal-hint.ts` 实现，纯函数易测试

**实现要点**：
- `generateFocusHint(state)` 返回 `{ overallPower, crisis: { attr, value } | null, suggestion: string }`
- `overallPower = (military+economy+politics+people+diplomacy)/5`
- `crisis`：遍历 5 维属性，取 <30 中最低者；无则 null
- `suggestion`：默认"稳步发展各项实力"，有 crisis 时"优先应对{attrName}危机"，AI 简报返回时覆盖

### D6：文案管理集中 vs 分散

**决策：集中到 `utils/copywriting.ts`**

理由：
- 分散在各组件难以统一迭代（改一个词要翻多个文件）
- 集中管理便于后续做 A/B 测试或 i18n（虽 Non-Goal，但留扩展空间）
- effects 标签映射（`military` → "军事"）当前分散在 `DecisionButton.vue` 和 `NpcActionList.vue` 两处，应抽出复用

**实现要点**：
- `copywriting.ts` 导出 `EFFECT_LABELS`（完整词映射）、`BUTTON_TEXT`（按钮文案）、`PHASE_HINTS`（阶段提示）、`TOOLTIP_TEXT`（图标提示）
- 组件 import 使用，禁止硬编码文案字符串

### D7：可折叠区块用 v-if vs max-height

**决策：`max-height` + `overflow:hidden` + `transition`（遵循 AGENTS.md 规范）**

理由：
- AGENTS.md 明确："折叠/展开区域禁止用 `v-if` 直接切换，必须用 `max-height` + `overflow: hidden` + `transition` 实现平滑高度过渡"
- `v-if` 会卸载组件丢失内部状态（如 StatusPanel 的数字滚动动画状态）
- `max-height` 设一个足够大的值（如 `2000rpx`），transition `max-height 300ms ease`

**实现要点**：
- `CollapsibleSection.vue` 通用组件：`props: { title, defaultExpanded, icon }`，内部 `ref<boolean>` 控制展开
- 展开：`max-height: 2000rpx; overflow: hidden; transition: max-height 300ms ease, opacity 200ms ease`
- 折叠：`max-height: 0; opacity: 0; overflow: hidden`
- 标题栏可点击，右侧 chevron 图标旋转动画

## 手机端 / 平板端适配方案

本项目用 uni-app `rpx` 单位（750rpx = 屏幕宽度），**不使用** Tailwind `sm:` 断点（那是 my-chat 项目规范，game-web 不用 Tailwind）。

### OnboardingOverlay

- 手机端：全屏覆盖，引导卡片区宽度 `90%`，距底部 `120rpx`（避让手势条）
- 平板端：引导卡片区宽度 `60%`，居中
- 高亮目标区块用 `box-shadow` 外阴影，三端一致
- 触摸目标：下一步/跳过按钮 `min-w/min-h: 88rpx`（≈44px）

### v-tooltip

- 手机端：长按 500ms 触发，浮层 `position:fixed` 在元素上方，`max-width: 80%`
- 平板端：同手机端（平板也是触摸交互）
- H5 桌面浏览器：hover 触发，浮层在元素上方
- 浮层字号 `24rpx`（≈12px），`padding: 16rpx 24rpx`

### FocusPanel

- 手机端：单列布局，进度条占满宽，危机/建议换行显示
- 平板端：进度条占满宽，危机与建议可同行（`flex-direction: row` 当宽度足够）
- 进度条高度 `16rpx`（≈8px），触摸友好

### CollapsibleSection

- 标题栏 `min-h: 88rpx`（≈44px）保证触摸目标
- 折叠动画 `max-height 300ms ease`
- 展开/折叠图标 `24rpx`（≈12px）+ `v-tooltip` 提示

### DecisionButton 两步交互

- 选中态：`border: 4rpx solid #8B1A1A`（主题红）+ `bg: #FFF8E7`（浅米黄）
- 未选中：`border: 2rpx solid #D4C5A0`
- 按钮 `min-w/min-h: 88rpx`（≈44px）
- effects 标签 `flex-wrap: wrap`，字号 `24rpx`

## 触摸交互尺寸

| 元素 | 最小尺寸 | 依据 |
|---|---|---|
| OnboardingOverlay 下一步/跳过按钮 | 88rpx×88rpx（≈44px） | AGENTS.md 输入区按钮≥44px |
| v-tooltip 触发区（图标按钮） | 72rpx×72rpx（≈36px） | AGENTS.md 图标按钮≥36px |
| CollapsibleSection 标题栏 | 88rpx 高（≈44px） | AGENTS.md 触摸目标≥44px |
| DecisionButton | 88rpx×88rpx（≈44px） | AGENTS.md 输入区按钮≥44px |
| FocusPanel 进度条 | 16rpx 高（≈8px） | 视觉即可，非触摸目标 |
| InfoHint 问号图标 | 48rpx×48rpx（≈24px） | 非主要操作，可略小但≥24px |

## API 变更：参数校验与错误处理

### 新增 POST /api/game/advisor-briefing

**请求**：
```json
{
  "saveId": "uuid-v4",
  "turn": 1,
  "stateSnapshot": {
    "turn": 1,
    "date": { "year": 1851, "month": 1 },
    "attributes": { "military": 50, "economy": 50, "politics": 50, "people": 50, "diplomacy": 50 },
    "resources": { "silver": 1000, "troops": 500, "food": 800, "reputation": 10 },
    "character": { "background": "文官", "factionName": "清廷" },
    "recentEvents": []
  }
}
```

**zod 校验**：
```ts
const BodySchema = z.object({
  saveId: z.string().uuid(),
  turn: z.number().int().min(1),
  stateSnapshot: StateSnapshotSchema  // 复用现有 schema
})
```

**响应**：
- 200：`{ ok: true, data: { summary: string, suggestion: string } }`
- 400：`{ ok: false, error: { code: 'INVALID_PARAMS', message: '参数错误' } }`
- 429：`{ ok: false, error: { code: 'RATE_LIMITED', message: '请求过于频繁' } }`（复用现有 rate-limit）
- 500：`{ ok: false, error: { code: 'BRIEFING_FAILED', message: '局势简报生成失败' } }`

**错误处理策略**：
- LLM 调用失败：降级返回 `{ summary: '', suggestion: '' }` + header `X-Fallback: true`，**不** throw（避免阻断游戏）
- 超时 10s：降级同上
- 并发锁冲突：返回 429（复用 `concurrency-lock.ts`）

## 多端兼容方案

### H5（浏览器）

- `v-tooltip` 用 `@mouseenter/@mouseleave` + `@longpress`（H5 也支持 longpress）
- `OnboardingOverlay` 用 `position:fixed` + `getBoundingClientRect` 定位
- `CollapsibleSection` `max-height` transition 原生支持

### 微信小程序

- `v-tooltip`：`@longpress` 是 uni-app 编译到小程序的原生事件（映射到 `bindlongpress`），无需 polyfill
- `OnboardingOverlay`：`position:fixed` 小程序支持，`box-shadow` 外阴影高亮支持
- `CollapsibleSection`：`max-height` transition 小程序支持（需 `transition` 属性，uni-app 编译）
- `getBoundingClientRect`：小程序用 `uni.createSelectorQuery()` 替代，封装到 `utils/element-rect.ts`

### App（Android/iOS）

- 与小程序基本一致，`@longpress` 原生支持
- `position:fixed` 原生支持

### 关键差异处理

| 能力 | H5 | 小程序 | App |
|---|---|---|---|
| tooltip 触发 | hover + longpress | longpress only | longpress only |
| 元素定位 | `getBoundingClientRect` | `uni.createSelectorQuery` | `uni.createSelectorQuery` |
| transition | 原生 | uni-app 编译支持 | 原生 |
| localStorage | `localStorage` | `uni.setStorageSync` | `uni.setStorageSync` |

封装到 `utils/platform.ts` 统一接口，避免组件内判断平台。

## AI 调用策略

### 局势简报（advisor-briefing）

- **模型**：`Qwen/Qwen3-8B` + `enable_thinking:false`（通过 `siliconflow-fetch.ts` 注入）
- **调用方式**：`generateObject()` + zod schema `{ summary: z.string().max(60), suggestion: z.string().max(60) }`
- **并发**：与 `generate-event` 并行调用（不串行），不占用 `concurrency-lock`（简报无副作用，可并发）
- **缓存**：无缓存（每回合局势不同，缓存命中率低）
- **超时**：10s（超时降级空简报）
- **成本**：约 200-400 tokens 输入 + 60-120 tokens 输出 ≈ 0.0002 元/回合
- **开关**：`runtimeConfig.enableBriefing`（默认 `true`），可全局关闭省成本

### 军师对话提示词调整（advisor-chat）

- **新玩家引导加强**：提示词增加条件分支——`if turn <= 3` 则注入"当前是新玩家第{turn}回合，请：①多用白话少用文言 ②主动解释专业术语 ③给出具体可执行建议 ④语气鼓励"
- **不改变流式协议**：仍用 `streamText()` + SSE，仅 prompt 变化
- **不增加 token 成本**：提示词增加约 50 tokens，可忽略

### 总成本影响

| 项目 | 原成本 | 新成本 | 增量 |
|---|---|---|---|
| 单回合（无军师对话） | 3-8K tokens ≈ 0.003元 | +200-400 tokens（简报）≈ 0.0002元 | +7% |
| 单回合（含军师对话） | 5-10K tokens ≈ 0.004元 | +200-400 tokens ≈ 0.0002元 | +5% |
| 月活 1000 用户 × 日均 5 回合 | ≈ 15元/天 | ≈ 16元/天 | +1元/天 |

成本可控，默认开启简报。

## 残余不确定性

- `[不确定]` **onboarding 高亮定位精度**：`box-shadow` 外阴影方案在小程序端的 `getBoundingClientRect` 等价物（`createSelectorQuery`）异步返回，可能引导步骤切换时高亮闪烁。需在 T1.4 实测验证，若闪烁改为"半透明遮罩 + 目标区块 `position:relative; z-index:1001`"方案。
- `[不确定]` **长按事件与按钮 click 冲突**：`@longpress` 触发后是否仍触发 `@click`，uni-app 各端行为可能不一致。需在 T3.2 指令实现时实测，必要时 longpress 触发后 `event.preventDefault()` 阻止 click。
- `[不确定]` **FocusPanel 建议质量**：规则生成 + AI 简报的混合策略，AI 简报可能与规则建议矛盾（如规则说"优先军事"，AI 说"发展经济"）。MVP 阶段以 AI 简报为准（覆盖规则），后续观察数据调整。
- `[不确定]` **微信小程序 `max-height` transition 性能**：复杂 DOM 结构下 `max-height` 动画可能卡顿。若实测卡顿，改为 `transform: scaleY` 方案（但 scaleY 会拉伸内容，需权衡）。
