import fs from 'fs';
import { dataStore } from '../../store/dataStore.js';
import { getMovieDir, getMovieFolderName, getDiaryPath } from '../../utils/paths.js';
import { writeQueue } from '../../utils/writeQueue.js';
import { AppError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';
import type { DiaryEntry, DiaryTimelineMonth, DiaryTimelineDay } from '../../../shared/types/index.js';
import { compareWatchMomentDesc, parseLocalDate } from '../../../shared/utils/date.js';

// 获取某部影视的观影记录（按日期从近到远）
export function getDiaryByMovie(movieId: string): DiaryEntry[] {
  return [...dataStore.getDiary(movieId)].sort(compareWatchMomentDesc);
}

// 删除一条自动观影日记
export async function deleteDiaryEntry(movieId: string, entryId: string): Promise<void> {
  const movie = dataStore.getMovie(movieId);
  if (!movie) throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');

  const entries = dataStore.getDiary(movieId);
  if (!entries.some((entry) => entry.id === entryId)) {
    throw new AppError(ErrorCode.DIARY_NOT_FOUND, '观影日记不存在');
  }

  const filtered = entries.filter((entry) => entry.id !== entryId);
  const folderName = getMovieFolderName(movie.title, movie.releaseDate);
  const diaryPath = getDiaryPath(getMovieDir(folderName));
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
  allEntries.sort(compareWatchMomentDesc);

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
