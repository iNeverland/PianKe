/**
 * 日期工具 — 统一使用本地时间，避免 toISOString() 的 UTC 偏差。
 *
 * 问题：new Date().toISOString() 返回 UTC 时间，在 UTC+8 凌晨 0:00-7:59
 * 得到的日期会少一天。
 */

/** 返回当前本地时间的日期字符串 YYYY-MM-DD */
export function getLocalDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 返回当前本地时间 HH:mm:ss，用于精确排列自动日记事件。 */
export function getLocalTimeStr(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** 供日记和追剧记录共用的时间字段。 */
export interface WatchMoment {
  watchDate: string;
  watchTime?: string;
}

/** 按本地观看日期和时间由近到远排序，不改变原数组。 */
export function compareWatchMomentDesc(a: WatchMoment, b: WatchMoment): number {
  return b.watchDate.localeCompare(a.watchDate)
    || (b.watchTime || '').localeCompare(a.watchTime || '');
}

/**
 * 安全解析 YYYY-MM-DD 为本地日期。
 * new Date("2026-07-04") 被 ECMAScript 规范强制解析为 UTC，在不同时区下
 * getDay() 结果可能错误。此函数始终以本地时间构造 Date。
 */
export function parseLocalDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}
