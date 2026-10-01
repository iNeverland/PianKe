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

/**
 * 安全解析 YYYY-MM-DD 为本地日期。
 * new Date("2026-07-04") 被 ECMAScript 规范强制解析为 UTC，在不同时区下
 * getDay() 结果可能错误。此函数始终以本地时间构造 Date。
 *
 * 解析不出来时返回 null，而不是 Invalid Date：调用方拿 Invalid Date 去 getDay()
 * 会得到 NaN，最终渲染成 undefined（日记里的星期曾因此显示为空白）。
 * 历史数据中 watchDate 为空串的情况是真实存在的。
 */
export function parseLocalDate(day: string): Date | null {
  const parts = String(day || '').split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}
