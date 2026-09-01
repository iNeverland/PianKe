import type { Platform, ThemeMode } from './types';

/**
 * Electron 实现：所有能力直接转发到 preload 暴露的 window.electronAPI。
 *
 * 该实现仅在检测到 window.electronAPI 存在时才被选用（见 index.ts），因此这里
 * 可以安全地直接访问 window.electronAPI 而无需可选链。
 */
export const electronPlatform: Platform = {
  name: 'electron',
  // 使用 getter 延迟求值，避免模块加载时（早于 preload 注入）访问 window.electronAPI。
  get platform() {
    return window.electronAPI.platform;
  },

  setTheme: (mode: ThemeMode) => window.electronAPI.setTheme(mode),

  window: {
    minimize: () => window.electronAPI.window.minimize(),
    maximize: () => window.electronAPI.window.maximize(),
    close: () => window.electronAPI.window.close(),
    isMaximized: () => window.electronAPI.window.isMaximized(),
    onMaximizeChange: (callback) => window.electronAPI.window.onMaximizeChange(callback),
  },

  updater: {
    getState: () => window.electronAPI.updater.getState(),
    check: (source) => window.electronAPI.updater.check(source),
    download: () => window.electronAPI.updater.download(),
    onStateChange: (callback) => window.electronAPI.updater.onStateChange(callback),
  },

  tmdb: {
    search: (query) => window.electronAPI.tmdb.search(query),
    getDetails: (mediaType, id) => window.electronAPI.tmdb.getDetails(mediaType, id),
    getPoster: (posterPath) => window.electronAPI.tmdb.getPoster(posterPath),
  },

  onScreenshotTrigger: (callback) => window.electronAPI.onScreenshotTrigger(callback),
  registerShortcut: (accelerator) => window.electronAPI.registerShortcut(accelerator),
  unregisterShortcut: () => window.electronAPI.unregisterShortcut(),
  showScreenToast: (message, duration) => window.electronAPI.showScreenToast(message, duration),
  getDesktopSources: () => window.electronAPI.getDesktopSources(),
  getPrimaryScreenSnapshot: () => window.electronAPI.getPrimaryScreenSnapshot(),
  startCrop: (movieId, fullScreenDataUrl, movies) =>
    window.electronAPI.startCrop(movieId, fullScreenDataUrl, movies),
  onScreenshotCropped: (callback) => window.electronAPI.onScreenshotCropped(callback),
};
