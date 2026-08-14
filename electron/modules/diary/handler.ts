import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/types/index.js';
import { assertTrustedSender } from '../../utils/senderGuard.js';
import * as service from './service.js';

export function registerDiaryHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DIARY_GET_BY_MOVIE, async (event, movieId: string) => {
    assertTrustedSender(event);
    return service.getDiaryByMovie(movieId);
  });

  ipcMain.handle(IPC_CHANNELS.DIARY_DELETE, async (event, movieId: string, entryId: string) => {
    assertTrustedSender(event);
    return service.deleteDiaryEntry(movieId, entryId);
  });

  ipcMain.handle(IPC_CHANNELS.DIARY_GET_TIMELINE, async (event) => {
    assertTrustedSender(event);
    return service.getTimeline();
  });
}
