import type {
  AppUpdateState,
  ScreenshotMoviePickerItem,
  TmdbDetails,
  TmdbPosterResult,
  TmdbSearchResult,
  UpdateCheckSource,
} from '@shared/types/index';

/**
 * 平台抽象层的统一接口。
 *
 * 只包含「原生系统能力」——窗口、主题、自动更新、截图、TMDB 代理。业务数据
 * （影视/日记/追剧/想看/统计）不在此列，它们由 src/lib/api.ts 的 Proxy 在登录后
 * 路由到 cloudApi（直连 PocketBase），天然跨平台。
 *
 * React UI 只依赖本接口，不直接依赖 window.electronAPI 或 Capacitor，从而让同一套
 * UI 跑在 Electron（桌面）与 Capacitor（Android）上。
 */

export type ThemeMode = 'dark' | 'light' | 'system';

export interface PlatformWindow {
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  /** 返回取消订阅函数；桌面端由主进程推送最大化状态变化。 */
  onMaximizeChange(callback: (isMaximized: boolean) => void): void;
}

export interface PlatformUpdater {
  getState(): Promise<AppUpdateState>;
  check(source?: UpdateCheckSource): Promise<AppUpdateState>;
  download(): Promise<boolean>;
  /** 返回取消订阅函数。 */
  onStateChange(callback: (state: AppUpdateState) => void): () => void;
}

export interface PlatformTmdb {
  search(query: string): Promise<TmdbSearchResult[]>;
  getDetails(mediaType: '电影' | '剧集', id: number): Promise<TmdbDetails>;
  getPoster(posterPath: string): Promise<TmdbPosterResult>;
}

export interface Platform {
  /** 实现标识，便于 UI 按平台做渐进适配（如隐藏标题栏）。 */
  readonly name: 'electron' | 'capacitor' | 'web';
  /** 底层平台标识：Electron 为 process.platform；Android 为 'android'。 */
  readonly platform: string;

  setTheme(mode: ThemeMode): Promise<void>;

  window: PlatformWindow;
  updater: PlatformUpdater;
  tmdb: PlatformTmdb;

  onScreenshotTrigger(callback: () => void): () => void;
  registerShortcut(accelerator: string): Promise<boolean>;
  unregisterShortcut(): Promise<void>;
  showScreenToast(message: string, duration?: number): Promise<void>;
  getDesktopSources(): Promise<{ id: string; name: string; thumb: string }[]>;
  getPrimaryScreenSnapshot(): Promise<string | null>;
  startCrop(
    movieId: string | null,
    fullScreenDataUrl: string,
    movies?: ScreenshotMoviePickerItem[]
  ): Promise<void>;
  onScreenshotCropped(callback: (movieId: string, dataUrl: string) => void): () => void;
}
