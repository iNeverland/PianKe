import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/types/index.js';
import * as service from './service.js';

export function registerTmdbHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.TMDB_SEARCH, async (_event, query: string) => {
    return service.searchTmdb(query);
  });

  ipcMain.handle(IPC_CHANNELS.TMDB_GET_DETAILS, async (_event, mediaType: '电影' | '剧集', id: number) => {
    return service.getTmdbDetails(mediaType, id);
  });

  ipcMain.handle(IPC_CHANNELS.TMDB_GET_POSTER, async (_event, posterPath: string) => {
    return service.getTmdbPoster(posterPath);
  });
}
