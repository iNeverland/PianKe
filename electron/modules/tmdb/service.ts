import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { AppError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';
import { authHeaders, ensureDeviceCredentials, forgetDeviceCredentials } from './credentials.js';
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

/** 元数据请求（搜索/详情）的超时：代理命中缓存时是毫秒级，15 秒足够。 */
const METADATA_TIMEOUT_MS = 15_000;

/**
 * 带鉴权的 fetch：优先用设备凭据，拿不到则回退到随包分发的共享口令。
 *
 * 收到 401 时说明设备凭据可能已被服务端吊销（或服务端刚关闭了共享口令的数据访问），
 * 因此清掉本地凭据重注册一次并只重试一次；仍失败就把原始响应交回调用方。
 * 超时按次传入：元数据用 METADATA_TIMEOUT_MS，海报按单个规格计时（见 getTmdbPoster）。
 */
async function authedFetch(
  url: URL,
  config: Required<Pick<TmdbProxyConfig, 'url'>> & TmdbProxyConfig,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
  timeoutMs = METADATA_TIMEOUT_MS,
): Promise<Response> {
  const ensure = (force = false) => {
    // 换过代理地址的旧凭据会被服务端判为无效，此时强制重注册一次；
    // 否则磁盘里的旧凭据会让这个请求一直 401。
    if (force) forgetDeviceCredentials();
    return ensureDeviceCredentials({ url: config.url, appToken: config.appToken });
  };

  // 超时按**每次尝试**分别计时：AbortSignal 一旦触发就永久失效，
  // 复用同一个 signal 会让重试在起步瞬间就失败。
  const send = (headers: Record<string, string>) => fetch(url, {
    method: init.method,
    body: init.body,
    headers: { ...(init.headers || {}), ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });

  let credentials = await ensure();
  // 注册接口不可用（离线或处于冷却期）时只能退回共享口令；
  // 这种情况下没有可失效的凭据，再重试一次也只是白等一个超时周期。
  if (!credentials) return send(authHeaders(config, null));

  const response = await send(authHeaders(config, credentials));
  if (response.status !== 401) return response;

  // 401：凭据可能已被吊销，换一对新凭据重试一次
  credentials = await ensure(true);
  return send(authHeaders(config, credentials));
}

async function requestProxy<T>(pathname: string, search?: Record<string, string>): Promise<T> {
  const config = getProxyConfig();
  const url = new URL(pathname, config.url.endsWith('/') ? config.url : `${config.url}/`);
  for (const [key, value] of Object.entries(search || {})) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await authedFetch(url, config, { headers: { accept: 'application/json' } });
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

/**
 * 海报规格的降级链：先按 w500 取，超时或失败就退到更小的图。
 *
 * 为什么要降级：客户端与代理之间可能要经过本机的代理软件隧道（例如 Clash 的 fake-ip
 * 模式），几百 KB 的海报在这种链路上很容易走满十几秒。海报只是详情页/卡片上的展示图，
 * 拿不到 w500 时宁可要一张小图，也好过整张海报缺失——保存时上传给云端的就是这一张。
 * 每个规格在服务端各自独立缓存，所以降级链不会互相污染缓存。
 */
const POSTER_WIDTHS = ['w500', 'w342', 'w154'] as const;
const POSTER_ATTEMPT_TIMEOUT_MS = 20_000;
/** 海报体积上限，与服务端的 MAX_IMAGE_BYTES 呼应。 */
const MAX_POSTER_BYTES = 10 * 1024 * 1024;

/** AbortSignal.timeout() 触发的错误：名称是 TimeoutError（部分运行时是 AbortError）。 */
function isTimeoutError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/** 取单个规格的海报；null 表示这个规格没取到（调用方继续降级）。 */
async function fetchPosterAtWidth(
  config: Required<Pick<TmdbProxyConfig, 'url'>> & TmdbProxyConfig,
  posterPath: string,
  width: string,
): Promise<{ dataUrl: string; bytes: number } | null> {
  const url = new URL('/api/poster', config.url.endsWith('/') ? config.url : `${config.url}/`);
  url.searchParams.set('path', posterPath);
  url.searchParams.set('width', width);

  const response = await authedFetch(url, config, {}, POSTER_ATTEMPT_TIMEOUT_MS);
  if (!response.ok) return null;

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) return null;
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_POSTER_BYTES) return null;
  // arrayBuffer() 在慢速传输下也会一直等，因此每次尝试都必须带自己的超时。
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length === 0 || data.length > MAX_POSTER_BYTES) return null;
  return { dataUrl: `data:${contentType};base64,${data.toString('base64')}`, bytes: data.length };
}

/** 从自建服务器下载海报并转为本地保存流程可直接使用的 data URL。 */
export async function getTmdbPoster(posterPath: string): Promise<TmdbPosterResult> {
  const config = getProxyConfig();

  let lastError: unknown = null;
  for (const width of POSTER_WIDTHS) {
    try {
      const poster = await fetchPosterAtWidth(config, posterPath, width);
      if (poster) {
        if (width !== POSTER_WIDTHS[0]) {
          console.warn(`[tmdb] 海报 ${width} 下载成功（降到较小规格），${poster.bytes} 字节`);
        }
        return { dataUrl: poster.dataUrl, width, bytes: poster.bytes };
      }
      console.warn(`[tmdb] 海报 ${width} 未取到，尝试下一个规格`);
    } catch (err) {
      lastError = err;
      console.warn(`[tmdb] 海报 ${width} 下载失败，尝试下一个规格:`, (err as Error)?.message);
    }
  }

  // 所有规格都没成功：把底层原因（超时/连接失败）说清楚，用户才知道该重试还是查网络。
  if (lastError) {
    throw new AppError(
      ErrorCode.TMDB_UNREACHABLE,
      isTimeoutError(lastError)
        ? '海报下载超时，请重试或手动上传海报'
        : '无法下载 TMDB 海报，请重试或手动上传海报',
      lastError,
    );
  }
  return { dataUrl: null };
}
