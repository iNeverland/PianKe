import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/types/index.js';
import * as service from './service.js';

export function registerDiaryHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DIARY_GET_BY_MOVIE, async (_event, movieId: string) => {
    return service.getDiaryByMovie(movieId);
  });

  ipcMain.handle(IPC_CHANNELS.DIARY_DELETE, async (_event, movieId: string, entryId: string) => {
    return service.deleteDiaryEntry(movieId, entryId);
  });

  ipcMain.handle(IPC_CHANNELS.DIARY_GET_TIMELINE, async () => {
    return service.getTimeline();
  });
}
