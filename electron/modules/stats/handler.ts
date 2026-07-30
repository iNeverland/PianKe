import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/types/index.js';
import * as service from './service.js';

export function registerStatsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.STATS_DASHBOARD, async () => {
    return service.getDashboard();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_OVERVIEW, async () => {
    return service.getOverview();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_BY_MEDIA_TYPE, async () => {
    return service.getByMediaType();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_BY_YEAR, async () => {
    return service.getByYear();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_BY_GENRE, async () => {
    return service.getByGenre();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_BY_RATING, async () => {
    return service.getByRating();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_BY_COUNTRY, async () => {
    return service.getByCountry();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_DIARY_RATING_DIST, async () => {
    return service.getDiaryRatingDistribution();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_MONTHLY_TREND, async () => {
    return service.getMonthlyTrend();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_MONTH_SUMMARY, async (_event, year: number, month: number) => {
    return service.getMonthSummary(year, month);
  });

  ipcMain.handle(IPC_CHANNELS.STATS_DIARY_CALENDAR, async (_event, days: number) => {
    return service.getDiaryCalendar(days);
  });
}
