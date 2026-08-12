import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import type { DiaryTimelineMonth } from '@shared/types/index';
import EmptyState from '@/components/common/EmptyState';
import LoadingSkeleton from '@/components/common/LoadingSkeleton';
import PosterThumb from '@/components/common/PosterThumb';
import CustomDatePicker from '@/components/common/CustomDatePicker';
import Modal from '@/components/common/Modal';
import { showToast } from '@/components/common/Toast';
import Header from '@/components/layout/Header';
import AppIcon from '@/components/common/AppIcon';

const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];

// 每日热力图颜色（分级：1-2 / 3-4 / 5+）
function dailyHeatStyle(count: number, isDark: boolean): React.CSSProperties {
  if (count === 0) return {};
  if (isDark) {
    if (count <= 2) return { background: '#1a4a2e' };
    if (count <= 4) return { background: '#9e8020' };
    return { background: '#b53030' };
  }
  if (count <= 2) return { background: '#d8f0db' };
  if (count <= 4) return { background: '#f0d030' };
  return { background: '#e53e3e' };
}

export default function Diary() {
  const navigate = useNavigate();
  const [timeline, setTimeline] = useState<DiaryTimelineMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const now = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  // 日期筛选
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [deletingDiary, setDeletingDiary] = useState<{
    movieId: string;
    entryId: string;
    movieTitle: string;
  } | null>(null);
  const [isDark, setIsDark] = useState(() => {
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // 监听主题变化
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme === 'dark') setIsDark(true);
      else if (theme === 'light') setIsDark(false);
      else setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    loadTimeline();
  }, []);

  async function loadTimeline() {
    try {
      const data = await api.diary.getTimeline();
      setTimeline(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // 根据日期筛选时间线
  const filteredTimeline = useMemo(() => {
    if (!dateFrom && !dateTo) return timeline;

    let rawFrom = dateFrom || '0000-01-01';
    let rawTo = dateTo || '9999-12-31';
    // 确保 from <= to，用户可能先选了后面的日期
    if (rawFrom > rawTo) [rawFrom, rawTo] = [rawTo, rawFrom];
    const from = rawFrom;
    const to = rawTo;

    return timeline
      .map(month => {
        const filteredDays = month.days
          .map(day => {
            const dateKey = day.date.substring(0, 10);
            const filteredItems = day.items.filter(() => dateKey >= from && dateKey <= to);
            return filteredItems.length > 0 ? { ...day, items: filteredItems } : null;
          })
          .filter((d): d is NonNullable<typeof d> => d !== null);
        return filteredDays.length > 0 ? { ...month, days: filteredDays } : null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }, [timeline, dateFrom, dateTo]);

  const isFiltered = !!(dateFrom || dateTo);

  function clearDateFilter() {
    setDateFrom('');
    setDateTo('');
  }

  async function deleteDiaryEntry() {
    if (!deletingDiary) return;
    const entry = deletingDiary;
    setDeletingDiary(null);
    try {
      await api.diary.delete(entry.movieId, entry.entryId);
      await loadTimeline();
      showToast('观影日记已删除');
    } catch (err: any) {
      showToast(err.message || '删除失败');
    }
  }

  // 导航限制
  const canGoNextMonth = viewYear < now.getFullYear() || (viewYear === now.getFullYear() && viewMonth < now.getMonth() + 1);
  const canGoNextYear = viewYear < now.getFullYear();

  function goPrevMonth() {
    if (viewMonth === 1) {
      setViewYear(viewYear - 1);
      setViewMonth(12);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function goNextMonth() {
    if (!canGoNextMonth) return;
    if (viewMonth === 12) {
      setViewYear(viewYear + 1);
      setViewMonth(1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  function goPrevYear() { setViewYear(viewYear - 1); }
  function goNextYear() { if (canGoNextYear) setViewYear(viewYear + 1); }

  function goToday() {
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth() + 1);
  }

  const stats = useMemo(() => {
    const displayData = dateFrom || dateTo ? filteredTimeline : timeline;
    let totalEntries = 0;
    let totalMovies = 0;
    const movieSet = new Set<string>();
    // 当月（热力图当前浏览月份）统计
    let viewMonthMovies = 0;
    const viewMonthSet = new Set<string>();
    const viewMonthPrefix = `${viewYear}-${String(viewMonth).padStart(2, '0')}`;

    for (const month of displayData) {
      for (const day of month.days) {
        const dateKey = day.date.substring(0, 10);
        for (const item of day.items) {
          totalEntries++;
          movieSet.add(item.movieId);
          if (!dateFrom && !dateTo && dateKey.startsWith(viewMonthPrefix)) {
            viewMonthSet.add(item.movieId);
          }
        }
      }
    }
    totalMovies = movieSet.size;
    viewMonthMovies = viewMonthSet.size;

    return {
      totalEntries,
      totalMovies,
      viewMonthMovies,
    };
  }, [timeline, filteredTimeline, dateFrom, dateTo, viewYear, viewMonth]);

  // 热力图数据：选中月每日 + 选中年每月（按影视去重）
  const heatmapData = useMemo(() => {
    const viewMonthPrefix = `${viewYear}-${String(viewMonth).padStart(2, '0')}`;

    // 选中月每日: Map<YYYY-MM-DD, Set<movieId>>
    const daily = new Map<string, Set<string>>();
    // 选中年每月: Map<YYYY-MM, Set<movieId>>
    const monthly = new Map<string, Set<string>>();

    // 初始化选中年份全部12个月
    for (let m = 1; m <= 12; m++) {
      const key = `${viewYear}-${String(m).padStart(2, '0')}`;
      monthly.set(key, new Set());
    }

    for (const month of timeline) {
      if (monthly.has(month.month)) {
        for (const day of month.days) {
          // 归一化日期：截取前10位 YYYY-MM-DD
          const dateKey = day.date.substring(0, 10);
          for (const item of day.items) {
            monthly.get(month.month)!.add(item.movieId);
            if (dateKey.startsWith(viewMonthPrefix)) {
              if (!daily.has(dateKey)) daily.set(dateKey, new Set());
              daily.get(dateKey)!.add(item.movieId);
            }
          }
        }
      }
    }

    return { daily, monthly, viewYear, viewMonth, viewMonthPrefix };
  }, [timeline, viewYear, viewMonth]);

  // 构建选中月日历网格
  const calendarGrid = useMemo(() => {
    const { viewYear: cy, viewMonth: cm } = heatmapData;
    const firstDay = new Date(cy, cm - 1, 1);
    const lastDay = new Date(cy, cm, 0);
    const dayOfWeek = firstDay.getDay(); // 0=Sun
    const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - offset);

    const weeks: Array<Array<{ day: number; date: string; inMonth: boolean }>> = [];
    const cursor = new Date(startDate);

    while (true) {
      const week: Array<{ day: number; date: string; inMonth: boolean }> = [];
      for (let i = 0; i < 7; i++) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, '0');
        const d = String(cursor.getDate()).padStart(2, '0');
        week.push({
          day: cursor.getDate(),
          date: `${y}-${m}-${d}`,
          inMonth: cursor.getMonth() + 1 === cm && y === cy,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
      if (cursor > lastDay) break;
    }

    return weeks;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewYear, viewMonth]);

  if (loading) return (
    <div>
      <Header title="观影日记" subtitle="加载中..." showAdd={false} />
      <LoadingSkeleton rows={5} />
    </div>
  );

  if (timeline.length === 0) {
    return (
      <div>
        <Header title="观影日记" subtitle="记录你的观影轨迹" showAdd={false} />
        <EmptyState title="暂无观影日记" description="更新追剧进度或影视状态后，记录会出现在这里" />
      </div>
    );
  }

  return (
    <div>
      <Header title="观影日记" subtitle={isFiltered ? '日期筛选' : `${stats.totalEntries} 条观影记录`} showAdd={false} />

      {/* 统计摘要条 */}
      <div className="flex items-center gap-5 mb-4 text-xs text-text-muted">
        {isFiltered ? (
          <span>筛选 <b className="text-text-primary font-semibold">{stats.totalMovies}</b> 部</span>
        ) : (
          <span>{viewYear}年{viewMonth}月 <b className="text-text-primary font-semibold">{stats.viewMonthMovies}</b> 部</span>
        )}
        <span className="w-px h-3 bg-border" />
        <span>共 <b className="text-text-primary font-semibold">{stats.totalMovies}</b> 部</span>
        <span className="w-px h-3 bg-border" />
        <span><b className="text-text-primary font-semibold">{stats.totalEntries}</b> 条状态与进度记录</span>
      </div>

      {/* 日期筛选栏 */}
      <div className="flex items-center gap-3 mb-6">
        <CustomDatePicker value={dateFrom} onChange={setDateFrom} />
        <span className="text-xs text-text-muted">至</span>
        <CustomDatePicker value={dateTo} onChange={setDateTo} />
        {isFiltered && (
          <button
            onClick={clearDateFilter}
            className="text-xs text-accent hover:text-accent/80 transition-colors bg-transparent border-none cursor-pointer whitespace-nowrap"
          >
            清除筛选
          </button>
        )}
        {!isFiltered && (
          <span className="text-[11px] text-text-muted">选填：筛选日期范围查看</span>
        )}
      </div>

      {/* 左右两栏：时间线 + 热力图 */}
      <div className="flex gap-8">
        {/* 左侧：时间线 */}
        <div className="flex-1 min-w-0 diary-timeline stagger-children">
          {filteredTimeline.length === 0 && isFiltered ? (
            <p className="text-text-muted text-sm py-8 text-center">该日期范围内暂无观影记录</p>
          ) : (
            filteredTimeline.map((month) => (
            <div key={month.month} className="mb-8">
              {/* 月份标题 — 杂志章节风格 */}
              <div className="flex items-center gap-5 mb-5 pl-7">
                <span className="font-display text-base font-semibold text-text-primary tracking-tight">{month.month}</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* 日期分组 */}
              <div className="diary-date-list">
                {month.days.map((day) => (
                  <div key={day.date} className="mb-6">
                    {/* 日期头：圆点 + 日期 + 星期 */}
                    <div className="diary-date-header">
                      <div className="diary-date-dot" />
                      <span className="diary-date-text">
                        {day.date}
                        <span className="diary-date-weekday">{day.weekday}</span>
                      </span>
                    </div>

                    {/* 当日条目列表 */}
                    <div className="flex flex-col gap-1">
                      {day.items.map((item) => (
                        <div key={`${item.movieId}-${item.id}`} className="relative group">
                          <div
                            onClick={() => navigate(`/movie/${item.movieId}`)}
                            className="timeline-item"
                          >
                            <PosterThumb
                              movieId={item.movieId}
                              hasPoster={Boolean(item.movieThumbPath)}
                              alt=""
                              className="w-10 h-[60px] rounded object-cover flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0 py-0.5">
                              <p className="text-text-primary text-sm font-medium truncate leading-snug">
                                {item.movieTitle}
                                {item.watchTime && <span className="text-text-muted font-normal ml-1.5 text-xs">{item.watchTime}</span>}
                              </p>
                              {item.review && (
                                <p className="text-text-muted text-xs italic mt-1.5 line-clamp-2 leading-relaxed">{item.review}</p>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingDiary({ movieId: item.movieId, entryId: item.id, movieTitle: item.movieTitle });
                            }}
                            className="absolute top-1/2 -translate-y-1/2 right-4 !text-[#e53e3e] text-xs border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity bg-transparent"
                          >删除</button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
          )}
        </div>

        {/* 右侧：热力图 */}
        <div className="w-[252px] flex-shrink-0">
          <div className="sticky top-8 space-y-8">
            {/* 每日热力图 */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={goPrevMonth}
                  className="w-5 h-5 rounded flex items-center justify-center border-none cursor-pointer bg-transparent text-text-muted hover:text-text-primary transition-colors"
                  title="上一月" aria-label="上一月"
                >
                  <AppIcon name="chevronLeft" className="w-3.5 h-3.5" />
                </button>
                <h3 className="text-xs font-display font-semibold text-text-primary tracking-tight">
                  {heatmapData.viewYear}年{heatmapData.viewMonth}月 · 每日
                </h3>
                <button
                  onClick={goNextMonth}
                  disabled={!canGoNextMonth}
                  className={`w-5 h-5 rounded flex items-center justify-center border-none cursor-pointer bg-transparent transition-colors ${canGoNextMonth ? 'text-text-muted hover:text-text-primary' : 'text-text-muted/30 cursor-default'}`}
                  title={canGoNextMonth ? '下一月' : '已是当前月'}
                  aria-label={canGoNextMonth ? '下一月' : '已是当前月'}
                >
                  <AppIcon name="chevronRight" className="w-3.5 h-3.5" />
                </button>
              </div>
              {/* 星期头 */}
              <div className="grid grid-cols-7 gap-[3px] mb-1.5">
                {WEEK_HEADERS.map(w => (
                  <div key={w} className="text-[0.6rem] text-text-muted text-center font-medium font-display">{w}</div>
                ))}
              </div>
              {/* 日历格子 */}
              <div className="flex flex-col gap-[3px]">
                {calendarGrid.map((week, wi) => (
                  <div key={wi} className="grid grid-cols-7 gap-[3px]">
                    {week.map((cell) => (
                      <div
                        key={cell.date}
                        title={`${cell.date}${cell.inMonth ? ` — ${heatmapData.daily.get(cell.date)?.size || 0} 部` : ''}`}
                        style={cell.inMonth ? dailyHeatStyle(heatmapData.daily.get(cell.date)?.size || 0, isDark) : { background: 'transparent', color: '#c5c3bd' }}
                        className="aspect-square rounded-[4px] flex items-center justify-center text-[0.65rem] leading-none font-medium font-display"
                      >
                        {cell.day}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* 年度月度热力图 */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={goPrevYear}
                  className="w-5 h-5 rounded flex items-center justify-center border-none cursor-pointer bg-transparent text-text-muted hover:text-text-primary transition-colors"
                  title="上一年" aria-label="上一年"
                >
                  <AppIcon name="chevronLeft" className="w-3.5 h-3.5" />
                </button>
                <h3 className="text-xs font-display font-semibold text-text-primary tracking-tight">
                  {heatmapData.viewYear}年 · 月度
                </h3>
                <button
                  onClick={goNextYear}
                  disabled={!canGoNextYear}
                  className={`w-5 h-5 rounded flex items-center justify-center border-none cursor-pointer bg-transparent transition-colors ${canGoNextYear ? 'text-text-muted hover:text-text-primary' : 'text-text-muted/30 cursor-default'}`}
                  title={canGoNextYear ? '下一年' : '已是当前年'}
                  aria-label={canGoNextYear ? '下一年' : '已是当前年'}
                >
                  <AppIcon name="chevronRight" className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-[3px]">
                {[...heatmapData.monthly.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([monthKey, movieSet]) => {
                  const m = parseInt(monthKey.substring(5, 7), 10);
                  const count = movieSet.size;
                  const style: React.CSSProperties = count === 0
                    ? { color: isDark ? '#8a8985' : '#9e9d99' }
                    : isDark
                      ? count <= 3
                        ? { background: '#1a4a2e', color: '#c0d8c0' }
                        : count <= 6
                          ? { background: '#1f6e3a', color: '#d0e8d0' }
                          : count <= 9
                            ? { background: '#9e8020', color: '#f0e0a0' }
                            : { background: '#b53030', color: '#f0c0c0' }
                      : count <= 3
                        ? { background: '#d8f0db', color: '#1a1a1a' }
                        : count <= 6
                          ? { background: '#40c463', color: '#fff' }
                          : count <= 9
                            ? { background: '#f0d030', color: '#1a1a1a' }
                            : { background: '#e53e3e', color: '#fff' };
                  return (
                    <div
                      key={monthKey}
                      title={`${monthKey} — ${count} 部`}
                      className="aspect-square p-[3px]"
                    >
                      <div
                        style={style}
                        className="w-full h-full rounded-[4px] flex flex-col items-center justify-center"
                      >
                        <div className="text-[0.55rem] font-medium leading-none mb-0.5 opacity-80">{MONTH_NAMES[m - 1]}</div>
                        <div className="text-sm font-display font-semibold leading-none">{count}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* 回到今天按钮 */}
              {(heatmapData.viewYear !== now.getFullYear() || heatmapData.viewMonth !== now.getMonth() + 1) && (
                <button
                  onClick={goToday}
                  className="mt-3 w-full text-[11px] text-accent hover:text-accent/80 transition-colors bg-transparent border-none cursor-pointer text-center"
                >
                  回到本月
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={Boolean(deletingDiary)}
        onClose={() => setDeletingDiary(null)}
        title="删除观影日记"
        width="400px"
      >
        <p className="text-text-secondary text-sm mb-5">
          确定要删除「{deletingDiary?.movieTitle}」的这条观影日记吗？
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setDeletingDiary(null)} className="btn btn-ghost">取消</button>
          <button onClick={deleteDiaryEntry} className="btn btn-danger">删除</button>
        </div>
      </Modal>

    </div>
  );
}
