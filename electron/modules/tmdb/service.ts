import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { AppError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';
import type { TmdbDetails, TmdbPosterResult, TmdbSearchResult } from '../../../shared/types/index.js';

interface TmdbProxyConfig {
  url?: string;
  appToken?: string;
}

function readProxyConfig(): TmdbProxyConfig {
  // 环境变量便于开发与部署平台注入；打包应用可在构建前写入 resources/tmdb-proxy.json。
  const envUrl = process.env.PIANKE_TMDB_PROXY_URL;
  const envToken = process.env.PIANKE_TMDB_PROXY_TOKEN;
  if (envUrl) return { url: envUrl, appToken: envToken };

  const configPaths = [
    process.resourcesPath && path.join(process.resourcesPath, 'tmdb-proxy.json'),
    path.join(app.getAppPath(), 'resources', 'tmdb-proxy.json'),
  ].filter(Boolean) as string[];
  for (const configPath of configPaths) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as TmdbProxyConfig;
    } catch {
      // 继续尝试下一个位置：开发环境没有 process.resourcesPath 中的配置。
    }
  }
  return {};
}

function getProxyConfig(): Required<Pick<TmdbProxyConfig, 'url'>> & TmdbProxyConfig {
  const config = readProxyConfig();
  if (!config.url) {
    throw new AppError(ErrorCode.TMDB_UNREACHABLE, '尚未配置 TMDB 代理服务器地址');
  }
  try {
    const parsed = new URL(config.url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('invalid protocol');
  } catch {
    throw new AppError(ErrorCode.TMDB_UNREACHABLE, 'TMDB 代理服务器地址无效');
  }
  return config as Required<Pick<TmdbProxyConfig, 'url'>> & TmdbProxyConfig;
}

async function requestProxy<T>(pathname: string, search?: Record<string, string>): Promise<T> {
  const config = getProxyConfig();
  const url = new URL(pathname, config.url.endsWith('/') ? config.url : `${config.url}/`);
  for (const [key, value] of Object.entries(search || {})) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: config.appToken ? { 'x-app-token': config.appToken } : {},
    });
  } catch (err) {
    throw new AppError(ErrorCode.TMDB_UNREACHABLE, '无法连接 TMDB 代理服务器', err);
  }

  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) {
    throw new AppError(ErrorCode.TMDB_SERVER_ERROR, body.error || 'TMDB 代理服务器请求失败');
  }
  return body;
}

export async function searchTmdb(query: string): Promise<TmdbSearchResult[]> {
  const body = await requestProxy<{ results?: TmdbSearchResult[] }>('/api/search', { q: query.trim() });
  return Array.isArray(body.results) ? body.results : [];
}

/**
 * TMDB 类型名 → 本应用类型词表的归一化表。需要它的两个原因：
 *
 * 1) TMDB 的 zh-CN 类型库对个别剧集类型没有中文翻译（例如 10765 Sci-Fi & Fantasy），
 *    接口会原样返回英文名，界面上就会出现中英混排；
 * 2) TMDB 剧集类型库把「Action & Adventure」「Sci-Fi & Fantasy」「War & Politics」
 *    当作**单个**类型（电影类型库才是 Action / Adventure 分开的），
 *    直接写入 genre 就会出现"动作冒险"这种没有分隔符的一项。
 *
 * 因此这里把复合类型拆成多条，并为英文名补上兜底映射（zh-CN 有翻译时不会走到兜底）。
 */
const GENRE_ALIASES: Record<string, readonly string[]> = {
  // 剧集复合类型（英文与 TMDB 的中文写法都兼容）
  'Action & Adventure': ['动作', '冒险'],
  'Sci-Fi & Fantasy': ['科幻', '奇幻'],
  'War & Politics': ['战争', '政治'],
  动作冒险: ['动作', '冒险'],
  科幻与奇幻: ['科幻', '奇幻'],
  科幻奇幻: ['科幻', '奇幻'],
  // 其余 TMDB 英文类型名兜底
  Action: ['动作'],
  Adventure: ['冒险'],
  Animation: ['动画'],
  Comedy: ['喜剧'],
  Crime: ['犯罪'],
  Documentary: ['纪录片'],
  Drama: ['剧情'],
  Family: ['家庭'],
  Fantasy: ['奇幻'],
  History: ['历史'],
  Horror: ['恐怖'],
  Music: ['音乐'],
  Mystery: ['悬疑'],
  Romance: ['爱情'],
  'Science Fiction': ['科幻'],
  'TV Movie': ['电视电影'],
  Thriller: ['惊悚'],
  War: ['战争'],
  Western: ['西部'],
  Kids: ['儿童'],
  News: ['新闻'],
  Reality: ['真人秀'],
  Soap: ['肥皂剧'],
  Talk: ['脱口秀'],
};

/** 归一化 TMDB 类型数组：拆分复合类型 → 英文兜底翻译 → 去重并保持原顺序。 */
export function normalizeGenres(genres: string[] | undefined): string[] {
  const result: string[] = [];
  for (const raw of genres ?? []) {
    const name = (raw || '').trim();
    if (!name) continue;
    for (const mapped of GENRE_ALIASES[name] ?? [name]) {
      if (!result.includes(mapped)) result.push(mapped);
    }
  }
  return result;
}

export async function getTmdbDetails(mediaType: '电影' | '剧集', id: number): Promise<TmdbDetails> {
  const tmdbType = mediaType === '剧集' ? 'tv' : 'movie';
  const body = await requestProxy<{ result?: TmdbDetails }>(`/api/details/${tmdbType}/${id}`);
  if (!body.result) {
    throw new AppError(ErrorCode.TMDB_SERVER_ERROR, 'TMDB 代理服务器未返回影视详情');
  }
  // 归一化类型：代理的 zh-CN 请求对个别类型无中文翻译，且复合类型需要拆分
  return { ...body.result, genre: normalizeGenres(body.result.genre) };
}

/** 从自建服务器下载海报并转为本地保存流程可直接使用的 data URL。 */
export async function getTmdbPoster(posterPath: string): Promise<TmdbPosterResult> {
  const config = getProxyConfig();
  const url = new URL('/api/poster', config.url.endsWith('/') ? config.url : `${config.url}/`);
  url.searchParams.set('path', posterPath);
  url.searchParams.set('width', 'w500');

  let response: Response;
  try {
    response = await fetch(url, {
      headers: config.appToken ? { 'x-app-token': config.appToken } : {},
    });
  } catch (err) {
    throw new AppError(ErrorCode.TMDB_UNREACHABLE, '无法下载 TMDB 海报', err);
  }
  if (!response.ok) return { dataUrl: null };

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) return { dataUrl: null };
  const data = Buffer.from(await response.arrayBuffer());
  return { dataUrl: `data:${contentType};base64,${data.toString('base64')}` };
}
