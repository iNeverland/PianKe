import { useState, useEffect, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import api from '@/lib/api';
import type {
  StatsOverview, StatsByType, StatsByGenre, StatsByCountry,
  StatsMonthlyTrend,
} from '@shared/types/index';
import LoadingSkeleton from '@/components/common/LoadingSkeleton';
import ErrorState from '@/components/common/ErrorState';
import Header from '@/components/layout/Header';
import AppIcon from '@/components/common/AppIcon';
import {
  readChartPalette, onColor, withAlpha, seriesColorByIndex, categoryColor,
  type ChartPalette,
} from '@/lib/chartPalette';

function EmptyHint() {
  return <p className="text-text-muted text-xs py-6 text-center">暂无数据</p>;
}

/**
 * 迷你折线（12 个月等距序列）。
 *
 * 用内联 SVG 而不是再挂一个 ECharts 实例：卡片里只要一条走势线，
 * 为此多起一个图表实例（含 canvas、tooltip、aria 生成）不划算，也会拖慢首屏。
 * x 轴按固定 12 格等距铺开——空月份是 0 而不是被跳过，否则"疏密"会被误读成趋势。
 */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const width = 120;
  const height = 26;
  const inset = 3;
  const max = Math.max(...values);
  const stepX = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * stepX;
    // 全为 0 时贴底画一条平线，而不是让 0/0 得到 NaN 把 path 弄没
    const y = max <= 0 ? height - inset : height - inset - (value / max) * (height - inset * 2);
    return { x, y };
  });
  const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `${points[0].x},${height} ${line} ${points[points.length - 1].x},${height}`;
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {/* 面积用 currentColor + 低透明度：颜色跟随 .stat-spark 的文字色，随主题令牌走 */}
      <polygon points={area} fill="currentColor" opacity="0.12" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last.x} cy={last.y} r="2" fill="currentColor" />
    </svg>
  );
}

/** 5 星评分条：把 1–10 的均分折成 0–5 星，实心部分用 currentColor（星色由 CSS 给）。 */
function RatingStars({ rating }: { rating: number }) {
  const filled = Math.round(rating / 2);
  return (
    <span className="stat-stars" aria-label={`平均 ${rating} 分，满分 10 分`}>
      {[1, 2, 3, 4, 5].map((index) => (
        <span key={index} className={index <= filled ? undefined : 'is-empty'}>★</span>
      ))}
    </span>
  );
}

/** 时长（小时）→ 可读文本：整数不带小数点，小数保留一位。 */
function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0h';
  return `${Math.round(hours * 10) / 10}h`;
}

/** 时长（小时）→ 天，供「约 23.2 天」这类上下文使用。 */
function formatDays(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0';
  return `${Math.round((hours / 24) * 10) / 10}`;
}

/** 类型占比：返回 0–100 的整数百分比，分母为 0 时返回 0（避免出现 NaN%）。 */
function sharePercent(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

/** 类型占比文案，供卡片右上角徽标使用；分母是影片总数（该类型的影片占全部影片的比例）。 */
function formatShare(part: number, total: number): string {
  return total ? `占 ${sharePercent(part, total)}%` : '—';
}

/**
 * 月份变化量徽标（影视总数卡）：只回答"本月新增了几部"。
 * 不做增长率——上月为 0 时 0 → N 的增幅是无限大，写出来只会误导。
 */
function formatMonthCount(current: number): string {
  return current > 0 ? `本月 +${current} 部` : '本月 0 部';
}

/** 观影时长卡的徽标：同样只给本月数值，不摆环比百分比。 */
function formatMonthHours(hours: number): string {
  return `本月 ${formatHours(hours)}`;
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
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    (async () => {
      try {
        const dashboard = await api.stats.dashboard();
        if (!active) return;
        setOverview(dashboard.overview);
        setByType(dashboard.byType);
        setByGenre(dashboard.byGenre);
        setByCountry(dashboard.byCountry);
        setDiaryRatingDist(dashboard.diaryRatingDist);
        setMonthlyTrend(dashboard.monthlyTrend);
      } catch (err) {
        console.error(err);
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [reloadKey]);

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

  // 月度趋势：最近 12 个月（dashboard 已补齐成定长 12 格，这里直接沿用同一份标签，
  // 不要再自己算一遍月份，否则两处口径一旦受时区/跨月影响就会错位）
  const trendMonths = useMemo(() => monthlyTrend.map((item) => item.month), [monthlyTrend]);

  const trendCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of monthlyTrend) {
      map[item.month] = item.count;
    }
    return map;
  }, [monthlyTrend]);

  const trendHoursMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of monthlyTrend) {
      map[item.month] = item.hours;
    }
    return map;
  }, [monthlyTrend]);

  /** 顶部两张卡的迷你折线用同一份序列（与下方折线图同源，不会出现两套数） */
  const trendValues = useMemo(() => ({
    counts: trendMonths.map((month) => trendCountMap[month] || 0),
    hours: trendMonths.map((month) => trendHoursMap[month] || 0),
  }), [trendMonths, trendCountMap, trendHoursMap]);

  /** 最爱类型卡脚注右侧：类型分布第二名（from byGenre，已按数量降序）。 */
  const genreRunnerUp = useMemo(() => {
    const second = byGenre[1];
    return second ? `Top2 ${second.genre} ${second.count} 部` : '';
  }, [byGenre]);

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
        const hours = trendHoursMap[p.name] || 0;
        // 时长只在当月真有时长时才补一行，避免每格都挂一个「0h」
        return hours > 0
          ? `${p.name}<br/>观看 <b>${p.value}</b> 部 · ${hours}h`
          : `${p.name}<br/>观看 <b>${p.value}</b> 部`;
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
  }), [trendMonths, trendCountMap, trendHoursMap, theme]);

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

  if (loadError) {
    return (
      <div>
        <Header title="数据统计" subtitle="加载失败" showAdd={false} />
        <ErrorState
          description="无法加载统计数据。请检查网络或登录状态后重试。"
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      </div>
    );
  }

  return (
    <div>
      <Header title="数据统计" subtitle="观影数据可视化" showAdd={false} />

      {/* 概览卡片（方案 D：数值 + 变化量 + 上下文）。
          卡片内的图标尺寸由 .stat-card-icon 的 font-size 统一控制，
          AppIcon 的两种渲染形态（内联 SVG / .app-icon-source）都取 1em，
          因此这里不再逐个指定 w/h，避免混用导致四个图标大小不一。 */}
      <div className="stats-row mb-5">
        <div className="stat-card">
          <div className="stat-card-top">
            <span className="stat-card-icon"><AppIcon name="stats" /></span>
            <span className="stat-card-label">影视总数</span>
            <span className="stat-card-badge">{formatMonthCount(overview?.addedThisMonth ?? 0)}</span>
          </div>
          <div className="stat-value">{overview?.totalMovies ?? 0}</div>
          <div className="stat-spark"><Sparkline values={trendValues.counts} /></div>
          {/* 脚注只留一行状态分布：原来左侧的「近 12 个月新增 N 部」在窄卡片里会折行，
              而趋势已经由上面的迷你折线表达，重复信息删掉更清晰。 */}
          <div className="stat-foot stat-foot-single">
            <span>已看完 {overview?.statusCounts?.已看完 ?? 0} · 在看 {overview?.statusCounts?.在看 ?? 0} · 想看 {overview?.statusCounts?.想看 ?? 0}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-top">
            <span className="stat-card-icon"><AppIcon name="clock" /></span>
            <span className="stat-card-label">观影时长</span>
            <span className="stat-card-badge">{formatMonthHours(overview?.hoursThisMonth ?? 0)}</span>
          </div>
          <div className="stat-value">{overview?.totalHours ?? 0}<span className="stat-unit">h</span></div>
          <div className="stat-spark"><Sparkline values={trendValues.hours} /></div>
          {/* 本月时长已经在右上角徽标里，脚注只留总量换算，避免同一数字出现两次 */}
          <div className="stat-foot stat-foot-single">
            <span>约 {formatDays(overview?.totalHours ?? 0)} 天</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-top">
            <span className="stat-card-icon"><AppIcon name="star" /></span>
            <span className="stat-card-label">平均评分</span>
            <span className="stat-card-badge">已评分 {overview?.ratedCount ?? 0} 部</span>
          </div>
          <div className="stat-value">
            {overview?.avgPersonalRating != null
              ? <>{overview.avgPersonalRating}<span className="stat-unit">/10</span></>
              : '—'}
          </div>
          <div className="stat-bar">
            <div className="stat-bar-track">
              <i style={{ width: `${((overview?.avgPersonalRating ?? 0) / 10) * 100}%` }} />
            </div>
          </div>
          <div className="stat-foot">
            {overview?.avgPersonalRating != null
              ? <RatingStars rating={overview.avgPersonalRating} />
              : <span>评分后显示</span>}
            <span>{overview?.topRating ? `最多 ${overview.topRating} 分` : '满分 10'}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-top">
            <span className="stat-card-icon"><AppIcon name="diary" /></span>
            <span className="stat-card-label">最爱类型</span>
            <span className="stat-card-badge">{formatShare(overview?.topGenreCount ?? 0, overview?.totalMovies ?? 0)}</span>
          </div>
          <div className="stat-value stat-value-text">{overview?.mostWatchedGenre?.slice(0, 2).join(' / ') || '—'}</div>
          <div className="stat-bar">
            <div className="stat-bar-track">
              {/* 占比 = 该类型的影片数 / 全部影片数（例如「剧情」出现在 3 部里、共 4 部 → 75%）。
                  不要用"类型标签总数"当分母：那是标签占比，一部片带 5 个类型就会把占比摊薄，
                  与"最爱类型"想表达的"这个类型占我片库多少"不是一回事。 */}
              <i style={{ width: `${sharePercent(overview?.topGenreCount ?? 0, overview?.totalMovies ?? 0)}%` }} />
            </div>
          </div>
          <div className="stat-foot">
            <span>{overview?.topGenre ? `Top1 ${overview.topGenre} ${overview.topGenreCount} 部` : '暂无类型数据'}</span>
            <span>{genreRunnerUp ?? ''}</span>
          </div>
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
        {/* monthlyTrend 现在是定长 12 格（缺月补 0），不能再用 length 判断"有没有数据"，
            否则新用户会看到一张全 0 的折线，而不是这句引导文案。 */}
        {trendValues.counts.every((value) => value === 0) ? (
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
