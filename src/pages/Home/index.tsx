import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import type { MovieSummary, WatchStatus, MediaType } from '@shared/types/index';
import MovieGrid from '@/components/movie/MovieGrid';
import Header from '@/components/layout/Header';
import AppIcon from '@/components/common/AppIcon';
import { GridSkeleton } from '@/components/common/LoadingSkeleton';

const TYPE_OPTIONS: { label: string; value: MediaType | '' }[] = [
  { label: '全部', value: '' },
  { label: '电影', value: '电影' },
  { label: '剧集', value: '剧集' },
  { label: '纪录片', value: '纪录片' },
  { label: '综艺', value: '综艺' },
  { label: '动画', value: '动画' },
];

const STATUS_OPTIONS: { label: string; value: WatchStatus | '' }[] = [
  { label: '全部状态', value: '' },
  { label: '已看完', value: '已看完' },
  { label: '追剧中', value: '在看' },
  { label: '想看', value: '想看' },
];

const SORT_OPTIONS: { label: string; value: string }[] = [
  { label: '最近观看', value: 'recent' },
  { label: '评分最高', value: 'rating' },
  { label: '最新上映', value: 'year' },
  { label: '添加时间', value: 'added' },
  { label: '标题', value: 'title' },
];

/** 从 localStorage 读取最近观看天数，默认 7 */
function getRecentDays(): number {
  try {
    const stored = localStorage.getItem('pianke-recent-days');
    if (stored) {
      const n = parseInt(stored, 10);
      if (n >= 1 && n <= 90) return n;
    }
  } catch { /* 隐私模式等极端情况 */ }
  return 7;
}

/**
 * 解析搜索框中的过滤器语法
 * - "2020"        → 文本"2020" + year=2020
 * - ">8"          → minRating=8（无文本匹配）
 * - "2020 >8"     → 文本"2020" + year=2020 + minRating=8
 * - "2020 <6"     → 文本"2020" + year=2020 + maxRating=6
 * - ">=7 <=9"     → minRating=7 + maxRating=9
 */
function parseSearchFilters(input: string): {
  query: string;
  year?: string;
  minRating?: number;
  maxRating?: number;
} {
  let text = input.trim();
  if (!text) return { query: '' };

  let minRating: number | undefined;
  let maxRating: number | undefined;

  // 提取评分过滤模式：[><]=? 后跟数字
  const ratingRe = /([><]=?)\s*(\d+)/g;
  let match: RegExpExecArray | null;
  const removed: Array<{ start: number; end: number }> = [];

  while ((match = ratingRe.exec(text)) !== null) {
    const op = match[1];
    const val = Number(match[2]);
    if (op === '>' || op === '>=') minRating = val;
    if (op === '<' || op === '<=') maxRating = val;
    removed.push({ start: match.index, end: match.index + match[0].length });
  }

  // 从后往前移除评分模式（避免索引偏移）
  let cleaned = text;
  for (let i = removed.length - 1; i >= 0; i--) {
    cleaned = cleaned.slice(0, removed[i].start) + cleaned.slice(removed[i].end);
  }

  // 提取年份（1900-2099）
  const yearMatch = cleaned.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : undefined;

  // 文本查询 = 去除评分语法后、但保留年份
  const query = cleaned.replace(/\s+/g, ' ').trim();

  // 纯评分语法（如 ">8"、"<=6"）不产生文本查询，避免把语法当标题关键词导致空结果。
  return { query: query || (minRating !== undefined || maxRating !== undefined ? '' : input.trim()), year, minRating, maxRating };
}

const RATING_OPTIONS: { label: string; value: string }[] = [
  { label: '全部评分', value: '' },
  { label: '10', value: '10' },
  { label: '8', value: '8' },
  { label: '6', value: '6' },
  { label: '4', value: '4' },
  { label: '2', value: '2' },
  { label: '未评分', value: 'none' },
];

export default function Home() {
  const navigate = useNavigate();
  const [recentMovies, setRecentMovies] = useState<MovieSummary[]>([]);
  const [allMovies, setAllMovies] = useState<MovieSummary[]>([]);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [filterType, setFilterType] = useState<MediaType | ''>('');
  const [filterStatus, setFilterStatus] = useState<WatchStatus | ''>('');
  const [filterRating, setFilterRating] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState('recent');
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [visibleCount, setVisibleCount] = useState(60);

  // 监听全局键盘快捷键触发的聚焦搜索框事件
  useEffect(() => {
    const handleFocusSearch = () => {
      setSearchOpen(true);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    };
    window.addEventListener('focus-home-search', handleFocusSearch);
    return () => window.removeEventListener('focus-home-search', handleFocusSearch);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    if (sortOpen || filterOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [sortOpen, filterOpen]);

  useEffect(() => {
    (async () => {
      try {
        // 最近观看只是完整摘要的派生结果；一次读取即可，避免冷启动时重复请求云端。
        const summary = await api.library.getSummary();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - getRecentDays());
        const cutoffText = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
        const recent = summary
          .filter((movie) => (movie.latestWatchDate || '') >= cutoffText)
          .sort((a, b) => (b.latestWatchDate || '').localeCompare(a.latestWatchDate || ''));
        setAllMovies(summary);
        setRecentMovies(recent);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const [searchResults, setSearchResults] = useState<MovieSummary[] | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (search.trim()) {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => {
        const { query, year, minRating, maxRating } = parseSearchFilters(search);
        const hasFilters = year || minRating != null || maxRating != null;
        api.movie.search(query, hasFilters ? { year, minRating, maxRating } : undefined)
          .then(setSearchResults)
          .catch(() => {});
      }, 300);
    } else {
      setSearchResults(null);
    }
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [search]);

  const filteredMovies = useMemo(() => {
    const base = searchResults ?? allMovies;
    const filtered = base.filter(m => {
      if (filterType && m.mediaType !== filterType) return false;
      if (filterStatus && m.status !== filterStatus) return false;
      if (filterRating) {
        if (filterRating === 'none') {
          if (m.personalRating != null) return false;
        } else {
          const target = Number(filterRating);
          if (m.personalRating !== target) return false;
        }
      }
      return true;
    });
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'rating': return b.rating - a.rating;
        case 'year': return b.releaseDate.localeCompare(a.releaseDate);
        case 'added': return (b.createdAt || '').localeCompare(a.createdAt || '');
        case 'title': return a.title.localeCompare(b.title, 'zh');
        case 'recent':
        default: {
          const d = (b.latestWatchDate || '').localeCompare(a.latestWatchDate || '');
          return d !== 0 ? d : (b.createdAt || '').localeCompare(a.createdAt || '');
        }
      }
    });
  }, [allMovies, searchResults, filterType, filterStatus, filterRating, sortBy]);

  const displayedMovies = useMemo(() => filteredMovies.slice(0, visibleCount), [filteredMovies, visibleCount]);

  async function handleStatusChange() {
    try {
      const recent = await api.library.getRecentWatches(getRecentDays());
      setRecentMovies(recent);
    } catch { /* 静默 */ }
  }

  function handleMovieDelete(id: string) {
    setAllMovies((prev) => prev.filter((movie) => movie.id !== id));
    setRecentMovies((prev) => prev.filter((movie) => movie.id !== id));
    setSearchResults((prev) => prev ? prev.filter((movie) => movie.id !== id) : prev);
  }

  if (loading) {
    return (
      <div>
        <Header title="我的影院" subtitle="加载中..." />
        <GridSkeleton />
      </div>
    );
  }

  return (
    <div>
      <Header title="我的影院" subtitle={`${allMovies.length} 部影视 · 记录每一次观影`}>
        {/* 搜索 */}
        <div className={`search-bar ${searchOpen || search ? 'open' : ''}`}>
          <button
            className="tool-icon"
            onClick={() => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 100); }}
            aria-label="搜索"
          >
            <AppIcon name="search" />
          </button>
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => { if (!search) setSearchOpen(false); }}
            placeholder="搜索..."
            aria-label="搜索影视"
          />
        </div>

        {/* 筛选下拉 */}
        <div className="sort-dropdown" ref={filterRef}>
          <button
            onClick={() => setFilterOpen(!filterOpen)}
            className={`tool-icon ${filterOpen || filterType || filterStatus || filterRating ? 'active' : ''}`}
            title="筛选"
            aria-label="筛选"
          >
            <AppIcon name="filter" />
          </button>
          {filterOpen && (
            <div className="sort-menu !w-[320px] !p-3.5">
              <div className="mb-3">
                <div className="text-xs text-text-muted mb-2 font-medium">类型</div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {TYPE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      className={`filter-chip text-xs ${filterType === opt.value ? 'active' : ''}`}
                      onClick={() => setFilterType(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="border-t border-border pt-3 mb-3">
                <div className="text-xs text-text-muted mb-2 font-medium">状态</div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {STATUS_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      className={`filter-chip text-xs ${filterStatus === opt.value ? 'active' : ''}`}
                      onClick={() => setFilterStatus(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="border-t border-border pt-3">
                <div className="text-xs text-text-muted mb-2 font-medium">个人评分</div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {RATING_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      className={`filter-chip text-xs ${filterRating === opt.value ? 'active' : ''}`}
                      onClick={() => setFilterRating(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 排序 */}
        <div className="sort-dropdown" ref={sortRef}>
          <button className="tool-icon" onClick={() => setSortOpen(!sortOpen)} title="排序" aria-label="排序">
            <AppIcon name="sort" />
          </button>
          {sortOpen && (
            <div className="sort-menu">
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`sort-item ${sortBy === opt.value ? 'active' : ''}`}
                  onClick={() => {
                    setSortBy(opt.value);
                    setSortOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </Header>

      {/* 最近观看 */}
      {recentMovies.length > 0 && !search && !filterType && !filterStatus && !filterRating && (
        <>
          <div className="section-header">
            <span className="section-title !mb-0">最近观看</span>
            <button className="section-link" onClick={() => navigate('/diary')}>
              全部
              <AppIcon name="chevronRight" className="w-3 h-3" />
            </button>
          </div>
          <MovieGrid movies={recentMovies.slice(0, 5)} onStatusChange={handleStatusChange} onDelete={handleMovieDelete} />
          <div className="mb-8" />
        </>
      )}

      {/* 全部影视 */}
      <div className="section-header">
        <span className="section-title !mb-0">全部影视</span>
        <span className="text-xs text-text-muted">{filteredMovies.length}</span>
      </div>

      <MovieGrid
        movies={displayedMovies}
        emptyTitle={search ? '没有找到匹配的影视' : '还没有添加影视'}
        emptyDescription={search ? '试试其他关键词或筛选条件' : '点击右上角「添加」开始记录'}
        onStatusChange={handleStatusChange}
        onDelete={handleMovieDelete}
      />

      {visibleCount < filteredMovies.length && (
        <div className="flex justify-center py-8">
          <button
            onClick={() => setVisibleCount(prev => prev + 60)}
            className="btn btn-secondary"
          >
            加载更多（剩余 {filteredMovies.length - visibleCount} 部）
          </button>
        </div>
      )}
    </div>
  );
}
