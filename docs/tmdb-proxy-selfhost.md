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
- **`APP_TOKEN` 必须与服务端 `.env`、反向代理配置里的 `__APP_TOKEN_REGEX__`、以及客户端打包时注入的
  `PIANKE_TMDB_PROXY_TOKEN` 三处一致**。它是轻量门槛而非安全边界（口令随安装包分发，能从安装目录里
  读出来），真正的防线是限流与用量监控；正因为如此，它**绝不能进入版本库**。轮换流程见下文「口令轮换」。
  彻底消除这一风险的办法见下文「设备凭据」：把共享口令降级成「仅注册」。
- **探活接口 `/healthz` 免 token**（Caddy 用 `handle_path` 剥离前缀后转发到 `/api/healthz`），
  方便外部监控；不要给它加 token 校验。
- **限流桶按「身份 + 客户端 IP」划分**，身份是设备 id 或共享口令指纹。服务端只在
  `TRUST_PROXY=true` 时才信任 `X-Forwarded-For`（防伪造绕过），因此在 Caddy 后面同一身份的
  所有客户端共享一个 60 次/分钟的桶；好处是某个设备（或泄露的旧口令）被滥用时，不会把
  正常客户端一起打到 429。多人使用时如果出现 `429 请求过于频繁`，把它调大或改用 Caddy 侧限流。

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

## 客户端侧配置（真实口令不入库）

`resources/tmdb-proxy.json` 含与服务端共享的口令，**已被 `.gitignore` 忽略**，不再提交；
仓库里只保留 `resources/tmdb-proxy.example.json` 作为模板。

打包时由 `scripts/inject-tmdb-proxy.mjs` 生成该文件，取值优先级：

1. 环境变量 `PIANKE_TMDB_PROXY_URL` / `PIANKE_TMDB_PROXY_TOKEN`（CI Secret，推荐）
2. 已存在的本地 `resources/tmdb-proxy.json`（开发者自己的未跟踪副本）

发布脚本（`electron:build*` / `electron:publish*`）都带 `--require`：两者都拿不到时直接让构建失败，
避免打出一个 TMDB 功能不可用的包。

```powershell
# 本机打包
$env:PIANKE_TMDB_PROXY_URL="https://tmdb.astara.space"
$env:PIANKE_TMDB_PROXY_TOKEN="<APP_TOKEN>"
npm run electron:build:win

# 只生成配置文件（不打包）
npm run tmdb:proxy:config

# 连通性与口令一致性自检（只打印掩码与指纹，不会输出令牌原文）
npm run tmdb:proxy:check
```

打包后该文件通过 `electron-builder.yml` 的 `extraResources` 复制到安装目录，
主进程从 `process.resourcesPath/tmdb-proxy.json` 读取。开发调试时环境变量
`PIANKE_TMDB_PROXY_URL` / `PIANKE_TMDB_PROXY_TOKEN` 的优先级更高，不必落盘。

> 注意：口令随安装包分发，能从安装目录里读出来，因此它只用于「防止域名被扫到后被人白嫖配额」，
> 不是安全边界。真正兜底的是反向代理的 401 门槛、限流与用量监控。

## 口令轮换（不打断已安装的客户端）

反向代理与服务端现在都支持**同时**接受新旧两个口令，所以可以平滑轮换：

```bash
# 1) 服务器：生成新口令，旧的自动移入 APP_TOKEN_PREVIOUS（过渡期）
#    Caddy 部署：
cd /opt/pianke/server/deploy && ROTATE_APP_TOKEN=1 ./deploy-caddy.sh tmdb.astara.space
#    Nginx 部署：
cd /opt/pianke/server/deploy && ROTATE_APP_TOKEN=1 ./deploy.sh tmdb.astara.space
#    脚本会打印新的 APP_TOKEN；服务启动日志会打印每个有效口令的指纹

# 2) 本机：用新口令重打包客户端（见上一节）并分发

# 3) 客户端普及后：收回旧口令，然后重跑同一个部署脚本（它会按 .env 重新生成反代正则）
sed -i '/^APP_TOKEN_PREVIOUS=/d' /opt/pianke/server/.env
```

验证要点：

- 过渡期 `curl -s -o /dev/null -w '%{http_code}' -H 'x-app-token: <旧口令>' https://<域名>/api/search?q=test` 应为 200；
- 收回后同一条命令应为 401，而新口令仍为 200；
- 若忘记收回，服务端启动日志会持续打印「正在接受 APP_TOKEN_PREVIOUS」告警。
- 手工改配置时注意：占位符 `__APP_TOKEN_REGEX__` 必须替换成 `^(当前口令)$`（过渡期为
  `^(新口令|旧口令)$`），**千万不要把占位符原样留在生产配置里** —— 那样占位符本身就成了有效口令。

## 设备凭据（把共享口令降级为「仅注册」）

### 为什么需要

共享口令随安装包分发，任何人解包都能读出来，所以它**不可能是安全边界**。
设备凭据方案不试图"藏得更好"，而是把它的用途收窄成「只能注册」：

```text
客户端首次访问
  └─ POST /api/device/register   带 x-app-token（共享口令，仅此一次）
        └─ 201 { deviceId, deviceToken }   只返回一次
           客户端存到 <userData>/tmdb-device.json（按用户隔离，不随包分发）
之后所有请求
  └─ x-device-id + x-device-token    服务端按设备校验、按设备限流
```

收益：

1. **按设备记账与限流** —— 单台设备出问题不会拖垮其他客户端；
2. **可单独吊销** —— `device-admin.mjs revoke` 即可，不必给所有人重发客户端；
3. **泄露的共享口令不再是万能钥匙** —— 关掉 `LEGACY_TOKEN_DATA_ACCESS` 后它只能注册，
   而注册受配额限制，能被滥用的上限是有界的、可观测的。

### 服务端开关

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DEVICE_ENROLLMENT` | `true` | 是否允许注册新设备。设为 `false` 只影响新注册，已有设备照常可用 |
| `LEGACY_TOKEN_DATA_ACCESS` | `true` | **关键开关**：共享口令能否直接取数据 |
| `MAX_DEVICES` | `200` | 设备总数上限，防止共享口令泄露后被无限注册 |
| `REGISTER_LIMIT_PER_HOUR` | `10` | 单 IP 每小时注册上限 |
| `REGISTER_LIMIT_PER_DAY` | `100` | 全局每日注册上限 |
| `STATE_DIRECTORY` | systemd 注入 | 设备库目录，库文件为 `devices.json` |

设备库由 systemd 的 `StateDirectory=pianke-tmdb` 提供（`/var/lib/pianke-tmdb`，权限 0700），
即使开了 `ProtectSystem=strict` 也能原子写入。<br>
`/api/healthz` 会额外返回 `devices`、`deviceEnrollment`、`legacyTokenDataAccess` 三个字段便于观测。

### 上线顺序（每一步都可回退，中途不会中断任何人）

```bash
# 1) 部署新服务端代码：此时两套凭据并存，旧客户端毫无感知
scp -P 22022 server/index.mjs server/devices.mjs server/device-admin.mjs root@<主机>:/opt/pianke/server/
scp -P 22022 server/deploy/pianke-tmdb.service root@<主机>:/opt/pianke/server/deploy/
ssh -p 22022 root@<主机> "install -m644 /opt/pianke/server/deploy/pianke-tmdb.service /etc/systemd/system/ \
  && systemctl daemon-reload && systemctl restart pianke-tmdb"
curl -s https://tmdb.astara.space/healthz    # 应能看到 devices 字段

# 2) 发布带设备凭据的客户端；确认设备在陆续注册
ssh -p 22022 root@<主机> "cd /opt/pianke/server && node device-admin.mjs list"

# 3) 客户端普及后，关掉共享口令的数据访问 —— 这一步才真正消除「口令随包分发」的风险
ssh -p 22022 root@<主机> "grep -q '^LEGACY_TOKEN_DATA_ACCESS=' /opt/pianke/server/.env \
  || echo 'LEGACY_TOKEN_DATA_ACCESS=false' >> /opt/pianke/server/.env"
ssh -p 22022 root@<主机> "systemctl restart pianke-tmdb"
```

第 3 步之后，共享口令只能调 `/api/device/register`，且受注册配额限制；
新装用户依然能正常入网（客户端首次使用会自动注册），**不需要再分发新的共享口令**。
只完成了第 1、2 步也不会变差：行为与现在完全一致。

### 运维

```bash
# 列出所有设备（请求数、最近使用时间、备注）
node /opt/pianke/server/device-admin.mjs list

# 吊销单台设备（客户端下次请求会自动重新注册，拿到新凭据）
systemctl stop pianke-tmdb
node /opt/pianke/server/device-admin.mjs revoke <deviceId>
systemctl start pianke-tmdb

# 清理长期未使用的设备
node /opt/pianke/server/device-admin.mjs prune --days 90 --yes
```

> 工具默认拒绝在服务运行中写入：服务把设备库常驻内存，外部改动会在它下次落盘时被覆盖。
> 确实要在运行中写入时加 `--force`，但那次的改动很可能丢失。

## 排障

| 报错 | 含义 | 排查 |
| --- | --- | --- |
| `无法连接 TMDB 代理服务器` | 客户端 `fetch` 完全失败（DNS/连接层） | 域名是否解析到 `104.207.92.221`；`curl -s https://tmdb.astara.space/healthz` |
| `未授权访问`（401） | 既没有有效的共享口令，也没有有效的设备凭据 | 先跑 `npm run tmdb:proxy:check` 取客户端口令指纹，与服务端启动日志里的指纹比对；三处分别是反代 `__APP_TOKEN_REGEX__`、`.env` 的 `APP_TOKEN`/`APP_TOKEN_PREVIOUS`、打包注入的 `PIANKE_TMDB_PROXY_TOKEN`。若客户端已用设备凭据，则用 `device-admin.mjs list` 确认设备是否被吊销 |
| `共享口令已停用数据访问，请把客户端升级到使用设备凭据的版本`（401） | 服务端已设 `LEGACY_TOKEN_DATA_ACCESS=false`，而这个客户端还没升级 | 分发带设备凭据的新客户端；紧急情况可临时把它改回 `true` 并重启 |
| 设备注册 `429`（注册过于频繁/已达当日配额） | 命中 `REGISTER_LIMIT_PER_HOUR` / `REGISTER_LIMIT_PER_DAY` | 正常现象；若确实是自己的装机潮，临时调大配额后重启 |
| 设备注册 `503`（无法持久化设备凭据） | `STATE_DIRECTORY` 不可写 | 确认 `pianke-tmdb.service` 里有 `StateDirectory=pianke-tmdb`，或手工给 `/var/lib/pianke-tmdb` 授权 |
| 客户端反复重新注册 | 设备被频繁吊销，或服务端重启后设备库丢失 | `device-admin.mjs list` 看设备数与创建时间；确认 `devices.json` 落在 `/var/lib/pianke-tmdb` 而不是进程临时目录 |
| `服务器未配置 TMDB_TOKEN`（500） | 服务端缺 TMDB 凭据 | 检查 `/opt/pianke/server/.env` 是否被误删 |
| `请求过于频繁`（429） | 命中 60 次/分钟限流（桶 = 口令指纹 + IP） | 见上文「限流桶按口令指纹 + 客户端 IP 划分」 |
| 握手 `tlsv1 alert internal error` | Caddy reload 后丢失 TLS 策略 | `systemctl restart caddy` |

客户端侧连通性自检：`node scripts/check-tmdb-proxy.mjs`。

## 密钥防复发

三道门禁，缺一不可：

1. **入库前**：`npm run audit:secrets`（[scripts/check-secrets.mjs](../scripts/check-secrets.mjs)）。
   零依赖，扫描所有被 git 跟踪的文件，检查明文 `appToken`/`APP_TOKEN`/TMDB JWT/私钥/证书口令，
   并断言 `resources/tmdb-proxy.json` 与 `server/.env` 仍然处于被忽略状态。
   已接进 `npm run check`，并在 [.github/workflows/build-installers.yml](../.github/workflows/build-installers.yml)
   的 `secret-scan` 作业里作为安装包构建的前置条件。
2. **打包时**：`scripts/inject-tmdb-proxy.mjs --require` 从环境变量注入，取不到就让构建失败。
3. **轮换能力**：`ROTATE_APP_TOKEN=1 ./deploy-*.sh` 支持新旧口令并存过渡，随时可换。

## 遗留待办

- **历史提交里仍有旧口令（可选清理）**：`resources/tmdb-proxy.json` 曾出现在 2 个历史提交中
  （`939b0b8`、`dc5ed73`）。文件现已移出索引并被忽略、构建改为环境变量注入，但历史内容还在。
  **只要按上文「口令轮换」换掉旧口令，历史里的那串字符就已经失效**，清理历史属于卫生工作而非救火。
  确需清理时用 [scripts/purge-leaked-token.ps1](../scripts/purge-leaked-token.ps1)：
  默认只预演，加 `-Execute` 才动手，会自动做 mirror 备份、优先用 `git filter-repo`、
  并打印强推与协作者重新 clone 的注意事项。
- **设备凭据尚未全面启用**：代码与服务端已就绪（见上文「设备凭据」），
  目前的实际状态取决于是否走完了那三步上线顺序；`/api/healthz` 的
  `legacyTokenDataAccess` 字段为 `true` 即表示共享口令仍可直接取数据。
- **服务端 `TMDB_TOKEN` 尚未轮换**：`server/.env` 中的 v4 Token 为明文落盘（该文件未被 git 跟踪）。
  它同样需要轮换，但目前无法重新申请，属于已知残留风险；缓解措施是保持 `.env` 权限 `600`、
  不进入备份/同步盘，并在将来可以申请时立即更换。模板见 `server/.env.example`。
- **轮换服务器登录凭据**：部署期间 root 密码曾在聊天记录中出现。SSH 密码登录已关闭
  （`PasswordAuthentication no` + `PermitRootLogin prohibit-password`），建议再执行一次
  `passwd root` 换强密码。
- **确认 Vercel 项目已删除**：旧的 `pianke-tmdb-proxy.vercel.app` 曾有可用部署，
  `server/vercel/` 源码已在本次迁移中移除，Vercel 控制台上的项目需手动删除。
