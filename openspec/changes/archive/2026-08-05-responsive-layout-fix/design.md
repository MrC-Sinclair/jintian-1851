# 响应式布局修复 + 品牌 logo 替换 — 技术设计

## Goals

- **宽屏零白底**：任何视口宽度下（≥320px），页面内容区之外不露出浏览器默认白底，统一米黄渐变主题
- **窄屏零溢出**：320/375px 窄屏下无横向滚动、无内容截断，触摸目标随屏宽等比例缩放
- **品牌一致**：首页 logo 与「金田：1851」深红金古风主题统一
- **跨端安全**：仅用 uni-app 原生 rpx 单位与 `page` 虚拟选择器，不引入浏览器独有 API，不影响小程序/App 构建

## Non-Goals

- **不做**：业务逻辑改动（本次纯样式/资源修复）
- **不做**：响应式断点重构（如平板专属布局、Tailwind 断点——game-web 不用 Tailwind）
- **不做**：深色模式 / 主题切换
- **不做**：布局框架替换（仍为 uni-app rpx 方案）

## Architecture

### uni-app H5 DOM 层级（关键修复点）

```
html
└── body
    └── #app
        └── uni-app
            └── uni-page
                └── uni-page-wrapper
                    └── uni-page-body
                        └── page（uni-app 虚拟选择器，编译后作用于页面根元素）
                            └── 页面根 view（.home / .game-main / .settings）
```

修复策略：**两层兜底**

1. **全局层（App.vue）**：在最外层 `html/body` 与 uni-app 各层容器强制 `width:100% !important; max-width:none !important` + 同色渐变背景，从源头消灭白底。
2. **页面层（各页面根容器）**：页面根容器 `.home/.game-main/.settings` 各自 `width:100%` + `overflow-x:hidden`，处理内部固定尺寸元素可能造成的横向溢出。

### 单位换算依据

- uni-app `rpx`：`750rpx = 屏幕宽度`，在 375px 设计基准下 `1rpx = 0.5px`。
- 触摸目标规范（AGENTS.md）：图标按钮 ≥ 36px、输入区按钮 ≥ 44px。
- 换算：`36px → 72rpx`、`44px → 88rpx`，rpx 在窄屏自动等比缩小（320px 下 `72rpx ≈ 30.7px`），既满足规范又不撑破视口。

## Decisions

### D1：全局强制铺满 vs 单页面各自处理

**决策：全局 App.vue 兜底 + 单页面补充**

理由：
- 单页面各自处理易遗漏（每个页面都要写一遍背景与宽度），且 uni-app 容器层级多层嵌套，仅改页面根容器无法覆盖外层白底。
- 全局层用 `!important` 强制覆盖 uni-app 默认样式，作为"最后防线"，任何页面都不会露白。
- 页面层仍保留 `width:100% + overflow-x:hidden`，处理自身内部固定尺寸元素的横向溢出，职责清晰。

### D2：固定 px 触摸目标改 rpx vs 改媒体查询

**决策：改 rpx（跟随视口缩放）**

理由：
- 媒体查询需为每个断点写一套尺寸，维护成本高，且与 uni-app rpx 设计哲学冲突。
- rpx 天然随屏宽等比例缩放，375 基准下 `72rpx/88rpx` 恰好等于规范要求的 `36px/44px`，窄屏自动缩小，无需额外断点。
- 仅修正触摸目标尺寸（min-width/min-height），内部文字/内边距已普遍用 rpx，改动面最小、风险最低。

### D3：logo 缓存破版 vs 换文件名

**决策：URL 追加 `?v=2` 查询参数**

理由：
- 换文件名需同步改 `pages.json` / 引用路径，波及面大。
- `static/` 下资源经 Vite 处理，`?v=2` 即可破 HMR/浏览器缓存，改动最小。
- 同时放大 `200rpx → 280rpx` 并加圆角阴影，提升首屏品牌质感，与古风主题呼应。

### D4：`page` 选择器 stylelint 绕过

**决策：局部 `stylelint-disable-next-line` 注释**

理由：
- `page` 是 uni-app 编译期注入的虚拟选择器，标准 CSS/stylelint 视其为未知类型选择器报错。
- 仅在该行加 `selector-type-no-unknown` 禁用注释，避免全局放宽规则导致真正未知选择器漏检。

## 多端兼容方案

| 能力 | H5 | 微信小程序 | App |
| --- | --- | --- | --- |
| rpx 缩放 | ✅ 原生 | ✅ 原生 | ✅ 原生 |
| `page` 虚拟选择器 | ✅ 编译生效 | ✅ 编译生效 | ✅ 编译生效 |
| 渐变背景 `linear-gradient` | ✅ | ✅ | ✅ |
| `overflow-x:hidden` | ✅ | ✅（scroll-view 外层） | ✅ |
| `!important` 强制覆盖 | ✅ | ✅ | ✅ |

> 说明：三项能力均为 uni-app 跨端原生支持，未引入任何 `window`/`document`/浏览器独有 API，不影响小程序/App 构建产物。

## 触摸交互尺寸（修复后）

| 元素 | 最小尺寸 | 依据 |
| --- | --- | --- |
| game-main 图标/同步按钮 | 72rpx×72rpx（≈36px @375） | AGENTS.md 图标按钮≥36px |
| game-main 操作/底部按钮 | 88rpx×88rpx（≈44px @375） | AGENTS.md 输入区按钮≥44px |
| settings 返回/图标按钮 | 72rpx×72rpx（≈36px @375） | AGENTS.md 图标按钮≥36px |
| settings 操作按钮 | 88rpx×88rpx（≈44px @375） | AGENTS.md 输入区按钮≥44px |
| 首页 logo | 280rpx×280rpx | 品牌展示，非触摸目标 |

## 验证方案

- **窄屏**：Playwright 设 viewport 320px / 375px，截图确认无横向滚动条、无内容截断。
- **宽屏**：Playwright 设 viewport 1280px，截图确认无右侧白底，容器铺满视口（`clientWidth` ≈ 视口宽）。
- **logo**：首页截图确认古风 logo 渲染、`?v=2` 破缓存生效、圆角阴影正常。
- **lint**：`cd game-web && pnpm lint`（含 stylelint，`page` 选择器绕过生效，无报错）。
- **残余**：小程序/App 端真机验证建议上线前补做（见 proposal.md 残余不确定性）。
