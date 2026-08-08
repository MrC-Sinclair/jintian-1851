# onboarding-tutorial — 新手引导覆盖层

## ADDED Requirements

### Requirement: 首次进入游戏的交互式引导

游戏 MUST 在玩家首次进入 `game-main` 时自动触发交互式引导覆盖层（`OnboardingOverlay`），分 6 步高亮讲解核心概念，帮助玩家在 30 秒内理解游戏目标与操作方式。引导状态通过 `localStorage`（key: `onboarding_done`）持久化，已完成或跳过的玩家不再触发。

#### Scenario: 首次进入游戏自动触发引导

WHEN 玩家首次进入 `game-main` 页面（`localStorage.onboarding_done` 不存在或为 false）
THEN `OnboardingOverlay` 组件挂载并显示第 1 步引导
AND 全屏半透明遮罩 `position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:1000` 覆盖游戏界面
AND 引导卡片显示在屏幕底部（距底部 `120rpx`），含标题、内容、步骤指示"1/6"、"下一步"与"跳过"按钮

#### Scenario: 引导步骤数据驱动

WHEN `OnboardingOverlay` 挂载
THEN `steps` props 包含 6 个步骤对象，每个对象含 `{ target: string, title: string, content: string }`
AND 步骤顺序为：①欢迎与背景 ②状态面板（5维属性+4资源）③事件卡片 ④决策方式（选项/自由行动）⑤军师对话 ⑥胜利/失败条件
AND 每步切换时调 `getElementRect(targetRef)` 获取目标区块位置，设置高亮元素 `style.left/top/width/height`
AND 高亮目标区块用 `box-shadow: 0 0 0 9999px rgba(0,0,0,0.6)` 外阴影覆盖非高亮区

#### Scenario: 玩家点击"下一步"前进

WHEN 玩家在第 N 步点击"下一步"按钮（N < 6）
THEN `currentStep` 递增到 N+1
AND 高亮目标切换到第 N+1 步的 `target` 区块
AND 步骤指示更新为"(N+1)/6"
AND 第 6 步时"下一步"按钮文案变为"开始游戏"

#### Scenario: 玩家点击"跳过"直接完成

WHEN 玩家在任意步骤点击"跳过"按钮
THEN `useOnboarding.markDone()` 被调用
AND `localStorage.onboarding_done` 设为 `true`
AND `OnboardingOverlay` 卸载
AND `useTurn.startTurn()` 被触发开始首个回合

#### Scenario: 引导完成后不再触发

WHEN 玩家再次进入 `game-main`（`localStorage.onboarding_done === true`）
THEN `OnboardingOverlay` 不挂载
AND `useTurn.startTurn()` 直接触发

#### Scenario: 引导触摸目标符合规范

WHEN `OnboardingOverlay` 渲染
THEN "下一步"与"跳过"按钮 `min-w/min-h: 88rpx`（≈44px）
AND 按钮按压时 `active:scale-0.95` 提供触觉反馈
AND 遮罩点击不触发任何操作（仅按钮可点击）

### Requirement: 引导高亮定位三端兼容

引导覆盖层的高亮目标定位 MUST 在 H5、微信小程序、App 三端均能准确获取目标区块位置。

#### Scenario: H5 端高亮定位

WHEN 平台为 H5 浏览器
THEN `getElementRect(selector)` 使用 `document.querySelector(selector).getBoundingClientRect()` 获取位置
AND 返回 `{ left, top, width, height }` 相对视口的坐标

#### Scenario: 微信小程序/App 端高亮定位

WHEN 平台为微信小程序或 App
THEN `getElementRect(selector)` 使用 `uni.createSelectorQuery().select(selector).boundingClientRect()` 获取位置
AND 异步返回 Promise，resolve `{ left, top, width, height }`

#### Scenario: SSR 水合安全

WHEN 服务端渲染 `game-main`
THEN `OnboardingOverlay` 不渲染（用 `v-if="mounted && isOnboarding"` 控制）
AND `mounted` ref 初始值为 `false`，在 `onMounted` 内设为 `true`
AND 避免服务端与客户端渲染不一致的水合错误
