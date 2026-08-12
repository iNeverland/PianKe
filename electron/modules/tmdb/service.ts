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

export async function getTmdbDetails(mediaType: '电影' | '剧集', id: number): Promise<TmdbDetails> {
  const tmdbType = mediaType === '剧集' ? 'tv' : 'movie';
  const body = await requestProxy<{ result?: TmdbDetails }>(`/api/details/${tmdbType}/${id}`);
  if (!body.result) {
    throw new AppError(ErrorCode.TMDB_SERVER_ERROR, 'TMDB 代理服务器未返回影视详情');
  }
  return body.result;
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
