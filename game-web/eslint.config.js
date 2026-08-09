import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tsParser from '@typescript-eslint/parser'
import vueParser from 'vue-eslint-parser'

// uni-app Vue3 CLI 工程的 ESLint 配置
// 参考 my-chat/eslint.config.js，针对 uni-app 三端特性调整 globals
export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'unpackage/**', // uni-app 构建产物（小程序/H5/App）
      'src/manifest.json', // uni-app 自动生成
      'src/pages.json', // uni-app 自动生成
      '**/*.d.ts', // TypeScript 类型声明文件（uni-app 模板自带，不需 lint）
      'shims-uni.d.ts',
      'src/shime-uni.d.ts',
      'src/env.d.ts'
    ]
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      globals: {
        // uni-app 全局 API（三端通用）
        uni: 'readonly',
        wx: 'readonly',
        getCurrentPages: 'readonly',
        getApp: 'readonly',
        // uni-app 生命周期（页面/应用级）
        onLaunch: 'readonly',
        onShow: 'readonly',
        onHide: 'readonly',
        onLoad: 'readonly',
        onReady: 'readonly',
        onUnload: 'readonly',
        onPullDownRefresh: 'readonly',
        onReachBottom: 'readonly',
        onShareAppMessage: 'readonly',
        onShareTimeline: 'readonly',
        onPageScroll: 'readonly',
        // Vue 3 Composition API
        ref: 'readonly',
        computed: 'readonly',
        reactive: 'readonly',
        shallowRef: 'readonly',
        shallowReactive: 'readonly',
        readonly: 'readonly',
        watch: 'readonly',
        watchEffect: 'readonly',
        watchPostEffect: 'readonly',
        watchSyncEffect: 'readonly',
        onMounted: 'readonly',
        onUnmounted: 'readonly',
        onBeforeMount: 'readonly',
        onBeforeUnmount: 'readonly',
        onActivated: 'readonly',
        onDeactivated: 'readonly',
        nextTick: 'readonly',
        defineProps: 'readonly',
        defineEmits: 'readonly',
        defineExpose: 'readonly',
        defineModel: 'readonly',
        withDefaults: 'readonly',
        provide: 'readonly',
        inject: 'readonly',
        // 浏览器 API（H5 端）
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        HTMLElement: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLSelectElement: 'readonly',
        confirm: 'readonly',
        crypto: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        Blob: 'readonly',
        File: 'readonly'
      }
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'no-console': 'off',
      'no-undef': 'off',
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      globals: {
        // uni-app 全局 API
        uni: 'readonly',
        wx: 'readonly',
        getCurrentPages: 'readonly',
        getApp: 'readonly',
        // Vue 3 Composition API
        ref: 'readonly',
        computed: 'readonly',
        reactive: 'readonly',
        watch: 'readonly',
        onMounted: 'readonly',
        nextTick: 'readonly',
        // 浏览器 API
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        HTMLElement: 'readonly',
        Event: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLSelectElement: 'readonly',
        confirm: 'readonly',
        crypto: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        // Vitest 全局
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly'
      }
    },
    rules: {
      'no-console': 'off',
      'no-undef': 'off',
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }]
    }
  }
]
