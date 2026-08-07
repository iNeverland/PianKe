import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { dataStore } from '../../store/dataStore.js';
import { getMovieDir, getWatchRecordsPath } from '../../utils/paths.js';
import { writeQueue } from '../../utils/writeQueue.js';
import { AppError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';
import { CreateWatchRecordInputSchema } from '../../../shared/schemas/index.js';
import type { WatchRecord } from '../../../shared/types/index.js';

function getMovieDirectory(movieId: string): string {
  const movie = dataStore.getMovie(movieId);
  if (!movie) throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
  const folderName = movie.releaseDate ? `${movie.title} (${movie.releaseDate.split('-')[0]})` : movie.title;
  return getMovieDir(movieId, folderName);
}

async function persist(movieId: string, entries: WatchRecord[]): Promise<void> {
  const recordsPath = getWatchRecordsPath(getMovieDirectory(movieId));
  await writeQueue.enqueue(recordsPath, async () => {
    fs.writeFileSync(recordsPath, JSON.stringify(entries, null, 2), 'utf-8');
  });
  dataStore.setWatchRecords(movieId, entries);
}

export function getWatchRecordsByMovie(movieId: string): WatchRecord[] {
  return [...dataStore.getWatchRecords(movieId)].sort((a, b) => {
    const dateCmp = b.watchDate.localeCompare(a.watchDate);
    return dateCmp || (b.watchTime || '').localeCompare(a.watchTime || '');
  });
}

export async function addWatchRecord(movieId: string, data: Record<string, unknown>): Promise<WatchRecord> {
  getMovieDirectory(movieId);
  const validated = CreateWatchRecordInputSchema.parse(data);
  const now = new Date();
  const entry: WatchRecord = {
    id: uuidv4(),
    watchDate: validated.watchDate,
    watchTime: validated.watchTime || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    rating: validated.rating,
    review: validated.review,
    images: validated.images || [],
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
