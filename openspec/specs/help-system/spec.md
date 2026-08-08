# help-system Specification

## Purpose
独立帮助页 `pages/help/index` 作为游戏百科与 FAQ，首页提供"如何游戏"入口。集中展示游戏背景、核心概念、胜负条件、玩法技巧，降低新手门槛、承载术语解释的统一出口。
## Requirements
### Requirement: 独立帮助页

游戏 MUST 提供独立的帮助页面 `pages/help/index`，作为玩家随时可查阅的游戏百科与 FAQ。首页 MUST 提供"如何游戏"入口跳转帮助页。

#### Scenario: 首页提供帮助入口

WHEN 玩家在首页 `pages/index/index`
THEN 4 个操作按钮下方存在"如何游戏"按钮
AND 按钮文案为 `BUTTON_TEXT.howToPlay`（"如何游戏"）
AND 按钮触摸目标 `min-h: 88rpx`，按压 `active:scale-0.95`
AND 点击跳转 `uni.navigateTo({ url: '/pages/help/index' })`

#### Scenario: 帮助页内容结构

WHEN 玩家进入 `pages/help/index`
THEN 页面用 `scroll-view` 滚动展示以下章节：
  1. 游戏背景：咸丰元年（1851年）背景介绍，玩家目标
  2. 核心概念百科：5 类身份、5 维属性、4 项资源、势力关系、事件类型、NPC 行动（每项含解释）
  3. 胜利与失败：综合实力≥90 胜利、任一属性≤0 失败、1912 年时光尽头
  4. 玩法技巧：优先平衡发展、关注危机预警、善用军师、自由行动可解锁隐藏策略
  5. FAQ：5-8 条常见问题
AND 顶部有返回按钮（`v-tooltip` 提示"返回"）+ 标题"如何游戏"
AND 返回按钮触摸目标 `min-w/min-h: 72rpx`

#### Scenario: 帮助页术语与 InfoHint 一致

WHEN 帮助页展示 5 维属性百科
THEN 每维属性的解释文案与 `StatusPanel` 中 `InfoHint` 的 `content` 一致
AND 文案来源统一为 `utils/copywriting.ts` 或常量模块，禁止多处硬编码不同解释

### Requirement: InfoHint 术语解释组件

游戏 MUST 提供 `InfoHint` 组件（小问号图标），覆盖 `StatusPanel`、`FactionCard`、`NpcActionList` 等组件的所有专业术语，玩家点击问号即弹出术语说明。

#### Scenario: InfoHint 渲染与交互

WHEN `InfoHint` 组件挂载
THEN 渲染圆形问号图标（直径 `48rpx`≈24px，背景 `#8B1A1A`，白色"?"）
AND 点击问号弹出说明浮层（`position:fixed` 居中，半透明遮罩）
AND 浮层内容：术语标题（粗体）+ 解释段落 + 关闭按钮
AND 点击浮层外区域或关闭按钮关闭浮层
AND 关闭按钮触摸目标 `min-w/min-h: 88rpx`

#### Scenario: StatusPanel 术语覆盖

WHEN `StatusPanel` 渲染 5 维属性
THEN 每维属性标签旁存在 `InfoHint`，解释该属性含义与影响
AND 解释文案示例："军事：军队战力、装备水平、将领素质。影响战斗胜负、叛乱镇压"

WHEN `StatusPanel` 渲染 4 项资源
THEN 每项资源标签旁存在 `InfoHint`，解释资源用途
AND 解释文案示例："银两：货币储备，用于购械、赈灾、行贿"

#### Scenario: FactionCard 术语覆盖

WHEN `FactionCard` 渲染势力信息
THEN 势力名称旁存在 `InfoHint`，解释"势力关系"概念
AND 解释文案："势力关系：-100（敌对）到 100（盟友），影响 NPC 对你的态度与行动"

#### Scenario: NpcActionList 术语覆盖

WHEN `NpcActionList` 渲染 NPC 行动
THEN 标题"天下动静"旁存在 `InfoHint`，解释 NPC 行动机制
AND 每种行动类型旁存在 `InfoHint`，解释该行动后果
AND 解释文案示例："扩张：势力正在扩张领土，可能威胁你的领地"

### Requirement: v-tooltip 自定义指令

游戏 MUST 提供 `v-tooltip` 自定义指令，覆盖所有纯图标按钮（军师/同步/返回/设置/折叠等），移动端通过长按 500ms 触发，桌面端通过 hover 触发。

#### Scenario: 桌面端 hover 触发

WHEN 平台为 H5 桌面浏览器且鼠标 `@mouseenter` 图标按钮
THEN 显示 tooltip 浮层（`position:fixed`，元素上方居中，`z-index:999`）
AND 浮层半透明黑底白字，`max-width:80%`，字号 `24rpx`，`padding:16rpx 24rpx`，圆角 `8rpx`
WHEN 鼠标 `@mouseleave`
THEN tooltip 浮层消失

#### Scenario: 移动端长按触发

WHEN 平台为触摸设备（`isTouchDevice()` 为 true）且玩家长按图标按钮 500ms
THEN 触发 `@longpress` 事件，显示 tooltip 浮层
AND 浮层 3 秒后自动消失，或点击任意位置关闭

#### Scenario: 长按与 click 冲突处理

WHEN 长按触发 tooltip 后玩家手指抬起并触发 `@click`
THEN `event.preventDefault()` + `event.stopPropagation()` 阻止 click 误触发按钮自身操作
AND 通过标志位（`longpressTriggered`）在下次 click 中判断，标志位在 click 后重置

#### Scenario: 指令用法

WHEN 开发者在模板中使用 `v-tooltip="'军师对话'"`（字符串形式）
THEN binding.value 为字符串，作为 tooltip 内容

WHEN 开发者使用 `v-tooltip="{ content: '同步存档', placement: 'top' }"`（对象形式）
THEN binding.value.content 为内容，placement 控制浮层位置（默认 `top`，可选 `bottom`）

#### Scenario: 全局注册

WHEN 应用初始化（`main.ts`）
THEN `app.directive('tooltip', vTooltip)` 全局注册指令
AND 所有 `.vue` 文件可直接使用 `v-tooltip` 无需 import

