# 自建更新服务器发布

片刻的桌面端通过 HTTPS 从自建服务器获取自动更新；GitHub Actions 只负责在推送版本标签后构建并通过 SSH 上传更新文件。

## 服务器准备

以下示例使用 `updates.example.com` 和部署目录 `/var/www/pianke/updates`。请将它们替换为自己的域名和路径。

```bash
sudo adduser --disabled-password deploy
sudo mkdir -p /var/www/pianke/updates
sudo chown -R deploy:deploy /var/www/pianke/updates
```

Nginx 应将这个目录公开为 HTTPS 静态目录，且不可要求登录。例如：

```nginx
server {
    listen 443 ssl;
    server_name updates.example.com;

    ssl_certificate     /etc/letsencrypt/live/updates.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/updates.example.com/privkey.pem;

    root /var/www/pianke/updates;

    location / {
        try_files $uri =404;
        add_header Cache-Control "no-cache";
    }
}
```

## 部署密钥

在本机生成仅用于 GitHub Actions 的独立密钥：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/pianke_updates -C "github-actions-pianke"
```

将 `~/.ssh/pianke_updates.pub` 的内容追加到服务器 `/home/deploy/.ssh/authorized_keys`，并正确设置权限：

```bash
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
```

生成服务器 SSH 主机指纹并保存其完整输出：

```bash
ssh-keyscan -H updates.example.com
```

请在可信网络中执行此命令，并核对服务器控制台显示的指纹。不要在 Actions 中临时执行 `ssh-keyscan`，否则无法防范中间人攻击。

## GitHub Secrets

在仓库的 **Settings → Secrets and variables → Actions** 创建下列 Repository secrets：

| Secret | 示例值 | 用途 |
| --- | --- | --- |
| `UPDATE_BASE_URL` | `https://updates.example.com` | 客户端请求 `latest.yml` 的公开 HTTPS 地址；不要以 `/` 结尾。 |
| `UPDATE_HOST` | `updates.example.com` | SSH 服务器域名或 IP。 |
| `UPDATE_USER` | `deploy` | SSH 部署用户。 |
| `UPDATE_PORT` | `22` | SSH 端口；本服务器使用 `22022`。 |
| `UPDATE_SSH_KEY` | `~/.ssh/pianke_updates` 私钥全文 | 仅 CI 使用的私钥，包含 `BEGIN/END` 行。 |
| `UPDATE_PATH` | `/var/www/pianke/updates` | 服务器上的更新文件目录。 |
| `UPDATE_KNOWN_HOSTS` | `ssh-keyscan -H` 的完整输出 | SSH 服务器主机公钥，用于验证连接。 |

## 发布

将 `package.json` 的版本号升级后，提交并推送新的版本标签：

```bash
git tag v1.3.0
git push origin v1.3.0
```

工作流会上传 Windows 的 `latest.yml`、安装包和 `.blockmap`，以及 macOS 的 `latest-mac.yml`、`.zip` 与 `.dmg`。安装包和差分文件先上传，最后才发布 `latest*.yml`，因此客户端不会提前发现一个尚未完整上传的版本。

发布完成后确认以下地址可匿名访问：

```text
https://updates.example.com/latest.yml
https://updates.example.com/latest-mac.yml
```
