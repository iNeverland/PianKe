import { useState, useRef, useEffect } from 'react';

interface CustomDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export default function CustomDatePicker({ value, onChange, className = '' }: CustomDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const initialDate = value ? new Date(value + 'T00:00:00') : new Date();
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth() + 1);
  // Year picker shows a 12-year window; compute the start year
  const [yearPage, setYearPage] = useState(Math.floor(initialDate.getFullYear() / 12) * 12);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function openPicker() {
    const d = value ? new Date(value + 'T00:00:00') : new Date();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth() + 1);
    setShowYearPicker(false);
    setYearPage(Math.floor(d.getFullYear() / 12) * 12);
    setOpen(true);
  }

  function prevMonth() {
    if (viewMonth === 1) { setViewMonth(12); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  }

  function nextMonth() {
    if (viewMonth === 12) { setViewMonth(1); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  }

  function prevYear() { setViewYear(viewYear - 1); }
  function nextYear() { setViewYear(viewYear + 1); }

  function selectDay(day: number) {
    onChange(toDateStr(viewYear, viewMonth, day));
    setOpen(false);
  }

  function selectYear(year: number) {
    setViewYear(year);
    setShowYearPicker(false);
  }

  function prevYearPage() { setYearPage(yearPage - 12); }
  function nextYearPage() { setYearPage(yearPage + 12); }

  // Build calendar grid
  const firstDay = new Date(viewYear, viewMonth - 1, 1);
  const lastDay = new Date(viewYear, viewMonth, 0);
  const totalDays = lastDay.getDate();
  const startDow = firstDay.getDay(); // 0=Sun
  const offset = startDow === 0 ? 6 : startDow - 1; // Monday-start

  const cells: Array<{ day: number; inMonth: boolean; isToday: boolean; isSelected: boolean }> = [];

  const prevLastDay = new Date(viewYear, viewMonth - 1, 0).getDate();
  for (let i = offset - 1; i >= 0; i--) {
    cells.push({ day: prevLastDay - i, inMonth: false, isToday: false, isSelected: false });
  }

  const today = new Date();
  const todayStr = toDateStr(today.getFullYear(), today.getMonth() + 1, today.getDate());
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = toDateStr(viewYear, viewMonth, d);
    cells.push({
      day: d,
      inMonth: true,
      isToday: dateStr === todayStr,
      isSelected: dateStr === value,
    });
  }

  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) {
    for (let d = 1; d <= remaining; d++) {
      cells.push({ day: d, inMonth: false, isToday: false, isSelected: false });
    }
  }

  const weeks: typeof cells[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  // Build year grid
  const years: number[] = [];
  for (let y = yearPage; y < yearPage + 12; y++) {
    years.push(y);
  }

  const displayText = value || '选择日期';

  return (
    <div ref={ref} className={`custom-datepicker ${className}`}>
      <button type="button" className="custom-datepicker-trigger" onClick={openPicker}>
        <span className={value ? 'custom-datepicker-value' : 'custom-datepicker-placeholder'}>{displayText}</span>
        <svg
          viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          className="custom-datepicker-icon"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </button>

      {open && (
        <div className="custom-datepicker-popup">
          {showYearPicker ? (
            <>
              {/* Year picker header */}
              <div className="custom-datepicker-header">
                <button type="button" onClick={prevYearPage} className="custom-datepicker-nav" aria-label="前12年">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <span className="custom-datepicker-title">
                  {yearPage} – {yearPage + 11}
                </span>
                <button type="button" onClick={nextYearPage} className="custom-datepicker-nav" aria-label="后12年">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
              {/* Year grid */}
              <div className="custom-datepicker-year-grid">
                {years.map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => selectYear(y)}
                    className={`custom-datepicker-year${y === viewYear ? ' selected' : ''}${y === today.getFullYear() ? ' today' : ''}`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* Month picker header */}
              <div className="custom-datepicker-header">
                <button type="button" onClick={prevYear} className="custom-datepicker-nav" aria-label="上年" title="上一年">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="11 18 5 12 11 6" /><polyline points="19 18 13 12 19 6" />
                  </svg>
                </button>
                <button type="button" onClick={prevMonth} className="custom-datepicker-nav" aria-label="上月" title="上个月">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="custom-datepicker-title-btn"
                  onClick={() => { setYearPage(Math.floor(viewYear / 12) * 12); setShowYearPicker(true); }}
                  title="选择年份"
                >
                  {viewYear}年 {MONTHS[viewMonth - 1]}
                </button>
                <button type="button" onClick={nextMonth} className="custom-datepicker-nav" aria-label="下月" title="下个月">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                <button type="button" onClick={nextYear} className="custom-datepicker-nav" aria-label="下年" title="下一年">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="13 6 19 12 13 18" /><polyline points="5 6 11 12 5 18" />
                  </svg>
                </button>
              </div>

              {/* Weekday headers */}
              <div className="custom-datepicker-weekdays">
                {WEEKDAYS.map((w) => (
                  <span key={w} className="custom-datepicker-weekday">{w}</span>
                ))}
              </div>

              {/* Day grid */}
              <div className="custom-datepicker-grid">
                {weeks.map((week, wi) => (
                  <div key={wi} className="custom-datepicker-row">
                    {week.map((cell, ci) => (
                      <button
                        key={ci}
                        type="button"
                        disabled={!cell.inMonth}
                        onClick={() => cell.inMonth && selectDay(cell.day)}
                        className={`custom-datepicker-day${cell.inMonth ? '' : ' outside'}${cell.isToday ? ' today' : ''}${cell.isSelected ? ' selected' : ''}`}
                      >
                        {cell.day}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
