# 上线前检查清单

> 本文件跟踪两个已归档提案中**未完成的非代码任务**（运维 / 真机 / 配置）。
> 源提案已原地标记归档，代码与测试均交付（709 测试全绿，H5 + 小程序构建成功）。

## 来源：add-qing-revival-mvp（MVP 主提案）

### T8.0 部署前置准备（域名 / HTTPS / Nginx）— 上线前必做

- [ ] 购买 + 备案域名（如 `api.jintian-1851.example.com`）
- [ ] 申请 SSL 证书（Let's Encrypt 免费或云厂商免费证书）
- [ ] Nginx 反向代理配置（关键：`proxy_buffering off` / `proxy_cache off` / `chunked_transfer_encoding on`，SSE 必须关闭缓冲）
- [ ] 微信小程序后台配置 request 合法域名 `https://api.jintian-1851.example.com`
- [ ] 验证：`curl -I https://api.jintian-1851.example.com/health` 返回 200
- [ ] 验证：`curl -N` SSE 端点立即收到首个 chunk（<1s）
- [ ] 验证：微信开发者工具关闭「不校验合法域名」后请求成功

参考：`openspec/changes/add-qing-revival-mvp/tasks.md` T8.0

### T8.1 三端真机测试

- [ ] H5：Chrome + Firefox + Safari 验证流式、动画、布局
- [ ] 微信小程序：iOS + Android 真机验证 `uni.request` chunked 流式
- [ ] App：Android APK 真机验证
- [ ] 每端至少 1 次完整流程：开局 → 1 回合 → 同步

参考：`openspec/changes/add-qing-revival-mvp/tasks.md` T8.1

### 生产环境配置

- [ ] `.env` 配置 `OPENAI_API_KEY`（硅基流动）
- [ ] `.env` 配置 `DATABASE_URL`（PostgreSQL 端口 5534）
- [ ] `.env` 配置 `IMGBB_API_KEY`（若用图片对话）
- [ ] `docker compose up -d` 启动 PostgreSQL 并验证 healthy
- [ ] `pnpm db:push` 同步 schema 到生产数据库

## 来源：improve-ux-playability（体验优化提案）

### T4.4 第 4 项：双端完整流程浏览器手动验证

- [ ] H5 端：首页 → 如何游戏 → 开始游戏 → 引导 → 回合（焦点/事件/选项两步/军师简报/危机预警）→ 折叠展开 → 结局
- [ ] 微信小程序端：同上完整流程

参考：`openspec/changes/improve-ux-playability/tasks.md` T4.4

## 来源：free-action-faction-effects（自由行动势力影响提案）

### 多端冒烟遗留：微信小程序人工走查

- [ ] 微信开发者工具中走查自由行动含势力变化：输入"暗中资助湘军"类决策 → 反馈区出现"关系 +N"提示、资源扣减正常（H5 端已由 `tests/e2e/free-action-faction-effects.spec.ts` 覆盖；逻辑层三端共用，无浏览器 API 依赖）

参考：`openspec/changes/archive/2026-08-17-free-action-faction-effects/tasks.md` 第 5 节

## 完成标准

所有项打勾后，两个提案可视为完全交付，可移除本清单文件。
