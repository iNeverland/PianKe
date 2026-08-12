import { cloudApi } from './cloudApi';
import { isCloudAuthenticated } from './pocketbase';

// 创建代理，惰性访问 window.electronAPI。登录后业务数据由 PocketBase 接管；
// 窗口、截图裁剪、TMDB 与更新仍使用 Electron 的安全 IPC 通道。
const api = new Proxy({} as typeof window.electronAPI, {
  get(_target, prop: string) {
    if (prop === 'then' || prop === 'toJSON') return undefined;
    if (isCloudAuthenticated() && (prop === 'library' || prop === 'movie' || prop === 'diary' || prop === 'watchRecord' || prop === 'watchlist' || prop === 'stats')) {
      return cloudApi[prop];
    }
    const ea = window.electronAPI as unknown as Record<string, unknown> | undefined;
    if (!ea) return undefined;
    return ea[prop];
  },
});

export default api;
