import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/types/index.js';
import { assertTrustedSender } from '../../utils/senderGuard.js';
import * as service from './service.js';

export function registerTmdbHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.TMDB_SEARCH, async (event, query: string) => {
    assertTrustedSender(event);
    return service.searchTmdb(query);
  });

  ipcMain.handle(IPC_CHANNELS.TMDB_GET_DETAILS, async (event, mediaType: '电影' | '剧集', id: number) => {
    assertTrustedSender(event);
    return service.getTmdbDetails(mediaType, id);
  });

  ipcMain.handle(IPC_CHANNELS.TMDB_GET_POSTER, async (event, posterPath: string) => {
    assertTrustedSender(event);
    return service.getTmdbPoster(posterPath);
  });
}
