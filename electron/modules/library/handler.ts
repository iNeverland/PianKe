import path from 'path';
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../shared/types/index.js';
import * as service from './service.js';
import { getLibraryRoot } from '../../utils/paths.js';
import { dataStore } from '../../store/dataStore.js';

export function registerLibraryHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.LIBRARY_OPEN, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: '选择资源库文件夹',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return service.openLibrary(result.filePaths[0]);
  });

  ipcMain.handle(IPC_CHANNELS.LIBRARY_REOPEN, async (_event, dirPath: string) => {
    return service.openLibrary(dirPath);
  });

  ipcMain.handle(IPC_CHANNELS.LIBRARY_GET_PATH, async () => {
    try {
      return getLibraryRoot();
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.LIBRARY_CREATE, async (event, name: string) => {
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择资源库存储位置',
      buttonLabel: '在此位置创建',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const basePath = result.filePaths[0];
    const dirPath = path.join(basePath, `${name}.pianke`);
    return service.createLibrary(dirPath, name);
  });

  ipcMain.handle(IPC_CHANNELS.LIBRARY_CREATE_BACKUP, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择完整备份的保存位置',
      buttonLabel: '备份到此位置',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return service.createFullBackup(result.filePaths[0]);
  });

  ipcMain.handle(IPC_CHANNELS.LIBRARY_GET_INFO, async () => {
    return service.getLibraryInfo();
  });

  ipcMain.handle(IPC_CHANNELS.LIBRARY_GET_SUMMARY, async () => {
    return service.getSummary();
  });

  ipcMain.handle(IPC_CHANNELS.LIBRARY_GET_RECENT_WATCHES, async (_event, days?: number) => {
    return service.getRecentWatches(days);
  });

  ipcMain.handle(IPC_CHANNELS.LIBRARY_IS_LOADED, async () => {
    return dataStore.loaded;
  });
}
