import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/types/index.js';
import { assertTrustedSender } from '../../utils/senderGuard.js';
import * as service from './service.js';

export function registerWatchRecordHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WATCH_RECORD_GET_BY_MOVIE, async (event, movieId: string) => {
    assertTrustedSender(event);
    return service.getWatchRecordsByMovie(movieId);
  });
  ipcMain.handle(IPC_CHANNELS.WATCH_RECORD_ADD, async (event, movieId: string, data) => {
    assertTrustedSender(event);
    return service.addWatchRecord(movieId, data);
  });
  ipcMain.handle(IPC_CHANNELS.WATCH_RECORD_UPDATE, async (event, movieId: string, entryId: string, data) => {
    assertTrustedSender(event);
    return service.updateWatchRecord(movieId, entryId, data);
  });
  ipcMain.handle(IPC_CHANNELS.WATCH_RECORD_DELETE, async (event, movieId: string, entryId: string) => {
    assertTrustedSender(event);
    return service.deleteWatchRecord(movieId, entryId);
  });
}
