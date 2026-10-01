import type { RecordModel } from 'pocketbase';
import type {
  DiaryCalendarEntry, DiaryEntry, DiaryTimelineMonth, MonthSummary,
  MovieMetadata, MovieSummary, Progress, ProgressSegment, ScreenshotInfo, StatsByCountry, StatsByGenre,
  StatsByRating, StatsByType, StatsByYear, StatsDashboard, StatsMonthlyTrend,
  StatsOverview, WatchRecord, WatchStatus,
} from '@shared/types/index';
import { getLocalDateStr, getLocalTimeStr, parseLocalDate } from '@shared/utils/date';
import { getCloudUser, isInvalidCloudSessionAfterWriteFailure, pocketbase } from './pocketbase';
import { normalizeStoredSegments, qualifyVarietySegments, segmentText } from './segmentGroups';
import { getOfflineMedia, getOfflineSnapshot, requestPersistentOfflineStorage, saveOfflineMedia, saveOfflineSnapshot } from './offlineCache';

type CloudMovieRecord = RecordModel & Record<string, unknown>;
type CloudDiaryRecord = RecordModel & Record<string, unknown>;
type CloudRecord = RecordModel & Record<string, unknown>;

interface Snapshot {
  movies: CloudMovieRecord[];
  diaries: CloudDiaryRecord[];
  watchRecords: CloudRecord[];
  screenshots: CloudRecord[];
}

const SNAPSHOT_TTL_MS = 60_000;
const FILE_TOKEN_TTL_MS = 4 * 60_000;
const SCREENSHOT_CACHE_TTL_MS = 60_000;
// 云端缩略图尺寸：照片墙/卡片在 HiDPI 屏上放大查看时仍需足够清晰。
export const POSTER_THUMB_SIZE = '600x900';
export const SCREENSHOT_THUMB_SIZE = '960x540';
const MEDIA_WARM_CONCURRENCY = 3;

// 首页、统计与日记会在同一时间读取相同的基础数据。缓存「进行中的请求」可以
// 避免它们在缓存尚未写入时重复下载整套数据。
let snapshotCache: { value: Snapshot; expiresAt: number } | null = null;
let snapshotRequest: Promise<Snapshot> | null = null;
let snapshotGeneration = 0;
let offlineSnapshot: Snapshot | null = null;
let offlineSnapshotOwnerId: string | null = null;
let offlineSnapshotRequest: Promise<Snapshot | null> | null = null;
let offlineSnapshotRequestOwnerId: string | null = null;
let cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;
let cloudSyncFirstQueuedAt = 0;
let fileToken: { value: string; expiresAt: number } | null = null;
let fileTokenRequest: Promise<string> | null = null;
let cacheOwnerId: string | null = getCloudUser()?.id || null;
let movieListCache: { value: CloudMovieRecord[]; expiresAt: number } | null = null;
let movieListRequest: Promise<CloudMovieRecord[]> | null = null;

// 列表记录本身已包含生成文件 URL 所需的 id、collectionName 与文件名。建立索引后，
// 首屏的每张海报都无需再发一次 getOne 请求。
const movieRecordCache = new Map<string, CloudMovieRecord>();
const movieRecordRequests = new Map<string, Promise<CloudMovieRecord>>();
const movieDetailCache = new Map<string, CloudMovieRecord>();
const movieDetailRequests = new Map<string, Promise<CloudMovieRecord>>();
const screenshotRecordCache = new Map<string, CloudRecord>();
const screenshotRecordRequests = new Map<string, Promise<CloudRecord>>();
const screenshotListCache = new Map<string, { value: CloudRecord[]; expiresAt: number }>();
const screenshotListRequests = new Map<string, Promise<CloudRecord[]>>();
const diaryEntriesRequests = new Map<string, Promise<CloudDiaryRecord[]>>();
const watchRecordRequests = new Map<string, Promise<CloudRecord[]>>();
let allScreenshotsRequest: Promise<Map<string, ScreenshotInfo[]>> | null = null;
let allScreenshotsCache: { value: Map<string, ScreenshotInfo[]>; expiresAt: number } | null = null;
let mediaWarmRequest: Promise<void> | null = null;
let mediaWarmOwnerId: string | null = null;
const mediaObjectUrls = new Map<string, string>();

/**
 * 展示用 Blob URL 的上限。
 *
 * blob: URL 会一直持有对应 Blob，不 revoke 就不会被 GC。原先这张表只增不减，
 * 唯一释放点是登出，因此浏览大库（数百海报 + 上千截图）后内存会持续上涨。
 * Map 保持插入顺序，因此直接按顺序淘汰最早的条目。
 * 上限取 300：远高于一屏到几屏的常用集合，正常浏览几乎不会触碰到；
 * 已加载完成的 <img> 不受 revoke 影响，重新挂载时会经 fileUrl 重新取一次 URL。
 */
const MEDIA_OBJECT_URL_LIMIT = 300;

function rememberMediaObjectUrl(key: string, url: string): string {
  const previous = mediaObjectUrls.get(key);
  if (previous && previous !== url) URL.revokeObjectURL(previous);
  mediaObjectUrls.delete(key);
  mediaObjectUrls.set(key, url);
  while (mediaObjectUrls.size > MEDIA_OBJECT_URL_LIMIT) {
    const oldestKey = mediaObjectUrls.keys().next().value;
    if (oldestKey === undefined) break;
    const oldestUrl = mediaObjectUrls.get(oldestKey);
    mediaObjectUrls.delete(oldestKey);
    if (oldestUrl) URL.revokeObjectURL(oldestUrl);
  }
  return url;
}

// 列表与统计不需要传输简介、演员等大字段；详情页仍通过 getOne 读取完整资料。
// 首次同步保存完整文本资料，离线时才能浏览详情、日记和追剧记录。
const SNAPSHOT_MOVIE_FIELDS = 'id,title,titleOriginal,mediaType,director,cast,releaseDate,country,genre,tags,runtime,synopsis,rating,poster,status,progress,created,rewatchCount';
const SNAPSHOT_DIARY_FIELDS = 'id,movie,watchDate,watchTime,rating,review,kind,created';
const SNAPSHOT_WATCH_RECORD_FIELDS = 'id,movie,watchDate,watchTime,rating,review,created';
const DETAIL_DIARY_FIELDS = 'id,movie,watchDate,watchTime,rating,review,kind,created';
const DETAIL_WATCH_RECORD_FIELDS = 'id,movie,watchDate,watchTime,rating,review,created';
const SCREENSHOT_FIELDS = 'id,movie,image,episode,hours,minutes,seconds,created';

function requireUserId(): string {
  const user = getCloudUser();
  if (!user) throw new Error('登录已失效，请重新登录');
  return user.id;
}

async function cloudWrite<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (await isInvalidCloudSessionAfterWriteFailure(error)) {
      throw new Error('登录状态已失效，请重新登录后重试');
    }
    throw error;
  }
}

function invalidateSnapshot(): void {
  snapshotCache = null;
  snapshotRequest = null;
  movieListCache = null;
  movieListRequest = null;
  snapshotGeneration++;
}

/** 写入后整库对账的合并窗口与最长等待（避免被连续写入一直推迟）。 */
const CLOUD_SYNC_DEBOUNCE_MS = 2000;
const CLOUD_SYNC_MAX_WAIT_MS = 8000;

/**
 * 写入云端后排一次整库对账。
 *
 * 每个写操作都会先把服务端返回的记录**增量**写进内存与 IndexedDB（见 updateOfflineSnapshot），
 * 所以"读到刚写的数据"并不依赖这里；这里只负责把**其它设备**的变更对账回来。
 *
 * 因此不需要每写一次就立刻重拉四个全量列表。原先的实现会让连续编辑（例如逐个改综艺
 * 分段名，每次 blur 一次）触发同等次数的整库下载，库大时既卡又费流量。现在合并成一次，
 * 并设最长等待上限，保证持续写入时也不会被无限推迟。
 */
function scheduleCloudSync(): void {
  const now = Date.now();
  if (cloudSyncFirstQueuedAt === 0) cloudSyncFirstQueuedAt = now;
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  const waited = now - cloudSyncFirstQueuedAt;
  const delay = Math.max(0, Math.min(CLOUD_SYNC_DEBOUNCE_MS, CLOUD_SYNC_MAX_WAIT_MS - waited));
  cloudSyncTimer = setTimeout(() => {
    cloudSyncTimer = null;
    cloudSyncFirstQueuedAt = 0;
    void runCloudSync();
  }, delay);
}

/** 等掉可能正在进行的旧读取，再按新的 generation 重拉，避免旧请求覆盖刚编辑的数据。 */
async function runCloudSync(): Promise<void> {
  const pending = snapshotRequest;
  if (pending) await pending.catch(() => {});
  const ownerId = getCloudUser()?.id;
  if (ownerId) await fetchRemoteSnapshot(ownerId).catch(() => {});
}

/** 将刚完成的写操作立即反映到内存和 IndexedDB，关闭应用也不会丢掉这一次更新。 */
function updateOfflineSnapshot(update: (snapshot: Snapshot) => Snapshot): void {
  const current = currentCachedSnapshot();
  const ownerId = getCloudUser()?.id;
  if (!current || !ownerId) return;
  const next = update(current);
  offlineSnapshot = next;
  offlineSnapshotOwnerId = ownerId;
  indexSnapshot(next);
  snapshotCache = { value: next, expiresAt: Date.now() + SNAPSHOT_TTL_MS };
  void saveOfflineSnapshot(ownerId, next).catch(() => {});
}

function persistMovieUpdate(updated: CloudMovieRecord): void {
  invalidateSnapshot();
  scheduleCloudSync();
  movieRecordCache.set(updated.id, updated);
  movieDetailCache.set(updated.id, updated);
  updateOfflineSnapshot((snapshot) => ({
    ...snapshot,
    movies: snapshot.movies.map((movie) => (movie.id === updated.id ? updated : movie)),
  }));
}

function persistSystemDiary(diary: CloudDiaryRecord): void {
  invalidateSnapshot();
  scheduleCloudSync();
  updateOfflineSnapshot((snapshot) => ({
    ...snapshot,
    diaries: [...snapshot.diaries, diary],
  }));
}

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Snapshot>;
  return Array.isArray(candidate.movies) && Array.isArray(candidate.diaries) && Array.isArray(candidate.watchRecords) && Array.isArray(candidate.screenshots);
}

function clearCloudCaches(): void {
  invalidateSnapshot();
  fileToken = null;
  fileTokenRequest = null;
  movieRecordCache.clear();
  movieRecordRequests.clear();
  movieDetailCache.clear();
  movieDetailRequests.clear();
  screenshotRecordCache.clear();
  screenshotRecordRequests.clear();
  screenshotListCache.clear();
  screenshotListRequests.clear();
  diaryEntriesRequests.clear();
  watchRecordRequests.clear();
  allScreenshotsRequest = null;
  allScreenshotsCache = null;
  offlineSnapshot = null;
  offlineSnapshotOwnerId = null;
  offlineSnapshotRequest = null;
  offlineSnapshotRequestOwnerId = null;
  // 取消待执行的整库对账：切换账号后它会把新账号的数据拉成旧账号的
  if (cloudSyncTimer) {
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = null;
  }
  cloudSyncFirstQueuedAt = 0;
  for (const url of mediaObjectUrls.values()) URL.revokeObjectURL(url);
  mediaObjectUrls.clear();
}

// 同一 Electron 窗口可以登出后切换账号。必须清掉内存记录与文件 token，避免
// 新账号先短暂看到旧账号缓存的标题、海报或截图。
pocketbase.authStore.onChange((_token, record) => {
  const nextOwnerId = record?.id || null;
  if (nextOwnerId !== cacheOwnerId) {
    cacheOwnerId = nextOwnerId;
    clearCloudCaches();
  }
});

function indexSnapshot(snapshot: Snapshot): void {
  // 收到一份完整快照时移除已在其他设备删除的记录，防止旧索引在断网读取时复活。
  movieRecordCache.clear();
  movieDetailCache.clear();
  screenshotRecordCache.clear();
  screenshotListCache.clear();
  snapshot.movies.forEach((record) => movieRecordCache.set(record.id, record));
  snapshot.screenshots.forEach((record) => screenshotRecordCache.set(record.id, record));
  const expiresAt = Date.now() + SNAPSHOT_TTL_MS;
  const screenshotsByMovie = new Map<string, CloudRecord[]>();
  snapshot.screenshots.forEach((record) => {
    const movieId = stringField(record, 'movie');
    const entries = screenshotsByMovie.get(movieId) || [];
    entries.push(record);
    screenshotsByMovie.set(movieId, entries);
  });
  screenshotsByMovie.forEach((records, movieId) => screenshotListCache.set(movieId, { value: records, expiresAt }));
  movieListCache = { value: snapshot.movies, expiresAt: Date.now() + SNAPSHOT_TTL_MS };
}

function currentCachedSnapshot(): Snapshot | null {
  return snapshotCache?.value || offlineSnapshot;
}

async function restoreOfflineSnapshot(ownerId: string): Promise<Snapshot | null> {
  if (offlineSnapshotOwnerId === ownerId) return offlineSnapshot;
  if (offlineSnapshotRequest && offlineSnapshotRequestOwnerId === ownerId) return offlineSnapshotRequest;
  const request = getOfflineSnapshot<Snapshot>(ownerId)
    .then((value) => {
      // 登出或切换账号后，旧的 IndexedDB 读取即便较晚完成也绝不能写回内存。
      if (cacheOwnerId !== ownerId) return null;
      offlineSnapshotOwnerId = ownerId;
      offlineSnapshot = isSnapshot(value) ? value : null;
      if (offlineSnapshot) indexSnapshot(offlineSnapshot);
      return offlineSnapshot;
    })
    .catch(() => null)
    .finally(() => {
      if (offlineSnapshotRequest === request) {
        offlineSnapshotRequest = null;
        offlineSnapshotRequestOwnerId = null;
      }
    });
  offlineSnapshotRequest = request;
  offlineSnapshotRequestOwnerId = ownerId;
  return request;
}

async function loadSnapshot(): Promise<Snapshot> {
  if (snapshotCache && snapshotCache.expiresAt > Date.now()) return snapshotCache.value;
  if (snapshotRequest) return snapshotRequest;

  const ownerId = getCloudUser()?.id;
  if (ownerId) {
    const stored = await restoreOfflineSnapshot(ownerId);
    if (stored) {
      snapshotCache = { value: stored, expiresAt: Date.now() + SNAPSHOT_TTL_MS };
      // 先返回本地缓存；刷新请求不阻塞首屏，并会在成功后覆盖下一次读取的数据。
      void fetchRemoteSnapshot(ownerId).catch(() => {});
      return stored;
    }
  }

  return fetchRemoteSnapshot(ownerId);
}

async function fetchRemoteSnapshot(ownerId?: string): Promise<Snapshot> {
  if (snapshotRequest) return snapshotRequest;
  const generation = snapshotGeneration;
  const request = Promise.all([
    pocketbase.collection('movies').getFullList<CloudMovieRecord>({ fields: SNAPSHOT_MOVIE_FIELDS }),
    pocketbase.collection('diary_entries').getFullList<CloudDiaryRecord>({ fields: SNAPSHOT_DIARY_FIELDS }),
    pocketbase.collection('watch_records').getFullList<CloudRecord>({ fields: SNAPSHOT_WATCH_RECORD_FIELDS }),
    pocketbase.collection('screenshots').getFullList<CloudRecord>({ fields: SCREENSHOT_FIELDS }),
  ]).then(([movies, diaries, watchRecords, screenshots]) => {
    const value = { movies, diaries, watchRecords, screenshots };
    if (generation === snapshotGeneration) {
      indexSnapshot(value);
      snapshotCache = { value, expiresAt: Date.now() + SNAPSHOT_TTL_MS };
      offlineSnapshot = value;
      offlineSnapshotOwnerId = ownerId || null;
      if (ownerId) void saveOfflineSnapshot(ownerId, value).catch(() => {});
      if (ownerId) void warmMediaThumbnails(value, ownerId);
    }
    return value;
  }).catch((error) => {
    // 网络不可用时仍能使用已同步的完整本地库。
    if (offlineSnapshot && offlineSnapshotOwnerId === ownerId) return offlineSnapshot;
    throw error;
  }).finally(() => {
    if (snapshotRequest === request) snapshotRequest = null;
  });

  snapshotRequest = request;
  return request;
}

function stringField(record: CloudRecord, name: string): string {
  const value = record[name];
  return typeof value === 'string' ? value : '';
}

function arrayField(record: CloudRecord, name: string): string[] {
  const value = record[name];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function progressField(record: CloudRecord): Progress | null {
  const value = record.progress;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<Progress>;
  if (typeof raw.episode !== 'number' || typeof raw.totalEpisodes !== 'number') return null;
  // 综艺分段在这里统一成结构化形态（旧自由文本标签就地升级，见 segmentGroups）。
  const segments = normalizeStoredSegments(raw.segments);
  return {
    episode: raw.episode,
    totalEpisodes: raw.totalEpisodes,
    ...(segments ? { segments } : {}),
  };
}

function toMetadata(record: CloudMovieRecord): MovieMetadata {
  const poster = stringField(record, 'poster');
  return {
    id: record.id,
    title: stringField(record, 'title'),
    titleOriginal: stringField(record, 'titleOriginal') || undefined,
    mediaType: stringField(record, 'mediaType') as MovieMetadata['mediaType'],
    director: stringField(record, 'director'),
    cast: arrayField(record, 'cast'),
    releaseDate: stringField(record, 'releaseDate'),
    country: stringField(record, 'country'),
    genre: arrayField(record, 'genre'),
    tags: arrayField(record, 'tags'),
    runtime: Number(record.runtime || 0),
    synopsis: stringField(record, 'synopsis') || undefined,
    rating: Number(record.rating || 0),
    posterPath: poster || undefined,
    posterThumbPath: poster || undefined,
    status: stringField(record, 'status') as WatchStatus,
    progress: progressField(record),
    createdAt: record.created,
    rewatchCount: Number(record.rewatchCount || 0),
  };
}

function toDiary(record: CloudDiaryRecord): DiaryEntry {
  return {
    id: record.id,
    watchDate: stringField(record, 'watchDate'),
    watchTime: stringField(record, 'watchTime') || undefined,
    rating: Number(record.rating),
    review: stringField(record, 'review') || undefined,
    images: [],
    kind: stringField(record, 'kind') === 'status' ? 'status' : 'progress',
  };
}

function toWatchRecord(record: CloudRecord): WatchRecord {
  return {
    id: record.id,
    watchDate: stringField(record, 'watchDate'),
    watchTime: stringField(record, 'watchTime') || undefined,
    rating: Number(record.rating || 0),
    review: stringField(record, 'review') || undefined,
  };
}

function latestMoment(entries: CloudDiaryRecord[]): string | undefined {
  return entries.reduce<string | undefined>((latest, entry) => {
    const moment = `${stringField(entry, 'watchDate')}T${stringField(entry, 'watchTime')}`;
    return !latest || moment > latest ? moment : latest;
  }, undefined);
}

function toSummary(movie: MovieMetadata, diaryEntries: CloudDiaryRecord[], records: CloudRecord[]): MovieSummary {
  const rated = records.map(toWatchRecord).filter((entry) => entry.rating > 0);
  const personalRating = rated.length
    ? Math.round((rated.reduce((total, entry) => total + entry.rating, 0) / rated.length) * 10) / 10
    : null;
  return {
    id: movie.id,
    title: movie.title,
    titleOriginal: movie.titleOriginal,
    mediaType: movie.mediaType,
    rating: movie.rating,
    personalRating,
    posterThumbPath: movie.posterThumbPath,
    releaseDate: movie.releaseDate,
    genre: movie.genre,
    tags: movie.tags,
    status: movie.status,
    progress: movie.progress,
    latestWatchDate: latestMoment(diaryEntries),
    createdAt: movie.createdAt,
    rewatchCount: movie.rewatchCount,
  };
}

async function summaries(): Promise<MovieSummary[]> {
  const { movies, diaries, watchRecords } = await loadSnapshot();
  const diaryByMovie = new Map<string, CloudDiaryRecord[]>();
  const recordsByMovie = new Map<string, CloudRecord[]>();
  for (const entry of diaries) {
    const movieId = stringField(entry, 'movie');
    diaryByMovie.set(movieId, [...(diaryByMovie.get(movieId) || []), entry]);
  }
  for (const entry of watchRecords) {
    const movieId = stringField(entry, 'movie');
    recordsByMovie.set(movieId, [...(recordsByMovie.get(movieId) || []), entry]);
  }
  return movies.map(toMetadata).map((movie) => toSummary(movie, diaryByMovie.get(movie.id) || [], recordsByMovie.get(movie.id) || []));
}

async function listMovieRecords(): Promise<CloudMovieRecord[]> {
  if (movieListCache && movieListCache.expiresAt > Date.now()) return movieListCache.value;
  if (movieListRequest) return movieListRequest;
  const ownerId = getCloudUser()?.id;
  if (ownerId) {
    const stored = await restoreOfflineSnapshot(ownerId);
    if (stored) {
      movieListCache = { value: stored.movies, expiresAt: Date.now() + SNAPSHOT_TTL_MS };
      void fetchRemoteSnapshot(ownerId).catch(() => {});
      return stored.movies;
    }
  }
  const request = pocketbase.collection('movies').getFullList<CloudMovieRecord>({ fields: SNAPSHOT_MOVIE_FIELDS })
    .then((records) => {
      records.forEach((record) => movieRecordCache.set(record.id, record));
      movieListCache = { value: records, expiresAt: Date.now() + SNAPSHOT_TTL_MS };
      return records;
    })
    .finally(() => {
      if (movieListRequest === request) movieListRequest = null;
    });
  movieListRequest = request;
  return request;
}

/** 轻量行列表不需要观看记录与日记的衍生字段，直接按状态查询影视集合。 */
async function listMoviesByStatus(status: WatchStatus): Promise<MovieSummary[]> {
  const ownerId = getCloudUser()?.id;
  const stored = ownerId ? await restoreOfflineSnapshot(ownerId) : null;
  if (stored) {
    void fetchRemoteSnapshot(ownerId).catch(() => {});
    return stored.movies.filter((record) => stringField(record, 'status') === status).map(toMetadata).map((movie) => toSummary(movie, [], []));
  }
  const records = await pocketbase.collection('movies').getFullList<CloudMovieRecord>({
    filter: `status = "${status}"`,
    fields: SNAPSHOT_MOVIE_FIELDS,
  });
  records.forEach((record) => movieRecordCache.set(record.id, record));
  return records.map(toMetadata).map((movie) => toSummary(movie, [], []));
}

/** 照片墙只需要影视标题与海报标识，不需要日记或观看记录。 */
export async function listCloudMediaMovies(): Promise<MovieSummary[]> {
  return (await listMovieRecords()).map(toMetadata).map((movie) => toSummary(movie, [], []));
}

function publicFields(data: Record<string, unknown>): Record<string, unknown> {
  const allowed = ['title', 'titleOriginal', 'mediaType', 'director', 'cast', 'releaseDate', 'country', 'genre', 'tags', 'runtime', 'synopsis', 'rating', 'status', 'progress', 'rewatchCount'];
  return Object.fromEntries(allowed.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
}

function posterFile(data: Record<string, unknown>): File | null {
  const base64 = typeof data.posterBase64 === 'string' ? data.posterBase64 : '';
  if (!base64) return null;
  const [header, content = ''] = base64.split(',', 2);
  const mime = header.match(/^data:([^;]+);base64$/)?.[1] || 'image/jpeg';
  const bytes = Uint8Array.from(atob(content || base64), (char) => char.charCodeAt(0));
  const extension = typeof data.posterExt === 'string' ? data.posterExt.replace(/^\./, '') : mime.split('/')[1] || 'jpg';
  return new File([bytes], `poster.${extension}`, { type: mime });
}

function toLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * 组装带文件的表单。
 * `removeFile` 用于「显式移除」：PocketBase 以 `字段名-` 空值表示删除该文件，
 * 缺了这个分支就只能上传、永远删不掉（见「移除海报」按钮）。
 */
function formDataWithFile(payload: Record<string, unknown>, field: string, file: File | null, removeFile = false): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  if (file) form.append(field, file);
  else if (removeFile) form.append(`${field}-`, '');
  return form;
}

async function createSystemDiary(movieId: string, kind: 'progress' | 'status', review: string, watchDate = getLocalDateStr()): Promise<CloudDiaryRecord> {
  return cloudWrite(() => pocketbase.collection('diary_entries').create<CloudDiaryRecord>({
    owner: requireUserId(), movie: movieId, watchDate, watchTime: getLocalTimeStr(), rating: -1, kind, review,
  }));
}

/**
 * 综艺 segments 变更 → 记录/合并 progress 日记（10 分钟内合并）。
 * 与本地 updateMovie 行为一致：最近 10 分钟内已有的 progress 日记被更新，
 * 否则新建一条，避免频繁编辑分段标签产生冗余记录。
 *
 * 只把「本次最新添加」的分段写进 review，避免期数很多时日记把整个历史分段列表
 * 累积显示出来（只显示最新添加的分段）。
 *
 * 写入的是「期号 + 分段名」的完整文本（如「第 3 期加更上」），所以新日记本身
 * 就自带期号；`qualifyVarietySegments` 只用于补齐更早写入的、只带分段名的旧日记。
 */
async function upsertVarietyProgressDiary(movieId: string, segments: ProgressSegment[], previousSegments?: ProgressSegment[]): Promise<void> {
  const previous = new Set((previousSegments ?? []).map(segmentText).filter(Boolean));
  const filled = segments.map(segmentText).filter(Boolean);
  const added = filled.filter((text) => !previous.has(text));
  const review = added.length > 0 ? added.join(' · ') : (filled.length > 0 ? filled.join(' · ') : '未标注观看进度');
  const now = new Date();
  const watchTime = getLocalTimeStr();
  const TEN_MINUTES = 10 * 60 * 1000;

  const existing = await getDiaryEntriesForMovie(movieId).catch(() => []);
  const lastProgress = [...existing].reverse().find((entry) => stringField(entry, 'kind') === 'progress');
  if (lastProgress) {
    const entryTime = new Date(`${stringField(lastProgress, 'watchDate')}T${stringField(lastProgress, 'watchTime') || '00:00:00'}`);
    if (now.getTime() - entryTime.getTime() <= TEN_MINUTES) {
      // 10 分钟内已有一条 progress 日记 → 更新其 review 与 watchTime
      const updated = await cloudWrite(() => pocketbase.collection('diary_entries').update<CloudDiaryRecord>(lastProgress.id, { watchTime, review }));
      invalidateSnapshot();
      scheduleCloudSync();
      updateOfflineSnapshot((snapshot) => ({
        ...snapshot,
        diaries: snapshot.diaries.map((entry) => (entry.id === updated.id ? updated : entry)),
      }));
      return;
    }
  }
  persistSystemDiary(await createSystemDiary(movieId, 'progress', review));
}

/**
 * 截图上传前本地压缩：超长边（默认 1920px）以上的原图先缩放并转成 JPEG，
 * 大幅减小上传体积，缩短云端上传时间与服务器缩略图生成时间。
 * 压缩失败或原图已足够小则原样返回。
 */
async function compressScreenshotForUpload(dataUrl: string, maxEdge = 1920, quality = 0.85): Promise<string> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('decode failed'));
      image.src = dataUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 1) return dataUrl; // 已经足够小，不做处理
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return dataUrl; // 压缩失败不影响上传，原样发送
  }
}

/**
 * 文件版压缩：与 compressScreenshotForUpload 同样的「超长边缩放 + 转 JPEG」策略，
 * 但全程走 Blob + Canvas，不产生 base64 中间串，也不把原图整份复制到内存。
 *
 * 为什么需要它：base64 路径下同一张图会同时存在 3 份（base64 字符串、atob 结果、
 * Uint8Array 拷贝）。批量上传大图时这是移动端 WebView OOM、桌面端渲染进程被杀
 * （随后自动 reload，未保存的表单输入全丢）的主要来源。
 */
async function compressImageFileForUpload(file: File, maxEdge = 1920, quality = 0.85): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('decode failed'));
      image.src = objectUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 1) return file; // 已经足够小，不做处理
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob ?? file;
  } catch {
    return file; // 压缩失败不影响上传，原样发送
  } finally {
    // 图像已解码并绘制完毕，可以安全释放
    URL.revokeObjectURL(objectUrl);
  }
}

/** 截图上传成功后的统一收尾：失效缓存、更新本地快照、预热缩略图。 */
function afterScreenshotUpload(movieId: string, created: CloudRecord): void {
  invalidateSnapshot();
  scheduleCloudSync();
  screenshotRecordCache.set(created.id, created);
  updateOfflineSnapshot((snapshot) => ({ ...snapshot, screenshots: [...snapshot.screenshots, created] }));
  screenshotListCache.delete(movieId);
  allScreenshotsCache = null;
  // 上传成功后立即预热新截图的缩略图：触发服务端生成并缓存到本地 IndexedDB，
  // 让照片墙/详情页无需再等首次缩略图请求，秒开显示。
  void (async () => {
    try {
      const ownerId = getCloudUser()?.id;
      if (!ownerId) return;
      const token = await getProtectedFileToken();
      const remoteUrl = pocketbase.files.getURL({ ...created, collectionName: 'screenshots' }, created.id, { token, thumb: SCREENSHOT_THUMB_SIZE });
      await cacheRemoteMedia(ownerId, `screenshots:${created.id}:${created.id}:${SCREENSHOT_THUMB_SIZE}`, remoteUrl);
    } catch {
      // 预热失败不影响上传结果；页面仍会按需加载缩略图。
    }
  })();
}

async function getProtectedFileToken(): Promise<string> {
  if (fileToken && fileToken.expiresAt > Date.now()) return fileToken.value;
  if (!fileTokenRequest) {
    fileTokenRequest = pocketbase.files.getToken()
      .then((value) => {
        fileToken = { value, expiresAt: Date.now() + FILE_TOKEN_TTL_MS };
        return value;
      })
      .finally(() => {
        fileTokenRequest = null;
      });
  }
  return fileTokenRequest;
}

async function fileUrl(record: CloudRecord, field: string, thumb?: string): Promise<string | null> {
  const filename = stringField(record, field);
  if (!filename) return null;
  const ownerId = getCloudUser()?.id;
  const mediaKey = `${record.collectionName || (field === 'poster' ? 'movies' : 'screenshots')}:${record.id}:${filename}:${thumb || 'original'}`;
  if (ownerId) {
    const existingUrl = mediaObjectUrls.get(`${ownerId}:${mediaKey}`);
    if (existingUrl) return existingUrl;
    const localBlob = await getOfflineMedia(ownerId, mediaKey).catch(() => null);
    if (localBlob) {
      return rememberMediaObjectUrl(`${ownerId}:${mediaKey}`, URL.createObjectURL(localBlob));
    }
    // 截图原图按需保存，以控制本地空间；离线查看灯箱时仍优先给出已同步的缩略图。
    if (field === 'image' && !thumb) {
      const thumbnailKey = `${record.collectionName || 'screenshots'}:${record.id}:${filename}:${SCREENSHOT_THUMB_SIZE}`;
      const thumbnailBlob = await getOfflineMedia(ownerId, thumbnailKey).catch(() => null);
      if (thumbnailBlob) {
        return rememberMediaObjectUrl(`${ownerId}:${mediaKey}`, URL.createObjectURL(thumbnailBlob));
      }
    }
    // 海报原图同样优先使用已同步的缩略图兜底，避免大图加载失败/缓慢时一片空白。
    if (field === 'poster' && !thumb) {
      const thumbnailKey = `${record.collectionName || 'movies'}:${record.id}:${filename}:${POSTER_THUMB_SIZE}`;
      const thumbnailBlob = await getOfflineMedia(ownerId, thumbnailKey).catch(() => null);
      if (thumbnailBlob) {
        return rememberMediaObjectUrl(`${ownerId}:${mediaKey}`, URL.createObjectURL(thumbnailBlob));
      }
    }
  }
  const token = await getProtectedFileToken();
  // `fields` 精简响应时部分 PocketBase 版本可能省略 collectionName；文件 URL
  // 仍可根据字段所属集合稳定生成，避免优化后缩略图退化为空白。
  const collectionName = record.collectionName || (field === 'poster' ? 'movies' : 'screenshots');
  const remoteUrl = pocketbase.files.getURL({ ...record, collectionName }, filename, { token, ...(thumb ? { thumb } : {}) });
  if (ownerId) void cacheRemoteMedia(ownerId, mediaKey, remoteUrl);
  return remoteUrl;
}

async function cacheRemoteMedia(ownerId: string, mediaKey: string, remoteUrl: string): Promise<void> {
  try {
    const response = await fetch(remoteUrl);
    if (!response.ok) return;
    await saveOfflineMedia(ownerId, mediaKey, await response.blob());
  } catch {
    // 缓存预热失败不应影响当前图片的网络加载。
  }
}

/**
 * 首次完整同步后预热用于界面展示的缩略图。原始截图继续按需下载，避免大型截图库
 * 占满 IndexedDB；断网打开灯箱时会自动使用这里的缩略图兜底。
 *
 * 有上限、也尊重省流量设置：原先是无条件全量预热，云端有几千张截图时用户只是
 * 打开首页，后台就会跑掉几十上百 MB 下行流量与等量的 IndexedDB 写入。
 */
const MEDIA_WARM_LIMIT = 200;

function warmMediaThumbnails(snapshot: Snapshot, ownerId: string): void {
  if (mediaWarmRequest && mediaWarmOwnerId === ownerId) return;

  // 数据节省模式，或链路只有 2G/3G 时不预热（navigator.connection 是非标准 API）
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData) return;
  if (connection?.effectiveType && /^(slow-2g|2g|3g)$/.test(connection.effectiveType)) return;

  const all: Array<{ record: CloudRecord; field: 'poster' | 'image'; thumb: string }> = [
    ...snapshot.movies.filter((record) => Boolean(stringField(record, 'poster'))).map((record) => ({ record, field: 'poster' as const, thumb: POSTER_THUMB_SIZE })),
    ...snapshot.screenshots.filter((record) => Boolean(stringField(record, 'image'))).map((record) => ({ record, field: 'image' as const, thumb: SCREENSHOT_THUMB_SIZE })),
  ];
  // 新的排前面：库比上限大时，优先保证最近添加的内容离线可见
  const jobs = all.length > MEDIA_WARM_LIMIT ? all.slice(-MEDIA_WARM_LIMIT) : all;
  const request = (async () => {
    const token = await getProtectedFileToken();
    for (let offset = 0; offset < jobs.length; offset += MEDIA_WARM_CONCURRENCY) {
      await Promise.all(jobs.slice(offset, offset + MEDIA_WARM_CONCURRENCY).map(async ({ record, field, thumb }) => {
        const filename = stringField(record, field);
        const collectionName = record.collectionName || (field === 'poster' ? 'movies' : 'screenshots');
        const mediaKey = `${collectionName}:${record.id}:${filename}:${thumb}`;
        const exists = await getOfflineMedia(ownerId, mediaKey).catch(() => null);
        if (exists) return;
        const remoteUrl = pocketbase.files.getURL({ ...record, collectionName }, filename, { token, thumb });
        await cacheRemoteMedia(ownerId, mediaKey, remoteUrl);
      }));
    }
  })().catch(() => {}).finally(() => {
    if (mediaWarmRequest === request) {
      mediaWarmRequest = null;
      mediaWarmOwnerId = null;
    }
  });
  mediaWarmRequest = request;
  mediaWarmOwnerId = ownerId;
}

async function getMovieRecord(id: string): Promise<CloudMovieRecord> {
  const cached = movieRecordCache.get(id);
  if (cached) return cached;

  const pending = movieRecordRequests.get(id);
  if (pending) return pending;

  const ownerId = getCloudUser()?.id;
  if (ownerId) {
    const stored = await restoreOfflineSnapshot(ownerId);
    const offline = stored?.movies.find((record) => record.id === id);
    if (offline) {
      movieRecordCache.set(id, offline);
      void fetchRemoteSnapshot(ownerId).catch(() => {});
      return offline;
    }
  }

  const request = pocketbase.collection('movies').getOne<CloudMovieRecord>(id)
    .then((record) => {
      movieRecordCache.set(id, record);
      return record;
    })
    .finally(() => {
      movieRecordRequests.delete(id);
    });
  movieRecordRequests.set(id, request);
  return request;
}

async function getMovieDetailRecord(id: string): Promise<CloudMovieRecord> {
  const cached = movieDetailCache.get(id);
  if (cached) return cached;
  const pending = movieDetailRequests.get(id);
  if (pending) return pending;
  const ownerId = getCloudUser()?.id;
  if (ownerId) {
    const stored = await restoreOfflineSnapshot(ownerId);
    const offline = stored?.movies.find((record) => record.id === id);
    if (offline) {
      movieDetailCache.set(id, offline);
      void fetchRemoteSnapshot(ownerId).catch(() => {});
      return offline;
    }
  }
  const request = pocketbase.collection('movies').getOne<CloudMovieRecord>(id)
    .then((record) => {
      movieRecordCache.set(id, record);
      movieDetailCache.set(id, record);
      return record;
    })
    .catch((error) => {
      const offline = currentCachedSnapshot()?.movies.find((record) => record.id === id);
      if (offline) return offline;
      throw error;
    }).finally(() => {
      movieDetailRequests.delete(id);
    });
  movieDetailRequests.set(id, request);
  return request;
}

async function getScreenshotRecord(id: string): Promise<CloudRecord> {
  const cached = screenshotRecordCache.get(id);
  if (cached) return cached;
  const pending = screenshotRecordRequests.get(id);
  if (pending) return pending;
  const ownerId = getCloudUser()?.id;
  if (ownerId) {
    const stored = await restoreOfflineSnapshot(ownerId);
    const offline = stored?.screenshots.find((record) => record.id === id);
    if (offline) {
      screenshotRecordCache.set(id, offline);
      void fetchRemoteSnapshot(ownerId).catch(() => {});
      return offline;
    }
  }
  const request = pocketbase.collection('screenshots').getOne<CloudRecord>(id, { fields: SCREENSHOT_FIELDS })
    .then((record) => {
      screenshotRecordCache.set(id, record);
      return record;
    })
    .catch((error) => {
      const offline = currentCachedSnapshot()?.screenshots.find((record) => record.id === id);
      if (offline) return offline;
      throw error;
    }).finally(() => {
      screenshotRecordRequests.delete(id);
    });
  screenshotRecordRequests.set(id, request);
  return request;
}

async function getScreenshotsForMovie(movieId: string): Promise<CloudRecord[]> {
  const cached = screenshotListCache.get(movieId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = screenshotListRequests.get(movieId);
  if (pending) return pending;
  const ownerId = getCloudUser()?.id;
  if (ownerId) {
    const stored = await restoreOfflineSnapshot(ownerId);
    if (stored) {
      const offline = stored.screenshots.filter((record) => stringField(record, 'movie') === movieId);
      screenshotListCache.set(movieId, { value: offline, expiresAt: Date.now() + SCREENSHOT_CACHE_TTL_MS });
      void fetchRemoteSnapshot(ownerId).catch(() => {});
      return offline;
    }
  }
  const request = pocketbase.collection('screenshots').getFullList<CloudRecord>({
    filter: `movie = "${movieId}"`,
    fields: SCREENSHOT_FIELDS,
  }).then((records) => {
    records.forEach((record) => screenshotRecordCache.set(record.id, record));
    screenshotListCache.set(movieId, { value: records, expiresAt: Date.now() + SCREENSHOT_CACHE_TTL_MS });
    return records;
  }).catch((error) => {
    const offline = currentCachedSnapshot();
    if (offline) return offline.screenshots.filter((record) => stringField(record, 'movie') === movieId);
    throw error;
  }).finally(() => {
    screenshotListRequests.delete(movieId);
  });
  screenshotListRequests.set(movieId, request);
  return request;
}

async function getDiaryEntriesForMovie(movieId: string): Promise<CloudDiaryRecord[]> {
  const pending = diaryEntriesRequests.get(movieId);
  if (pending) return pending;
  const ownerId = getCloudUser()?.id;
  if (ownerId) {
    const stored = await restoreOfflineSnapshot(ownerId);
    if (stored) {
      void fetchRemoteSnapshot(ownerId).catch(() => {});
      return stored.diaries.filter((record) => stringField(record, 'movie') === movieId);
    }
  }
  const request = pocketbase.collection('diary_entries').getFullList<CloudDiaryRecord>({
    filter: `movie = "${movieId}"`,
    fields: DETAIL_DIARY_FIELDS,
  }).catch((error) => {
    const offline = currentCachedSnapshot();
    if (offline) return offline.diaries.filter((record) => stringField(record, 'movie') === movieId);
    throw error;
  }).finally(() => {
    diaryEntriesRequests.delete(movieId);
  });
  diaryEntriesRequests.set(movieId, request);
  return request;
}

async function getWatchRecordsForMovie(movieId: string): Promise<CloudRecord[]> {
  const pending = watchRecordRequests.get(movieId);
  if (pending) return pending;
  const ownerId = getCloudUser()?.id;
  if (ownerId) {
    const stored = await restoreOfflineSnapshot(ownerId);
    if (stored) {
      void fetchRemoteSnapshot(ownerId).catch(() => {});
      return stored.watchRecords.filter((record) => stringField(record, 'movie') === movieId);
    }
  }
  const request = pocketbase.collection('watch_records').getFullList<CloudRecord>({
    filter: `movie = "${movieId}"`,
    fields: DETAIL_WATCH_RECORD_FIELDS,
  }).catch((error) => {
    const offline = currentCachedSnapshot();
    if (offline) return offline.watchRecords.filter((record) => stringField(record, 'movie') === movieId);
    throw error;
  }).finally(() => {
    watchRecordRequests.delete(movieId);
  });
  watchRecordRequests.set(movieId, request);
  return request;
}

/** 照片墙一次性读取当前账号的截图元数据，避免每部影片各发一次查询。 */
export async function getCloudScreenshotsByMovie(): Promise<Map<string, ScreenshotInfo[]>> {
  if (allScreenshotsCache && allScreenshotsCache.expiresAt > Date.now()) return allScreenshotsCache.value;
  if (allScreenshotsRequest) return allScreenshotsRequest;
  const ownerId = getCloudUser()?.id;
  const stored = ownerId ? await restoreOfflineSnapshot(ownerId) : null;
  if (stored) {
    const grouped = screenshotsToMap(stored.screenshots);
    allScreenshotsCache = { value: grouped, expiresAt: Date.now() + SCREENSHOT_CACHE_TTL_MS };
    void fetchRemoteSnapshot(ownerId).catch(() => {});
    return grouped;
  }
  const request = pocketbase.collection('screenshots').getFullList<CloudRecord>({ fields: SCREENSHOT_FIELDS })
    .then((records) => {
      const grouped = screenshotsToMap(records);
      const expiresAt = Date.now() + SCREENSHOT_CACHE_TTL_MS;
      grouped.forEach((items, movieId) => {
        screenshotListCache.set(movieId, {
          value: items.map((item) => screenshotRecordCache.get(item.filename)).filter((record): record is CloudRecord => Boolean(record)),
          expiresAt,
        });
      });
      allScreenshotsCache = { value: grouped, expiresAt: Date.now() + SCREENSHOT_CACHE_TTL_MS };
      return grouped;
    })
    .finally(() => {
      if (allScreenshotsRequest === request) allScreenshotsRequest = null;
    });
  allScreenshotsRequest = request;
  return request;
}

function screenshotsToMap(records: CloudRecord[]): Map<string, ScreenshotInfo[]> {
  const grouped = new Map<string, ScreenshotInfo[]>();
  for (const record of records) {
    screenshotRecordCache.set(record.id, record);
    const movieId = stringField(record, 'movie');
    const items = grouped.get(movieId) || [];
    items.push({
      filename: record.id,
      createdAt: stringField(record, 'created') || undefined,
      episode: typeof record.episode === 'number' ? record.episode : undefined,
      hours: typeof record.hours === 'number' ? record.hours : undefined,
      minutes: typeof record.minutes === 'number' ? record.minutes : undefined,
      seconds: typeof record.seconds === 'number' ? record.seconds : undefined,
    });
    grouped.set(movieId, items);
  }
  return grouped;
}

/**
 * 一次性迁移：把历史「累积全量分段」的综艺进度日记改写为只保留相对上一条新增的分段，
 * 使云端已存在的日记也满足“只显示最新添加的期数”。幂等：只有计算出的新增分段与当前
 * review 不同才写回；写完后由 localStorage 按账号标记跳过，避免每次登录重复扫描。
 */
export async function migrateVarietyDiaryReviews(): Promise<void> {
  const ownerId = getCloudUser()?.id;
  if (!ownerId) return;
  const flagKey = `pianke.diaryReviewMigrated.v1.${ownerId}`;
  try {
    if (localStorage.getItem(flagKey) === '1') return;
  } catch {
    /* localStorage 不可用时每次都跑，操作幂等 */
  }

  let snapshot: Snapshot;
  try {
    snapshot = await loadSnapshot();
  } catch {
    return;
  }

  const reviewMap = new Map<string, string>();
  for (const movie of snapshot.movies) {
    if (stringField(movie, 'mediaType') !== '综艺') continue;
    const movieId = stringField(movie, 'id');
    const ordered = snapshot.diaries
      .filter((entry) => stringField(entry, 'movie') === movieId)
      .sort((a, b) => `${stringField(a, 'watchDate')}${stringField(a, 'watchTime')}`.localeCompare(`${stringField(b, 'watchDate')}${stringField(b, 'watchTime')}`));
    const seen = new Set<string>();
    for (const entry of ordered) {
      if (stringField(entry, 'kind') !== 'progress') continue;
      const storedReview = stringField(entry, 'review');
      if (!storedReview || storedReview === '未标注观看进度') continue;
      const segs = storedReview.split(/[·.、，,]/).map((s) => s.trim()).filter(Boolean);
      const added = segs.filter((s) => !seen.has(s));
      segs.forEach((s) => seen.add(s));
      const delta = added.length > 0 ? added.join(' · ') : storedReview;
      if (delta !== storedReview) reviewMap.set(entry.id, delta);
    }
  }

  let updatedCount = 0;
  if (reviewMap.size > 0) {
    for (const [id, review] of reviewMap) {
      try {
        await cloudWrite(() => pocketbase.collection('diary_entries').update<CloudDiaryRecord>(id, { review }));
        updatedCount++;
      } catch (error) {
        console.warn('[cloud] Failed to migrate variety diary review', id, error);
      }
    }
    if (updatedCount > 0) {
      invalidateSnapshot();
      scheduleCloudSync();
      updateOfflineSnapshot((snapshot) => ({
        ...snapshot,
        diaries: snapshot.diaries.map((entry) => (reviewMap.has(entry.id) ? { ...entry, review: reviewMap.get(entry.id) } : entry)),
      }));
    }
  }

  // 全部写入成功（或本就没有需要改写的历史）后才标记完成；部分失败下次登录会重试。
  if (reviewMap.size === 0 || updatedCount === reviewMap.size) {
    try {
      localStorage.setItem(flagKey, '1');
    } catch {
      /* ignore */
    }
  }
}

/**
 * 一次性迁移：把综艺分段从「自由文本标签」升级为结构化 `{ period, label }`。
 *
 * 期号从此是数据、而不是每次展示时从文本里猜的约定，详情页分组、日记页显示与 Excel
 * 导出的口径因此完全一致。转换规则见 `legacyTextToSegments`（解析期号 + 裸标签就近归属，
 * 与升级前详情页的分组结果相同）。幂等：只有确实存在旧文本标签才写回；全部成功或本来就
 * 无事可做时按账号打标记，避免每次登录重复扫描。
 */
export async function migrateVarietySegments(): Promise<void> {
  const ownerId = getCloudUser()?.id;
  if (!ownerId) return;
  const flagKey = `pianke.segmentsMigrated.v1.${ownerId}`;
  try {
    if (localStorage.getItem(flagKey) === '1') return;
  } catch {
    /* localStorage 不可用时每次都跑，操作幂等 */
  }

  let snapshot: Snapshot;
  try {
    snapshot = await loadSnapshot();
  } catch {
    return;
  }

  const migrated = new Map<string, Progress>();
  let failed = 0;
  for (const record of snapshot.movies) {
    if (stringField(record, 'mediaType') !== '综艺') continue;
    const progress = progressField(record);
    if (!progress?.segments) continue;
    // 已经是结构化形态就跳过（旧数据里至少有一项是字符串）
    const stored = (record.progress as { segments?: unknown } | undefined)?.segments;
    if (Array.isArray(stored) && stored.every((item) => item != null && typeof item === 'object')) continue;
    try {
      await cloudWrite(() => pocketbase.collection('movies').update<CloudMovieRecord>(record.id, { progress }));
      migrated.set(record.id, progress);
    } catch (error) {
      failed++;
      console.warn('[cloud] Failed to migrate variety segments', record.id, error);
    }
  }

  if (migrated.size > 0) {
    invalidateSnapshot();
    scheduleCloudSync();
    updateOfflineSnapshot((current) => ({
      ...current,
      movies: current.movies.map((item) => (migrated.has(item.id) ? { ...item, progress: migrated.get(item.id) } : item)),
    }));
  }

  // 全部写入成功（或本就没有需要升级的数据）后才标记完成；部分失败下次登录会重试。
  if (failed === 0) {
    try {
      localStorage.setItem(flagKey, '1');
    } catch {
      /* ignore */
    }
  }
}

/** 应用登录后调用：预先恢复本地快照，并让云端同步在后台运行。 */
export async function hydrateOfflineCloudCache(): Promise<void> {
  const ownerId = getCloudUser()?.id;
  if (!ownerId) return;
  void requestPersistentOfflineStorage();
  await restoreOfflineSnapshot(ownerId);
  void fetchRemoteSnapshot(ownerId).catch(() => {});
  // 后台一次性改写历史综艺日记的 review，让它「对比上一条只显示新增的分段」。
  void migrateVarietyDiaryReviews();
  // 后台一次性把综艺分段升级成结构化 `{ period, label }`。
  void migrateVarietySegments();
}

function splitCountries(country: string): string[] {
  return [...new Set(country.split(/[、，,／/]/).map((item) => item.trim()).filter(Boolean))];
}

function ratingBucket(rating: number): number | null {
  if (rating <= 0) return null;
  return Math.max(2, Math.min(10, Math.round(rating / 2) * 2));
}

function sortByMomentDesc<T extends { watchDate: string; watchTime?: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => `${b.watchDate}${b.watchTime || ''}`.localeCompare(`${a.watchDate}${a.watchTime || ''}`));
}

/**
 * 把云端数据组装成导出工作簿：影视清单 / 观影日记 / 追剧记录三张表，表名、列顺序、
 * 列宽与自动筛选保持稳定，便于与历史导出的文件互相替换。
 */
function buildExcelWorkbook(
  movies: MovieMetadata[],
  diaryByMovie: Map<string, DiaryEntry[]>,
  watchRecordsByMovie: Map<string, WatchRecord[]>,
  screenshotsByMovie: Map<string, ScreenshotInfo[]>,
  XLSX: typeof import('xlsx'),
) {
  const workbook = XLSX.utils.book_new();

  const movieRows = movies.map((movie) => [
    movie.id,
    movie.title,
    movie.titleOriginal || '',
    movie.mediaType,
    movie.status,
    movie.director,
    movie.cast.join(' / '),
    movie.releaseDate,
    movie.country,
    movie.genre.join(' / '),
    movie.tags.join(' / '),
    movie.runtime,
    movie.rating,
    movie.progress?.episode ?? '',
    movie.progress?.totalEpisodes ?? '',
    movie.rewatchCount ?? 0,
    movie.createdAt || '',
    movie.synopsis || '',
  ]);
  const movieSheet = XLSX.utils.aoa_to_sheet([
    ['ID', '标题', '原始标题', '类型', '状态', '导演', '主演', '上映日期', '国家', '类型标签', '自定义标签', '片长（分钟）', '公众评分', '当前集数', '总集数', '重看次数', '添加时间', '简介'],
    ...movieRows,
  ]);
  movieSheet['!cols'] = [
    { wch: 38 }, { wch: 20 }, { wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 28 }, { wch: 12 }, { wch: 14 },
    { wch: 24 }, { wch: 24 }, { wch: 13 }, { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 11 }, { wch: 22 }, { wch: 48 },
  ];
  movieSheet['!autofilter'] = { ref: `A1:R${Math.max(movieRows.length + 1, 1)}` };
  XLSX.utils.book_append_sheet(workbook, movieSheet, '影视清单');

  const diaryRows = movies.flatMap((movie) => (diaryByMovie.get(movie.id) || []).map((entry) => [
    movie.id,
    movie.title,
    entry.watchDate,
    entry.watchTime || '',
    entry.rating,
    entry.kind,
    entry.review || '',
    (screenshotsByMovie.get(movie.id) || []).length,
  ]));
  const diarySheet = XLSX.utils.aoa_to_sheet([
    ['影视 ID', '影视标题', '记录日期', '记录时间', '评分', '记录类型', '详情', '关联图片数'],
    ...diaryRows,
  ]);
  diarySheet['!cols'] = [{ wch: 38 }, { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 11 }, { wch: 12 }, { wch: 60 }, { wch: 12 }];
  diarySheet['!autofilter'] = { ref: `A1:H${Math.max(diaryRows.length + 1, 1)}` };
  XLSX.utils.book_append_sheet(workbook, diarySheet, '观影日记');

  const watchRecordRows = movies.flatMap((movie) => (watchRecordsByMovie.get(movie.id) || []).map((entry) => [
    movie.id,
    movie.title,
    entry.watchDate,
    entry.watchTime || '',
    entry.rating,
    entry.review || '',
  ]));
  const watchRecordSheet = XLSX.utils.aoa_to_sheet([
    ['影视 ID', '影视标题', '观看日期', '观看时间', '个人评分', '短评'],
    ...watchRecordRows,
  ]);
  watchRecordSheet['!cols'] = [{ wch: 38 }, { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 11 }, { wch: 60 }];
  watchRecordSheet['!autofilter'] = { ref: `A1:F${Math.max(watchRecordRows.length + 1, 1)}` };
  XLSX.utils.book_append_sheet(workbook, watchRecordSheet, '追剧记录');

  return { workbook, movieCount: movies.length, diaryCount: diaryRows.length, watchRecordCount: watchRecordRows.length };
}

/** 浏览器侧落盘：xlsx 在渲染进程只能生成字节流，下载交给浏览器/WebView 处理。 */
async function downloadSpreadsheet(data: ArrayBuffer | Uint8Array, fileName: string): Promise<void> {
  // xlsx 的 write(type:'array') 返回 ArrayBuffer，旧版 Node 构建可能返回 Buffer 或普通数组，
  // 统一成 Uint8Array 后再交给 Blob，避免把数字数组当成文本写进文件。
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength === 0) throw new Error('生成 Excel 内容为空，请稍后重试');

  const blob = new Blob([bytes.slice().buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // 立即回收会让部分 WebView 取消尚未开始的下载，稍后再释放。
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** 云端导出：xlsx 体积较大，仅在用户真正点击导出时按需加载，不进入首屏包。 */
async function exportCloudMoviesToExcel(): Promise<{ filePath?: string; fileName: string; movieCount: number; diaryCount: number; watchRecordCount: number }> {
  // 云端只能通过快照拿到简介、导演等完整字段；loadSnapshot 在离线时回退到本地副本，
  // 因此断网也能导出最近一次同步的数据，而不是直接失败。
  const [{ movies, diaries, watchRecords, screenshots }, XLSX] = await Promise.all([
    loadSnapshot(),
    import('xlsx'),
  ]);

  const diaryByMovie = new Map<string, DiaryEntry[]>();
  for (const record of diaries) {
    const movieId = stringField(record, 'movie');
    diaryByMovie.set(movieId, [...(diaryByMovie.get(movieId) || []), toDiary(record)]);
  }
  const watchRecordsByMovie = new Map<string, WatchRecord[]>();
  for (const record of watchRecords) {
    const movieId = stringField(record, 'movie');
    watchRecordsByMovie.set(movieId, [...(watchRecordsByMovie.get(movieId) || []), toWatchRecord(record)]);
  }

  const metadata = movies.map(toMetadata);
  // 综艺进度日记的详情列与日记页保持同一口径：只显示最新添加的分段，并补上期号
  // （旧日记里只写了「加更上」这类分段名，导出时也应是「第 3 期加更上」）。
  for (const movie of metadata) {
    const entries = diaryByMovie.get(movie.id);
    if (!entries?.length) continue;
    const reviews = varietyProgressReviews(entries, movie.mediaType, movie.progress?.segments);
    if (reviews.size === 0) continue;
    diaryByMovie.set(movie.id, entries.map((entry) => (
      reviews.has(entry.id) ? { ...entry, review: reviews.get(entry.id) } : entry
    )));
  }

  const { workbook, movieCount, diaryCount, watchRecordCount } = buildExcelWorkbook(
    metadata,
    diaryByMovie,
    watchRecordsByMovie,
    screenshotsToMap(screenshots),
    XLSX,
  );

  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer | Uint8Array;
  const fileName = `PianKe-影视数据-${getLocalDateStr()}.xlsx`;
  await downloadSpreadsheet(data, fileName);
  return { fileName, movieCount, diaryCount, watchRecordCount };
}

/**
 * 综艺进度日记的 review 里保存的是当次「已完成的分段列表」快照。期数很多时，列表会
 * 越来越长，导致日记页把历史全部期数都显示出来。这里按观看时间顺序做差分：
 * 每条只保留相对前一条「最新添加」的分段，实现“只显示最新添加的期数”的效果，
 * 并且对云端早已累积的旧记录同样生效。
 *
 * 展示前再补一道期号：用户常只给某期的第一个分段写期号（「第 3 期上」），同期的其余
 * 分段只写「下」「加更上」，日记直接展示原文就看不出是哪一期。这里用
 * `segmentGroups.qualifyVarietySegments` 把期号补齐（自带期号的先占位，只写分段名的
 * 按顺序认领剩下的同名分段）。
 */
function varietyProgressReviews(entries: DiaryEntry[], mediaType: string, segments?: ProgressSegment[]): Map<string, string> {
  const display = new Map<string, string>();
  if (mediaType !== '综艺') return display;

  const sorted = [...entries].sort((a, b) => `${a.watchDate}${a.watchTime || ''}`.localeCompare(`${b.watchDate}${b.watchTime || ''}`));

  // ① 先按时间顺序取出每条日记「相对之前新增」的分段——与下面展示的口径完全一致。
  const seen = new Set<string>();
  const byEntry: { entry: DiaryEntry; review: string; added: string[] }[] = [];
  for (const entry of sorted) {
    const review = entry.review;
    if (entry.kind !== 'progress' || !review || review === '未标注观看进度') continue;
    // 兼容历史数据里用「.」或「·」等分隔的分段列表。
    const segs = review.split(/[·.、，,]/).map((s) => s.trim()).filter(Boolean);
    const added: string[] = [];
    for (const seg of segs) {
      if (seen.has(seg)) continue;
      seen.add(seg);
      added.push(seg);
    }
    byEntry.push({ entry, review, added });
  }

  // ② 只对真正会显示出来的这些分段补期号：它们按时间顺序正好对应 segments 的推进，
  //    历史累积型旧记录里重复出现的分段不会参与对齐、也就不会把顺序带偏。
  const qualified = qualifyVarietySegments(byEntry.flatMap((item) => item.added), segments ?? []);

  let cursor = 0;
  for (const { entry, review, added } of byEntry) {
    const names = qualified.slice(cursor, cursor + added.length);
    cursor += added.length;
    const shown = added.map((seg, i) => names[i] ?? seg);
    display.set(entry.id, shown.length > 0 ? shown.join(' · ') : review);
  }
  return display;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 观影时长口径（与统计页保持一致）：只计入「已看完」，剧集/综艺按 片长 × 总集数。
 * 抽出来是为了让月度总结与总览用同一把尺子 —— 原先月度总结直接写死 0。
 */
function watchedMinutes(movies: MovieMetadata[]): number {
  return movies.reduce((total, movie) => (
    movie.status === '已看完' ? total + movie.runtime * (movie.progress?.totalEpisodes || 1) : total
  ), 0);
}

async function buildDashboard(): Promise<StatsDashboard> {
  const snapshot = await loadSnapshot();
  const movies = snapshot.movies.map(toMetadata);
  const recordsByMovie = new Map<string, WatchRecord[]>();
  const diariesByMovie = new Map<string, DiaryEntry[]>();
  for (const record of snapshot.watchRecords) {
    const movie = stringField(record, 'movie');
    recordsByMovie.set(movie, [...(recordsByMovie.get(movie) || []), toWatchRecord(record)]);
  }
  for (const entry of snapshot.diaries) {
    const movie = stringField(entry, 'movie');
    diariesByMovie.set(movie, [...(diariesByMovie.get(movie) || []), toDiary(entry)]);
  }
  const typeCount: Record<string, number> = {};
  const genreCount: Record<string, number> = {};
  const countryCount: Record<string, number> = {};
  const ratingCount: Record<number, number> = { 2: 0, 4: 0, 6: 0, 8: 0, 10: 0 };
  const monthCount: Record<string, number> = {};
  let totalMinutes = 0;
  let personalTotal = 0;
  let personalCount = 0;
  for (const movie of movies) {
    typeCount[movie.mediaType] = (typeCount[movie.mediaType] || 0) + 1;
    movie.genre.forEach((genre) => { genreCount[genre] = (genreCount[genre] || 0) + 1; });
    splitCountries(movie.country).forEach((country) => { countryCount[country] = (countryCount[country] || 0) + 1; });
    for (const record of recordsByMovie.get(movie.id) || []) {
      if (record.rating > 0) { personalTotal += record.rating; personalCount++; }
      const bucket = ratingBucket(record.rating);
      if (bucket) ratingCount[bucket]++;
    }
    if (movie.status === '已看完') totalMinutes += movie.runtime * (movie.progress?.totalEpisodes || 1);
    if (movie.status !== '想看') {
      for (const month of new Set((diariesByMovie.get(movie.id) || []).map((entry) => entry.watchDate.slice(0, 7)))) {
        monthCount[month] = (monthCount[month] || 0) + 1;
      }
    }
  }
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    overview: { totalMovies: movies.length, totalHours: round(totalMinutes / 60), avgPersonalRating: personalCount ? round(personalTotal / personalCount) : null, mostWatchedGenre: Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([genre]) => genre) },
    byType: (['电影', '剧集', '综艺', '纪录片', '动画'] as const).map((type) => ({ type, count: typeCount[type] || 0 })),
    byGenre: Object.entries(genreCount).map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count),
    byCountry: Object.entries(countryCount).map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count),
    diaryRatingDist: [[2, '★ 2分'], [4, '★★ 4分'], [6, '★★★ 6分'], [8, '★★★★ 8分'], [10, '★★★★★ 10分']].map(([stars, label]) => ({ stars: Number(stars), label: String(label), count: ratingCount[Number(stars)] })),
    monthlyTrend: Object.entries(monthCount).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
  };
}

export const cloudApi = {
  library: {
    getSummary: summaries,
    getRecentWatches: async (days = 30): Promise<MovieSummary[]> => {
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
      const cutoffString = toLocalDateString(cutoff);
      return (await summaries()).filter((movie) => (movie.latestWatchDate || '') >= cutoffString).sort((a, b) => (b.latestWatchDate || '').localeCompare(a.latestWatchDate || ''));
    },
  },
  movie: {
    list: async (filters?: Record<string, unknown>): Promise<MovieSummary[]> => {
      if (typeof filters?.status === 'string' && !filters.mediaType && !filters.genre && !filters.tag && !filters.year) {
        return listMoviesByStatus(filters.status as WatchStatus);
      }
      return (await summaries()).filter((movie) => (
      (!filters?.mediaType || movie.mediaType === filters.mediaType) &&
      (!filters?.status || movie.status === filters.status) &&
      (!filters?.genre || movie.genre.includes(String(filters.genre))) &&
      (!filters?.tag || movie.tags.includes(String(filters.tag))) &&
      (!filters?.year || movie.releaseDate.startsWith(String(filters.year)))
      ));
    },
    getById: async (id: string): Promise<MovieMetadata> => toMetadata(await getMovieDetailRecord(id)),
    create: async (data: Record<string, unknown>): Promise<MovieMetadata> => {
      const userId = requireUserId();
      const current = await summaries();
      const year = String(data.releaseDate || '').slice(0, 4);
      if (current.some((movie) => movie.title === data.title && movie.releaseDate.slice(0, 4) === year)) throw new Error(`影视「${data.title}」已存在`);
      const payload = { owner: userId, ...publicFields(data) };
      const poster = posterFile(data);
      const created = await cloudWrite(() => pocketbase.collection('movies').create<CloudMovieRecord>(poster
        ? formDataWithFile(payload, 'poster', poster)
        : payload));
      invalidateSnapshot();
      scheduleCloudSync();
      movieRecordCache.set(created.id, created);
      movieDetailCache.set(created.id, created);
      updateOfflineSnapshot((snapshot) => ({ ...snapshot, movies: [...snapshot.movies, created] }));
      return toMetadata(created);
    },
    update: async (id: string, data: Record<string, unknown>): Promise<MovieMetadata> => {
      const before = await getMovieDetailRecord(id);
      const previous = toMetadata(before);
      const payload = publicFields(data);
      const poster = posterFile(data);
      // posterBase64 === null 是「显式移除海报」的信号（MovieForm 的移除按钮），
      // 与 undefined（不改动）区分开，否则移除后保存会静默保留原海报。
      const removePoster = data.posterBase64 === null;
      let updated: CloudMovieRecord;
      if (poster || removePoster) {
        updated = await cloudWrite(() => pocketbase.collection('movies').update<CloudMovieRecord>(id, formDataWithFile(payload, 'poster', poster, removePoster)));
      } else {
        updated = await cloudWrite(() => pocketbase.collection('movies').update<CloudMovieRecord>(id, payload));
      }
      const next = toMetadata(updated);
      // 影片记录已经成功写入后，不应因可选的自动日记失败而向界面返回失败。
      persistMovieUpdate(updated);
      if (previous.status !== next.status && (next.status === '在看' || next.status === '已看完')) {
        try {
          persistSystemDiary(await createSystemDiary(id, 'status', `状态变更为「${next.status}」`));
        } catch (error) {
          console.warn('[cloud] Failed to create status diary after updating movie', error);
        }
      }
      // 综艺 segments 变更 → 记录/合并 progress 日记（与本地行为一致）
      if (
        next.mediaType === '综艺' &&
        next.progress?.segments &&
        JSON.stringify(previous.progress?.segments) !== JSON.stringify(next.progress.segments)
      ) {
        try {
          await upsertVarietyProgressDiary(id, next.progress.segments, previous.progress?.segments);
        } catch (error) {
          console.warn('[cloud] Failed to create variety progress diary after updating movie', error);
        }
      }
      return next;
    },
    delete: async (id: string): Promise<void> => {
      await cloudWrite(() => pocketbase.collection('movies').delete(id));
      movieRecordCache.delete(id);
      movieDetailCache.delete(id);
      invalidateSnapshot();
      scheduleCloudSync();
      updateOfflineSnapshot((snapshot) => ({
        ...snapshot,
        movies: snapshot.movies.filter((movie) => movie.id !== id),
        diaries: snapshot.diaries.filter((entry) => stringField(entry, 'movie') !== id),
        watchRecords: snapshot.watchRecords.filter((entry) => stringField(entry, 'movie') !== id),
        screenshots: snapshot.screenshots.filter((entry) => stringField(entry, 'movie') !== id),
      }));
    },
    search: async (query: string, filters?: { year?: string; minRating?: number; maxRating?: number }): Promise<MovieSummary[]> => {
      const lower = query.toLowerCase();
      return (await summaries()).filter((movie) => {
        const matches = !lower || [movie.title, movie.titleOriginal || '', movie.releaseDate, movie.genre.join(' '), movie.tags.join(' ')].some((field) => field.toLowerCase().includes(lower));
        return matches && (!filters?.year || movie.releaseDate.startsWith(filters.year));
      }).filter((movie) => (filters?.minRating == null || (movie.personalRating != null && movie.personalRating >= filters.minRating)) && (filters?.maxRating == null || (movie.personalRating != null && movie.personalRating <= filters.maxRating)));
    },
    updateProgress: async (id: string, episode: number): Promise<MovieMetadata> => {
      const previous = await cloudApi.movie.getById(id);
      if (!previous.progress?.totalEpisodes) throw new Error('该影视不支持进度追踪');
      const value = Math.max(0, Math.min(episode, previous.progress.totalEpisodes));
      const updated = await cloudWrite(() => pocketbase.collection('movies').update<CloudMovieRecord>(id, { progress: { ...previous.progress, episode: value } }));
      // 进度是主记录，自动日记是附属记录。两者无法在浏览器侧组成服务器事务。
      persistMovieUpdate(updated);
      try {
        persistSystemDiary(await createSystemDiary(id, 'progress', `第${value}集 · 进度 ${Math.round(value / previous.progress.totalEpisodes * 100)}%`));
      } catch (error) {
        console.warn('[cloud] Failed to create progress diary after updating movie', error);
      }
      return toMetadata(updated);
    },
    addTag: async (id: string, tag: string): Promise<MovieMetadata> => { const movie = await cloudApi.movie.getById(id); return cloudApi.movie.update(id, { tags: [...new Set([...movie.tags, tag])] }); },
    removeTag: async (id: string, tag: string): Promise<MovieMetadata> => { const movie = await cloudApi.movie.getById(id); return cloudApi.movie.update(id, { tags: movie.tags.filter((item) => item !== tag) }); },
    getAllTags: async (): Promise<string[]> => [...new Set((await summaries()).flatMap((movie) => movie.tags))].sort((a, b) => a.localeCompare(b, 'zh')),
    getPosterUrl: async (id: string, thumb?: boolean): Promise<string | null> => fileUrl(await getMovieRecord(id), 'poster', thumb ? POSTER_THUMB_SIZE : undefined),
    exportExcel: exportCloudMoviesToExcel,
    listScreenshots: async (movieId: string): Promise<ScreenshotInfo[]> => (await getScreenshotsForMovie(movieId)).map((record) => ({ filename: record.id, createdAt: stringField(record, 'created') || undefined, episode: typeof record.episode === 'number' ? record.episode : undefined, hours: typeof record.hours === 'number' ? record.hours : undefined, minutes: typeof record.minutes === 'number' ? record.minutes : undefined, seconds: typeof record.seconds === 'number' ? record.seconds : undefined })),
    addScreenshot: async (movieId: string, base64: string, _ext: string): Promise<ScreenshotInfo[]> => {
      // 上传前先在本地压缩大图，减少上传体积与服务器缩略图生成时间
      const optimized = await compressScreenshotForUpload(base64);
      const [header, content = ''] = optimized.split(',', 2); const mime = header.match(/^data:([^;]+);base64$/)?.[1] || 'image/jpeg';
      const bytes = Uint8Array.from(atob(content || optimized), (char) => char.charCodeAt(0));
      const compressedExt = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
      const form = new FormData(); form.append('owner', requireUserId()); form.append('movie', movieId); form.append('image', new File([bytes], `screenshot${compressedExt}`, { type: mime }));
      const created = await cloudWrite(() => pocketbase.collection('screenshots').create<CloudRecord>(form));
      afterScreenshotUpload(movieId, created);
      return cloudApi.movie.listScreenshots(movieId);
    },
    /**
     * 文件直传（批量上传、粘贴图片走这条）：不经过 base64，内存占用从「3 份副本」
     * 降到「1 份原始 File + 1 份压缩结果」，且压缩结果只在真的更小时才使用。
     */
    addScreenshotFile: async (movieId: string, file: File): Promise<ScreenshotInfo[]> => {
      const optimized = await compressImageFileForUpload(file);
      const useOriginal = optimized.size >= file.size;
      const payload: Blob = useOriginal ? file : optimized;
      const baseName = (file.name || 'screenshot').replace(/\.[^.]+$/, '') || 'screenshot';
      const name = useOriginal ? (file.name || 'screenshot.jpg') : `${baseName}.jpg`;
      const form = new FormData();
      form.append('owner', requireUserId());
      form.append('movie', movieId);
      form.append('image', new File([payload], name, { type: payload.type || 'image/jpeg' }));
      const created = await cloudWrite(() => pocketbase.collection('screenshots').create<CloudRecord>(form));
      afterScreenshotUpload(movieId, created);
      return cloudApi.movie.listScreenshots(movieId);
    },
    deleteScreenshot: async (movieId: string, screenshotId: string): Promise<ScreenshotInfo[]> => {
      await cloudWrite(() => pocketbase.collection('screenshots').delete(screenshotId));
      invalidateSnapshot();
      scheduleCloudSync();
      screenshotRecordCache.delete(screenshotId);
      updateOfflineSnapshot((snapshot) => ({ ...snapshot, screenshots: snapshot.screenshots.filter((item) => item.id !== screenshotId) }));
      screenshotListCache.delete(movieId);
      allScreenshotsCache = null;
      return cloudApi.movie.listScreenshots(movieId);
    },
    getScreenshot: async (_movieId: string, screenshotId: string): Promise<string | null> => fileUrl(await getScreenshotRecord(screenshotId), 'image'),
    getScreenshotThumbnail: async (_movieId: string, screenshotId: string): Promise<string | null> => fileUrl(await getScreenshotRecord(screenshotId), 'image', SCREENSHOT_THUMB_SIZE),
    updateScreenshotInfo: async (movieId: string, screenshotId: string, info: { episode?: number; hours?: number; minutes?: number; seconds?: number }): Promise<ScreenshotInfo[]> => {
      const updated = await cloudWrite(() => pocketbase.collection('screenshots').update<CloudRecord>(screenshotId, info));
      invalidateSnapshot();
      scheduleCloudSync();
      screenshotRecordCache.set(screenshotId, updated);
      updateOfflineSnapshot((snapshot) => ({ ...snapshot, screenshots: snapshot.screenshots.map((item) => (item.id === screenshotId ? updated : item)) }));
      screenshotListCache.delete(movieId);
      allScreenshotsCache = null;
      return cloudApi.movie.listScreenshots(movieId);
    },
  },
  diary: {
    getByMovie: async (movieId: string): Promise<DiaryEntry[]> => {
      const entries = sortByMomentDesc((await getDiaryEntriesForMovie(movieId)).map(toDiary));
      const record = await getMovieRecord(movieId).catch(() => null);
      const mediaType = record ? stringField(record, 'mediaType') : '';
      const reviews = varietyProgressReviews(entries, mediaType, record ? progressField(record)?.segments : undefined);
      return reviews.size > 0 ? entries.map((entry) => (reviews.has(entry.id) ? { ...entry, review: reviews.get(entry.id)! } : entry)) : entries;
    },
    delete: async (_movieId: string, entryId: string): Promise<void> => {
      await cloudWrite(() => pocketbase.collection('diary_entries').delete(entryId));
      invalidateSnapshot();
      scheduleCloudSync();
      updateOfflineSnapshot((snapshot) => ({ ...snapshot, diaries: snapshot.diaries.filter((entry) => entry.id !== entryId) }));
    },
    getTimeline: async (): Promise<DiaryTimelineMonth[]> => {
      // 首次同步后的日记页直接使用完整本地快照；断网不会卡在远程请求超时。
      const { movies, diaries } = await loadSnapshot();
      const byId = new Map(movies.map((record) => [record.id, toMetadata(record)]));
      const all = diaries.map((entry) => ({ entry: toDiary(entry), movie: byId.get(stringField(entry, 'movie')) })).filter((item): item is { entry: DiaryEntry; movie: MovieMetadata } => Boolean(item.movie && (item.movie.status === '已看完' || item.movie.progress)));

      // 综艺进度日记只显示「最新添加」的期数，而非历史全部期数（对既有累积记录同样生效）。
      const displayReviewByEntry = new Map<string, string>();
      {
        const byMovie = new Map<string, { movie: MovieMetadata; entries: DiaryEntry[] }>();
        for (const { entry, movie } of all) {
          const group = byMovie.get(movie.id) || { movie, entries: [] };
          group.entries.push(entry);
          byMovie.set(movie.id, group);
        }
        for (const { movie, entries } of byMovie.values()) {
          const reviews = varietyProgressReviews(entries, movie.mediaType, movie.progress?.segments);
          for (const [id, review] of reviews) displayReviewByEntry.set(id, review);
        }
      }

      const months = new Map<string, Map<string, { date: string; weekday: string; items: Array<DiaryEntry & { movieId: string; movieTitle: string; movieThumbPath?: string }> }>>();
      for (const { entry, movie } of all) { const month = entry.watchDate.slice(0, 7); const days = months.get(month) || new Map(); const parsedDate = parseLocalDate(entry.watchDate); const day = days.get(entry.watchDate) || { date: entry.watchDate, weekday: parsedDate ? WEEKDAYS[parsedDate.getDay()] : '', items: [] }; const displayEntry = displayReviewByEntry.has(entry.id) ? { ...entry, review: displayReviewByEntry.get(entry.id) } : entry; day.items.push({ ...displayEntry, movieId: movie.id, movieTitle: movie.title, movieThumbPath: movie.posterThumbPath }); days.set(entry.watchDate, day); months.set(month, days); }
      return [...months.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([month, days]) => ({ month, days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)).map((day) => ({ ...day, items: sortByMomentDesc(day.items) })) }));
    },
  },
  watchRecord: {
    getByMovie: async (movieId: string): Promise<WatchRecord[]> => sortByMomentDesc((await getWatchRecordsForMovie(movieId)).map(toWatchRecord)),
    add: async (movieId: string, data: Record<string, unknown>): Promise<WatchRecord> => {
      const record = await cloudWrite(() => pocketbase.collection('watch_records').create<CloudRecord>({ owner: requireUserId(), movie: movieId, watchDate: data.watchDate, watchTime: data.watchTime || getLocalTimeStr(), rating: data.rating || 0, review: data.review || '' }));
      invalidateSnapshot();
      scheduleCloudSync();
      updateOfflineSnapshot((snapshot) => ({ ...snapshot, watchRecords: [...snapshot.watchRecords, record] }));
      return toWatchRecord(record);
    },
    update: async (_movieId: string, entryId: string, data: Record<string, unknown>): Promise<WatchRecord> => {
      const record = await cloudWrite(() => pocketbase.collection('watch_records').update<CloudRecord>(entryId, data));
      invalidateSnapshot();
      scheduleCloudSync();
      updateOfflineSnapshot((snapshot) => ({ ...snapshot, watchRecords: snapshot.watchRecords.map((entry) => (entry.id === entryId ? record : entry)) }));
      return toWatchRecord(record);
    },
    delete: async (_movieId: string, entryId: string): Promise<void> => {
      await cloudWrite(() => pocketbase.collection('watch_records').delete(entryId));
      invalidateSnapshot();
      scheduleCloudSync();
      updateOfflineSnapshot((snapshot) => ({ ...snapshot, watchRecords: snapshot.watchRecords.filter((entry) => entry.id !== entryId) }));
    },
  },
  watchlist: {
    list: async (): Promise<MovieSummary[]> => listMoviesByStatus('想看'),
    markAsWatching: async (movieId: string): Promise<void> => { await cloudApi.movie.update(movieId, { status: '在看' }); },
    markAsWatched: async (movieId: string, entryData: Record<string, unknown>): Promise<void> => { const movie = await cloudApi.movie.getById(movieId); const progress = movie.progress ? { ...movie.progress, episode: movie.progress.totalEpisodes } : null; await cloudApi.movie.update(movieId, { status: '已看完', ...(progress ? { progress } : {}) }); if (Number(entryData.rating || 0) > 0 || String(entryData.review || '').trim()) await cloudApi.watchRecord.add(movieId, entryData); },
  },
  stats: {
    dashboard: buildDashboard,
    overview: async (): Promise<StatsOverview> => (await buildDashboard()).overview,
    byMediaType: async (): Promise<StatsByType[]> => (await buildDashboard()).byType,
    byYear: async (): Promise<StatsByYear[]> => { const movies = (await loadSnapshot()).movies.map(toMetadata).filter((movie) => movie.status === '已看完'); const map = new Map<string, { count: number; sum: number }>(); movies.forEach((movie) => { const year = movie.releaseDate.slice(0, 4); const v = map.get(year) || { count: 0, sum: 0 }; v.count++; v.sum += movie.rating; map.set(year, v); }); return [...map.entries()].map(([year, v]) => ({ year, count: v.count, avgRating: Math.round(v.sum / v.count * 10) / 10 })).sort((a, b) => b.year.localeCompare(a.year)); },
    byGenre: async (): Promise<StatsByGenre[]> => (await buildDashboard()).byGenre,
    byRating: async (): Promise<StatsByRating[]> => { const count: Record<number, number> = {}; (await loadSnapshot()).movies.map(toMetadata).filter((movie) => movie.status === '已看完').forEach((movie) => { const rating = Math.round(movie.rating); count[rating] = (count[rating] || 0) + 1; }); return Object.entries(count).map(([rating, value]) => ({ rating: Number(rating), count: value })).sort((a, b) => a.rating - b.rating); },
    byCountry: async (): Promise<StatsByCountry[]> => (await buildDashboard()).byCountry,
    diaryRatingDist: async () => (await buildDashboard()).diaryRatingDist,
    monthlyTrend: async (): Promise<StatsMonthlyTrend[]> => (await buildDashboard()).monthlyTrend,
    monthSummary: async (year: number, month: number): Promise<MonthSummary> => {
      const monthText = `${year}-${String(month).padStart(2, '0')}`;
      const [dashboard, movies, snapshot] = await Promise.all([buildDashboard(), summaries(), loadSnapshot()]);
      const inMonth = movies.filter((movie) => (movie.latestWatchDate || '').startsWith(monthText));
      // 时长的口径与总览一致（只算「已看完」，剧集按 片长 × 总集数）：
      // MonthSummary 里只有轻量摘要，拿不到 runtime，所以回到快照取完整记录。
      const monthIds = new Set(inMonth.map((movie) => movie.id));
      const minutes = watchedMinutes(snapshot.movies.map(toMetadata).filter((movie) => monthIds.has(movie.id)));
      return {
        year,
        month,
        totalMovies: inMonth.length,
        totalHours: Math.round((minutes / 60) * 10) / 10,
        avgRating: dashboard.overview.avgPersonalRating,
        topGenres: dashboard.overview.mostWatchedGenre,
        movies: inMonth,
        diaryEntries: snapshot.diaries.map(toDiary).filter((entry) => entry.watchDate.startsWith(monthText)),
      };
    },
    diaryCalendar: async (days: number): Promise<DiaryCalendarEntry[]> => { const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days); const cutoffText = toLocalDateString(cutoff); const map = new Map<string, Set<string>>(); for (const entry of (await loadSnapshot()).diaries) { const date = stringField(entry, 'watchDate'); if (date >= cutoffText) { const movies = map.get(date) || new Set<string>(); movies.add(stringField(entry, 'movie')); map.set(date, movies); } } return [...map.entries()].map(([date, movies]) => ({ date, count: movies.size })); },
  },
};


