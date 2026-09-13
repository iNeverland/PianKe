#!/usr/bin/env bash
#
# 把 PianKe TMDB 代理站点追加到一个已存在的 Caddyfile 中。
# 适用于服务器上已经用 Caddy 管 80/443 的情况（本项目的 PocketBase 主机就是这种）。
#
# 用法：
#   ./deploy-caddy.sh <域名> [Caddyfile路径]
#   ./deploy-caddy.sh tmdb.example.com /etc/caddy/Caddyfile
#
# 需要 /opt/pianke/server/.env 里已有 APP_TOKEN。脚本幂等：重复运行只会覆盖自己的站点。
set -euo pipefail

DOMAIN="${1:-}"
CADDYFILE="${2:-/etc/caddy/Caddyfile}"
APP_ENV="/opt/pianke/server/.env"

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "请用 root 运行"
[[ -n "$DOMAIN" ]] || die "用法: ./deploy-caddy.sh <域名> [Caddyfile路径]"
[[ -f "$CADDYFILE" ]] || die "$CADDYFILE 不存在；这台机器可能没有 Caddy，请改用 deploy.sh + Nginx 方案"
[[ -f "$APP_ENV" ]] || die "$APP_ENV 不存在，先完成服务端部署"

APP_TOKEN="$(grep -E '^APP_TOKEN=' "$APP_ENV" | head -1 | cut -d= -f2- || true)"
[[ -n "$APP_TOKEN" ]] || die "$APP_ENV 里没有 APP_TOKEN，请先设置（否则接口无鉴权）"

log "备份 $CADDYFILE"
BACKUP="$CADDYFILE.backup-before-$DOMAIN-$(date +%Y%m%d%H%M%S)"
cp -a "$CADDYFILE" "$BACKUP"
log "备份到 $BACKUP"

# 1) 先剥掉本脚本上一轮写入的站点块（幂等的关键）
#    逐行数花括号，确保整个块被完整移除，避免出现 "ambiguous site definition"
TMP="$(mktemp)"
awk -v d="$DOMAIN" '
  BEGIN { skip=0; depth=0 }
  skip == 0 {
    if ($0 ~ /^[ \t]*#/) { print; next }
    if ($0 !~ /^[ \t]*$/) {
      n = split($0, a, "{")
      if (n > 1) {
        if (index(a[1], d) > 0) {
          skip = 1
          depth = 1
          next
        }
      }
    }
    print
    next
  }
  skip == 1 {
    depth += gsub(/\{/, "{") - gsub(/\}/, "}")
    if (depth <= 0) { skip = 0 }
    next
  }
' "$CADDYFILE" > "$TMP"

# 2) 生成新站点块（占位符替换；token 为十六进制，转义 & 以防万一）
BLOCK="$(mktemp)"
TOKEN_ESCAPED="$(printf '%s' "$APP_TOKEN" | sed 's/[&\\]/\\&/g')"
sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__APP_TOKEN__/$TOKEN_ESCAPED/g" \
    /opt/pianke/server/deploy/caddy-pianke-tmdb.caddyfile > "$BLOCK"

# 3) 插到最后一个顶层 site 的结束花括号之后，保证块级结构合法
awk -v blockfile="$BLOCK" '
  { lines[NR] = $0 }
  END {
    last = 0
    seen = 0
    for (i = 1; i <= NR; i++) {
      if (lines[i] ~ /^[ \t]*[^ \t#]/) { seen = 1 }
      if (seen && lines[i] ~ /^}[ \t]*$/) { last = i }
    }
    if (last == 0) { print "ERROR: 找不到顶层结束花括号" > "/dev/stderr"; exit 1 }
    for (i = 1; i <= last; i++) print lines[i]
    print ""
    while ((getline l < blockfile) > 0) print l
    close(blockfile)
    for (i = last + 1; i <= NR; i++) print lines[i]
  }
' "$TMP" > "$CADDYFILE"

log "已写入站点 $DOMAIN"

# 4) 日志目录
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy

# 5) 校验并热加载
log "校验 Caddyfile"
if ! caddy validate --config "$CADDYFILE" --adapter caddyfile 2>&1 | tail -2; then
  warn "校验失败，回滚到备份"
  cp -a "$BACKUP" "$CADDYFILE"
  exit 1
fi

log "热加载 Caddy"
if ! systemctl reload caddy; then
  warn "reload 失败，回滚并重启"
  cp -a "$BACKUP" "$CADDYFILE"
  systemctl restart caddy
  exit 1
fi

rm -f "$TMP" "$BLOCK"
log "Caddy 状态: $(systemctl is-active caddy)"

# 6) 本机验收（用 Host 头绕过 DNS）
log "本机经 Caddy 验收"
echo -n "  /healthz（无需 token）: "
curl -s --max-time 10 -H "Host: $DOMAIN" http://127.0.0.1/healthz || echo "(失败)"
echo
echo -n "  带 token:   "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 -H "Host: $DOMAIN" -H "x-app-token: $APP_TOKEN" "http://127.0.0.1/api/search?q=test"
echo -n "  无 token:   "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 -H "Host: $DOMAIN" "http://127.0.0.1/api/search?q=test"

echo
log "完成。DNS 生效后，Caddy 会在首次访问时自动签发 $DOMAIN 的证书。"
echo "  公网验收：curl -s https://$DOMAIN/healthz"
echo "  带 token：curl -s -H 'x-app-token: <APP_TOKEN>' 'https://$DOMAIN/api/search?q=test'"
