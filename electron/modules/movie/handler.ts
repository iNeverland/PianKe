import path from 'path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/types/index.js';
import { assertTrustedSender } from '../../utils/senderGuard.js';
import { getLocalDateStr } from '../../../shared/utils/date.js';
import * as service from './service.js';

export function registerMovieHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.MOVIE_LIST, async (event, filters?) => {
    assertTrustedSender(event);
    return service.listMovies(filters);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_GET_BY_ID, async (event, id: string) => {
    assertTrustedSender(event);
    return service.getMovieById(id);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_CREATE, async (event, data) => {
    assertTrustedSender(event);
    return service.createMovie(data);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_UPDATE, async (event, id: string, data) => {
    assertTrustedSender(event);
    return service.updateMovie(id, data);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_DELETE, async (event, id: string) => {
    assertTrustedSender(event);
    return service.deleteMovie(id);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_SEARCH, async (event, query: string, filters?) => {
    assertTrustedSender(event);
    return service.searchMovies(query, filters);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_UPDATE_PROGRESS, async (event, id: string, episode: number) => {
    assertTrustedSender(event);
    return service.updateProgress(id, episode);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_ADD_TAG, async (event, id: string, tag: string) => {
    assertTrustedSender(event);
    return service.addTag(id, tag);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_REMOVE_TAG, async (event, id: string, tag: string) => {
    assertTrustedSender(event);
    return service.removeTag(id, tag);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_GET_ALL_TAGS, async (event) => {
    assertTrustedSender(event);
    return service.getAllTags();
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_GET_POSTER_URL, async (event, id: string, thumb?: boolean) => {
    assertTrustedSender(event);
    return service.getPosterBase64(id, thumb);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_EXPORT_EXCEL, async (event) => {
    assertTrustedSender(event);
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
    const date = getLocalDateStr();
    const result = await dialog.showSaveDialog(win!, {
      title: '导出影视数据',
      defaultPath: path.join('PianKe-影视数据-' + date + '.xlsx'),
      filters: [
        { name: 'Excel 工作簿', extensions: ['xlsx'] },
        { name: 'Excel 97-2003 工作簿', extensions: ['xls'] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    return service.exportMoviesToExcel(result.filePath);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_LIST_SCREENSHOTS, async (event, id: string) => {
    assertTrustedSender(event);
    return service.listScreenshots(id);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_ADD_SCREENSHOT, async (event, id: string, base64Data: string, ext: string) => {
    assertTrustedSender(event);
    return service.addScreenshot(id, base64Data, ext);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_DELETE_SCREENSHOT, async (event, id: string, filename: string) => {
    assertTrustedSender(event);
    return service.deleteScreenshot(id, filename);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_GET_SCREENSHOT, async (event, id: string, filename: string) => {
    assertTrustedSender(event);
    return service.getScreenshotBase64(id, filename);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_GET_SCREENSHOT_THUMBNAIL, async (event, id: string, filename: string) => {
    assertTrustedSender(event);
    return service.getScreenshotThumbnailBase64(id, filename);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_UPDATE_SCREENSHOT_INFO, async (event, id: string, filename: string, info: Record<string, unknown>) => {
    assertTrustedSender(event);
    return service.updateScreenshotInfo(id, filename, info as { episode?: number; hours?: number; minutes?: number; seconds?: number });
  });
}
