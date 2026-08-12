import type { RecordModel } from 'pocketbase';
import type {
  DiaryCalendarEntry, DiaryEntry, DiaryTimelineMonth, LibraryInfo, MonthSummary,
  MovieMetadata, MovieSummary, Progress, ScreenshotInfo, StatsByCountry, StatsByGenre,
  StatsByRating, StatsByType, StatsByYear, StatsDashboard, StatsMonthlyTrend,
  StatsOverview, WatchRecord, WatchStatus,
} from '@shared/types/index';
import { getLocalDateStr, getLocalTimeStr, parseLocalDate } from '@shared/utils/date';
import { getCloudUser, pocketbase } from './pocketbase';
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

export interface LocalMigrationResult {
  cancelled: boolean;
  importedMovies: number;
  skippedMovies: number;
  importedDiaries: number;
  importedWatchRecords: number;
  importedScreenshots: number;
}

const SNAPSHOT_TTL_MS = 60_000;
const FILE_TOKEN_TTL_MS = 4 * 60_000;
const SCREENSHOT_CACHE_TTL_MS = 60_000;
const POSTER_THUMB_SIZE = '300x450';
const SCREENSHOT_THUMB_SIZE = '500x281';
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
let cloudSyncQueued = false;
let cloudSyncRunning = false;
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

function invalidateSnapshot(): void {
  snapshotCache = null;
  snapshotRequest = null;
  movieListCache = null;
  movieListRequest = null;
  snapshotGeneration++;
}

/**
 * 写入云端后异步落盘一份最新完整快照。先等待可能正在进行的旧读取结束，
 * 再按新的 generation 重拉，避免旧请求覆盖刚刚编辑的本地离线数据。
 */
function scheduleCloudSync(): void {
  cloudSyncQueued = true;
  if (cloudSyncRunning) return;
  cloudSyncRunning = true;
  void (async () => {
    while (cloudSyncQueued) {
      cloudSyncQueued = false;
      const pending = snapshotRequest;
      if (pending) await pending.catch(() => {});
      const ownerId = getCloudUser()?.id;
      if (ownerId) await fetchRemoteSnapshot(ownerId).catch(() => {});
    }
    cloudSyncRunning = false;
  })();
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
  cloudSyncQueued = false;
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
  return {
    episode: raw.episode,
    totalEpisodes: raw.totalEpisodes,
    ...(Array.isArray(raw.segments) ? { segments: raw.segments.filter((item): item is string => typeof item === 'string') } : {}),
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

function formDataWithFile(payload: Record<string, unknown>, field: string, file: File): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  form.append(field, file);
  return form;
}

async function createSystemDiary(movieId: string, kind: 'progress' | 'status', review: string, watchDate = getLocalDateStr()): Promise<CloudDiaryRecord> {
  return pocketbase.collection('diary_entries').create<CloudDiaryRecord>({
    owner: requireUserId(), movie: movieId, watchDate, watchTime: getLocalTimeStr(), rating: -1, kind, review,
  });
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
      const localUrl = URL.createObjectURL(localBlob);
      mediaObjectUrls.set(`${ownerId}:${mediaKey}`, localUrl);
      return localUrl;
    }
    // 截图原图按需保存，以控制本地空间；离线查看灯箱时仍优先给出已同步的缩略图。
    if (field === 'image' && !thumb) {
      const thumbnailKey = `${record.collectionName || 'screenshots'}:${record.id}:${filename}:${SCREENSHOT_THUMB_SIZE}`;
      const thumbnailBlob = await getOfflineMedia(ownerId, thumbnailKey).catch(() => null);
      if (thumbnailBlob) {
        const localUrl = URL.createObjectURL(thumbnailBlob);
        mediaObjectUrls.set(`${ownerId}:${mediaKey}`, localUrl);
        return localUrl;
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
 * 首次完整同步后预热所有用于界面展示的缩略图。原始截图继续按需下载，避免大型
 * 截图库占满 IndexedDB；断网打开灯箱时会自动使用这里的缩略图兜底。
 */
function warmMediaThumbnails(snapshot: Snapshot, ownerId: string): void {
  if (mediaWarmRequest && mediaWarmOwnerId === ownerId) return;
  const jobs: Array<{ record: CloudRecord; field: 'poster' | 'image'; thumb: string }> = [
    ...snapshot.movies.filter((record) => Boolean(stringField(record, 'poster'))).map((record) => ({ record, field: 'poster' as const, thumb: POSTER_THUMB_SIZE })),
    ...snapshot.screenshots.filter((record) => Boolean(stringField(record, 'image'))).map((record) => ({ record, field: 'image' as const, thumb: SCREENSHOT_THUMB_SIZE })),
  ];
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
      episode: typeof record.episode === 'number' ? record.episode : undefined,
      hours: typeof record.hours === 'number' ? record.hours : undefined,
      minutes: typeof record.minutes === 'number' ? record.minutes : undefined,
      seconds: typeof record.seconds === 'number' ? record.seconds : undefined,
    });
    grouped.set(movieId, items);
  }
  return grouped;
}

/** 应用登录后调用：预先恢复本地快照，并让云端同步在后台运行。 */
export async function hydrateOfflineCloudCache(): Promise<void> {
  const ownerId = getCloudUser()?.id;
  if (!ownerId) return;
  void requestPersistentOfflineStorage();
  await restoreOfflineSnapshot(ownerId);
  void fetchRemoteSnapshot(ownerId).catch(() => {});
}

function splitCountries(country: string): string[] {
  return [...new Set(country.split(/[、，,／/]/).map((item) => item.trim()).filter(Boolean))];
}

function ratingBucket(rating: number): number | null {
  if (rating <= 0) return null;
  return Math.max(2, Math.min(10, Math.round(rating <= 5 ? rating * 2 : rating / 2) * 2));
}

function sortByMomentDesc<T extends { watchDate: string; watchTime?: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => `${b.watchDate}${b.watchTime || ''}`.localeCompare(`${a.watchDate}${a.watchTime || ''}`));
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
    overview: { totalMovies: movies.length, totalHours: round(totalMinutes / 60), avgPersonalRating: personalCount ? round(personalTotal / personalCount) : 0, mostWatchedGenre: Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([genre]) => genre) },
    byType: (['电影', '剧集', '综艺', '纪录片', '动画'] as const).map((type) => ({ type, count: typeCount[type] || 0 })),
    byGenre: Object.entries(genreCount).map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count),
    byCountry: Object.entries(countryCount).map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count),
    diaryRatingDist: [[2, '★ 2分'], [4, '★★ 4分'], [6, '★★★ 6分'], [8, '★★★★ 8分'], [10, '★★★★★ 10分']].map(([stars, label]) => ({ stars: Number(stars), label: String(label), count: ratingCount[Number(stars)] })),
    monthlyTrend: Object.entries(monthCount).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
  };
}

export const cloudApi = {
  library: {
    open: async (): Promise<LibraryInfo | null> => cloudApi.library.getInfo(),
    reopen: async (): Promise<LibraryInfo | null> => cloudApi.library.getInfo(),
    create: async (): Promise<LibraryInfo | null> => cloudApi.library.getInfo(),
    getPath: async (): Promise<string | null> => 'PocketBase 云端（pb.astara.space）',
    getInfo: async (): Promise<LibraryInfo | null> => {
      const user = getCloudUser();
      if (!user) return null;
      const movies = await summaries();
      return { name: user.displayName || user.email, version: 1, createdAt: '', movieCount: movies.length };
    },
    getSummary: summaries,
    getRecentWatches: async (days = 30): Promise<MovieSummary[]> => {
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
      const cutoffString = toLocalDateString(cutoff);
      return (await summaries()).filter((movie) => (movie.latestWatchDate || '') >= cutoffString).sort((a, b) => (b.latestWatchDate || '').localeCompare(a.latestWatchDate || ''));
    },
    createBackup: async () => null,
    isLoaded: async () => Boolean(getCloudUser()),
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
      const created = await pocketbase.collection('movies').create<CloudMovieRecord>(poster
        ? formDataWithFile(payload, 'poster', poster)
        : payload);
      invalidateSnapshot();
      scheduleCloudSync();
      movieRecordCache.set(created.id, created);
      movieDetailCache.set(created.id, created);
      updateOfflineSnapshot((snapshot) => ({ ...snapshot, movies: [...snapshot.movies, created] }));
      return toMetadata(created);
    },
    update: async (id: string, data: Record<string, unknown>): Promise<MovieMetadata> => {
      const before = await pocketbase.collection('movies').getOne<CloudMovieRecord>(id);
      const previous = toMetadata(before);
      const payload = publicFields(data);
      const poster = posterFile(data);
      let updated: CloudMovieRecord;
      if (poster) {
        updated = await pocketbase.collection('movies').update<CloudMovieRecord>(id, formDataWithFile(payload, 'poster', poster));
      } else {
        updated = await pocketbase.collection('movies').update<CloudMovieRecord>(id, payload);
      }
      const next = toMetadata(updated);
      let systemDiary: CloudDiaryRecord | null = null;
      if (previous.status !== next.status && (next.status === '在看' || next.status === '已看完')) systemDiary = await createSystemDiary(id, 'status', `状态变更为「${next.status}」`);
      invalidateSnapshot();
      scheduleCloudSync();
      movieRecordCache.set(id, updated);
      movieDetailCache.set(id, updated);
      updateOfflineSnapshot((snapshot) => ({
        ...snapshot,
        movies: snapshot.movies.map((movie) => (movie.id === id ? updated : movie)),
        ...(systemDiary ? { diaries: [...snapshot.diaries, systemDiary] } : {}),
      }));
      return next;
    },
    delete: async (id: string): Promise<void> => {
      await pocketbase.collection('movies').delete(id);
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
      const updated = await pocketbase.collection('movies').update<CloudMovieRecord>(id, { progress: { ...previous.progress, episode: value } });
      const systemDiary = await createSystemDiary(id, 'progress', `第${value}集 · 进度 ${Math.round(value / previous.progress.totalEpisodes * 100)}%`);
      invalidateSnapshot();
      scheduleCloudSync();
      updateOfflineSnapshot((snapshot) => ({
        ...snapshot,
        movies: snapshot.movies.map((movie) => (movie.id === id ? updated : movie)),
        diaries: [...snapshot.diaries, systemDiary],
      }));
      return toMetadata(updated);
    },
    addTag: async (id: string, tag: string): Promise<MovieMetadata> => { const movie = await cloudApi.movie.getById(id); return cloudApi.movie.update(id, { tags: [...new Set([...movie.tags, tag])] }); },
    removeTag: async (id: string, tag: string): Promise<MovieMetadata> => { const movie = await cloudApi.movie.getById(id); return cloudApi.movie.update(id, { tags: movie.tags.filter((item) => item !== tag) }); },
    getAllTags: async (): Promise<string[]> => [...new Set((await summaries()).flatMap((movie) => movie.tags))].sort((a, b) => a.localeCompare(b, 'zh')),
    getPosterUrl: async (id: string, thumb?: boolean): Promise<string | null> => fileUrl(await getMovieRecord(id), 'poster', thumb ? POSTER_THUMB_SIZE : undefined),
    exportExcel: async () => { throw new Error('云端数据导出将在下一版提供；当前服务器已执行每日备份。'); },
    listScreenshots: async (movieId: string): Promise<ScreenshotInfo[]> => (await getScreenshotsForMovie(movieId)).map((record) => ({ filename: record.id, episode: typeof record.episode === 'number' ? record.episode : undefined, hours: typeof record.hours === 'number' ? record.hours : undefined, minutes: typeof record.minutes === 'number' ? record.minutes : undefined, seconds: typeof record.seconds === 'number' ? record.seconds : undefined })),
    addScreenshot: async (movieId: string, base64: string, ext: string): Promise<ScreenshotInfo[]> => {
      const [header, content = ''] = base64.split(',', 2); const mime = header.match(/^data:([^;]+);base64$/)?.[1] || 'image/jpeg';
      const bytes = Uint8Array.from(atob(content || base64), (char) => char.charCodeAt(0));
      const form = new FormData(); form.append('owner', requireUserId()); form.append('movie', movieId); form.append('image', new File([bytes], `screenshot${ext.startsWith('.') ? ext : `.${ext}`}`, { type: mime }));
      const created = await pocketbase.collection('screenshots').create<CloudRecord>(form);
      invalidateSnapshot();
      scheduleCloudSync();
      screenshotRecordCache.set(created.id, created);
      updateOfflineSnapshot((snapshot) => ({ ...snapshot, screenshots: [...snapshot.screenshots, created] }));
      screenshotListCache.delete(movieId);
      allScreenshotsCache = null;
      return cloudApi.movie.listScreenshots(movieId);
    },
    deleteScreenshot: async (movieId: string, screenshotId: string): Promise<ScreenshotInfo[]> => {
      await pocketbase.collection('screenshots').delete(screenshotId);
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
      const updated = await pocketbase.collection('screenshots').update<CloudRecord>(screenshotId, info);
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
    getByMovie: async (movieId: string): Promise<DiaryEntry[]> => sortByMomentDesc((await getDiaryEntriesForMovie(movieId)).map(toDiary)),
    delete: async (_movieId: string, entryId: string): Promise<void> => {
      await pocketbase.collection('diary_entries').delete(entryId);
      invalidateSnapshot();
      scheduleCloudSync();
      updateOfflineSnapshot((snapshot) => ({ ...snapshot, diaries: snapshot.diaries.filter((entry) => entry.id !== entryId) }));
    },
    getTimeline: async (): Promise<DiaryTimelineMonth[]> => {
      // 首次同步后的日记页直接使用完整本地快照；断网不会卡在远程请求超时。
      const { movies, diaries } = await loadSnapshot();
      const byId = new Map(movies.map((record) => [record.id, toMetadata(record)]));
      const all = diaries.map((entry) => ({ entry: toDiary(entry), movie: byId.get(stringField(entry, 'movie')) })).filter((item): item is { entry: DiaryEntry; movie: MovieMetadata } => Boolean(item.movie && (item.movie.status === '已看完' || item.movie.progress)));
      const months = new Map<string, Map<string, { date: string; weekday: string; items: Array<DiaryEntry & { movieId: string; movieTitle: string; movieThumbPath?: string }> }>>();
      for (const { entry, movie } of all) { const month = entry.watchDate.slice(0, 7); const days = months.get(month) || new Map(); const day = days.get(entry.watchDate) || { date: entry.watchDate, weekday: ['周日','周一','周二','周三','周四','周五','周六'][parseLocalDate(entry.watchDate).getDay()], items: [] }; day.items.push({ ...entry, movieId: movie.id, movieTitle: movie.title, movieThumbPath: movie.posterThumbPath }); days.set(entry.watchDate, day); months.set(month, days); }
      return [...months.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([month, days]) => ({ month, days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)).map((day) => ({ ...day, items: sortByMomentDesc(day.items) })) }));
    },
  },
  watchRecord: {
    getByMovie: async (movieId: string): Promise<WatchRecord[]> => sortByMomentDesc((await getWatchRecordsForMovie(movieId)).map(toWatchRecord)),
    add: async (movieId: string, data: Record<string, unknown>): Promise<WatchRecord> => {
      const record = await pocketbase.collection('watch_records').create<CloudRecord>({ owner: requireUserId(), movie: movieId, watchDate: data.watchDate, watchTime: data.watchTime || getLocalTimeStr(), rating: data.rating || 0, review: data.review || '' });
      invalidateSnapshot();
      scheduleCloudSync();
      updateOfflineSnapshot((snapshot) => ({ ...snapshot, watchRecords: [...snapshot.watchRecords, record] }));
      return toWatchRecord(record);
    },
    update: async (_movieId: string, entryId: string, data: Record<string, unknown>): Promise<WatchRecord> => {
      const record = await pocketbase.collection('watch_records').update<CloudRecord>(entryId, data);
      invalidateSnapshot();
      scheduleCloudSync();
      updateOfflineSnapshot((snapshot) => ({ ...snapshot, watchRecords: snapshot.watchRecords.map((entry) => (entry.id === entryId ? record : entry)) }));
      return toWatchRecord(record);
    },
    delete: async (_movieId: string, entryId: string): Promise<void> => {
      await pocketbase.collection('watch_records').delete(entryId);
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
    monthSummary: async (year: number, month: number): Promise<MonthSummary> => { const monthText = `${year}-${String(month).padStart(2, '0')}`; const dashboard = await buildDashboard(); const movies = (await summaries()).filter((movie) => (movie.latestWatchDate || '').startsWith(monthText)); return { year, month, totalMovies: movies.length, totalHours: 0, avgRating: dashboard.overview.avgPersonalRating, topGenres: dashboard.overview.mostWatchedGenre, movies, diaryEntries: (await loadSnapshot()).diaries.map(toDiary).filter((entry) => entry.watchDate.startsWith(monthText)) }; },
    diaryCalendar: async (days: number): Promise<DiaryCalendarEntry[]> => { const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days); const cutoffText = toLocalDateString(cutoff); const map = new Map<string, Set<string>>(); for (const entry of (await loadSnapshot()).diaries) { const date = stringField(entry, 'watchDate'); if (date >= cutoffText) { const movies = map.get(date) || new Set<string>(); movies.add(stringField(entry, 'movie')); map.set(date, movies); } } return [...map.entries()].map(([date, movies]) => ({ date, count: movies.size })); },
  },
};

/**
 * 从用户选择的旧 .pianke 资源库复制数据到当前账号。读取始终通过 Electron IPC
 * 完成，原始 JSON 与图片文件不会删除或改写。
 */
export async function migrateLocalLibraryToCloud(): Promise<LocalMigrationResult> {
  const localApi = window.electronAPI;
  const info = await localApi.library.open();
  const empty: LocalMigrationResult = { cancelled: !info, importedMovies: 0, skippedMovies: 0, importedDiaries: 0, importedWatchRecords: 0, importedScreenshots: 0 };
  if (!info) return empty;

  const existing = new Set((await summaries()).map((movie) => `${movie.title}\u0000${movie.releaseDate.slice(0, 4)}`));
  const result = { ...empty, cancelled: false };
  const localMovies = await localApi.movie.list();
  for (const summary of localMovies) {
    const movie = await localApi.movie.getById(summary.id);
    const key = `${movie.title}\u0000${movie.releaseDate.slice(0, 4)}`;
    if (existing.has(key)) { result.skippedMovies++; continue; }

    const posterBase64 = movie.posterPath ? await localApi.movie.getPosterUrl(movie.id) : null;
    const mime = posterBase64?.match(/^data:([^;]+);/)?.[1] || '';
    const posterExt = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
    const created = await cloudApi.movie.create({ ...movie, posterBase64: posterBase64 || undefined, posterExt });
    existing.add(key);
    result.importedMovies++;

    const [diaries, records, screenshots] = await Promise.all([
      localApi.diary.getByMovie(movie.id),
      localApi.watchRecord.getByMovie(movie.id),
      localApi.movie.listScreenshots(movie.id),
    ]);
    await Promise.all(diaries.map(async (entry) => {
      await pocketbase.collection('diary_entries').create({ owner: requireUserId(), movie: created.id, watchDate: entry.watchDate, watchTime: entry.watchTime || '', rating: -1, kind: entry.kind, review: entry.review || '' });
      result.importedDiaries++;
    }));
    await Promise.all(records.map(async (entry) => {
      await cloudApi.watchRecord.add(created.id, { watchDate: entry.watchDate, watchTime: entry.watchTime, rating: entry.rating, review: entry.review || '' });
      result.importedWatchRecords++;
    }));
    for (const screenshot of screenshots) {
      const image = await localApi.movie.getScreenshot(movie.id, screenshot.filename);
      if (!image) continue;
      await cloudApi.movie.addScreenshot(created.id, image, '.png');
      result.importedScreenshots++;
    }
  }
  invalidateSnapshot();
  return result;
}
