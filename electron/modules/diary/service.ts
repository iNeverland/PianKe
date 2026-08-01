import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { dataStore } from '../../store/dataStore.js';
import { getMovieDir, getDiaryPath } from '../../utils/paths.js';
import { writeQueue } from '../../utils/writeQueue.js';
import { AppError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';
import { CreateDiaryInputSchema } from '../../../shared/schemas/index.js';
import type { DiaryEntry, DiaryTimelineMonth, DiaryTimelineDay } from '../../../shared/types/index.js';
import { parseLocalDate } from '../../../shared/utils/date.js';

// 获取某部影视的观影记录（按日期从近到远）
export function getDiaryByMovie(movieId: string): DiaryEntry[] {
  const entries = dataStore.getDiary(movieId);
  return entries.sort((a, b) => {
    const dateCmp = b.watchDate.localeCompare(a.watchDate);
    if (dateCmp !== 0) return dateCmp;
    return (b.watchTime || '').localeCompare(a.watchTime || '');
  });
}

// 添加观影记录
export async function addDiaryEntry(
  movieId: string,
  data: Record<string, unknown>
): Promise<DiaryEntry> {
  const movie = dataStore.getMovie(movieId);
  if (!movie) {
    throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
  }

  const validated = CreateDiaryInputSchema.parse(data);
  const now = new Date();
  const watchTime = validated.watchTime || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const entry: DiaryEntry = {
    id: uuidv4(),
    watchDate: validated.watchDate,
    watchTime,
    rating: validated.rating,
    review: validated.review,
    images: validated.images || [],
    kind: 'manual',
  };

  const entries = dataStore.getDiary(movieId);
  entries.push(entry);

  // 写入文件
  const folderName = movie.releaseDate
    ? `${movie.title} (${movie.releaseDate.split('-')[0]})`
    : movie.title;
  const movieDir = getMovieDir(movieId, folderName);
  const diaryPath = getDiaryPath(movieDir);

  await writeQueue.enqueue(diaryPath, async () => {
    fs.writeFileSync(diaryPath, JSON.stringify(entries, null, 2), 'utf-8');
  });

  dataStore.setDiary(movieId, entries);
  return entry;
}

// 更新观影记录
export async function updateDiaryEntry(
  movieId: string,
  entryId: string,
  data: Partial<DiaryEntry>
): Promise<DiaryEntry> {
  const movie = dataStore.getMovie(movieId);
  if (!movie) {
    throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
  }

  const entries = dataStore.getDiary(movieId);
  const index = entries.findIndex((e) => e.id === entryId);
  if (index === -1) {
    throw new AppError(ErrorCode.DIARY_NOT_FOUND, '观影记录不存在');
  }

  const updated = { ...entries[index], ...data, id: entryId };
  entries[index] = updated;

  const folderName = movie.releaseDate
    ? `${movie.title} (${movie.releaseDate.split('-')[0]})`
    : movie.title;
  const movieDir = getMovieDir(movieId, folderName);
  const diaryPath = getDiaryPath(movieDir);

  await writeQueue.enqueue(diaryPath, async () => {
    fs.writeFileSync(diaryPath, JSON.stringify(entries, null, 2), 'utf-8');
  });

  dataStore.setDiary(movieId, entries);
  return updated;
}

// 删除观影记录
export async function deleteDiaryEntry(movieId: string, entryId: string): Promise<void> {
  const movie = dataStore.getMovie(movieId);
  if (!movie) {
    throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
  }

  const entries = dataStore.getDiary(movieId);
  const filtered = entries.filter((e) => e.id !== entryId);

  const folderName = movie.releaseDate
    ? `${movie.title} (${movie.releaseDate.split('-')[0]})`
    : movie.title;
  const movieDir = getMovieDir(movieId, folderName);
  const diaryPath = getDiaryPath(movieDir);

  await writeQueue.enqueue(diaryPath, async () => {
    fs.writeFileSync(diaryPath, JSON.stringify(filtered, null, 2), 'utf-8');
  });

  dataStore.setDiary(movieId, filtered);
}

// 获取时间线
export function getTimeline(): DiaryTimelineMonth[] {
  const allEntries: Array<DiaryEntry & { movieId: string; movieTitle: string; movieThumbPath?: string }> = [];

  const allDiaries = dataStore.getAllDiaries();
  for (const [movieId, entries] of allDiaries) {
    const movie = dataStore.getMovie(movieId);
    if (!movie) continue;
    if (movie.status !== '已看完' && !movie.progress) continue;

    for (const entry of entries) {
      allEntries.push({
        ...entry,
        movieId,
        movieTitle: movie.title,
        movieThumbPath: movie.posterThumbPath,
      });
    }
  }

  // 按日期降序，同日期按时分降序
  allEntries.sort((a, b) => {
    const dateCmp = b.watchDate.localeCompare(a.watchDate);
    if (dateCmp !== 0) return dateCmp;
    return (b.watchTime || '').localeCompare(a.watchTime || '');
  });

  // 按月分组
  const months: DiaryTimelineMonth[] = [];
  let currentMonth = '';
  let currentDays: DiaryTimelineDay[] = [];
  let currentDate = '';

  for (const entry of allEntries) {
    const month = entry.watchDate.substring(0, 7); // YYYY-MM
    const day = entry.watchDate;

    if (month !== currentMonth) {
      if (currentDays.length > 0) {
        months.push({ month: currentMonth, days: currentDays });
      }
      currentMonth = month;
      currentDays = [];
      currentDate = '';
    }

    if (day !== currentDate) {
      const date = parseLocalDate(day);
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      currentDays.push({
        date: day,
        weekday: weekdays[date.getDay()],
        items: [],
      });
      currentDate = day;
    }

    currentDays[currentDays.length - 1].items.push(entry);
  }

  if (currentDays.length > 0) {
    months.push({ month: currentMonth, days: currentDays });
  }

  return months;
}
