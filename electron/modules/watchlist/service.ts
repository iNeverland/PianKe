import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { dataStore } from '../../store/dataStore.js';
import { getMovieDir, getMovieFolderName, getDiaryPath, getWatchRecordsPath, getMetadataPath } from '../../utils/paths.js';
import { writeQueue } from '../../utils/writeQueue.js';
import { writeJsonAtomicSync } from '../../utils/atomicWrite.js';
import { AppError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';
import type { MovieSummary, DiaryEntry, WatchRecord } from '../../../shared/types/index.js';
import { getLocalDateStr, getLocalTimeStr } from '../../../shared/utils/date.js';

/** 从手动追剧记录中计算某部影视的平均个人评分，无评分返回 null */
function getPersonalRating(movieId: string): number | null {
  const entries = dataStore.getWatchRecords(movieId);
  if (!entries || entries.length === 0) return null;
  const rated = entries.filter(e => e.rating > 0);
  if (rated.length === 0) return null;
  return Math.round(rated.reduce((sum, e) => sum + e.rating, 0) / rated.length * 10) / 10;
}

function ensureMovieDir(movieId: string): string {
  const movie = dataStore.getMovie(movieId);
  if (!movie) throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
  const movieDir = getMovieDir(getMovieFolderName(movie.title, movie.releaseDate));
  if (!fs.existsSync(movieDir)) fs.mkdirSync(movieDir, { recursive: true });
  return movieDir;
}

// 获取想看清单
export function getWatchlist(): MovieSummary[] {
  return dataStore.getAllMovies()
    .filter((m) => m.status === '想看')
    .map((m) => ({
      id: m.id,
      title: m.title,
      titleOriginal: m.titleOriginal,
      mediaType: m.mediaType,
      rating: m.rating,
      personalRating: getPersonalRating(m.id),
      posterThumbPath: m.posterThumbPath,
      releaseDate: m.releaseDate,
      genre: m.genre,
      tags: m.tags,
      status: m.status,
      progress: m.progress,
    }));
}

// 标记追剧中
export async function markAsWatching(movieId: string): Promise<void> {
  const movieDir = ensureMovieDir(movieId);
  const metadataPath = getMetadataPath(movieDir);

  // 在写队列内读取最新影片状态、修改并原子落盘，避免并发覆盖。
  await writeQueue.enqueue(metadataPath, async () => {
    const current = dataStore.getMovie(movieId);
    if (!current) throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
    const updatedMovie = { ...current, status: '在看' as const };
    writeJsonAtomicSync(metadataPath, updatedMovie);
    dataStore.setMovie(movieId, updatedMovie);
  });

  // 状态变更是系统事件，不与用户当天的手动日记互相覆盖。
  const today = getLocalDateStr();
  const diaryPath = getDiaryPath(movieDir);
  await writeQueue.enqueue(diaryPath, async () => {
    const entries = dataStore.getDiary(movieId);
    const review = '状态变更为「追剧中」';
    if (!entries.some(e => e.watchDate === today && e.kind === 'status' && e.review === review)) {
      const watchTime = getLocalTimeStr();
      const next: DiaryEntry[] = [...entries, { id: uuidv4(), watchDate: today, watchTime, rating: -1, review, images: [], kind: 'status' }];
      writeJsonAtomicSync(diaryPath, next);
      dataStore.setDiary(movieId, next);
    }
  });
}

// 标记已看完（原子操作：更新状态 + 自动日记 + 可选手动追剧记录）
export async function markAsWatched(
  movieId: string,
  entryData: { watchDate: string; rating: number; review?: string }
): Promise<void> {
  const movieDir = ensureMovieDir(movieId);
  const metadataPath = getMetadataPath(movieDir);
  const diaryPath = getDiaryPath(movieDir);
  const watchRecordsPath = getWatchRecordsPath(movieDir);

  await writeQueue.enqueue(metadataPath, async () => {
    const current = dataStore.getMovie(movieId);
    if (!current) throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
    const updatedMovie = { ...current, status: '已看完' as const };

    // 状态变为已看完 → 自动将进度设为100%
    if (updatedMovie.progress?.totalEpisodes) {
      updatedMovie.progress = {
        ...updatedMovie.progress,
        episode: updatedMovie.progress.totalEpisodes,
      };
    }

    writeJsonAtomicSync(metadataPath, updatedMovie);
    dataStore.setMovie(movieId, updatedMovie);
  });

  // 状态变更始终写入自动日记。
  const watchTime = getLocalTimeStr();
  const hasManualContent = entryData.rating > 0 || Boolean(entryData.review?.trim());
  const statusEntry: DiaryEntry = {
    id: uuidv4(),
    watchDate: entryData.watchDate,
    watchTime,
    rating: -1,
    review: '状态变更为「已看完」',
    images: [],
    kind: 'status',
  };

  await writeQueue.enqueue(diaryPath, async () => {
    const entries = dataStore.getDiary(movieId);
    const next = [...entries, statusEntry];
    writeJsonAtomicSync(diaryPath, next);
    dataStore.setDiary(movieId, next);
  });

  // 用户主动填写的评分/短评单独保存为手动追剧记录。
  if (hasManualContent) {
    const watchRecord: WatchRecord = {
      id: uuidv4(),
      watchDate: entryData.watchDate,
      watchTime,
      rating: entryData.rating,
      review: entryData.review,
    };
    await writeQueue.enqueue(watchRecordsPath, async () => {
      const records = [...dataStore.getWatchRecords(movieId), watchRecord];
      writeJsonAtomicSync(watchRecordsPath, records);
      dataStore.setWatchRecords(movieId, records);
    });
  }
}
