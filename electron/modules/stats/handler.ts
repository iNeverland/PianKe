import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/types/index.js';
import { assertTrustedSender } from '../../utils/senderGuard.js';
import * as service from './service.js';

export function registerStatsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.STATS_DASHBOARD, async (event) => {
    assertTrustedSender(event);
    return service.getDashboard();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_OVERVIEW, async (event) => {
    assertTrustedSender(event);
    return service.getOverview();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_BY_MEDIA_TYPE, async (event) => {
    assertTrustedSender(event);
    return service.getByMediaType();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_BY_YEAR, async (event) => {
    assertTrustedSender(event);
    return service.getByYear();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_BY_GENRE, async (event) => {
    assertTrustedSender(event);
    return service.getByGenre();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_BY_RATING, async (event) => {
    assertTrustedSender(event);
    return service.getByRating();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_BY_COUNTRY, async (event) => {
    assertTrustedSender(event);
    return service.getByCountry();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_DIARY_RATING_DIST, async (event) => {
    assertTrustedSender(event);
    return service.getDiaryRatingDistribution();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_MONTHLY_TREND, async (event) => {
    assertTrustedSender(event);
    return service.getMonthlyTrend();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_MONTH_SUMMARY, async (event, year: number, month: number) => {
    assertTrustedSender(event);
    return service.getMonthSummary(year, month);
  });

  ipcMain.handle(IPC_CHANNELS.STATS_DIARY_CALENDAR, async (event, days: number) => {
    assertTrustedSender(event);
    return service.getDiaryCalendar(days);
  });
}
