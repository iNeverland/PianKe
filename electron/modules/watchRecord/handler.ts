import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/types/index.js';
import * as service from './service.js';

export function registerWatchRecordHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WATCH_RECORD_GET_BY_MOVIE, async (_event, movieId: string) => {
    return service.getWatchRecordsByMovie(movieId);
  });
  ipcMain.handle(IPC_CHANNELS.WATCH_RECORD_ADD, async (_event, movieId: string, data) => {
    return service.addWatchRecord(movieId, data);
  });
  ipcMain.handle(IPC_CHANNELS.WATCH_RECORD_UPDATE, async (_event, movieId: string, entryId: string, data) => {
    return service.updateWatchRecord(movieId, entryId, data);
  });
  ipcMain.handle(IPC_CHANNELS.WATCH_RECORD_DELETE, async (_event, movieId: string, entryId: string) => {
    return service.deleteWatchRecord(movieId, entryId);
  });
}
