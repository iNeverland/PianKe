import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/types/index.js';
import * as service from './service.js';

export function registerMovieHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.MOVIE_LIST, async (_event, filters?) => {
    return service.listMovies(filters);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_GET_BY_ID, async (_event, id: string) => {
    return service.getMovieById(id);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_CREATE, async (_event, data, posterFilePath?) => {
    return service.createMovie(data, posterFilePath);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_UPDATE, async (_event, id: string, data, posterFilePath?) => {
    return service.updateMovie(id, data, posterFilePath);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_DELETE, async (_event, id: string) => {
    return service.deleteMovie(id);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_SEARCH, async (_event, query: string, filters?) => {
    return service.searchMovies(query, filters);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_UPDATE_PROGRESS, async (_event, id: string, episode: number) => {
    return service.updateProgress(id, episode);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_ADD_TAG, async (_event, id: string, tag: string) => {
    return service.addTag(id, tag);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_REMOVE_TAG, async (_event, id: string, tag: string) => {
    return service.removeTag(id, tag);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_GET_ALL_TAGS, async () => {
    return service.getAllTags();
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_GET_POSTER_URL, async (_event, id: string, thumb?: boolean) => {
    return service.getPosterBase64(id, thumb);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_EXPORT_ALL, async () => {
    return service.getAllFullMovies();
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_IMPORT_CSV, async (_event, csvText: string) => {
    return service.importMoviesFromCsv(csvText);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_LIST_SCREENSHOTS, async (_event, id: string) => {
    return service.listScreenshots(id);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_ADD_SCREENSHOT, async (_event, id: string, base64Data: string, ext: string) => {
    return service.addScreenshot(id, base64Data, ext);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_DELETE_SCREENSHOT, async (_event, id: string, filename: string) => {
    return service.deleteScreenshot(id, filename);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_GET_SCREENSHOT, async (_event, id: string, filename: string) => {
    return service.getScreenshotBase64(id, filename);
  });

  ipcMain.handle(IPC_CHANNELS.MOVIE_UPDATE_SCREENSHOT_INFO, async (_event, id: string, filename: string, info: Record<string, unknown>) => {
    return service.updateScreenshotInfo(id, filename, info as { episode?: number; hours?: number; minutes?: number; seconds?: number });
  });
}
