# 域名 + 受信任证书接入方案（存档，未执行）

> 状态：**2026-10-11 决定不做微信小程序接入**，本文件是当时的调查结论与可执行方案存档。
> 若日后重启接入（或只为 H5 去掉「证书告警 + 必须带 :8443」），按本文第 3 节直接执行即可，
> 结论已核对过官方文档与两个项目的实际配置，不必重新调研。
>
> 本文档**没有改动任何线上配置**。第 4 节的 Caddyfile 草案是文本，未应用。

## 1. 现状事实（已核实）

| 事实 | 出处 |
|---|---|
| 本项目只有裸 IP，站点按端口建 | `deploy/Caddyfile` 头注释「ACME 不给裸 IP 签发证书，而本项目只有公网 IP 没有域名」 |
| 入口 `https://122.51.97.106:8443`，8081 仅做跳转 | `deploy/Caddyfile` + `deploy/docker-compose.deploy.yml:111-117` |
| mychat 独占 80/443，**但它同样没有域名** | `my-chat/deploy/Caddyfile`（自签 + IP SAN，站点写作 `:443`）、`my-chat/deploy/docker-compose.deploy.yml:42-44` |
| 域名+备案在原计划里就是未完成项 | 原上线前检查清单 T8.0（openspec 已停用，内容见 git 历史）「~~购买 + 备案域名~~ → 未做」 |
| 小程序 AppID 未配置 | `game-web/src/manifest.json:53` `"mp-weixin": { "appid": "" }` |
| 两个项目是两个独立 compose 项目，网络不互通 | 各自的 `deploy/docker-compose.deploy.yml`（项目名 `jintian` / `my-chat`） |

## 2. 微信侧硬要求（官方文档核实）

- 域名**必须经过 ICP 备案**；不支持 IP、不支持 localhost（局域网 IP 除外）
- **可以带端口**：「对于 https 域名，可以配置端口，如 `https://myserver.com:8080`」
  → 现有 `:8443` **不需要**迁到 443，也**不需要**和 mychat 做 SNI 分流
  → 但配置带端口的域名后，只能请求该端口；不配端口则请求 URL 里连默认 443 都不能出现
- 不支持配置父域名，要用**子域名**
- 证书必须受信任（自签过不了），TLS ≥ 1.2
- 新备案域名需等 24–48h 同步进微信系统，否则报「该域名未备案」

**结论：唯一的硬门槛是 ICP 备案（数周量级的外部等待），端口和证书都不是问题。**

腾讯云侧补充：中国境内 CVM 对未备案域名有「未备案监测系统识别并阻断并跳转固定页面」的机制，
触发面在 80/443；用非标端口（8443）可绕过该拦截层——但这只对**浏览器 H5** 有意义，
微信后台添加域名时的备案校验绕不过。

## 3. 若执行，最短路径（不碰 mychat、不碰 80/443、不新增安全组端口）

1. **买域名**，用子域名形态接入（如 `jintian.<主域>`）
2. **腾讯云提交首次备案**，以本 CVM 作为接入资源。初审 1–2 工作日 + 管局审核，
   常见 7–20 天。**这期间不要把解析指过来**
3. **签受信任证书**，二选一：
   - **3a 腾讯云免费 DV 证书**（推荐）：申请 → 下载 → 放进服务器 `deploy/certs/`，
     现有 Caddyfile 的 `tls site.crt site.key` 写法一字不改，只换文件。1 年一续，人工
   - **3b Let's Encrypt DNS-01**：自动续期。但 Caddy 官方镜像不含 DNSPod 插件，
     需自建镜像（`caddy builder` 加 `caddy-dns/dnspod`），且要动全局 `auto_https off`
   - **HTTP-01 走不通**：它要求 80 端口可达，而未备案期间 80 会被拦，且 80 已被 mychat 占用
4. **Caddyfile 改双站点块共存**（草案见第 4 节）：具名站点优先匹配，端口站点保留作 IP 直连兜底
5. 安全组**无需变更**（8443 已放行）。别为 ACME 开 80
6. 微信后台「开发 → 开发管理 → 开发设置 → 服务器域名」填 `https://jintian.<主域>:8443`，
   request / uploadFile / downloadFile / socket **逐类**配置（各自独立白名单）
7. `game-web/src/manifest.json` 填 AppID；`VITE_API_BASE_URL` 改成域名形式
   - **H5 端不需要它**：H5 与 API 同源（同一 Caddy 反代 `/api/*`），相对路径即可
   - **小程序/App 端必须保留**：它们没有同源概念，`utils/api.ts:96` 的 `getBaseUrl()` 只能读绝对 URL

## 4. Caddyfile 草案（文本，未应用）

```caddyfile
# 具名站点：域名 + 受信任证书。必须排在端口站点之前——
# Caddy 按 SNI/Host 优先匹配具名站点，匹配不到才落到按端口建的站点
jintian.example.com:8443 {
    tls /etc/caddy/certs/jintian.crt /etc/caddy/certs/jintian.key
    import api_proxy          # 与现有 /api/* 反代配置完全相同（含 flush_interval -1）
    import static_h5          # 与现有静态站点配置相同
}

# 兜底：现有玩家仍用 https://122.51.97.106:8443 访问。
# IP 不能进 SNI，所以这个按端口建的站点必须留着，否则老入口直接 502
:8443 {
    tls /etc/caddy/certs/site.crt /etc/caddy/certs/site.key
    import api_proxy
    import static_h5
}
```

用 `import` 抽复用块，避免两个站点块的 SSE 反代参数写两遍而漏改一份——
`flush_interval -1` 一旦在某份里缺失，那个入口的流式事件会阶段性卡住（见 Caddyfile 现有注释）。

## 5. 风险与未决项

| 项 | 说明 | 怎么确认 |
|---|---|---|
| **游戏类目资质** | 本项目是游戏。微信对游戏类目/小游戏的主体与版号要求与普通小程序不同，个人主体大概率不通过。**可能在备案之前就否决整条路** | 微信公众平台注册流程里的类目选择页，看是否要求《网络游戏备案》/版号材料 |
| **线上 mychat 配置未知** | 本文基于本地仓库 `D:\code\codeWork\my-chat` 的文件，CVM 上跑的可能是旧版 | SSH 后 `docker inspect` 其 caddy 容器的 PortBindings 与容器内 Caddyfile |
| 备案期间解析别指过来 | 指过来会被腾讯云的未备案监测阻断，表现为「跳转提示页」而不是证书错误，容易误判成 Caddy 配错 | 备案状态通过后再改解析 |
| 双站点块的证书混用 | 具名站点若误用自签 IP 证书，浏览器对域名校验会失败（SAN 里没有该 DNS 名） | `openssl s_client -connect <ip>:8443 -servername <domain>` 看返回的证书 subject |
| Caddy 全局 `auto_https off` | 若改用 3b（ACME 自动签发），必须重开或按站点覆盖，否则 Caddy 不会去签 | 看 `caddy validate` 与容器日志里的 obtain certificate 记录 |

## 6. 与存档鉴权提案的关系（别漏掉）

原 openspec 提案 save-ownership-auth 选的是「设备注册换发凭据」，它**解决不了**
「清缓存 / 换浏览器 → 存档归属丢失」——那需要真实身份（微信 openid）作为 linking 层。
openid 只能在小程序端拿到，所以**放弃小程序接入 = 同时放弃该残留问题的解**。
玩家清缓存后找回存档这件事，在当前架构下无解，需在 `docs/game-design.md` 侧以「本地存档为主、
云端为备份」的定位来兜，而不是承诺跨设备找回。
