import { useMemo } from 'react';
import type { DiaryCalendarEntry } from '@shared/types/index';

interface CalendarHeatmapProps {
  data: DiaryCalendarEntry[];
  days: number; // 总共要显示的天数（从今天往前推）
}

// 一周七天，周一开始
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function CalendarHeatmap({ data, days }: CalendarHeatmapProps) {
  const { grid, monthLabels, totalWeeks } = useMemo(() => {
    // 构建查找表
    const countMap: Record<string, number> = {};
    for (const item of data) {
      countMap[item.date] = item.count;
    }

    // 计算日期范围
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - days + 1);
    startDate.setHours(0, 0, 0, 0);

    // 找到起始日期所在周的周一
    const gridStart = new Date(startDate);
    const startDayOfWeek = gridStart.getDay(); // 0=周日
    const offsetToMonday = startDayOfWeek === 0 ? -6 : 1 - startDayOfWeek;
    gridStart.setDate(gridStart.getDate() + offsetToMonday);

    // 找到结束日期所在周的周日
    const gridEnd = new Date(today);
    const endDayOfWeek = gridEnd.getDay();
    const offsetToSunday = endDayOfWeek === 0 ? 0 : 7 - endDayOfWeek;
    gridEnd.setDate(gridEnd.getDate() + offsetToSunday);

    // 计算总周数
    const diffMs = gridEnd.getTime() - gridStart.getTime();
    const totalDays = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
    const weeks = Math.ceil(totalDays / 7);

    // 构建网格：7行 x weeks列
    // grid[row][col] = { date: string | null, count: number }
    const grid: { date: string | null; count: number }[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: weeks }, () => ({ date: null, count: 0 }))
    );

    // 填充网格
    const cursor = new Date(gridStart);
    for (let col = 0; col < weeks; col++) {
      for (let row = 0; row < 7; row++) {
        const dateStr = formatDate(cursor);
        const inRange = cursor >= startDate && cursor <= today;
        grid[row][col] = {
          date: dateStr,
          count: inRange ? (countMap[dateStr] || 0) : 0,
        };
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    // 计算月份标签：在每个月的第一个星期位置标注月份
    const monthLabels: { label: string; col: number }[] = [];
    for (let col = 0; col < weeks; col++) {
      // 取该列第一行（周一）的日期来判断月份
      const cell = grid[0][col];
      if (cell.date) {
        const [y, m] = cell.date.split('-');
        const monthKey = `${y}-${m}`;
        const prev = monthLabels[monthLabels.length - 1];
        if (!prev || !prev.label.endsWith(`${m}月`)) {
          monthLabels.push({ label: `${Number(m)}月`, col });
        }
      }
    }

    return { grid, monthLabels, totalWeeks: weeks };
  }, [data, days]);

  function getCellClass(count: number, date: string | null): string {
    if (!date) return 'heatmap-cell heatmap-cell-empty';
    if (count === 0) return 'heatmap-cell heatmap-cell-zero';
    if (count === 1) return 'heatmap-cell heatmap-cell-light';
    return 'heatmap-cell heatmap-cell-heavy';
  }

  function getTooltip(date: string | null, count: number): string {
    if (!date) return '';
    if (count === 0) return `${date} — 无记录`;
    return `${date} — ${count} 条记录`;
  }

  return (
    <div className="calendar-heatmap">
      {/* 月份标签行 */}
      <div className="heatmap-month-row" style={{ marginLeft: 24 }}>
        {monthLabels.map((m) => (
          <span
            key={`month-${m.col}`}
            className="heatmap-month-label"
            style={{ gridColumn: m.col + 1 }}
          >
            {m.label}
          </span>
        ))}
      </div>

      {/* 网格 + 星期标签 */}
      <div className="heatmap-body">
        {/* 星期标签列 */}
        <div className="heatmap-weekday-col">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="heatmap-weekday-label">
              {label}
            </div>
          ))}
        </div>

        {/* 网格 */}
        <div
          className="heatmap-grid"
          style={{
            gridTemplateColumns: `repeat(${totalWeeks}, 1fr)`,
          }}
        >
          {grid[0].map((_, col) =>
            grid.map((row, rowIdx) => {
              const cell = row[col];
              return (
                <div
                  key={`${col}-${rowIdx}`}
                  className={getCellClass(cell.count, cell.date)}
                  title={getTooltip(cell.date, cell.count)}
                />
              );
            })
          )}
        </div>
      </div>

      {/* 图例 */}
      <div className="heatmap-legend">
        <span className="heatmap-legend-label">少</span>
        <div className="heatmap-cell heatmap-cell-zero" />
        <div className="heatmap-cell heatmap-cell-light" />
        <div className="heatmap-cell heatmap-cell-heavy" />
        <span className="heatmap-legend-label">多</span>
      </div>
    </div>
  );
}
