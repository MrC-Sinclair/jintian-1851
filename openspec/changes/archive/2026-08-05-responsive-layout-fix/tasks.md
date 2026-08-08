# 任务拆分 — 响应式布局修复 + 品牌 logo 替换

> 本提案为**事后补录**：代码已交付，任务按实际落地顺序回溯记录，便于归档追溯。所有任务均已通过 Playwright 实测 + `pnpm lint` 验证。

## T1 App.vue 全局宽屏铺满兜底

- 在 `game-web/src/App.vue` 全局 `<style>` 增加：
  - `html, body`：`width:100%; min-height:100vh; background-color:#fdf6e3`
  - `#app, uni-app, uni-page, uni-page-wrapper, uni-page-body`：`width:100% !important; max-width:none !important; min-height:100vh; background:linear-gradient(180deg,#fdf6e3 0%,#f5e6c8 100%) !important`
  - `page`（加 `/* stylelint-disable-next-line selector-type-no-unknown */`）：`width:100% !important; min-height:100vh; 同款渐变背景 !important`
- **验证**：`pnpm lint`（stylelint 绕过生效）；1280px 视口截图无右侧白底

## T2 三页面根容器铺满 + 横向溢出兜底

- `pages/index/index.vue` → `.home`：加 `width:100%`
- `pages/game-main/index.vue` → `.game-main`：加 `width:100%` + `overflow-x:hidden`（注释说明防止子元素固定最小宽度撑破视口）
- `pages/settings/index.vue` → `.settings`：加 `width:100%` + `overflow-x:hidden`
- **验证**：`pnpm lint`；320/375/1280px 三视口截图无溢出/无白底

## T3 固定 px 触摸目标改为 rpx

- `pages/game-main/index.vue`：
  - `&__sync-btn` 等图标按钮：`min-width/min-height: 36px → 72rpx`
  - `&__btn` / `&__footer-btn` 操作按钮：`min-width/min-height: 44px → 88rpx`
- `pages/settings/index.vue`：
  - `&__back` / `&__header-placeholder` 图标按钮：`36px → 72rpx`
  - `&__btn` 操作按钮：`44px → 88rpx`
- 内部文字/内边距若仍为 px 一并改为 rpx（保持与既有 rpx 用法一致）
- **验证**：`pnpm lint`；375px 下按钮尺寸 ≈ 规范值（36/44px），320px 下等比缩小不溢出

## T4 品牌 logo 替换与首页优化

- 替换 `game-web/src/static/logo.png` 为 AI 生成的深红古风图标（交叉古剑 + 帅印 + 龙纹祥云，主题色 `#8b1a1a` / 金 `#d4a574`）
- `pages/index/index.vue`：
  - `logo` 引用：`src="/static/logo.png" → "/static/logo.png?v=2"`（破缓存）
  - `.home__logo`：尺寸 `200rpx → 280rpx`；新增 `border-radius:32rpx; box-shadow:0 8rpx 32rpx rgba(139,26,26,0.15)`
- **验证**：首页截图确认古风 logo 渲染、圆角阴影正常、`?v=2` 破缓存生效

## T5 全量验证

- 前端：`cd game-web && pnpm lint`（本次为纯样式/资源变更，无需 typecheck/test 增量——无 TS 类型与逻辑改动）
- Playwright 多视口实测：
  - 320px / 375px：无横向滚动、无内容截断
  - 1280px：无右侧白底，容器铺满视口
  - 首页：古风 logo + 圆角阴影正常
- **验证**：所有截图无异常，`pnpm lint` 退出码 0
