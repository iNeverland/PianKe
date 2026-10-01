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
#
# 口令轮换：
#   ROTATE_APP_TOKEN=1 ./deploy-caddy.sh <域名>      ← 自动生成新口令并保留旧口令（过渡期）
#   或手工把 .env 的旧口令挪到 APP_TOKEN_PREVIOUS，再直接重跑本脚本。
#   两种方式都会让反代变成同时接受新旧口令；客户端升级完再删掉那一行并重跑。
set -euo pipefail

DOMAIN="${1:-}"
CADDYFILE="${2:-/etc/caddy/Caddyfile}"
APP_ENV="/opt/pianke/server/.env"

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

# 把若干「口令 / 逗号分隔的口令串」拼成锚定正则，例如 ^(新口令|旧口令)$。
# 只接受 [A-Za-z0-9_-]，避免把正则元字符带进反代配置。
build_token_regex() {
  local tokens=() raw part parts
  for raw in "$@"; do
    [[ -n "$raw" ]] || continue
    IFS=',' read -r -a parts <<< "$raw"
    for part in "${parts[@]}"; do
      part="${part//[[:space:]]/}"
      [[ -n "$part" ]] || continue
      [[ "$part" =~ ^[A-Za-z0-9_-]+$ ]] || die "口令含非法字符（只允许字母/数字/下划线/连字符）"
      tokens+=("$part")
    done
  done
  [[ ${#tokens[@]} -gt 0 ]] || return 0
  local IFS='|'
  printf '^(%s)$' "${tokens[*]}"
}

[[ $EUID -eq 0 ]] || die "请用 root 运行"
[[ -n "$DOMAIN" ]] || die "用法: ./deploy-caddy.sh <域名> [Caddyfile路径]"
[[ -f "$CADDYFILE" ]] || die "$CADDYFILE 不存在；这台机器可能没有 Caddy，请改用 deploy.sh + Nginx 方案"
[[ -f "$APP_ENV" ]] || die "$APP_ENV 不存在，先完成服务端部署"

APP_TOKEN="$(grep -E '^APP_TOKEN=' "$APP_ENV" | head -1 | cut -d= -f2- || true)"
APP_TOKEN_PREVIOUS="$(grep -E '^APP_TOKEN_PREVIOUS=' "$APP_ENV" | head -1 | cut -d= -f2- || true)"
[[ -n "$APP_TOKEN" ]] || die "$APP_ENV 里没有 APP_TOKEN，请先设置（否则接口无鉴权）"

# 口令轮换（可选）：ROTATE_APP_TOKEN=1 ./deploy-caddy.sh <域名>
# 生成新口令写回 .env，并把当前口令追加进 APP_TOKEN_PREVIOUS，
# 这样尚未升级的客户端不会立刻 401。客户端普及后删掉 .env 里那一行再重跑本脚本。
if [[ "${ROTATE_APP_TOKEN:-0}" == "1" ]]; then
  command -v openssl >/dev/null 2>&1 || die "缺少 openssl，无法生成新口令"
  NEW_PREVIOUS="$APP_TOKEN"
  if [[ -n "$APP_TOKEN_PREVIOUS" ]]; then
    NEW_PREVIOUS="$APP_TOKEN,$APP_TOKEN_PREVIOUS"
  fi
  NEW_TOKEN="$(openssl rand -hex 32)"
  ENV_BACKUP="$APP_ENV.backup-$(date +%Y%m%d%H%M%S)"
  cp -a "$APP_ENV" "$ENV_BACKUP"
  sed -i -e "s|^APP_TOKEN=.*|APP_TOKEN=$NEW_TOKEN|" "$APP_ENV"
  if grep -qE '^APP_TOKEN_PREVIOUS=' "$APP_ENV"; then
    sed -i -e "s|^APP_TOKEN_PREVIOUS=.*|APP_TOKEN_PREVIOUS=$NEW_PREVIOUS|" "$APP_ENV"
  else
    printf 'APP_TOKEN_PREVIOUS=%s\n' "$NEW_PREVIOUS" >> "$APP_ENV"
  fi
  chmod 600 "$APP_ENV"
  APP_TOKEN="$NEW_TOKEN"
  APP_TOKEN_PREVIOUS="$NEW_PREVIOUS"
  warn "已轮换 APP_TOKEN，旧口令进入过渡期；原 .env 已备份到 $ENV_BACKUP"
  warn "新的 APP_TOKEN：$NEW_TOKEN"
fi

# 单口令 → ^(口令)$；轮换过渡期 → ^(新口令|旧口令)$，让未升级的客户端不会立刻 401。
TOKEN_REGEX="$(build_token_regex "$APP_TOKEN" "$APP_TOKEN_PREVIOUS")"
[[ -n "$TOKEN_REGEX" ]] || die "无法生成口令正则，请检查 $APP_ENV"
if [[ -n "$APP_TOKEN_PREVIOUS" ]]; then
  warn "检测到 APP_TOKEN_PREVIOUS：反代将同时接受旧口令（轮换过渡期）"
fi

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
TOKEN_ESCAPED="$(printf '%s' "$TOKEN_REGEX" | sed 's/[&\\]/\\&/g')"
DOMAIN_ESCAPED="$(printf '%s' "$DOMAIN" | sed 's/[&\\]/\\&/g')"
sed -e "s/__DOMAIN__/$DOMAIN_ESCAPED/g" -e "s/__APP_TOKEN_REGEX__/$TOKEN_ESCAPED/g" \
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

# 5.5) 服务端 .env 可能在本次运行中被轮换过，重启上游让它加载新口令
log "重启 pianke-tmdb 以加载最新口令"
systemctl restart pianke-tmdb 2>/dev/null || warn "未能重启 pianke-tmdb，请手动执行 systemctl restart pianke-tmdb"
sleep 1
systemctl is-active --quiet pianke-tmdb && log "pianke-tmdb 已运行" || warn "pianke-tmdb 未处于运行状态，请查看 journalctl -u pianke-tmdb"

# 6) 本机验收
#
# 必须走 HTTPS：Caddy 对 http:// 请求一律回 301/308 跳转，只查状态码会把「重定向」
# 误当成「通过」（实测三项全变 308，等于什么都没验证）。--resolve 让它直连本机
# 并保持正确的 SNI 与 Host，因此不依赖公网 DNS，也能校验证书。
VERIFY_FAILED=0
if curl -s -o /dev/null --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/healthz"; then
  BASE="https://$DOMAIN"; RESOLVE=(--resolve "$DOMAIN:443:127.0.0.1")
  log "本机经 Caddy 验收（HTTPS）"
else
  BASE="http://$DOMAIN"; RESOLVE=(--resolve "$DOMAIN:80:127.0.0.1")
  warn "HTTPS 尚不可用（证书未签发？），退回 HTTP 验收，结果仅供参考"
  log "本机经 Caddy 验收（HTTP）"
fi

probe() {
  local label="$1" expect="$2"; shift 2
  local got
  got="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${RESOLVE[@]}" "$@")"
  if [[ "$got" == "$expect" ]]; then
    echo "  ✓ $label: $got"
  else
    VERIFY_FAILED=1
    echo "  ✗ $label: 期望 $expect，实际 $got"
  fi
}

# 共享口令能否直接取数据由 .env 的 LEGACY_TOKEN_DATA_ACCESS 决定。收口（设为 false）之后
# 它只用于注册，此时「带共享口令取数据」的正确期望就是 401 —— 不区分状态的话，
# 收口后每次部署都会亮一个假失败。
LEGACY_DATA_ACCESS="$(grep -E '^LEGACY_TOKEN_DATA_ACCESS=' "$APP_ENV" | head -1 | cut -d= -f2- | tr -d '[:space:]' || true)"
SHARED_EXPECT=200
SHARED_LABEL="新 token"
if [[ "$LEGACY_DATA_ACCESS" == "false" ]]; then
  SHARED_EXPECT=401
  SHARED_LABEL="共享口令取数据（已停用，应 401）"
fi

# 注意探活路径是 /healthz（Caddy 的 handle_path 会剥离该前缀再重写成 /api/healthz）；
# /api/healthz 落在受凭据保护的 handle 块里，未经授权返回 401 才是对的。
probe "/healthz（免 token 的探活路径）" 200 "$BASE/healthz"
probe "$SHARED_LABEL" "$SHARED_EXPECT" -H "x-app-token: $APP_TOKEN" "$BASE/api/search?q=test"
if [[ -n "$APP_TOKEN_PREVIOUS" ]]; then
  probe "旧 token（过渡期）" 200 -H "x-app-token: ${APP_TOKEN_PREVIOUS%%,*}" "$BASE/api/search?q=test"
fi
probe "无 token" 401 "$BASE/api/search?q=test"

if [[ "$VERIFY_FAILED" -ne 0 ]]; then
  echo
  warn "有验收项未通过。配置已经写入并生效，未自动回滚；请按上面的 ✗ 逐项排查。"
  echo "  反代配置备份：$BACKUP"
  echo "  .env 备份：${ENV_BACKUP:-(本次未轮换口令)}"
  exit 1
fi

echo
log "全部验收通过。"
echo "  公网验收：curl -s https://$DOMAIN/healthz"
echo "  带 token：curl -s -H 'x-app-token: <APP_TOKEN>' 'https://$DOMAIN/api/search?q=test'"
