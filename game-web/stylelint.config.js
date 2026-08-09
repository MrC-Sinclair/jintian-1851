/** @type {import('stylelint').Config} */
export default {
  // 继承：标准规则 + Vue <style> 块支持 + 属性排序
  // 不含 stylelint-config-tailwindcss（uni-app 默认不用 Tailwind）
  extends: [
    'stylelint-config-standard',
    'stylelint-config-recommended-vue',
    'stylelint-config-recess-order'
  ],
  rules: {
    // ── uni-app 特性放宽 ───────────────────────────────
    // 允许 rpx 单位（uni-app 三端通用单位，小程序原生支持，H5 由 uni-app 运行时换算）
    'unit-no-unknown': [true, { ignoreUnits: ['rpx', 'upx'] }],
    // 关闭属性值未知检查（rpx 作为 padding/font-size 等属性值时被误报）
    'declaration-property-value-no-unknown': null,
    // 允许伪元素/类使用嵌套写法（如 SCSS 风格），与 Vue 现有 style 块一致
    'selector-pseudo-element-no-unknown': null,
    // 项目中颜色使用十六进制和 rgba 混合，不强制转换
    'color-function-notation': null,
    // 不强制 alpha 通道的简写
    'alpha-value-notation': null,
    // 允许浏览器前缀的属性（兼容小程序 WebView 与旧设备）
    'property-no-vendor-prefix': null,
    'value-no-vendor-prefix': null,
    // 允许 ID 选择器（部分场景需要）
    'selector-max-id': null,
    // 允许使用 !important（z-index/tooltip 场景需要）
    'declaration-no-important': null,
    // 允许 // 单行注释（PostCSS 插件支持）
    'no-descending-specificity': null,
    // 允许空规则前的注释
    'comment-empty-line-before': null,
    // 允许长属性值（box-shadow、transition 等）
    'declaration-block-no-redundant-longhand-properties': null,
    // 不强制把 word-wrap 替换为 overflow-wrap（旧 WebView 兼容需要双写）
    'declaration-property-value-disallowed-list': null,
    // 允许 rgba() 写法（不强制改为现代 rgb() 4 通道语法），兼容旧 WebView
    'color-function-alias-notation': null,
    // 允许使用非标准属性别名 word-wrap（旧 WebView fallback）
    'property-no-unknown': [true, { ignoreProperties: ['word-wrap'] }],
    // 允许使用废弃属性（word-wrap 作为 fallback 必须保留）
    'property-no-deprecated': null,
    // 允许空 style 块（App.vue 等 bootstrap 组件的 <style></style> 可以为空）
    'no-empty-source': null,
    // ── 严格规则：捕获真实 bug ─────────────────────────────
    // 禁止重复声明（捕获意外的同名属性覆盖）
    'declaration-block-no-duplicate-properties': true,
    // 禁止重复的自定义属性
    'declaration-block-no-duplicate-custom-properties': true,
    // 禁止无效的 URL
    'no-invalid-position-at-import-rule': true,
    // 禁止重复的选择器
    'no-duplicate-selectors': true,
    // 字体族必须有通用字体兜底
    'font-family-no-missing-generic-family-keyword': true
  },
  overrides: [
    {
      // .vue 文件由 postcss-html 处理（stylelint-config-recommended-vue 自带）
      files: ['**/*.vue'],
      customSyntax: 'postcss-html'
    },
    {
      // SCSS 文件用 postcss-scss 解析（uni.scss 使用 SCSS 变量语法）
      files: ['**/*.scss'],
      customSyntax: 'postcss-scss'
    }
  ]
}
