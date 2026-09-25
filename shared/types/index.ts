// 影视媒体类型
export type MediaType = '电影' | '剧集' | '综艺' | '纪录片' | '动画';

// 观看状态
export type WatchStatus = '在看' | '已看完' | '想看';

// 综艺分段：期号与分段名分开存，期号是数据而不是从自由文本里猜出来的约定。
// 例：{ period: '第 3 期', label: '加更上' }、{ period: '先导片', label: '上' }、{ period: '', label: '花絮' }
export interface ProgressSegment {
  /** 所属期号/分组名，如「第 3 期」「先导片」；无法归期时为空字符串 */
  period: string;
  /** 组内分段名，如「上」「中」「下」「加更上」 */
  label: string;
}

// 剧集进度
// - 剧集/常规影视：episode + totalEpisodes
// - 综艺：segments[]，label 非空视为已看
export interface Progress {
  episode: number;          // 当前看到第几集（综艺时为已看分段数量）
  totalEpisodes: number;    // 总集数（综艺时为分段总数）
  segments?: ProgressSegment[];
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

/** 截图后影片选择器使用的轻量数据，海报为可跨 Electron 窗口显示的数据 URL。 */
export interface ScreenshotMoviePickerItem {
  id: string;
  title: string;
  titleOriginal?: string;
  mediaType: MediaType;
  releaseDate: string;
  createdAt?: string;
  posterDataUrl?: string;
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
}

// 统计概览
export interface StatsOverview {
  totalMovies: number;
  totalHours: number;
  /** 平均个人评分：无任何评分时返回 null，UI 显示为「—」而非「0/10」。 */
  avgPersonalRating: number | null;
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

// 截图信息
export interface ScreenshotInfo {
  filename: string;
  /** 创建时间，用于跨设备保持照片墙顺序。 */
  createdAt?: string;
  /** 截图时间戳元数据（用户手动填写） */
  episode?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

// TMDB 搜索结果（由自建代理服务器返回的标准化结构）
export interface TmdbSearchResult {
  id: number;
  mediaType: '电影' | '剧集';
  title: string;
  titleOriginal: string;
  releaseDate: string;
  overview: string;
  rating: number;
  posterPath: string | null;
}

// TMDB 详情（标准化后可映射到 MovieMetadata）
export interface TmdbDetails {
  id: number;
  mediaType: '电影' | '剧集';
  title: string;
  titleOriginal: string;
  director: string;
  cast: string[];
  releaseDate: string;
  country: string;
  genre: string[];
  runtime: number;
  synopsis: string;
  rating: number;
  totalEpisodes: number | null;
  posterPath: string | null;
}

// 代理服务返回的海报数据 URL（由主进程下载后生成）
export interface TmdbPosterResult {
  dataUrl: string | null;
}

// 月度总结
export interface MonthSummary {
  year: number;
  month: number;
  totalMovies: number;
  totalHours: number;
  /** 该月平均个人评分：无评分时为 null。 */
  avgRating: number | null;
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

// IPC 通道名称。
// 业务数据（影视/日记/追剧/想看/统计）不走 IPC：云端是唯一权威数据源，渲染进程直接经
// src/lib/cloudApi.ts 访问。此块由 vite 构建插件同步生成到 electron/preload/main.cjs。
export const IPC_CHANNELS = {
  // TMDB 代理（经自建服务器）
  TMDB_SEARCH: 'tmdb:search',
  TMDB_GET_DETAILS: 'tmdb:getDetails',
  TMDB_GET_POSTER: 'tmdb:getPoster',

  // 应用更新
  UPDATE_GET_STATE: 'update:getState',
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',

} as const;
