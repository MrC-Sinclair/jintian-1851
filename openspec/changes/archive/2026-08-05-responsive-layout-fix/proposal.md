> **状态：已归档（代码已交付，2026-08-05；提案事后补录于 2026-08-06，现归档）**
> 代码交付：3 个页面 + App.vue 全局样式 + logo 资源替换，已用 Playwright 在 320/375/1280px 视口实测通过
> 触发原因：用户反馈首页「缩小没自适应」、settings / game-main 宽屏右侧大片白色空白、首页 uni-app 默认绿色 logo 与古风主题不符

## Why

项目进入 H5 桌面浏览器实测阶段后，暴露三类布局与品牌问题：

- **缩放不自适应（高）**：首页在窄屏（320/375px）下内容被裁剪或横向溢出，玩家误以为"缩小没自适应"。根因是多个交互元素（同步/军师/返回/操作按钮）使用了 `min-width: 36px` / `44px` 等**固定 px 物理像素**，rpx 等比例缩放时固定 px 不随之缩放，在窄屏下撑破视口宽度导致横向滚动或内容截断。
- **宽屏大片空白（高）**：settings、game-main 在桌面宽屏（如 1280px）下右侧露出浏览器默认白底，与游戏米黄渐变主题割裂。根因是 uni-app H5 的容器层级（`#app` / `uni-app` / `uni-page` / `uni-page-wrapper` / `uni-page-body` 及 `page` 虚拟选择器）默认未强制铺满视口宽度，且部分页面根容器缺少 `width: 100%`，外部容器露出白底。
- **品牌图标不符（中）**：首页沿用 uni-app 默认绿色 logo，与「金田：1851」深红金古风主题冲突，玩家第一眼品牌感知割裂。

本变更采用**全局兜底 + 局部 rpx 化**两段式修复，并替换品牌图标，幅度为**样式层修复**（无业务逻辑、无后端、无数据库变更）。

## What Changes

### 1. 全局宽屏铺满（App.vue）

- 在 `App.vue` 的全局 `<style>` 中，强制 uni-app H5 全链路容器铺满视口并统一渐变背景：
  - `html, body`：`width: 100%; min-height: 100vh; background-color: #fdf6e3`
  - `#app, uni-app, uni-page, uni-page-wrapper, uni-page-body`：`width: 100% !important; max-width: none !important; min-height: 100vh; background: 线性渐变(#fdf6e3 → #f5e6c8) !important`
  - `page`（uni-app 虚拟选择器，需 `stylelint-disable` 注释绕过后处理）：`width: 100% !important; min-height: 100vh; 渐变背景 !important`
- 作用：从最外层兜底，杜绝任何页面在宽屏露出白底，且不依赖单页面各自处理。

### 2. 页面根容器铺满 + 横向溢出兜底

对以下页面根容器增加 `width: 100%;` 与 `overflow-x: hidden;`：

- `pages/index/index.vue` → `.home`
- `pages/game-main/index.vue` → `.game-main`
- `pages/settings/index.vue` → `.settings`

### 3. 固定 px 触摸目标改为 rpx（跟随视口缩放）

将三类按钮的固定 `px` 触摸目标尺寸改为 `rpx`，使其随屏宽等比例缩放，避免在窄屏撑破视口：

| 页面 / 元素 | 原值（px） | 新值（rpx） |
| --- | --- | --- |
| `game-main` 同步/图标按钮（`&__sync-btn` 等） | `min-width/min-height: 36px` | `72rpx` |
| `game-main` 操作按钮（`&__btn` / `&__footer-btn`） | `min-width/min-height: 44px` | `88rpx` |
| `settings` 返回/图标按钮（`&__back` / `&__header-placeholder`） | `36px` | `72rpx` |
| `settings` 操作按钮（`&__btn`） | `44px` | `88rpx` |

> 说明：按钮内部文字/内边距已普遍使用 rpx，本次仅修正触摸目标尺寸的 px → rpx。rpx 依据 750rpx = 屏宽换算，`72rpx ≈ 36px`（375 基准）、`88rpx ≈ 44px`，在窄屏自动等比缩小。

### 4. 品牌 logo 替换与优化

- 将 `static/logo.png` 替换为 AI 生成的深红古风图标（交叉古剑 + 帅印 + 龙纹祥云，主题色 `#8b1a1a` / 金 `#d4a574`），与游戏设计风格统一。
- `pages/index/index.vue`：
  - `logo` 引用加缓存破版本号：`src="/static/logo.png?v=2"`
  - `.home__logo` 尺寸 `200rpx → 280rpx`，新增 `border-radius: 32rpx; box-shadow: 0 8rpx 32rpx rgba(139,26,26,0.15);`，提升首屏品牌质感。

## Capabilities

### Modified Capabilities

- `responsive-layout`（全局 + 页面级响应式）：App.vue 全链路容器铺满 + 渐变背景兜底；三页面根容器 `width:100%` + `overflow-x:hidden`；关键触摸目标 px → rpx 化
- `brand-assets`（品牌资源）：`static/logo.png` 替换为古风图标；首页 logo 放大 + 圆角阴影优化

> 说明：上述 capability 名称系为本提案补录所设，便于归档追溯；当前 `openspec/specs/` 尚未沉淀对应 spec 模块（属本次补录的边界，见下方 Impact / 残余不确定性）。

## Impact

| 层级 | 影响 |
| --- | --- |
| 前端页面 | 修改 `pages/index/index.vue`（logo 引用 + `.home__logo` 尺寸/圆角/阴影）、`pages/game-main/index.vue`（`.game-main` 铺满 + 按钮 px→rpx）、`pages/settings/index.vue`（`.settings` 铺满 + 按钮 px→rpx） |
| 前端全局样式 | 修改 `src/App.vue`（全链路容器 `width:100%` + 渐变背景兜底，新增 `page` 选择器需 stylelint 禁用注释） |
| 前端资源 | 替换 `static/logo.png`（古风深红金图标，覆盖默认绿色 logo） |
| 后端 | 无变更 |
| 数据库 | 无变更 |
| AI 调用 | 无变更 |
| 多端兼容 | 改动均为纯 CSS（rpx 单位三端通用；`page` 选择器为 uni-app 编译期虚拟选择器，H5/小程序/App 均生效）；未引入任何浏览器独有 API，不影响小程序/App 构建 |
| 测试 | 已用 Playwright 在 320px / 375px / 1280px 视口实测：无横向溢出、无宽屏白底、logo 正常渲染；`pnpm lint`（含 stylelint）通过 |
| 文档 | 本提案为事后补录，仅沉淀于 `openspec/changes/`，未改动 `docs/`（`docs/` 不涉及布局细节，无需更新） |

## 残余不确定性

- `[不确定]` **小程序/App 端真实渲染验证**：本次修复仅在 H5 端用 Playwright 实测，未跑 `dev:mp-weixin` / App 真机。rpx 与 `page` 选择器为 uni-app 跨端原生能力，理论上一致，但建议上线前在真机补验一次（见 `openspec/pre-launch-checklist.md` 双端验证项）。
- `[不确定]` **stylelint 规则长期维护**：`App.vue` 中 `page` 选择器依赖 `/* stylelint-disable-next-line selector-type-no-unknown */` 注释，若后续升级 stylelint 配置需确认该绕过仍有效。
