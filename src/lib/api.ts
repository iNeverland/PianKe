import { cloudApi } from './cloudApi';
import { isCloudAuthenticated } from './pocketbase';
import { platform } from '@/platform';

// 登录后由 PocketBase 接管的业务分组。这些调用不经过 Electron IPC，天然跨平台。
const CLOUD_BUSINESS_PROPS = new Set(['library', 'movie', 'diary', 'watchRecord', 'watchlist', 'stats']);

// 创建代理：登录后业务数据由 PocketBase 接管；窗口、截图裁剪、TMDB 与更新等
// 原生能力统一走平台抽象层（Electron 实现 / Capacitor 占位）。
const api = new Proxy({} as typeof window.electronAPI, {
  get(_target, prop: string) {
    if (prop === 'then' || prop === 'toJSON') return undefined;
    if (isCloudAuthenticated() && CLOUD_BUSINESS_PROPS.has(prop)) {
      return cloudApi[prop as keyof typeof cloudApi];
    }
    return (platform as unknown as Record<string, unknown>)[prop];
  },
});

export default api;
