import type {
  MovieSummary, MovieMetadata, DiaryEntry, WatchRecord,
  StatsOverview, StatsDashboard, StatsByType, StatsByYear, StatsByGenre,
  StatsByRating, StatsByCountry, StatsMonthlyTrend, MonthSummary,
  DiaryTimelineMonth, DiaryCalendarEntry, ScreenshotInfo, ScreenshotMoviePickerItem,
  AppUpdateState, UpdateCheckSource, TmdbSearchResult, TmdbDetails, TmdbPosterResult,
} from '@shared/types/index';

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
  onScreenshotSaved: (callback: (screenshots: ScreenshotInfo[]) => void) => () => void;
  onScreenshotCropped: (callback: (movieId: string, dataUrl: string) => void) => () => void;
  library: {
    getSummary: () => Promise<MovieSummary[]>;
    getRecentWatches: (days?: number) => Promise<MovieSummary[]>;
  };
  movie: {
    list: (filters?: Record<string, unknown>) => Promise<MovieSummary[]>;
    getById: (id: string) => Promise<MovieMetadata>;
    create: (data: Record<string, unknown>, posterFilePath?: string) => Promise<MovieMetadata>;
    update: (id: string, data: Record<string, unknown>, posterFilePath?: string) => Promise<MovieMetadata>;
    delete: (id: string) => Promise<void>;
    search: (query: string, filters?: { year?: string; minRating?: number; maxRating?: number }) => Promise<MovieSummary[]>;
    updateProgress: (id: string, episode: number) => Promise<MovieMetadata>;
    addTag: (id: string, tag: string) => Promise<MovieMetadata>;
    removeTag: (id: string, tag: string) => Promise<MovieMetadata>;
    getAllTags: () => Promise<string[]>;
    getPosterUrl: (id: string, thumb?: boolean) => Promise<string | null>;
    exportExcel: () => Promise<{ filePath: string; movieCount: number; diaryCount: number; watchRecordCount: number } | null>;
    listScreenshots: (id: string) => Promise<ScreenshotInfo[]>;
    addScreenshot: (id: string, base64Data: string, ext: string) => Promise<ScreenshotInfo[]>;
    deleteScreenshot: (id: string, filename: string) => Promise<ScreenshotInfo[]>;
    getScreenshot: (id: string, filename: string) => Promise<string | null>;
    getScreenshotThumbnail: (id: string, filename: string) => Promise<string | null>;
    updateScreenshotInfo: (id: string, filename: string, info: { episode?: number; hours?: number; minutes?: number; seconds?: number }) => Promise<ScreenshotInfo[]>;
  };
  tmdb: {
    search: (query: string) => Promise<TmdbSearchResult[]>;
    getDetails: (mediaType: '电影' | '剧集', id: number) => Promise<TmdbDetails>;
    getPoster: (posterPath: string) => Promise<TmdbPosterResult>;
  };
  diary: {
    getByMovie: (movieId: string) => Promise<DiaryEntry[]>;
    delete: (movieId: string, entryId: string) => Promise<void>;
    getTimeline: () => Promise<DiaryTimelineMonth[]>;
  };
  watchRecord: {
    getByMovie: (movieId: string) => Promise<WatchRecord[]>;
    add: (movieId: string, data: Record<string, unknown>) => Promise<WatchRecord>;
    update: (movieId: string, entryId: string, data: Record<string, unknown>) => Promise<WatchRecord>;
    delete: (movieId: string, entryId: string) => Promise<void>;
  };
  watchlist: {
    list: () => Promise<MovieSummary[]>;
    markAsWatched: (movieId: string, entryData: Record<string, unknown>) => Promise<void>;
    markAsWatching: (movieId: string) => Promise<void>;
  };
  stats: {
    dashboard: () => Promise<StatsDashboard>;
    overview: () => Promise<StatsOverview>;
    byMediaType: () => Promise<StatsByType[]>;
    byYear: () => Promise<StatsByYear[]>;
    byGenre: () => Promise<StatsByGenre[]>;
    byRating: () => Promise<StatsByRating[]>;
    byCountry: () => Promise<StatsByCountry[]>;
    diaryRatingDist: () => Promise<{ stars: number; label: string; count: number }[]>;
    monthlyTrend: () => Promise<StatsMonthlyTrend[]>;
    monthSummary: (year: number, month: number) => Promise<MonthSummary>;
    diaryCalendar: (days: number) => Promise<DiaryCalendarEntry[]>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
