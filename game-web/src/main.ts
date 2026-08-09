import { createSSRApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
// #ifdef H5
import { vTooltip } from "./directives/tooltip";
// #endif
export function createApp() {
  const app = createSSRApp(App);
  // 注册 Pinia（stores/game.ts、stores/ui.ts 依赖）
  app.use(createPinia());
  // 全局注册 v-tooltip 指令（所有 .vue 文件可直接用 v-tooltip，无需 import）
  // 仅 H5 端注册：mp-weixin 编译期不支持 Vue 自定义指令，需配合 .vue 中属性级条件编译
  // #ifdef H5
  app.directive("tooltip", vTooltip);
  // #endif
  return {
    app,
  };
}
