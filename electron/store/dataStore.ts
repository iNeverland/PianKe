// 内存数据存储：缓存当前库的所有影视和日记数据
// 避免频繁读取磁盘，提升查询性能

import type { LibraryInfo, MovieMetadata, DiaryEntry, WatchRecord } from '../../shared/types/index.js';

class DataStore {
  private libraryInfo: LibraryInfo | null = null;
  private movies: Map<string, MovieMetadata> = new Map();
  private diaries: Map<string, DiaryEntry[]> = new Map();
  private watchRecords: Map<string, WatchRecord[]> = new Map();
  private _loaded = false;

  // 海报 base64 缓存（LRU，同时限制条数和估算内存占用）。
  private posterCache: Map<string, string> = new Map();
  private static readonly POSTER_CACHE_MAX = 200;
  private static readonly POSTER_CACHE_MAX_BYTES = 24 * 1024 * 1024;
  private posterCacheBytes = 0;

  // ---- 加载状态 ----
  get loaded(): boolean { return this._loaded; }
  setLoaded(): void { this._loaded = true; }

  // ---- 库信息 ----

  setLibraryInfo(info: LibraryInfo): void {
    this.libraryInfo = info;
  }

  getLibraryInfo(): LibraryInfo | null {
    return this.libraryInfo;
  }

  // ---- 影视数据 ----

  setMovie(id: string, metadata: MovieMetadata): void {
    this.movies.set(id, metadata);
  }

  getMovie(id: string): MovieMetadata | undefined {
    return this.movies.get(id);
  }

  removeMovie(id: string): void {
    this.movies.delete(id);
    this.diaries.delete(id);
    this.watchRecords.delete(id);
    this.invalidatePoster(id);
  }

  getAllMovies(): MovieMetadata[] {
    return Array.from(this.movies.values());
  }

  // ---- 日记数据 ----

  setDiary(movieId: string, entries: DiaryEntry[]): void {
    this.diaries.set(movieId, entries);
  }

  getDiary(movieId: string): DiaryEntry[] {
    return this.diaries.get(movieId) || [];
  }

  getAllDiaries(): Map<string, DiaryEntry[]> {
    return this.diaries;
  }

  // ---- 手动追剧记录数据 ----

  setWatchRecords(movieId: string, entries: WatchRecord[]): void {
    this.watchRecords.set(movieId, entries);
  }

  getWatchRecords(movieId: string): WatchRecord[] {
    return this.watchRecords.get(movieId) || [];
  }

  getAllWatchRecords(): Map<string, WatchRecord[]> {
    return this.watchRecords;
  }

  // ---- 统计 ----

  updateMovieCount(): void {
    if (this.libraryInfo) {
      this.libraryInfo.movieCount = this.movies.size;
    }
  }

  // ---- 海报缓存 ----

  getPoster(key: string): string | undefined {
    const val = this.posterCache.get(key);
    if (val !== undefined) {
      // LRU：移到末尾
      this.posterCache.delete(key);
      this.posterCache.set(key, val);
    }
    return val;
  }

  setPoster(key: string, base64: string): void {
    const previous = this.posterCache.get(key);
    if (previous !== undefined) {
      this.posterCache.delete(key);
      this.posterCacheBytes -= this.posterSize(previous);
    }
    const incomingBytes = this.posterSize(base64);
    while (this.posterCache.size >= DataStore.POSTER_CACHE_MAX || this.posterCacheBytes + incomingBytes > DataStore.POSTER_CACHE_MAX_BYTES) {
      // 淘汰最旧的条目
      const first = this.posterCache.entries().next().value as [string, string] | undefined;
      if (!first) break;
      this.posterCache.delete(first[0]);
      this.posterCacheBytes -= this.posterSize(first[1]);
    }
    this.posterCache.set(key, base64);
    this.posterCacheBytes += incomingBytes;
  }

  invalidatePoster(movieId: string): void {
    for (const key of this.posterCache.keys()) {
      if (key.startsWith(movieId)) {
        const value = this.posterCache.get(key);
        this.posterCache.delete(key);
        if (value !== undefined) this.posterCacheBytes -= this.posterSize(value);
      }
    }
  }

  // ---- 清空 ----

  clear(): void {
    this.libraryInfo = null;
    this.movies.clear();
    this.diaries.clear();
    this.watchRecords.clear();
    this.posterCache.clear();
    this.posterCacheBytes = 0;
    this._loaded = false;
  }

  private posterSize(value: string): number {
    // JavaScript strings generally use two bytes per code unit; this is a
    // conservative cap that does not require decoding every base64 payload.
    return value.length * 2;
  }
}

export const dataStore = new DataStore();
