import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tsParser from '@typescript-eslint/parser'
import vueParser from 'vue-eslint-parser'

// Nuxt3 后端纯 API 服务的 ESLint 配置
// 参考 my-chat/eslint.config.js，针对纯 API 服务简化（无前端组件）
export default [
  {
    ignores: [
      '.nuxt/**',
      '.output/**',
      'node_modules/**',
      'dist/**',
      'drizzle/**',
      'playwright-report/**',
      'scripts/**'
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
        // Nuxt 自动导入
        $fetch: 'readonly',
        defineNuxtConfig: 'readonly',
        defineEventHandler: 'readonly',
        readBody: 'readonly',
        getMethod: 'readonly',
        getRouterParam: 'readonly',
        getQuery: 'readonly',
        createError: 'readonly',
        setResponseHeader: 'readonly',
        setResponseStatus: 'readonly',
        useRuntimeConfig: 'readonly',
        // Vue 3 Composition API
        ref: 'readonly',
        computed: 'readonly',
        reactive: 'readonly',
        watch: 'readonly',
        onMounted: 'readonly',
        nextTick: 'readonly',
        defineProps: 'readonly',
        defineEmits: 'readonly',
        // 浏览器/Node API
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        HTMLElement: 'readonly',
        Event: 'readonly',
        confirm: 'readonly',
        crypto: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        process: 'readonly',
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
        // Nuxt 自动导入
        $fetch: 'readonly',
        defineEventHandler: 'readonly',
        readBody: 'readonly',
        getMethod: 'readonly',
        getRouterParam: 'readonly',
        getQuery: 'readonly',
        createError: 'readonly',
        setResponseHeader: 'readonly',
        setResponseStatus: 'readonly',
        useRuntimeConfig: 'readonly',
        defineNuxtConfig: 'readonly',
        // Vue 3 Composition API
        ref: 'readonly',
        computed: 'readonly',
        reactive: 'readonly',
        watch: 'readonly',
        onMounted: 'readonly',
        nextTick: 'readonly',
        // 浏览器/Node API
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        HTMLElement: 'readonly',
        Event: 'readonly',
        confirm: 'readonly',
        crypto: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
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
