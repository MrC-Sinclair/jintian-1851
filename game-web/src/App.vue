<script setup lang="ts">
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import ToastContainer from "@/components/ToastContainer.vue";

onLaunch(() => {
  console.log("App Launch");
});
onShow(() => {
  console.log("App Show");
});
onHide(() => {
  console.log("App Hide");
});
</script>

<template>
  <!-- 全局确认对话框 + Toast 提示，挂在根节点供所有页面共享 -->
  <ConfirmDialog />
  <ToastContainer />
</template>

<style>
/* 全局滚动锁：弹框打开时禁用默认触摸行为，阻止橡皮筋效果和滚动链 */
body.scroll-locked {
  overscroll-behavior: none;
  touch-action: none;
}

/*
 * 全局宽屏适配：强制 uni-app H5 各层容器铺满视口宽度 + 同色渐变背景
 *
 * 问题根因：uni-app H5 在桌面端可能存在容器宽度限制或背景色断层，
 * 导致页面内容区之外露出浏览器默认白底。
 *
 * 策略：
 * 1. html/body 设为全宽+渐变背景（最外层兜底）
 * 2. #app/uni-app/uni-page/wrapper/page-body 全链路强制 100% 宽度+背景
 * 3. page 是 uni-app 虚拟选择器，编译后作用于页面根元素
 */
html,
body {
  width: 100%;
  min-height: 100vh;
  background-color: #fdf6e3;
}

#app,
uni-app,
uni-page,
uni-page-wrapper,
uni-page-body {
  width: 100% !important;
  max-width: none !important;
  min-height: 100vh;
  background: linear-gradient(180deg, #fdf6e3 0%, #f5e6c8 100%) !important;
}

/* stylelint-disable-next-line selector-type-no-unknown */
page {
  width: 100% !important;
  min-height: 100vh;
  background: linear-gradient(180deg, #fdf6e3 0%, #f5e6c8 100%) !important;
}
</style>
