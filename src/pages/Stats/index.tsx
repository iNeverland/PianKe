import { useState, useEffect, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import api from '@/lib/api';
import type {
  StatsOverview, StatsByType, StatsByGenre, StatsByCountry,
  StatsMonthlyTrend,
} from '@shared/types/index';
import LoadingSkeleton from '@/components/common/LoadingSkeleton';
import Header from '@/components/layout/Header';
import AppIcon from '@/components/common/AppIcon';

// 图表配色 — 从橙色调出发的暖→冷序列
const BAR_COLORS = [
  '#EF7800', '#e8963a', '#d4a840', '#54a0d8',
  '#5cb896', '#e06060', '#8b6cce',
];

const PIE_COLORS: Record<string, string> = {
  '电影': '#EF7800',
  '剧集': '#54a0d8',
  '综艺': '#d4a840',
  '纪录片': '#5cb896',
  '动画': '#8b6cce',
};

function EmptyHint() {
  return <p className="text-text-muted text-xs py-6 text-center">暂无数据</p>;
}

function useChartTheme() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onMediaChange = () => setVersion((value) => value + 1);
    media.addEventListener('change', onMediaChange);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', onMediaChange);
    };
  }, []);

  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
      || (!document.documentElement.hasAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    return {
      text: style.getPropertyValue('--text-secondary').trim() || '#6b6b6b',
      muted: style.getPropertyValue('--text-muted').trim() || '#9e9d99',
      border: style.getPropertyValue('--border').trim() || '#e8e7e3',
      isDark,
    };
  }, [version]);
}

export default function Stats() {
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [byType, setByType] = useState<StatsByType[]>([]);
  const [byGenre, setByGenre] = useState<StatsByGenre[]>([]);
  const [byCountry, setByCountry] = useState<StatsByCountry[]>([]);
  const [diaryRatingDist, setDiaryRatingDist] = useState<{ stars: number; label: string; count: number }[]>([]);
  const [monthlyTrend, setMonthlyTrend] = useState<StatsMonthlyTrend[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const dashboard = await api.stats.dashboard();
        setOverview(dashboard.overview);
        setByType(dashboard.byType);
        setByGenre(dashboard.byGenre);
        setByCountry(dashboard.byCountry);
        setDiaryRatingDist(dashboard.diaryRatingDist);
        setMonthlyTrend(dashboard.monthlyTrend);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const theme = useChartTheme();
  const topGenres = byGenre;
  const topCountries = byCountry;

  const genreOption = useMemo(() => ({
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    xAxis: { type: 'value' as const, show: false },
    grid: { left: 0, right: 40, top: 4, bottom: 0, containLabel: true },
    yAxis: {
      type: 'category' as const,
      data: topGenres.map(g => g.genre).reverse(),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.text, fontSize: 12, fontWeight: 500 },
      inverse: true,
    },
    series: [{
      type: 'bar',
      data: [...topGenres].reverse().map((g, i) => ({
        value: g.count,
        itemStyle: {
          color: BAR_COLORS[i % BAR_COLORS.length],
          borderRadius: [0, 3, 3, 0],
        },
      })),
      label: {
        show: true,
        position: 'right',
        color: theme.muted,
        fontSize: 11,
        fontWeight: 500,
        formatter: '{c}',
      },
      barMaxWidth: 18,
      barMinWidth: 12,
      barCategoryGap: '25%',
    }],
  }), [topGenres, theme]);

  const countryOption = useMemo(() => ({
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    xAxis: { type: 'value' as const, show: false },
    grid: { left: 0, right: 40, top: 4, bottom: 0, containLabel: true },
    yAxis: {
      type: 'category' as const,
      data: topCountries.map(c => c.country).reverse(),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.text, fontSize: 12, fontWeight: 500 },
      inverse: true,
    },
    series: [{
      type: 'bar',
      data: [...topCountries].reverse().map((c, i) => ({
        value: c.count,
        itemStyle: {
          color: BAR_COLORS[i % BAR_COLORS.length],
          borderRadius: [0, 3, 3, 0],
        },
      })),
      label: {
        show: true,
        position: 'right',
        color: theme.muted,
        fontSize: 11,
        fontWeight: 500,
        formatter: '{c}',
      },
      barMaxWidth: 18,
      barMinWidth: 12,
      barCategoryGap: '25%',
    }],
  }), [topCountries, theme]);

  // 月度趋势：最近12个月的折线图
  const trendMonths = useMemo(() => {
    const months: string[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = String(d.getMonth() + 1).padStart(2, '0');
      months.push(`${d.getFullYear()}-${m}`);
    }
    return months;
  }, []);

  const trendCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of monthlyTrend) {
      map[item.month] = item.count;
    }
    return map;
  }, [monthlyTrend]);

  const trendOption = useMemo(() => ({
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: theme.isDark ? '#2a2a24' : '#fff',
      borderColor: theme.border,
      textStyle: { color: theme.text, fontSize: 12 },
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0];
        return `${p.name}<br/>观看 <b>${p.value}</b> 部`;
      },
    },
    grid: { left: 36, right: 20, top: 20, bottom: 28 },
    xAxis: {
      type: 'category' as const,
      data: trendMonths,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: theme.muted,
        fontSize: 11,
        fontWeight: 500,
        formatter: (v: string) => v.substring(5).replace('-', '/'),
      },
    },
    yAxis: {
      type: 'value' as const,
      minInterval: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: theme.border, type: 'dashed' as const } },
      axisLabel: { color: theme.muted, fontSize: 11 },
    },
    series: [{
      type: 'line',
      data: trendMonths.map((m) => trendCountMap[m] || 0),
      smooth: false,
      symbol: 'circle',
      symbolSize: 5,
      lineStyle: { color: '#EF7800', width: 2.5 },
      itemStyle: {
        color: '#EF7800',
        borderColor: theme.isDark ? '#1a1a1a' : '#fff',
        borderWidth: 2,
      },
      areaStyle: {
        color: {
          type: 'linear' as const,
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(239, 120, 0, 0.18)' },
            { offset: 1, color: 'rgba(239, 120, 0, 0.01)' },
          ],
        },
      },
    }],
  }), [trendMonths, trendCountMap, theme]);

  // 评分分布：彩色渐变
  const ratingPieData = diaryRatingDist
    .filter(d => d.count > 0)
    .map((d, i) => ({
      name: '★'.repeat(d.stars / 2),
      value: d.count,
      itemStyle: { color: BAR_COLORS[i % BAR_COLORS.length] },
    }));

  const ratingPieOption = useMemo(() => ({
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: theme.isDark ? '#2a2a24' : '#fff',
      borderColor: theme.border,
      textStyle: { color: theme.text, fontSize: 12 },
      formatter: '{b}: {c} 部 ({d}%)',
    },
    legend: {
      bottom: 0,
      textStyle: { color: theme.text, fontSize: 11 },
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 14,
    },
    series: [{
      type: 'pie',
      radius: ['52%', '78%'],
      center: ['50%', '40%'],
      data: ratingPieData,
      label: {
        show: true,
        position: 'inside',
        color: theme.isDark ? '#1a1a1a' : '#fff',
        fontSize: 10,
        fontWeight: 600,
        formatter: '{c}',
      },
      labelLine: { show: false },
      emphasis: { scale: false },
      itemStyle: { borderColor: 'transparent', borderWidth: 0 },
    }],
  }), [ratingPieData, theme]);

  const typePieData = byType
    .filter(t => t.count > 0)
    .map(t => ({
      name: t.type,
      value: t.count,
      itemStyle: { color: PIE_COLORS[t.type] || '#999' },
    }));

  const typePieOption = useMemo(() => ({
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: theme.isDark ? '#2a2a24' : '#fff',
      borderColor: theme.border,
      textStyle: { color: theme.text, fontSize: 12 },
      formatter: '{b}: {c} 部 ({d}%)',
    },
    legend: {
      bottom: 0,
      textStyle: { color: theme.text, fontSize: 11 },
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 14,
    },
    series: [{
      type: 'pie',
      radius: ['52%', '78%'],
      center: ['50%', '40%'],
      data: typePieData,
      label: {
        show: true,
        position: 'inside',
        color: theme.isDark ? '#1a1a1a' : '#fff',
        fontSize: 10,
        fontWeight: 600,
        formatter: '{c}',
      },
      labelLine: { show: false },
      emphasis: { scale: false },
      itemStyle: { borderColor: 'transparent', borderWidth: 0 },
    }],
  }), [typePieData, theme]);

  if (loading) {
    return (
      <div>
        <Header title="数据统计" subtitle="加载中..." showAdd={false} />
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  return (
    <div>
      <Header title="数据统计" subtitle="观影数据可视化" showAdd={false} />

      {/* 概览卡片 */}
      <div className="stats-row mb-5">
        <div className="stat-card">
          <div className="stat-card-icon">
            <AppIcon name="stats" className="w-5 h-5" />
          </div>
          <div className="stat-value">{overview?.totalMovies ?? 0}</div>
          <div className="stat-label">影视总数</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon">
            <AppIcon name="clock" className="w-5 h-5" />
          </div>
          <div className="stat-value">{overview?.totalHours ?? 0}<span className="stat-unit">h</span></div>
          <div className="stat-label">观影时长</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon">
            <AppIcon name="star" className="w-5 h-5" />
          </div>
          <div className="stat-value">{overview?.avgPersonalRating ?? '—'}<span className="stat-unit">/10</span></div>
          <div className="stat-label">平均评分</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon">
            <AppIcon name="diary" className="w-5 h-5" />
          </div>
          <div className="stat-value">{overview?.mostWatchedGenre?.slice(0, 2).join(' / ') || '—'}</div>
          <div className="stat-label">最爱类型</div>
        </div>
      </div>

      {/* 类型分布 + 国家分布（双栏横条） */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="stat-card-contained">
          <h3 className="section-title">类型分布</h3>
          {topGenres.length === 0 ? <EmptyHint /> : (
            <ReactECharts option={genreOption} notMerge={true} style={{ height: Math.max(topGenres.length * 42, 280) }} />
          )}
        </div>
        <div className="stat-card-contained">
          <h3 className="section-title">影视国家</h3>
          {topCountries.length === 0 ? <EmptyHint /> : (
            <ReactECharts option={countryOption} notMerge={true} style={{ height: Math.max(topCountries.length * 42, 280) }} />
          )}
        </div>
      </div>

      {/* 观影趋势（全宽折线） */}
      <div className="stat-card-contained mb-4">
        <h3 className="section-title">观影趋势</h3>
        {monthlyTrend.length === 0 ? (
          <p className="text-text-muted text-xs py-10 text-center">添加观影记录后，每月趋势将在此展示</p>
        ) : (
          <ReactECharts option={trendOption} notMerge={true} style={{ height: 280 }} />
        )}
      </div>

      {/* 评分分布 + 影视类型（双饼图） */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="stat-card-contained">
          <h3 className="section-title">评分分布</h3>
          {ratingPieData.length === 0 ? (
            <p className="text-text-muted text-xs py-10 text-center">添加评分后显示</p>
          ) : (
            <ReactECharts option={ratingPieOption} notMerge={true} style={{ height: 250 }} />
          )}
        </div>
        <div className="stat-card-contained">
          <h3 className="section-title">影视类型</h3>
          {typePieData.length === 0 ? <EmptyHint /> : (
            <ReactECharts option={typePieOption} notMerge={true} style={{ height: 250 }} />
          )}
        </div>
      </div>

    </div>
  );
}
