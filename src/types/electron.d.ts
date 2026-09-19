import type {
  ScreenshotInfo, ScreenshotMoviePickerItem,
  AppUpdateState, UpdateCheckSource, TmdbSearchResult, TmdbDetails, TmdbPosterResult,
} from '@shared/types/index';

/**
 * preload 通过 window.electronAPI 注入的能力声明。
 *
 * 只声明「原生能力」——业务数据（影视/日记/追剧/想看/统计）在渲染进程统一走
 * src/lib/cloudApi.ts（直连 PocketBase，云端为唯一权威数据源），本文件不再声明，
 * 以免出现渲染进程永远不会走到的本地回退分支。
 */
export interface ElectronAPI {
  platform: string;
  setTheme: (mode: 'dark' | 'light' | 'system') => Promise<void>;
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onMaximizeChange: (callback: (isMaximized: boolean) => void) => void;
  };
  updater: {
    getState: () => Promise<AppUpdateState>;
    check: (source?: UpdateCheckSource) => Promise<AppUpdateState>;
    download: () => Promise<boolean>;
    onStateChange: (callback: (state: AppUpdateState) => void) => () => void;
  };
  onScreenshotTrigger: (callback: () => void) => () => void;
  registerShortcut: (accelerator: string) => Promise<boolean>;
  unregisterShortcut: () => Promise<void>;
  showScreenToast: (message: string, duration?: number) => Promise<void>;
  getDesktopSources: () => Promise<{ id: string; name: string; thumb: string }[]>;
  getPrimaryScreenSnapshot: () => Promise<string | null>;
  startCrop: (movieId: string | null, fullScreenDataUrl: string, movies?: ScreenshotMoviePickerItem[]) => Promise<void>;
  onScreenshotCropped: (callback: (movieId: string, dataUrl: string) => void) => () => void;
  tmdb: {
    search: (query: string) => Promise<TmdbSearchResult[]>;
    getDetails: (mediaType: '电影' | '剧集', id: number) => Promise<TmdbDetails>;
    getPoster: (posterPath: string) => Promise<TmdbPosterResult>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
