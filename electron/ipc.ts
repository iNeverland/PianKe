import { registerLibraryHandlers } from './modules/library/handler.js';
import { registerMovieHandlers } from './modules/movie/handler.js';
import { registerDiaryHandlers } from './modules/diary/handler.js';
import { registerWatchlistHandlers } from './modules/watchlist/handler.js';
import { registerStatsHandlers } from './modules/stats/handler.js';
import { registerUpdateHandlers } from './modules/updater/handler.js';

export function registerAllHandlers(): void {
  registerLibraryHandlers();
  registerMovieHandlers();
  registerDiaryHandlers();
  registerWatchlistHandlers();
  registerStatsHandlers();
  registerUpdateHandlers();
}
