import { normalizeSearch, requireAuthorized, sendJson, tmdbFetch } from '../lib/tmdb.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: '仅支持 GET 请求' });
  if (!requireAuthorized(req, res)) return;
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query) return sendJson(res, 400, { error: '缺少 q 参数' });

  try {
    const data = await tmdbFetch('/search/multi', { query });
    return sendJson(res, 200, { results: normalizeSearch(data.results) }, 'public, s-maxage=3600, stale-while-revalidate=86400');
  } catch (err) {
    console.error('[tmdb/search]', err);
    return sendJson(res, 502, { error: err.message || 'TMDB 搜索失败' });
  }
}
