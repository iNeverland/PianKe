import type { Platform, ThemeMode } from './types';

/**
 * Capacitor / Android（及纯 Web 兜底）实现。
 *
 * 第一阶段仅搭建基础框架：桌面专属能力（窗口控制、截图、自动更新、TMDB 主进程
 * 代理）在 Android 上暂以占位实现返回，保证 UI 可编译、可启动、不崩溃。后续阶段
 * 再逐项替换为 Capacitor 真实实现（相机/文件系统/更新渠道等）。
 *
 * 注意：占位实现中的未使用参数以 `_` 前缀命名，满足 tsconfig 的 noUnusedParameters。
 */

const DISABLED_UPDATE_STATE = {
  status: 'disabled' as const,
  currentVersion: __APP_VERSION__,
};

export const capacitorPlatform: Platform = {
  name: 'capacitor',
  platform: 'android',

  // Android 无原生窗口主题，深浅色完全由 CSS 变量（data-theme）驱动，这里无需操作。
  setTheme: async (_mode: ThemeMode) => {},

  window: {
    minimize: async () => {},
    maximize: async () => {},
    close: async () => {},
    isMaximized: async () => false,
    onMaximizeChange: () => {},
  },

  updater: {
    getState: async () => ({ ...DISABLED_UPDATE_STATE }),
    check: async () => ({ ...DISABLED_UPDATE_STATE }),
    download: async () => false,
    onStateChange: () => () => {},
  },

  tmdb: {
    // 桌面端由主进程转发自建 TMDB 代理；移动端可直接 fetch，第二阶段再接入配置。
    search: async (_query: string) => {
      throw new Error('TMDB 搜索暂未在移动端提供');
    },
    getDetails: async (_mediaType: '电影' | '剧集', _id: number) => {
      throw new Error('TMDB 详情暂未在移动端提供');
    },
    getPoster: async (_posterPath: string) => {
      throw new Error('TMDB 海报暂未在移动端提供');
    },
  },

  onScreenshotTrigger: () => () => {},
  registerShortcut: async () => false,
  unregisterShortcut: async () => {},
  showScreenToast: async (_message: string, _duration?: number) => {},
  getDesktopSources: async () => [],
  getPrimaryScreenSnapshot: async () => null,
  startCrop: async () => {},
  onScreenshotCropped: () => () => {},
};
