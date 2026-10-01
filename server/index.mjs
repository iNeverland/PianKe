import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeviceStore } from './devices.mjs';

const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';
const CHINESE_REGION_NAMES = new Intl.DisplayNames(['zh-CN'], { type: 'region' });

function loadDotEnv() {
  const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

loadDotEnv();

const TMDB_TOKEN = process.env.TMDB_TOKEN || '';
const PORT = Number(process.env.PORT || 8787);
// 默认只监听回环地址：本服务不自己做 TLS，直接暴露到公网会绕过反代的
// 鉴权与限流。如需直连（例如客户端与服务器同机）再显式设 HOST=0.0.0.0。
const HOST = process.env.HOST || '127.0.0.1';
// 客户端访问口令（x-app-token）。支持一次配置多个，用于令牌轮换过渡期：
//   APP_TOKEN          当前口令
//   APP_TOKEN_PREVIOUS 即将废弃的旧口令（客户端全部升级后应删除）
// 两者都可以用英文逗号分隔填多个。未配置任何口令时不做鉴权，仅剩限流保护。
const APP_TOKENS = [process.env.APP_TOKEN, process.env.APP_TOKEN_PREVIOUS]
  .filter(Boolean)
  .flatMap((value) => String(value).split(','))
  .map((value) => value.trim())
  .filter(Boolean);
const LEGACY_APP_TOKEN_IN_USE = Boolean(process.env.APP_TOKEN_PREVIOUS);

/** 令牌指纹：只用于日志与限流分桶，不能反推出原文。 */
function tokenFingerprint(token) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 8);
}

/** 定时安全比较，避免用响应时间区分「前缀正确」与「完全不对」。 */
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * 校验 x-app-token。
 * 返回匹配到的令牌（用于限流分桶）；未配置口令时返回 ''；不匹配返回 null。
 * 重复发送同名请求头时 Node 会给出数组，这种情况按不匹配处理。
 */
function matchAppToken(headerValue) {
  if (APP_TOKENS.length === 0) return '';
  if (typeof headerValue !== 'string') return null;
  const value = headerValue.trim();
  if (!value) return null;
  let matched = null;
  for (const token of APP_TOKENS) {
    // 不使用 early-return，避免用「比较了几项」推断令牌位置
    if (safeEqual(value, token)) matched = token;
  }
  return matched;
}

/* ─────────────────────────── 设备凭据（可选，替代随包分发的共享口令） ───────────────────────────
 * 共享口令随安装包分发，任何拿到安装包的人都能提取，因此它不适合长期充当访问凭据。
 * 设备凭据方案见 devices.mjs：共享口令只用来「注册」，之后按设备签发凭据、按设备记账。
 *
 * 迁移是渐进且可回退的：
 *   LEGACY_TOKEN_DATA_ACCESS=true（默认）共享口令与设备凭据并存，旧客户端不受影响；
 *   客户端全部升级后改成 false，共享口令就只剩「注册」一个用途 —— 即使继续泄露，
 *   也无法再直接取数据，能造成的损失被注册配额（见 REGISTER_LIMIT_*）限死。
 */
const DEVICE_ENROLLMENT = process.env.DEVICE_ENROLLMENT !== 'false';
const LEGACY_TOKEN_DATA_ACCESS = process.env.LEGACY_TOKEN_DATA_ACCESS !== 'false';
const DEVICE_STATE_DIR = process.env.STATE_DIRECTORY
  || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const devices = createDeviceStore({
  stateDir: DEVICE_STATE_DIR,
  maxDevices: Number(process.env.MAX_DEVICES || 200),
  registerLimitPerHour: Number(process.env.REGISTER_LIMIT_PER_HOUR || 10),
  registerLimitPerDay: Number(process.env.REGISTER_LIMIT_PER_DAY || 100),
});
devices.load();

/**
 * 授权：设备凭据优先于共享口令。
 * 返回 { ok, principal } 或 { ok:false, message }。
 */
function authorize(req, pathname) {
  const isRegister = pathname === '/api/device/register';
  const matchedDevice = devices.match(req.headers);
  if (matchedDevice) {
    return { ok: true, principal: `dev:${matchedDevice.deviceId}`, deviceId: matchedDevice.deviceId };
  }

  // 未配置任何共享口令：保持既有的「开放但限流」行为（也允许设备注册）
  if (APP_TOKENS.length === 0) {
    return { ok: true, principal: 'anon' };
  }

  const matchedToken = matchAppToken(req.headers['x-app-token']);
  if (matchedToken !== null && matchedToken !== '') {
    if (isRegister || LEGACY_TOKEN_DATA_ACCESS) {
      return { ok: true, principal: `tok:${tokenFingerprint(matchedToken)}` };
    }
    return { ok: false, message: '共享口令已停用数据访问，请把客户端升级到使用设备凭据的版本' };
  }
  return { ok: false, message: '未授权访问' };
}

/** 读取并限制大小的 JSON 请求体。 */
async function readJsonBody(req, limit = 8 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

// 简单的进程内缓存：结果缓存在内存，进程重启后失效。
// 若部署在多实例/需要持久化，可换成 Redis 或文件缓存。
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 小时
const rateBuckets = new Map();
const RATE_WINDOW = 60 * 1000;
const RATE_LIMIT = 60;
// 仅在部署在可信反向代理（如 Nginx/Vercel）之后时才信任 X-Forwarded-For，
// 否则直连时攻击者可通过伪造该头绕过限流。
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return hit.body;
}

function cacheSet(key, body) {
  cache.set(key, { time: Date.now(), body });
}

function clientIp(req) {
  const forwarded = TRUST_PROXY ? req.headers['x-forwarded-for'] : undefined;
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (raw || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
}

let lastBucketSweep = 0;

/**
 * 计数桶按「身份 + 客户端 IP」划分：身份是设备 id 或共享口令指纹。
 * 好处是某个设备（或泄露的旧口令）被滥用时，不会把正常客户端一起打到 429。
 */
function isRateLimited(req, principal) {
  const key = `${principal || 'anon'}|${clientIp(req)}`;
  const now = Date.now();

  // 顺带清理过期桶，避免不同 IP/口令不断累积导致 Map 无界增长
  if (now - lastBucketSweep >= RATE_WINDOW) {
    lastBucketSweep = now;
    for (const [bucketKey, bucket] of rateBuckets) {
      if (now - bucket.startedAt >= RATE_WINDOW) rateBuckets.delete(bucketKey);
    }
  }

  const current = rateBuckets.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count++;
  return current.count > RATE_LIMIT;
}

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

async function proxyToTmdb(pathname, query) {
  const url = new URL(`${TMDB_API}${pathname}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  url.searchParams.set('language', 'zh-CN');

  const isV3ApiKey = /^[a-f0-9]{32}$/i.test(TMDB_TOKEN);
  if (isV3ApiKey) url.searchParams.set('api_key', TMDB_TOKEN);

  const res = await fetch(url, {
    headers: {
      ...(isV3ApiKey ? {} : { Authorization: `Bearer ${TMDB_TOKEN}` }),
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`TMDB ${res.status}: ${data.status_message || '请求失败'}`);
  }
  return data;
}

/** 标准化搜索结果，便于前端直接使用 */
function normalizeSearch(results) {
  return (results || [])
    .filter((item) => item.media_type === 'movie' || item.media_type === 'tv')
    .map((item) => ({
      id: item.id,
      mediaType: item.media_type === 'tv' ? '剧集' : '电影',
      title: item.media_type === 'tv' ? item.name : item.title,
      titleOriginal: item.media_type === 'tv' ? item.original_name : item.original_title,
      releaseDate: item.media_type === 'tv' ? item.first_air_date || '' : item.release_date || '',
      overview: item.overview || '',
      rating: item.vote_average ? Math.round(item.vote_average * 10) / 10 : 0,
      posterPath: item.poster_path || null,
    }));
}

function normalizeDetails(item, mediaType) {
  const isTv = mediaType === 'tv';
  const crew = (item.credits && item.credits.crew) || [];
  const cast = (item.credits && item.credits.cast) || [];
  const director = isTv
    ? (item.created_by || []).map((p) => p.name).join('、')
    : crew.filter((p) => p.job === 'Director').map((p) => p.name).join('、');

  return {
    id: item.id,
    mediaType: isTv ? '剧集' : '电影',
    title: isTv ? item.name : item.title,
    titleOriginal: isTv ? item.original_name : item.original_title,
    director,
    cast: cast.slice(0, 10).map((p) => p.name),
    releaseDate: isTv ? item.first_air_date || '' : item.release_date || '',
    country: (item.production_countries || [])
      .map((country) => country.iso_3166_1 ? CHINESE_REGION_NAMES.of(country.iso_3166_1) || country.name : country.name)
      .join('、'),
    genre: (item.genres || []).map((g) => g.name),
    runtime: isTv
      ? (item.episode_run_time && item.episode_run_time[0]) || 0
      : item.runtime || 0,
    synopsis: item.overview || '',
    rating: item.vote_average ? Math.round(item.vote_average * 10) / 10 : 0,
    totalEpisodes: isTv ? item.number_of_episodes || 0 : null,
    posterPath: item.poster_path || null,
  };
}

function sendImage(res, buffer, contentType) {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=604800, immutable',
    'Content-Length': buffer.length,
  });
  res.end(buffer);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // 健康检查：不校验口令、不计入限流，便于反向代理/监控探活。
    if (pathname === '/api/healthz' && req.method === 'GET') {
      return sendJson(res, TMDB_TOKEN ? 200 : 503, {
        ok: Boolean(TMDB_TOKEN),
        tmdbToken: Boolean(TMDB_TOKEN),
        appTokenRequired: APP_TOKENS.length > 0,
        deviceEnrollment: DEVICE_ENROLLMENT,
        legacyTokenDataAccess: LEGACY_TOKEN_DATA_ACCESS,
        devices: devices.count(),
        uptime: Math.round(process.uptime()),
      });
    }

    // 授权：设备凭据或共享口令。共享口令能否取数据由 LEGACY_TOKEN_DATA_ACCESS 决定。
    const authorized = authorize(req, pathname);
    if (!authorized.ok) {
      return sendJson(res, 401, { error: authorized.message || '未授权访问' });
    }

    // 设备注册：用共享口令（或开放模式）换取一对设备凭据，换取结果只返回一次。
    if (pathname === '/api/device/register') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '仅支持 POST' });
      if (!DEVICE_ENROLLMENT) return sendJson(res, 404, { error: '接口不存在' });
      if (devices.isRegisterLimited(clientIp(req))) {
        return sendJson(res, 429, { error: '设备注册过于频繁或已达当日配额，请稍后重试' });
      }
      const body = await readJsonBody(req).catch(() => ({}));
      const result = devices.register(body.label);
      if (result.error) return sendJson(res, result.status, { error: result.error });
      console.log(`[device] 新设备 ${result.body.deviceId}（${body.label || '未命名'}），当前设备数 ${devices.count()}`);
      return sendJson(res, result.status, result.body);
    }

    // 设备用量记账（内存内累加，落盘由设备库合并）
    if (authorized.deviceId) devices.touch(authorized.deviceId);

    if (isRateLimited(req, authorized.principal)) {
      return sendJson(res, 429, { error: '请求过于频繁，请稍后重试' });
    }

    if (!TMDB_TOKEN) {
      return sendJson(res, 500, { error: '服务器未配置 TMDB_TOKEN' });
    }

    // 搜索：GET /api/search?q=...
    if (pathname === '/api/search' && req.method === 'GET') {
      const q = url.searchParams.get('q') || '';
      if (!q.trim()) return sendJson(res, 400, { error: '缺少 q 参数' });
      const cacheKey = 'search:' + q.trim();
      const cached = cacheGet(cacheKey);
      if (cached) return sendJson(res, 200, cached);
      const data = await proxyToTmdb('/search/multi', { query: q.trim() });
      const body = { results: normalizeSearch(data.results) };
      cacheSet(cacheKey, body);
      return sendJson(res, 200, body);
    }

    // 详情：GET /api/details/:mediaType/:id
    if (pathname.startsWith('/api/details/') && req.method === 'GET') {
      const parts = pathname.split('/').filter(Boolean);
      const mediaType = parts[2];
      const id = parts[3];
      if (!mediaType || !id) return sendJson(res, 400, { error: '参数不完整' });
      if (mediaType !== 'movie' && mediaType !== 'tv') {
        return sendJson(res, 400, { error: 'mediaType 仅支持 movie 或 tv' });
      }
      const cacheKey = 'details:' + mediaType + ':' + id;
      const cached = cacheGet(cacheKey);
      if (cached) return sendJson(res, 200, cached);
      const data = await proxyToTmdb(`/${mediaType}/${id}`, { append_to_response: 'credits' });
      const body = { result: normalizeDetails(data, mediaType) };
      cacheSet(cacheKey, body);
      return sendJson(res, 200, body);
    }

    // 海报代理：GET /api/poster?path=/xxx.jpg&width=w500
    // 让客户端也免直接访问 image.tmdb.org，海报请求统一走服务器缓存。
    if (pathname === '/api/poster' && req.method === 'GET') {
      const imgPath = url.searchParams.get('path');
      const width = url.searchParams.get('width') || 'w500';
      if (!imgPath) return sendJson(res, 400, { error: '缺少 path 参数' });
      if (!/^\/[A-Za-z0-9/_.-]+$/.test(imgPath) || !['w154', 'w342', 'w500', 'original'].includes(width)) {
        return sendJson(res, 400, { error: '海报参数无效' });
      }
      const cacheKey = 'poster:' + width + ':' + imgPath;
      const cached = cacheGet(cacheKey);
      if (cached && cached.buffer) {
        return sendImage(res, cached.buffer, cached.type);
      }
      const imgRes = await fetch(`${TMDB_IMG}/${width}${imgPath}`, { signal: AbortSignal.timeout(15000) });
      if (!imgRes.ok) return sendJson(res, 502, { error: '海报获取失败' });
      const contentLength = Number(imgRes.headers.get('content-length') || 0);
      if (contentLength > MAX_IMAGE_BYTES) return sendJson(res, 413, { error: '海报文件过大' });
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      if (buffer.length > MAX_IMAGE_BYTES) return sendJson(res, 413, { error: '海报文件过大' });
      const type = imgRes.headers.get('content-type') || 'image/jpeg';
      cacheSet(cacheKey, { buffer, type });
      return sendImage(res, buffer, type);
    }

    return sendJson(res, 404, { error: '接口不存在' });
  } catch (err) {
    console.error('[tmdb-server]', err);
    return sendJson(res, 502, { error: err.message || '服务器错误' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`PianKe TMDB 代理已启动: http://${HOST}:${PORT}`);
  if (!TMDB_TOKEN) console.warn('警告：尚未配置 TMDB_TOKEN（见 .env.example）');
  if (APP_TOKENS.length === 0) {
    console.warn('警告：未设置 APP_TOKEN，接口无鉴权，请勿直接暴露到公网');
  } else {
    console.log(`已启用 x-app-token 鉴权（有效口令 ${APP_TOKENS.length} 个）`);
    // 只打印指纹，便于与客户端 `npm run tmdb:proxy:check` 输出的 fp 直接对照，
    // 排 401 时不需要把口令抄来抄去。
    console.log(`  口令指纹: ${APP_TOKENS.map(tokenFingerprint).join(', ')}`);
    if (LEGACY_APP_TOKEN_IN_USE) {
      console.warn(`  当前口令: ${tokenFingerprint(APP_TOKENS[0])}（APP_TOKEN）`);
      console.warn('警告：正在接受 APP_TOKEN_PREVIOUS 中的旧口令（轮换过渡期）。');
      console.warn('      所有客户端升级完成后，请从 .env 删除 APP_TOKEN_PREVIOUS 并重启服务。');
    }
    if (!LEGACY_TOKEN_DATA_ACCESS) {
      console.log('  共享口令仅可用于设备注册（LEGACY_TOKEN_DATA_ACCESS=false），数据访问需要设备凭据。');
    }
  }
  if (!DEVICE_ENROLLMENT) {
    console.log('设备注册已关闭（DEVICE_ENROLLMENT=false），仅已注册设备与原共享口令可用。');
  } else {
    console.log(`设备凭据：已注册 ${devices.count()} 个（上限 ${devices.maxDevices}），设备库 ${devices.filePath}`);
    if (!devices.writable) {
      console.warn('警告：设备库不可写，注册接口会返回 503；请检查 STATE_DIRECTORY 权限或 systemd 的 StateDirectory。');
    }
  }
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.warn(`警告：正在监听 ${HOST}，请确保前面有反向代理负责 TLS 与鉴权`);
  }
});
