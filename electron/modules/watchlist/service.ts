import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { dataStore } from '../../store/dataStore.js';
import { getMovieDir, getDiaryPath, getMetadataPath } from '../../utils/paths.js';
import { writeQueue } from '../../utils/writeQueue.js';
import { AppError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';
import type { MovieSummary, DiaryEntry } from '../../../shared/types/index.js';
import { getLocalDateStr } from '../../../shared/utils/date.js';

/** 从日记中计算某部影视的平均个人评分，无评分返回 null */
function getPersonalRating(movieId: string): number | null {
  const entries = dataStore.getDiary(movieId);
  if (!entries || entries.length === 0) return null;
  const rated = entries.filter(e => e.rating > 0);
  if (rated.length === 0) return null;
  return Math.round(rated.reduce((sum, e) => sum + e.rating, 0) / rated.length * 10) / 10;
}

function makeFolderName(title: string, releaseDate?: string): string {
  const year = releaseDate ? releaseDate.split('-')[0] : null;
  return year ? `${title} (${year})` : title;
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
  const folderName = makeFolderName(updatedMovie.title, updatedMovie.releaseDate);
  const movieDir = getMovieDir(movieId, folderName);

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
    const now = new Date();
    const watchTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    entries.push({ id: uuidv4(), watchDate: today, watchTime, rating: -1, review, images: [], kind: 'status' });
    dataStore.setDiary(movieId, entries);
    const diaryPath = getDiaryPath(movieDir);
    await writeQueue.enqueue(diaryPath, async () => {
      fs.writeFileSync(diaryPath, JSON.stringify(entries, null, 2), 'utf-8');
    });
  }
}

// 标记已看完（原子操作：更新状态 + 添加观影记录）
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

  const folderName = makeFolderName(updatedMovie.title, updatedMovie.releaseDate);
  const movieDir = getMovieDir(movieId, folderName);

  if (!fs.existsSync(movieDir)) {
    fs.mkdirSync(movieDir, { recursive: true });
  }

  const metadataPath = getMetadataPath(movieDir);
  await writeQueue.enqueue(metadataPath, async () => {
    fs.writeFileSync(metadataPath, JSON.stringify(updatedMovie, null, 2), 'utf-8');
  });

  dataStore.setMovie(movieId, updatedMovie);

  // 快捷“看完”未收集评分/短评时，写入状态事件而非伪造 0 分手动日记。
  const now = new Date();
  const watchTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const hasManualContent = entryData.rating > 0 || Boolean(entryData.review?.trim());
  const entry: DiaryEntry = {
    id: uuidv4(),
    watchDate: entryData.watchDate,
    watchTime,
    rating: hasManualContent ? entryData.rating : -1,
    review: hasManualContent ? entryData.review : '状态变更为「已看完」',
    images: [],
    kind: hasManualContent ? 'manual' : 'status',
  };

  const entries = dataStore.getDiary(movieId);
  entries.push(entry);

  const diaryPath = getDiaryPath(movieDir);
  await writeQueue.enqueue(diaryPath, async () => {
    fs.writeFileSync(diaryPath, JSON.stringify(entries, null, 2), 'utf-8');
  });

  dataStore.setDiary(movieId, entries);
}
