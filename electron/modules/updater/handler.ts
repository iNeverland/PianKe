import { ipcMain } from 'electron';
import { IPC_CHANNELS, type UpdateCheckSource } from '../../../shared/types/index.js';
import { assertTrustedSender } from '../../utils/senderGuard.js';
import { checkForUpdates, downloadUpdate, getUpdateState } from './service.js';

export function registerUpdateHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_STATE, (event) => {
    assertTrustedSender(event);
    return getUpdateState();
  });
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, (event, source?: UpdateCheckSource) => {
    assertTrustedSender(event);
    return checkForUpdates(source === 'manual' ? 'manual' : 'automatic');
  });
  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, (event) => {
    assertTrustedSender(event);
    return downloadUpdate();
  });
}
