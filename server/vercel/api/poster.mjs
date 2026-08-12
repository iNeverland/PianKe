import { fetchPoster, requireAuthorized, sendJson } from '../lib/tmdb.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: '仅支持 GET 请求' });
  if (!requireAuthorized(req, res)) return;
  const posterPath = typeof req.query.path === 'string' ? req.query.path : '';
  const width = typeof req.query.width === 'string' ? req.query.width : 'w500';

  try {
    const { buffer, contentType } = await fetchPoster(posterPath, width);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=2592000');
    return res.status(200).end(buffer);
  } catch (err) {
    console.error('[tmdb/poster]', err);
    return sendJson(res, 400, { error: err.message || '海报获取失败' });
  }
}
