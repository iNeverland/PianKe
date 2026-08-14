import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const APP_TOKEN = process.env.APP_TOKEN || '';

// 简单的进程内缓存：结果缓存在内存，进程重启后失效。
// 若部署在多实例/需要持久化，可换成 Redis 或文件缓存。
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 小时
const requestsByIp = new Map();
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

function isRateLimited(req) {
  const forwarded = TRUST_PROXY ? req.headers['x-forwarded-for'] : undefined;
  const ip = (forwarded || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
  const now = Date.now();
  const current = requestsByIp.get(ip);
  if (!current || now - current.startedAt >= RATE_WINDOW) {
    requestsByIp.set(ip, { startedAt: now, count: 1 });
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

    // 可选访问口令：若服务器配置了 APP_TOKEN，客户端必须携带相同值。
    if (APP_TOKEN && req.headers['x-app-token'] !== APP_TOKEN) {
      return sendJson(res, 401, { error: '未授权访问' });
    }

    if (isRateLimited(req)) {
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

server.listen(PORT, () => {
  console.log(`PianKe TMDB 代理已启动: http://localhost:${PORT}`);
  if (!TMDB_TOKEN) console.warn('警告：尚未配置 TMDB_TOKEN（见 .env.example）');
});
