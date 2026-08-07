// 影视媒体类型
export type MediaType = '电影' | '剧集' | '综艺' | '纪录片' | '动画';

// 观看状态
export type WatchStatus = '在看' | '已看完' | '想看';

// 剧集进度
// - 剧集/常规影视：episode + totalEpisodes
// - 综艺：segments[] 自由文本标签，非空项视为已看
export interface Progress {
  episode: number;          // 当前看到第几集（综艺时为已填 segment 数量）
  totalEpisodes: number;    // 总集数（综艺时为 segment 总数）
  segments?: string[];      // 综艺专用：自定义进度标签，如「先导片」「第1期」「番外篇」
}

// 影视元数据
export interface MovieMetadata {
  id: string;
  title: string;
  titleOriginal?: string;
  mediaType: MediaType;
  director: string;
  cast: string[];
  releaseDate: string;
  country: string;
  genre: string[];
  tags: string[];
  runtime: number;
  synopsis?: string;
  rating: number;
  posterPath?: string;
  posterThumbPath?: string;
  status: WatchStatus;
  progress: Progress | null;
  createdAt: string;
  rewatchCount?: number;
}

// 影视列表摘要项（轻量，用于列表页）
export interface MovieSummary {
  id: string;
  title: string;
  titleOriginal?: string;
  mediaType: MediaType;
  rating: number;
  personalRating?: number | null;
  posterThumbPath?: string;
  releaseDate: string;
  genre: string[];
  tags: string[];
  status: WatchStatus;
  progress?: Progress | null;
  latestWatchDate?: string;
  createdAt?: string;
  rewatchCount?: number;
}

// 观影日记条目：仅记录系统自动写入的进度与状态变更
export interface DiaryEntry {
  id: string;
  watchDate: string;
  watchTime?: string;  // HH:mm 或 HH:mm:ss 24小时制，记录添加时间
  rating: number;
  review?: string;
  images: string[];
  kind: 'progress' | 'status';
}

// 追剧记录：仅由用户手动写下的感受与想法
export interface WatchRecord {
  id: string;
  watchDate: string;
  watchTime?: string;
  rating: number;
  review?: string;
  images: string[];
}

// 库信息
export interface LibraryInfo {
  name: string;
  version: number;
  createdAt: string;
  movieCount: number;
}

// 统计概览
export interface StatsOverview {
  totalMovies: number;
  totalHours: number;
  avgPersonalRating: number;
  mostWatchedGenre: string[];
}

// 按类型统计
export interface StatsByType {
  type: string;
  count: number;
}

// 按年份统计
export interface StatsByYear {
  year: string;
  count: number;
  avgRating: number;
}

// 按国家统计
export interface StatsByCountry {
  country: string;
  count: number;
}

// 按类型统计
export interface StatsByGenre {
  genre: string;
  count: number;
}

// 按评分统计
export interface StatsByRating {
  rating: number;
  count: number;
}

// 月度趋势
export interface StatsMonthlyTrend {
  month: string;
  count: number;
}

export interface StatsDashboard {
  overview: StatsOverview;
  byType: StatsByType[];
  byGenre: StatsByGenre[];
  byCountry: StatsByCountry[];
  diaryRatingDist: { stars: number; label: string; count: number }[];
  monthlyTrend: StatsMonthlyTrend[];
}

// 日记日历热力图数据
export interface DiaryCalendarEntry {
  date: string;   // YYYY-MM-DD
  count: number;
}

// 搜索过滤条件
export interface SearchFilters {
  year?: string;      // releaseDate 以此年份开头
  minRating?: number; // 个人评分 >= 此值
  maxRating?: number; // 个人评分 <= 此值
}

// 截图信息
export interface ScreenshotInfo {
  filename: string;
  thumbBase64: string;
  /** 截图时间戳元数据（用户手动填写） */
  episode?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

// 月度总结
export interface MonthSummary {
  year: number;
  month: number;
  totalMovies: number;
  totalHours: number;
  avgRating: number;
  topGenres: string[];
  movies: MovieSummary[];
  diaryEntries: DiaryEntry[];
}

// 日记时间线条目
export interface DiaryTimelineDay {
  date: string;
  weekday: string;
  items: (DiaryEntry & { movieId: string; movieTitle: string; movieThumbPath?: string })[];
}

export interface DiaryTimelineMonth {
  month: string;
  days: DiaryTimelineDay[];
}

// 应用自动更新状态（主进程通过 IPC 推送给渲染进程）
export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'
  | 'disabled';

export type UpdateCheckSource = 'automatic' | 'manual';

export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  version?: string;
  percent?: number;
  releaseDate?: string;
  releaseNotes?: string;
  message?: string;
  checkSource?: UpdateCheckSource;
}

// IPC 通道名称
export const IPC_CHANNELS = {
  // 库管理
  LIBRARY_OPEN: 'library:open',
  LIBRARY_CREATE: 'library:create',
  LIBRARY_REOPEN: 'library:reopen',
  LIBRARY_GET_PATH: 'library:getPath',
  LIBRARY_GET_INFO: 'library:getInfo',
  LIBRARY_GET_RECENT_PATH: 'library:getRecentPath',
  LIBRARY_GET_SUMMARY: 'library:getSummary',
  LIBRARY_GET_RECENT_WATCHES: 'library:getRecentWatches',
  LIBRARY_CREATE_BACKUP: 'library:createBackup',
  LIBRARY_IS_LOADED: 'library:isLoaded',

  // 影视管理
  MOVIE_LIST: 'movie:list',
  MOVIE_GET_BY_ID: 'movie:getById',
  MOVIE_CREATE: 'movie:create',
  MOVIE_UPDATE: 'movie:update',
  MOVIE_DELETE: 'movie:delete',
  MOVIE_SEARCH: 'movie:search',
  MOVIE_UPDATE_PROGRESS: 'movie:updateProgress',
  MOVIE_ADD_TAG: 'movie:addTag',
  MOVIE_REMOVE_TAG: 'movie:removeTag',
  MOVIE_GET_ALL_TAGS: 'movie:getAllTags',
  MOVIE_GET_POSTER_URL: 'movie:getPosterUrl',
  MOVIE_EXPORT_EXCEL: 'movie:exportExcel',
  MOVIE_LIST_SCREENSHOTS: 'movie:listScreenshots',
  MOVIE_ADD_SCREENSHOT: 'movie:addScreenshot',
  MOVIE_DELETE_SCREENSHOT: 'movie:deleteScreenshot',
  MOVIE_GET_SCREENSHOT: 'movie:getScreenshot',
  MOVIE_UPDATE_SCREENSHOT_INFO: 'movie:updateScreenshotInfo',

  // 自动观影日记
  DIARY_GET_BY_MOVIE: 'diary:getByMovie',
  DIARY_DELETE: 'diary:delete',
  DIARY_GET_TIMELINE: 'diary:getTimeline',

  // 手动追剧记录
  WATCH_RECORD_GET_BY_MOVIE: 'watchRecord:getByMovie',
  WATCH_RECORD_ADD: 'watchRecord:add',
  WATCH_RECORD_UPDATE: 'watchRecord:update',
  WATCH_RECORD_DELETE: 'watchRecord:delete',

  // 想看清单
  WATCHLIST_LIST: 'watchlist:list',
  WATCHLIST_MARK_AS_WATCHED: 'watchlist:markAsWatched',
  WATCHLIST_MARK_AS_WATCHING: 'watchlist:markAsWatching',

  // 统计
  STATS_DASHBOARD: 'stats:dashboard',
  STATS_OVERVIEW: 'stats:overview',
  STATS_BY_MEDIA_TYPE: 'stats:byMediaType',
  STATS_BY_YEAR: 'stats:byYear',
  STATS_BY_GENRE: 'stats:byGenre',
  STATS_BY_RATING: 'stats:byRating',
  STATS_BY_COUNTRY: 'stats:byCountry',
  STATS_DIARY_RATING_DIST: 'stats:diaryRatingDist',
  STATS_MONTHLY_TREND: 'stats:monthlyTrend',
  STATS_MONTH_SUMMARY: 'stats:monthSummary',
  STATS_DIARY_CALENDAR: 'stats:diaryCalendar',

  // 应用更新
  UPDATE_GET_STATE: 'update:getState',
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',

} as const;
