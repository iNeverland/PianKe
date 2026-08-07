import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { dataStore } from '../../store/dataStore.js';
import { getMovieDir, getMovieFolderName, getDiaryPath, getWatchRecordsPath, getMetadataPath } from '../../utils/paths.js';
import { writeQueue } from '../../utils/writeQueue.js';
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
  const movie = dataStore.getMovie(movieId);
  if (!movie) {
    throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
  }

  const updatedMovie = { ...movie, status: '在看' as const };
  const folderName = getMovieFolderName(updatedMovie.title, updatedMovie.releaseDate);
  const movieDir = getMovieDir(folderName);

  // 确保目录存在
  if (!fs.existsSync(movieDir)) {
    fs.mkdirSync(movieDir, { recursive: true });
  }

  const metadataPath = getMetadataPath(movieDir);
  await writeQueue.enqueue(metadataPath, async () => {
    fs.writeFileSync(metadataPath, JSON.stringify(updatedMovie, null, 2), 'utf-8');
  });

  dataStore.setMovie(movieId, updatedMovie);

  // 状态变更是系统事件，不与用户当天的手动日记互相覆盖。
  const today = getLocalDateStr();
  const entries = dataStore.getDiary(movieId);
  const review = '状态变更为「追剧中」';
  if (!entries.some(e => e.watchDate === today && e.kind === 'status' && e.review === review)) {
    const watchTime = getLocalTimeStr();
    entries.push({ id: uuidv4(), watchDate: today, watchTime, rating: -1, review, images: [], kind: 'status' });
    dataStore.setDiary(movieId, entries);
    const diaryPath = getDiaryPath(movieDir);
    await writeQueue.enqueue(diaryPath, async () => {
      fs.writeFileSync(diaryPath, JSON.stringify(entries, null, 2), 'utf-8');
    });
  }
}

// 标记已看完（原子操作：更新状态 + 自动日记 + 可选手动追剧记录）
export async function markAsWatched(
  movieId: string,
  entryData: { watchDate: string; rating: number; review?: string }
): Promise<void> {
  const movie = dataStore.getMovie(movieId);
  if (!movie) {
    throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
  }

  // 更新状态
  const updatedMovie = { ...movie, status: '已看完' as const };

  // 状态变为已看完 → 自动将进度设为100%
  if (updatedMovie.progress?.totalEpisodes) {
    updatedMovie.progress = {
      ...updatedMovie.progress,
      episode: updatedMovie.progress.totalEpisodes,
    };
  }

  const folderName = getMovieFolderName(updatedMovie.title, updatedMovie.releaseDate);
  const movieDir = getMovieDir(folderName);

  if (!fs.existsSync(movieDir)) {
    fs.mkdirSync(movieDir, { recursive: true });
  }

  const metadataPath = getMetadataPath(movieDir);
  await writeQueue.enqueue(metadataPath, async () => {
    fs.writeFileSync(metadataPath, JSON.stringify(updatedMovie, null, 2), 'utf-8');
  });

  dataStore.setMovie(movieId, updatedMovie);

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

  const entries = dataStore.getDiary(movieId);
  entries.push(statusEntry);

  const diaryPath = getDiaryPath(movieDir);
  await writeQueue.enqueue(diaryPath, async () => {
    fs.writeFileSync(diaryPath, JSON.stringify(entries, null, 2), 'utf-8');
  });

  dataStore.setDiary(movieId, entries);

  // 用户主动填写的评分/短评单独保存为手动追剧记录。
  if (hasManualContent) {
    const watchRecord: WatchRecord = {
      id: uuidv4(),
      watchDate: entryData.watchDate,
      watchTime,
      rating: entryData.rating,
      review: entryData.review,
      images: [],
    };
    const watchRecords = [...dataStore.getWatchRecords(movieId), watchRecord];
    const watchRecordsPath = getWatchRecordsPath(movieDir);
    await writeQueue.enqueue(watchRecordsPath, async () => {
      fs.writeFileSync(watchRecordsPath, JSON.stringify(watchRecords, null, 2), 'utf-8');
    });
    dataStore.setWatchRecords(movieId, watchRecords);
  }
}
