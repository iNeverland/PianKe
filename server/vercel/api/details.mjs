import { normalizeDetails, requireAuthorized, sendJson, tmdbFetch } from '../lib/tmdb.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: '仅支持 GET 请求' });
  if (!requireAuthorized(req, res)) return;
  const mediaType = typeof req.query.mediaType === 'string' ? req.query.mediaType : '';
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!['movie', 'tv'].includes(mediaType) || !/^\d+$/.test(id)) {
    return sendJson(res, 400, { error: '影视参数无效' });
  }

  try {
    const data = await tmdbFetch(`/${mediaType}/${id}`, { append_to_response: 'credits' });
    return sendJson(res, 200, { result: normalizeDetails(data, mediaType) }, 'public, s-maxage=86400, stale-while-revalidate=604800');
  } catch (err) {
    console.error('[tmdb/details]', err);
    return sendJson(res, 502, { error: err.message || 'TMDB 详情获取失败' });
  }
}
