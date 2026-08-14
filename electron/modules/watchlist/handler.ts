import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/types/index.js';
import { assertTrustedSender } from '../../utils/senderGuard.js';
import * as service from './service.js';

export function registerWatchlistHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WATCHLIST_LIST, async (event) => {
    assertTrustedSender(event);
    return service.getWatchlist();
  });

  ipcMain.handle(IPC_CHANNELS.WATCHLIST_MARK_AS_WATCHED, async (event, movieId: string, entryData) => {
    assertTrustedSender(event);
    return service.markAsWatched(movieId, entryData);
  });

  ipcMain.handle(IPC_CHANNELS.WATCHLIST_MARK_AS_WATCHING, async (event, movieId: string) => {
    assertTrustedSender(event);
    return service.markAsWatching(movieId);
  });
}
