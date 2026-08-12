import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { dataStore } from '../../store/dataStore.js';
import { getMovieDir, getMovieFolderName, getWatchRecordsPath } from '../../utils/paths.js';
import { writeQueue } from '../../utils/writeQueue.js';
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

async function persist(movieId: string, entries: WatchRecord[]): Promise<void> {
  const recordsPath = getWatchRecordsPath(getMovieDirectory(movieId));
  await writeQueue.enqueue(recordsPath, async () => {
    fs.writeFileSync(recordsPath, JSON.stringify(entries, null, 2), 'utf-8');
  });
  dataStore.setWatchRecords(movieId, entries);
}

export function getWatchRecordsByMovie(movieId: string): WatchRecord[] {
  return [...dataStore.getWatchRecords(movieId)].sort(compareWatchMomentDesc);
}

export async function addWatchRecord(movieId: string, data: Record<string, unknown>): Promise<WatchRecord> {
  getMovieDirectory(movieId);
  const validated = CreateWatchRecordInputSchema.parse(data);
  const entry: WatchRecord = {
    id: uuidv4(),
    watchDate: validated.watchDate,
    watchTime: validated.watchTime || getLocalTimeStr(),
    rating: validated.rating,
    review: validated.review,
  };
  const entries = [...dataStore.getWatchRecords(movieId), entry];
  await persist(movieId, entries);
  return entry;
}

export async function updateWatchRecord(
  movieId: string,
  entryId: string,
  data: Partial<WatchRecord>,
): Promise<WatchRecord> {
  const entries = [...dataStore.getWatchRecords(movieId)];
  const index = entries.findIndex((entry) => entry.id === entryId);
  if (index === -1) throw new AppError(ErrorCode.DIARY_NOT_FOUND, '追剧记录不存在');

  const validated = CreateWatchRecordInputSchema.partial().parse(data);
  const updated: WatchRecord = { ...entries[index], ...validated, id: entryId };
  entries[index] = updated;
  await persist(movieId, entries);
  return updated;
}

export async function deleteWatchRecord(movieId: string, entryId: string): Promise<void> {
  getMovieDirectory(movieId);
  const entries = dataStore.getWatchRecords(movieId).filter((entry) => entry.id !== entryId);
  await persist(movieId, entries);
}
