const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p';
const CHINESE_REGION_NAMES = new Intl.DisplayNames(['zh-CN'], { type: 'region' });

export function sendJson(res, status, payload, cacheControl = 'no-store') {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.status(status).json(payload);
}

export function requireAuthorized(req, res) {
  const appToken = process.env.APP_TOKEN;
  if (appToken && req.headers['x-app-token'] !== appToken) {
    sendJson(res, 401, { error: '未授权访问' });
    return false;
  }
  if (!process.env.TMDB_TOKEN) {
    sendJson(res, 500, { error: '服务器未配置 TMDB_TOKEN' });
    return false;
  }
  return true;
}

export async function tmdbFetch(pathname, params = {}) {
  const url = new URL(`${TMDB_API}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  url.searchParams.set('language', 'zh-CN');

  const token = process.env.TMDB_TOKEN || '';
  // TMDB 同时提供 v4 Read Access Token（Bearer）与 v3 API Key（32 位十六进制）。
  // 支持两者，避免把凭据类型填错时让服务不可用。
  const isV3ApiKey = /^[a-f0-9]{32}$/i.test(token);
  if (isV3ApiKey) url.searchParams.set('api_key', token);

  const response = await fetch(url, {
    headers: {
      ...(isV3ApiKey ? {} : { Authorization: `Bearer ${token}` }),
      accept: 'application/json',
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.status_message || `TMDB 请求失败（${response.status}）`);
  return body;
}

export function normalizeSearch(results) {
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

export function normalizeDetails(item, mediaType) {
  const isTv = mediaType === 'tv';
  const crew = item.credits?.crew || [];
  const cast = item.credits?.cast || [];
  const director = isTv
    ? (item.created_by || []).map((person) => person.name).join('、')
    : crew.filter((person) => person.job === 'Director').map((person) => person.name).join('、');

  return {
    id: item.id,
    mediaType: isTv ? '剧集' : '电影',
    title: isTv ? item.name : item.title,
    titleOriginal: isTv ? item.original_name : item.original_title,
    director,
    cast: cast.slice(0, 10).map((person) => person.name),
    releaseDate: isTv ? item.first_air_date || '' : item.release_date || '',
    // TMDB 即使指定 zh-CN，production_countries.name 也可能是英文；ISO 代码则稳定。
    country: (item.production_countries || [])
      .map((country) => country.iso_3166_1 ? CHINESE_REGION_NAMES.of(country.iso_3166_1) || country.name : country.name)
      .join('、'),
    genre: (item.genres || []).map((genre) => genre.name),
    runtime: isTv ? item.episode_run_time?.[0] || 0 : item.runtime || 0,
    synopsis: item.overview || '',
    rating: item.vote_average ? Math.round(item.vote_average * 10) / 10 : 0,
    totalEpisodes: isTv ? item.number_of_episodes || 0 : null,
    posterPath: item.poster_path || null,
  };
}

export async function fetchPoster(posterPath, width = 'w500') {
  if (!/^\/[A-Za-z0-9/_.-]+$/.test(posterPath) || !['w154', 'w342', 'w500', 'original'].includes(width)) {
    throw new Error('海报参数无效');
  }
  const response = await fetch(`${TMDB_IMAGE}/${width}${posterPath}`);
  if (!response.ok) throw new Error('海报获取失败');
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'image/jpeg',
  };
}
