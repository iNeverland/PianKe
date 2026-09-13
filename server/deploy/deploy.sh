#!/usr/bin/env bash
#
# PianKe TMDB 代理 —— Ubuntu 一键部署脚本
#
# 在服务器上运行：
#   cd /opt/pianke/server/deploy
#   ./deploy.sh tmdb.example.com
#
# 或在任意目录用环境变量运行：
#   sudo TMDB_TOKEN=eyJ... APP_TOKEN=$(openssl rand -hex 32) DOMAIN=tmdb.example.com EMAIL=me@example.com ./deploy.sh
#
# 脚本是幂等的：重复运行只会更新配置并重启服务。
set -euo pipefail

DOMAIN="${1:-${DOMAIN:-}}"
EMAIL="${EMAIL:-}"
ACME_EMAIL_ARG=""

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "请用 root 运行（sudo -i 后再执行）"
[[ -n "$DOMAIN" ]] || die "用法: ./deploy.sh <域名>   例: ./deploy.sh tmdb.example.com"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"          # 期望是仓库里的 server/ 目录
APP_DIR="/opt/pianke/server"
SERVICE="pianke-tmdb"
NGINX_SITE="/etc/nginx/sites-available/pianke-tmdb"

# ── 0. 来源校验 ────────────────────────────────────────────────────────────
[[ -f "$SRC_DIR/index.mjs" ]] || die "在 $SRC_DIR 找不到 index.mjs，请把整个 server/ 目录一起上传"
[[ -f "$SRC_DIR/deploy/nginx-pianke-tmdb.conf" ]] || die "缺少 deploy/nginx-pianke-tmdb.conf"

# ── 1. 采集配置 ────────────────────────────────────────────────────────────
if [[ -z "${TMDB_TOKEN:-}" && -f "$APP_DIR/.env" ]]; then
  TMDB_TOKEN="$(grep -E '^TMDB_TOKEN=' "$APP_DIR/.env" | head -1 | cut -d= -f2- || true)"
fi
if [[ -z "${TMDB_TOKEN:-}" ]]; then
  echo
  warn "粘贴 TMDB v4 Read Access Token（eyJ 开头），输入不回显："
  read -rs TMDB_TOKEN
  echo
fi
[[ "$TMDB_TOKEN" =~ ^(eyJ|ey[A-Za-z0-9_-]*\.) || ${#TMDB_TOKEN} -eq 32 ]] \
  || warn "这个值看起来不像 v4 Token 或 32 位 v3 Key，继续但可能 401"

if [[ -z "${APP_TOKEN:-}" ]]; then
  APP_TOKEN="$(openssl rand -hex 32)"
  warn "已自动生成 APP_TOKEN，请记录：$APP_TOKEN"
fi

# ── 2. 安装依赖 ────────────────────────────────────────────────────────────
log "安装 Node.js 22 与 Nginx（已装则跳过）"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg >/dev/null

NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "$MAJOR" -ge 18 ]] && NEED_NODE=0
fi
if [[ "$NEED_NODE" -eq 1 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
log "Node 版本: $(node -v)  /  npm: $(npm -v 2>/dev/null || echo n/a)"

command -v nginx >/dev/null 2>&1 || apt-get install -y -qq nginx >/dev/null

# ── 3. 同步代码 ────────────────────────────────────────────────────────────
log "同步代码到 $APP_DIR"
mkdir -p "$APP_DIR/deploy"
if [[ "$SRC_DIR" != "$APP_DIR" ]]; then
  cp -a "$SRC_DIR/index.mjs" "$APP_DIR/index.mjs"
  cp -a "$SRC_DIR/package.json" "$APP_DIR/package.json" 2>/dev/null || true
  cp -a "$SRC_DIR/deploy/." "$APP_DIR/deploy/"
fi

# ── 4. 写 .env ─────────────────────────────────────────────────────────────
log "写入 $APP_DIR/.env"
cat > "$APP_DIR/.env" <<EOF
TMDB_TOKEN=$TMDB_TOKEN
APP_TOKEN=$APP_TOKEN
PORT=8787
EOF
chmod 600 "$APP_DIR/.env"

# ── 5. systemd ─────────────────────────────────────────────────────────────
log "安装并启动 systemd 服务 $SERVICE"
install -m 644 "$APP_DIR/deploy/pianke-tmdb.service" "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true
systemctl restart "$SERVICE"
sleep 1
systemctl is-active --quiet "$SERVICE" || {
  journalctl -u "$SERVICE" -n 40 --no-pager || true
  die "服务启动失败，见上方日志"
}

# ── 6. 本机自检 ────────────────────────────────────────────────────────────
log "本机自检"
curl -fsS --max-time 10 "http://127.0.0.1:8787/api/healthz" && echo
SEARCH_BODY="$(curl -fsS --max-time 20 -H "x-app-token: $APP_TOKEN" "http://127.0.0.1:8787/api/search?q=test" | head -c 200)"
[[ -n "$SEARCH_BODY" ]] || die "/api/search 没有返回内容，检查 TMDB_TOKEN"
log "搜索接口返回: ${SEARCH_BODY:0:120}…"

# ── 7. Nginx 反代 ─────────────────────────────────────────────────────────
log "配置 Nginx（$DOMAIN）"
awk -v d="$DOMAIN" -v t="$APP_TOKEN" '
  /^# PianKe TMDB 代理/ { skip=1 }
  skip && /^# 证书由 certbot/ { next }
  skip && /^server \{/ { skip=0 }
  !skip { gsub(/__DOMAIN__/, d); gsub(/__APP_TOKEN__/, t); print }
' "$APP_DIR/deploy/nginx-pianke-tmdb.conf" > "$NGINX_SITE"

ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/pianke-tmdb
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ── 8. TLS ────────────────────────────────────────────────────────────────
if [[ "$DOMAIN" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ || "$DOMAIN" == *:* ]]; then
  warn "传入的是 IP，跳过 Let's Encrypt；客户端请使用 http://$DOMAIN"
elif ! getent hosts "$DOMAIN" >/dev/null 2>&1; then
  warn "$DOMAIN 在本机解析不出记录，跳过证书申请"
  warn "确认 DNS 已生效后重跑：certbot --nginx -d $DOMAIN"
else
  command -v certbot >/dev/null 2>&1 || apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  if [[ -z "$EMAIL" ]]; then
    read -rp "Let's Encrypt 通知邮箱（可留空回车跳过证书申请）: " EMAIL || true
  fi
  if [[ -n "$EMAIL" ]]; then
    ACME_EMAIL_ARG="-m $EMAIL"
    log "申请证书"
    # shellcheck disable=SC2086
    certbot --nginx -d "$DOMAIN" $ACME_EMAIL_ARG --agree-tos --redirect --non-interactive \
      || warn "certbot 失败，先用 http 也能跑；修复 DNS/80 端口后重跑"
    systemctl reload nginx
  else
    warn "未提供邮箱，跳过证书申请"
  fi
fi

# ── 8.5 通过公网域名端到端验收 ─────────────────────────────────────────────
SCHEME="http"
[[ -d "/etc/letsencrypt/live/$DOMAIN" ]] && SCHEME="https"

if [[ "$DOMAIN" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  PUBLIC_URL="http://$DOMAIN"
else
  PUBLIC_URL="$SCHEME://$DOMAIN"
  log "经 Nginx 公网入口验收（$PUBLIC_URL）"
  if curl -fsS --max-time 15 -H "x-app-token: $APP_TOKEN" "$PUBLIC_URL/api/search?q=test" | head -c 120 | grep -q .; then
    log "公网入口正常"
  else
    warn "公网入口未通过，请检查 DNS、80/443 端口与云厂商安全组"
  fi
  # 反向验证：不带 token 必须被拒
  if [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$PUBLIC_URL/api/search?q=test")" == "401" ]]; then
    log "未授权访问已被正确拒绝（401）"
  else
    warn "不带 x-app-token 的请求没有被 401 拒绝，请检查 Nginx 配置"
  fi
fi

# ── 9. 完成 ───────────────────────────────────────────────────────────────
cat <<EOF

────────────────────────────────────────────────────────
部署完成 ✅

  服务名    : $SERVICE   （systemctl status $SERVICE）
  本地监听  : 127.0.0.1:8787
  对外地址  : $PUBLIC_URL
  APP_TOKEN : $APP_TOKEN

把下面这段写进客户端的 resources/tmdb-proxy.json，然后重新打包：

{
  "url": "$PUBLIC_URL",
  "appToken": "$APP_TOKEN"
}

验收命令（在服务器上先跑一次）：
  curl -s "$PUBLIC_URL/api/healthz"
  curl -s -H "x-app-token: $APP_TOKEN" "$PUBLIC_URL/api/search?q=test" | head -c 200

⚠️  最后一次验收必须在「国内跑客户端的那台机器」上执行同样的 curl——
    服务器本机通不代表国内直连通。
────────────────────────────────────────────────────────
EOF
