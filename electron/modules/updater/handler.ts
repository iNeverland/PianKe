import { ipcMain } from 'electron';
import { IPC_CHANNELS, type UpdateCheckSource } from '../../../shared/types/index.js';
import { checkForUpdates, downloadUpdate, getUpdateState } from './service.js';

export function registerUpdateHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_STATE, () => getUpdateState());
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, (_event, source?: UpdateCheckSource) => {
    return checkForUpdates(source === 'manual' ? 'manual' : 'automatic');
  });
  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, () => downloadUpdate());
}
