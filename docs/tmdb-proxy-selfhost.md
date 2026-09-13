# TMDB 代理自托管部署记录

本文记录 PianKe 客户端所用 TMDB 代理在生产服务器上的实际部署方式，供后续维护、迁移与排障参考。

## 现状

| 项目 | 值 |
| --- | --- |
| 服务器 | Ubuntu 24.04（SG 新加坡，1 vCPU / 2 GB / 25 GB） |
| 公网 IP | `104.207.92.221` |
| SSH | `root@104.207.92.221:22022`（仅密钥登录） |
| 代理域名 | `https://tmdb.astara.space` |
| 服务端代码 | `/opt/pianke/server/index.mjs`（零依赖 Node） |
| 上游监听 | `127.0.0.1:8787`（**不对公网暴露**） |
| 进程管理 | systemd `pianke-tmdb.service` |
| 反向代理 | **Caddy**（`/etc/caddy/Caddyfile`），非 Nginx |
| 证书 | Caddy 自动申请并续期 Let's Encrypt |
| 同机其他服务 | PocketBase `127.0.0.1:8090`（站点 `pb.astara.space`）、`updates.astara.space` |

## 架构

```
客户端 (Electron 主进程)
  └─ https://tmdb.astara.space/api/*   ← X-App-Token 校验
        └─ Caddy (80/443, 自动 TLS)
              └─ 127.0.0.1:8787  (server/index.mjs, systemd)
                    └─ https://api.themoviedb.org/3  (服务器在新加坡，可直连)
```

客户端从不直接访问 TMDB：搜索走 `/api/search`、详情走 `/api/details/:type/:id`、
海报走 `/api/poster`。TMDB Token 只存在于服务器的 `.env`，不进客户端、不进仓库。

## 关键约定

- **上游只监听回环地址**。`index.mjs` 的 `HOST` 默认 `127.0.0.1`；服务本身不做 TLS，
  直接暴露到公网会绕过反代的鉴权与限流。如需覆盖，显式设 `HOST=0.0.0.0`（会打印警告）。
- **`APP_TOKEN` 必须与服务端 `.env` 及客户端 `resources/tmdb-proxy.json` 三处一致**。
  它是轻量门槛而非安全边界（token 在客户端里），真正的防线是限流与用量监控。
- **探活接口 `/healthz` 免 token**（Caddy 用 `handle_path` 剥离前缀后转发到 `/api/healthz`），
  方便外部监控；不要给它加 token 校验。
- **限流是按反代 IP 的单一计数桶**。服务端只在 `TRUST_PROXY=true` 时才信任 `X-Forwarded-For`
  （防伪造绕过），因此在 Caddy 后面默认所有客户端共享一个 60 次/分钟的桶。
  多人使用时如果出现 `429 请求过于频繁`，把它调大或改用 Caddy 侧限流。

## 日常操作

```bash
# 状态与日志
systemctl status pianke-tmdb --no-pager
journalctl -u pianke-tmdb -n 50 --no-pager

# 重启上游（改完 index.mjs 后）
systemctl restart pianke-tmdb

# 重新部署 Caddy 站点（幂等，会先备份 Caddyfile）
bash /opt/pianke/server/deploy/deploy-caddy.sh tmdb.astara.space

# 改完 Caddyfile 后务必完整重启：
# Caddy 2.6 在 reload 后偶发丢失 TLS 连接策略，握手会报 tlsv1 alert internal error
systemctl restart caddy

# 探活（公网）
curl -s https://tmdb.astara.space/healthz
```

## 更新服务端代码

```powershell
# 在开发机上
scp -P 22022 server\index.mjs root@104.207.92.221:/opt/pianke/server/
ssh -p 22022 root@104.207.92.221 "systemctl restart pianke-tmdb && sleep 1 && curl -s http://127.0.0.1:8787/api/healthz"
```

## 客户端侧契约

客户端只通过三个接口访问，路径与响应结构是两端共同的契约，改服务端时不要破坏：

| 接口 | 说明 |
| --- | --- |
| `GET /api/search?q=` | 返回 `{ results: [...] }` |
| `GET /api/details/:mediaType/:id` | `mediaType` 为 `movie` 或 `tv`，返回 `{ result: {...} }` |
| `GET /api/poster?path=&width=` | `width` 限 `w154/w342/w500/original`，直接返回 `image/*` |
| `GET /api/healthz` | 探活，免 token |

均需带 `x-app-token` 请求头（`/api/healthz` 除外）。

## 客户端侧配置

`resources/tmdb-proxy.json`：

```json
{
  "url": "https://tmdb.astara.space",
  "appToken": "<与服务器 APP_TOKEN 一致>"
}
```

打包后该文件通过 `electron-builder.yml` 的 `extraResources` 复制到安装目录，
主进程从 `process.resourcesPath/tmdb-proxy.json` 读取。服务端调试也可用环境变量
`PIANKE_TMDB_PROXY_URL` / `PIANKE_TMDB_PROXY_TOKEN` 覆盖。

## 排障

| 报错 | 含义 | 排查 |
| --- | --- | --- |
| `无法连接 TMDB 代理服务器` | 客户端 `fetch` 完全失败（DNS/连接层） | 域名是否解析到 `104.207.92.221`；`curl -s https://tmdb.astara.space/healthz` |
| `未授权访问`（401） | `X-App-Token` 不匹配 | 比对服务端 `.env`、Caddyfile、客户端 json 三处 |
| `服务器未配置 TMDB_TOKEN`（500） | 服务端缺 TMDB 凭据 | 检查 `/opt/pianke/server/.env` 是否被误删 |
| `请求过于频繁`（429） | 命中 60 次/分钟限流 | 见上文「限流是按反代 IP 的单桶」 |
| 握手 `tlsv1 alert internal error` | Caddy reload 后丢失 TLS 策略 | `systemctl restart caddy` |

客户端侧连通性自检：`node scripts/check-tmdb-proxy.mjs`。

## 遗留待办

- **轮换已泄露的凭据**：部署期间 root 密码曾在聊天记录中出现。SSH 密码登录已关闭
  （`PasswordAuthentication no` + `PermitRootLogin prohibit-password`），建议再执行一次
  `passwd root` 换强密码，并定期轮换 `APP_TOKEN`。
- **确认 Vercel 项目已删除**：旧的 `pianke-tmdb-proxy.vercel.app` 曾有可用部署，
  `server/vercel/` 源码已在本次迁移中移除，Vercel 控制台上的项目需手动删除。
