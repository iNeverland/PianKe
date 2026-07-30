import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/types/index.js';
import * as service from './service.js';

export function registerWatchlistHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WATCHLIST_LIST, async () => {
    return service.getWatchlist();
  });

  ipcMain.handle(IPC_CHANNELS.WATCHLIST_MARK_AS_WATCHED, async (_event, movieId: string, entryData) => {
    return service.markAsWatched(movieId, entryData);
  });

  ipcMain.handle(IPC_CHANNELS.WATCHLIST_MARK_AS_WATCHING, async (_event, movieId: string) => {
    return service.markAsWatching(movieId);
  });
}
