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
import {
  readChartPalette, onColor, withAlpha, seriesColorByIndex, categoryColor,
  type ChartPalette,
} from '@/lib/chartPalette';

function EmptyHint() {
  return <p className="text-text-muted text-xs py-6 text-center">暂无数据</p>;
}

interface ChartTheme {
  text: string;
  muted: string;
  border: string;
  elevated: string;
  isDark: boolean;
  palette: ChartPalette;
}

function useChartTheme(): ChartTheme {
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
      // tooltip 底色走 --bg-elevated 令牌，不再硬编码（原先深色写死 #2a2a24，
      // 而该值不等于任何主题令牌，深色 --bg-elevated 实为 #242420）。
      elevated: style.getPropertyValue('--bg-elevated').trim() || (isDark ? '#242420' : '#ffffff'),
      isDark,
      palette: readChartPalette(style, isDark),
    };
  }, [version]);
}

/**
 * 排名横条图（类型分布 / 影视国家）。
 *
 * 颜色按设计方规范「按名次依次取 cat-1..cat-10」：第 1 名拿主系列色 cat-1，
 * 依次向下；超过 10 项时循环（与规范的「依次」一致）。
 *
 * 取色用「真实名次」而非数组下标：颜色跟着条目走，因此不依赖 yAxis 的
 * reverse/inverse 视觉方向。items 由 API 按数量降序给出，故名次 = 原始下标。
 */
function buildRankedBarOption(items: { label: string; value: number }[], theme: ChartTheme) {
  const ranked = [...items].reverse();
  return {
    // ECharts 内置无障碍：自动生成图表描述（读屏可读）。
    // 纹理（decal）显式关闭：ECharts 在 aria 场景下可能默认带斜纹，这里按设计反馈去掉；
    // 系列区分改由轴标签/图例文案与数值标签承担，不是"仅靠颜色"。
    aria: { enabled: true, decal: { show: false } },
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    xAxis: { type: 'value' as const, show: false },
    grid: { left: 0, right: 40, top: 4, bottom: 0, containLabel: true },
    yAxis: {
      type: 'category' as const,
      data: ranked.map((item) => item.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.text, fontSize: 12, fontWeight: 500 },
      inverse: true,
    },
    series: [{
      type: 'bar',
      data: ranked.map((item, i) => ({
        value: item.value,
        itemStyle: {
          // items.length - 1 - i 即该条目在「按数量降序」原数组中的下标 = 名次
          color: seriesColorByIndex(theme.palette.cat, items.length - 1 - i),
          borderRadius: [0, 3, 3, 0],
        },
      })),
      label: {
        show: true,
        position: 'right' as const,
        color: theme.muted,
        fontSize: 11,
        fontWeight: 500,
        formatter: '{c}',
      },
      barMaxWidth: 18,
      barMinWidth: 12,
      barCategoryGap: '25%',
    }],
  };
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

  const genreOption = useMemo(
    () => buildRankedBarOption(topGenres.map((g) => ({ label: g.genre, value: g.count })), theme),
    [topGenres, theme],
  );

  const countryOption = useMemo(
    () => buildRankedBarOption(topCountries.map((c) => ({ label: c.country, value: c.count })), theme),
    [topCountries, theme],
  );

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
    // ECharts 内置无障碍：自动生成图表描述（读屏可读）。
    // 纹理（decal）显式关闭：ECharts 在 aria 场景下可能默认带斜纹，这里按设计反馈去掉；
    // 系列区分改由轴标签/图例文案与数值标签承担，不是"仅靠颜色"。
    aria: { enabled: true, decal: { show: false } },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: theme.elevated,
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
      lineStyle: { color: theme.palette.line, width: 2.5 },
      itemStyle: {
        color: theme.palette.line,
        // 描边取图表容器底色（--bg-secondary），让端点呈"镂空"halo 与卡片分离。
        // 原先用 onColor(line) —— 那是"文字压在色块上"的取法，对图形端点语义不对，
        // 而且深墨色的环压在浅色卡片上会变成一圈深色描边。
        borderColor: theme.palette.surface,
        borderWidth: 2,
      },
      areaStyle: {
        color: {
          type: 'linear' as const,
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            // 面积渐变由主色派生，换主题时不会残留写死的橙色（原为 rgba(239,120,0,…)）
            { offset: 0, color: withAlpha(theme.palette.line, 0.18) },
            { offset: 1, color: withAlpha(theme.palette.line, 0.01) },
          ],
        },
      },
    }],
  }), [trendMonths, trendCountMap, theme]);

  // 评分分布：颜色按设计方规范「按分值依次取 cat-1..cat-10」，
  // 数据本身按分值升序（2/4/6/8/10），依下标顺序取色即得到 2分→cat-1 … 10分→cat-5。
  const ratingPieData = useMemo(() => {
    const items = diaryRatingDist.filter((d) => d.count > 0);
    return items.map((d, i) => {
      const color = seriesColorByIndex(theme.palette.cat, i);
      return {
        // 用服务端已给的 label（如「★★★ 6分」）而不是 `'★'.repeat(stars/2)`：
        // 图例需要把分数读出来，才看得出颜色与分值的对应关系。
        name: d.label,
        value: d.count,
        itemStyle: { color },
        // 标签前景按所在扇区底色选择（WCAG 1.4.3，由 onColor 取两种墨色中更优者）
        label: { color: onColor(color) },
      };
    });
  }, [diaryRatingDist, theme]);

  const ratingPieOption = useMemo(() => ({
    // ECharts 内置无障碍：自动生成图表描述（读屏可读）。
    // 纹理（decal）显式关闭：ECharts 在 aria 场景下可能默认带斜纹，这里按设计反馈去掉；
    // 系列区分改由轴标签/图例文案与数值标签承担，不是"仅靠颜色"。
    aria: { enabled: true, decal: { show: false } },
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: theme.elevated,
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
        // 前景色由每个扇区的 datum.label.color 按各自底色给出（见 ratingPieData / typePieData）；
        // 此处不再写死 onColor('#EF7800')，那会把橙色的前景色误用到所有扇区上。
        fontSize: 10,
        fontWeight: 600,
        formatter: '{c}',
      },
      labelLine: { show: false },
      emphasis: { scale: false },
      itemStyle: { borderColor: 'transparent', borderWidth: 0 },
    }],
  }), [ratingPieData, theme]);

  // 影视类型：媒体类型是并列类别（名义量），用分类色板；
  // 颜色按类型语义固定绑定，不随条数或排序漂移。
  const typePieData = useMemo(() => byType
    .filter(t => t.count > 0)
    .map(t => {
      const color = categoryColor(theme.palette.cat, t.type, theme.muted);
      return {
        name: t.type,
        value: t.count,
        itemStyle: { color },
        label: { color: onColor(color) },
      };
    }), [byType, theme]);

  const typePieOption = useMemo(() => ({
    // ECharts 内置无障碍：自动生成图表描述（读屏可读）。
    // 纹理（decal）显式关闭：ECharts 在 aria 场景下可能默认带斜纹，这里按设计反馈去掉；
    // 系列区分改由轴标签/图例文案与数值标签承担，不是"仅靠颜色"。
    aria: { enabled: true, decal: { show: false } },
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: theme.elevated,
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
        // 前景色由每个扇区的 datum.label.color 按各自底色给出（见 ratingPieData / typePieData）；
        // 此处不再写死 onColor('#EF7800')，那会把橙色的前景色误用到所有扇区上。
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

      {/* 概览卡片：图标尺寸由 .stat-card-icon 的 font-size 统一控制，
          AppIcon 的两种渲染形态（内联 SVG / .app-icon-source）都取 1em，
          因此这里不再逐个指定 w/h，避免混用导致四个图标大小不一。 */}
      <div className="stats-row mb-5">
        <div className="stat-card">
          <div className="stat-card-icon">
            <AppIcon name="stats" />
          </div>
          <div className="stat-value">{overview?.totalMovies ?? 0}</div>
          <div className="stat-label">影视总数</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon">
            <AppIcon name="clock" />
          </div>
          <div className="stat-value">{overview?.totalHours ?? 0}<span className="stat-unit">h</span></div>
          <div className="stat-label">观影时长</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon">
            <AppIcon name="star" />
          </div>
          <div className="stat-value">{overview?.avgPersonalRating != null ? <>{overview.avgPersonalRating}<span className="stat-unit">/10</span></> : '—'}</div>
          <div className="stat-label">平均评分</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon">
            <AppIcon name="diary" />
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
