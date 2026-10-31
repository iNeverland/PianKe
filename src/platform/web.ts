import type { Platform, ThemeMode } from './types';

/**
 * 浏览器预览兜底实现（非 Electron 环境）。
 *
 * 桌面端正式运行在 Electron 中，实际使用的是 electronPlatform；这个实现只用于
 * `vite preview` 或浏览器直接打开构建产物时，保证页面可以渲染、不因缺少原生桥接崩溃。
 * 桌面专属能力（窗口、自动更新、截图、TMDB）在这里以占位实现返回。
 */
const DISABLED_UPDATE_STATE = {
  status: 'disabled' as const,
  currentVersion: __APP_VERSION__,
};

export const webPlatform: Platform = {
  name: 'web',
  platform: 'web',

  setTheme: async (_mode: ThemeMode) => {},

  window: {
    minimize: async () => {},
    maximize: async () => {},
    close: async () => {},
    isMaximized: async () => false,
    onMaximizeChange: () => () => {},
  },

  updater: {
    getState: async () => ({ ...DISABLED_UPDATE_STATE }),
    check: async () => ({ ...DISABLED_UPDATE_STATE }),
    download: async () => false,
    onStateChange: () => () => {},
  },

  tmdb: {
    search: async () => {
      throw new Error('TMDB 搜索仅在桌面端提供');
    },
    getDetails: async () => {
      throw new Error('TMDB 详情仅在桌面端提供');
    },
    getPoster: async () => {
      throw new Error('TMDB 海报仅在桌面端提供');
    },
  },

  onScreenshotTrigger: () => () => {},
  registerShortcut: async () => false,
  unregisterShortcut: async () => {},
  showScreenToast: async () => {},
  getPrimaryScreenSnapshot: async () => null,
  startCrop: async () => {},
  onScreenshotCropped: () => () => {},
};
