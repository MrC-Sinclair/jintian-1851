<template>
  <!-- H5：内联 svg（保留 currentColor 继承、CSS 控宽高等原生行为） -->
  <svg
    v-if="isH5"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path v-for="(d, i) in paths" :key="i" :d="d" :fill="color" />
  </svg>
  <!-- 小程序/App：WXML 无 <svg> 元素（编译后为未知标签，图标静默不渲染），
       用同一份 path 数据烘焙 base64 data-URI 背景渲染（WXSS 支持 data:image） -->
  <view v-else :style="mpStyle" aria-hidden="true" />
</template>

<script setup lang="ts">
/**
 * @file AppIcon 跨端矢量图标组件
 *
 * 微信小程序 WXML 不支持 <svg> 标签，所有矢量图标必须经本组件渲染：
 * - H5：内联 <svg>，行为与原生 svg 一致
 * - 小程序/App：SVG path 烘焙为 base64 data-URI 背景图
 *
 * 平台判断走运行时 uni.getSystemInfoSync().uniPlatform（同 device-id.ts 惯例），
 * 不用模板条件编译：Vitest 以纯 @vitejs/plugin-vue 编译 SFC，#ifdef 两侧都会渲染，
 * 运行时判断在测试环境（mock uniPlatform='h5'）恒走 svg 分支，断言行为可预期。
 *
 * 尺寸约定：传 size（px）则内联宽高；不传则由父级 CSS 类控制宽高（需保证父级有尺寸）。
 */

import { computed } from 'vue'

/** 预置图标名（path 数据取自 Material Icons，24x24 viewBox） */
type AppIconName =
  | 'check'
  | 'close'
  | 'warning'
  | 'info'
  | 'arrow-back'
  | 'book'
  | 'lightbulb'
  | 'search'

const ICON_PATHS: Record<AppIconName, string[]> = {
  check: ['M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'],
  close: [
    'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
  ],
  warning: ['M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z'],
  info: [
    'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z'
  ],
  'arrow-back': ['M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z'],
  book: [
    'M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zM21 18.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z',
    'M17.5 10.5c.6 0 1.15.1 1.65.25V7.5c-.5-.15-1.05-.25-1.65-.25s-1.15.1-1.65.25v3.25c.5-.15 1.05-.25 1.65-.25z',
    'M17.5 14.5c.6 0 1.15.1 1.65.25V11.5c-.5-.15-1.05-.25-1.65-.25s-1.15.1-1.65.25v3.25c.5-.15 1.05-.25 1.65-.25z'
  ],
  lightbulb: [
    'M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7zm-2 19c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-1h-4v1z'
  ],
  search: [
    'M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z'
  ]
}

const props = withDefaults(
  defineProps<{
    /** 预置图标名（与 path 二选一） */
    name?: AppIconName
    /** 原始 SVG path d 值（动态 path 场景用，传入后忽略 name） */
    path?: string
    /** 图标颜色。H5 端支持 'currentColor'；小程序端会烘焙进 data-URI，须传具体色值 */
    color?: string
    /** px 尺寸；不传则由父级 CSS 控制宽高 */
    size?: number
  }>(),
  { color: 'currentColor' }
)

const paths = computed<string[]>(() => {
  if (props.path) return [props.path]
  return props.name ? ICON_PATHS[props.name] : []
})

// H5 端 uniPlatform 实际返回 'web'（uni-app 3.x），兼容历史 'h5'
const { uniPlatform } = uni.getSystemInfoSync()
const isH5 = uniPlatform === 'web' || uniPlatform === 'h5'

// data-URI 按「path 数据 + 颜色」缓存，避免同图标多实例重复编码
const dataUriCache = new Map<string, string>()

const BASE64_TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** base64 编码（SVG 内容仅含 ASCII：path 数据 + 十六进制色值，按字节编码即可；小程序端无 btoa） */
function encodeBase64(input: string): string {
  let out = ''
  for (let i = 0; i < input.length; i += 3) {
    const b1 = input.charCodeAt(i)
    const has2 = i + 1 < input.length
    const has3 = i + 2 < input.length
    const b2 = has2 ? input.charCodeAt(i + 1) : 0
    const b3 = has3 ? input.charCodeAt(i + 2) : 0
    out += BASE64_TABLE[b1 >> 2]
    out += BASE64_TABLE[((b1 & 0x03) << 4) | (b2 >> 4)]
    out += has2 ? BASE64_TABLE[((b2 & 0x0f) << 2) | (b3 >> 6)] : '='
    out += has3 ? BASE64_TABLE[b3 & 0x3f] : '='
  }
  return out
}

/** 组装小程序端渲染用的 SVG 文本 */
function buildSvg(pathList: string[], color: string): string {
  const body = pathList.map((d) => `<path fill="${color}" d="${d}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`
}

const mpStyle = computed<Record<string, string>>(() => {
  // currentColor 无法穿透进 data-URI（外部 CSS 不参与背景图渲染），小程序端兜底深灰
  const color = props.color === 'currentColor' ? '#333333' : props.color
  const key = `${paths.value.join('|')}::${color}`
  let uri = dataUriCache.get(key)
  if (!uri) {
    uri = `url("data:image/svg+xml;base64,${encodeBase64(buildSvg(paths.value, color))}")`
    dataUriCache.set(key, uri)
  }
  const style: Record<string, string> = {
    backgroundImage: uri,
    backgroundSize: 'contain',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat'
  }
  if (props.size) {
    style.width = `${props.size}px`
    style.height = `${props.size}px`
  }
  return style
})
</script>
