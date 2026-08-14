import { v4 as uuidv4 } from 'uuid';
import { dataStore } from '../../store/dataStore.js';
import { getMovieDir, getMovieFolderName, getWatchRecordsPath } from '../../utils/paths.js';
import { writeQueue } from '../../utils/writeQueue.js';
import { writeJsonAtomicSync } from '../../utils/atomicWrite.js';
import { AppError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';
import { CreateWatchRecordInputSchema } from '../../../shared/schemas/index.js';
import type { WatchRecord } from '../../../shared/types/index.js';
import { compareWatchMomentDesc, getLocalTimeStr } from '../../../shared/utils/date.js';

function getMovieDirectory(movieId: string): string {
  const movie = dataStore.getMovie(movieId);
  if (!movie) throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
  return getMovieDir(getMovieFolderName(movie.title, movie.releaseDate));
}

/**
 * 在写队列内完成「读取 → 修改 → 原子落盘 → 提交内存」，同一影视的追剧记录
 * 操作被按文件串行化，避免并发读-改-写互相覆盖导致丢失更新。
 */
async function mutateRecords(
  movieId: string,
  mutate: (entries: WatchRecord[]) => WatchRecord[]
): Promise<void> {
  const recordsPath = getWatchRecordsPath(getMovieDirectory(movieId));
  await writeQueue.enqueue(recordsPath, async () => {
    const entries = mutate([...dataStore.getWatchRecords(movieId)]);
    writeJsonAtomicSync(recordsPath, entries);
    dataStore.setWatchRecords(movieId, entries);
  });
}

export function getWatchRecordsByMovie(movieId: string): WatchRecord[] {
  return [...dataStore.getWatchRecords(movieId)].sort(compareWatchMomentDesc);
}

export async function addWatchRecord(movieId: string, data: Record<string, unknown>): Promise<WatchRecord> {
  const validated = CreateWatchRecordInputSchema.parse(data);
  const entry: WatchRecord = {
    id: uuidv4(),
    watchDate: validated.watchDate,
    watchTime: validated.watchTime || getLocalTimeStr(),
    rating: validated.rating,
    review: validated.review,
  };
  await mutateRecords(movieId, (entries) => [...entries, entry]);
  return entry;
}

export async function updateWatchRecord(
  movieId: string,
  entryId: string,
  data: Partial<WatchRecord>,
): Promise<WatchRecord> {
  const validated = CreateWatchRecordInputSchema.partial().parse(data);
  let updated: WatchRecord | undefined;
  await mutateRecords(movieId, (entries) => {
    const index = entries.findIndex((entry) => entry.id === entryId);
    if (index === -1) throw new AppError(ErrorCode.DIARY_NOT_FOUND, '追剧记录不存在');
    updated = { ...entries[index], ...validated, id: entryId };
    const next = [...entries];
    next[index] = updated;
    return next;
  });
  return updated!;
}

export async function deleteWatchRecord(movieId: string, entryId: string): Promise<void> {
  await mutateRecords(movieId, (entries) => entries.filter((entry) => entry.id !== entryId));
}
