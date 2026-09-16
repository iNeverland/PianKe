/**
 * 图表主题配色。
 *
 * 色值来自设计方提供的《图表色彩规范表》（浅色 / 深色两套，各 10 个分类色 + 映射说明），
 * 以 src/index.css 的主题令牌（--chart-cat-1..10）为唯一事实来源，随浅色 / 手动深色 /
 * 跟随系统自动切换，与日记热力图（--heat-l*）是同一套做法。
 *
 * 取色规则（按设计方选择）：
 *   - 名义型数据（影视类型）→ 按语义固定绑定，颜色不随条数或排序漂移；
 *   - 有序型数据（排名条图、评分分布）→ 按名次/分值「依次」取 cat-1..cat-10，超过 10 项循环。
 *   - 单系列折线 → cat-1（规范中 cat-1 的语义即「主系列色 / 核心对比」）。
 *
 * scripts/check-a11y-contrast.mjs 会逐个断言这些令牌的对比度与同步性。
 */

/**
 * 媒体类型 → 分类色序号。语义固定绑定（电影永远是 cat-1），
 * 不随数据条数或排序变化，因此饼图扇区颜色不会因为数量增减而漂移。
 */
export const MEDIA_TYPE_INDEX: Record<string, number> = {
  电影: 0,
  剧集: 1,
  综艺: 2,
  纪录片: 3,
  动画: 4,
};

/** 设计方规范中的分类色个数 */
export const CATEGORY_COUNT = 10;

export interface ChartPalette {
  /** 分类色板（10 色）。名义型按语义绑定；有序型按名次/分值依次取用。 */
  cat: string[];
  /** 单系列（折线）主色 = cat-1 */
  line: string;
  /** 图表容器底色（--bg-secondary），用于折线端点描边形成镂空 halo */
  surface: string;
}

/**
 * 令牌缺失时的兜底值。正常不会触发（index.css 三套主题都定义了这 10 个令牌），
 * 仅防御「CSS 未加载 / 令牌名写错」导致颜色变成空字符串。
 * 这里必须与 index.css 保持一致，审计脚本会逐项比对，防止两处漂移。
 */
const FALLBACK: Record<'light' | 'dark', string[]> = {
  light: [
    '#5B8FF9', '#5AD8A6', '#5D7092', '#F6BD16', '#E8684A',
    '#6DC8EC', '#9270CA', '#FF9D4D', '#269A99', '#BDC5D1',
  ],
  dark: [
    '#7AA8FC', '#6DE3B4', '#8899B5', '#FAD355', '#F08870',
    '#8BE0F8', '#B093E4', '#FFB67A', '#4EC2C0', '#D8DFE8',
  ],
};

const FALLBACK_SURFACE: Record<'light' | 'dark', string> = {
  light: '#F0EDE7',
  dark: '#1A1A17',
};

function readVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  return style.getPropertyValue(name).trim() || fallback;
}

/** 从当前主题的 CSS 变量读出图表色板。 */
export function readChartPalette(style: CSSStyleDeclaration, isDark: boolean): ChartPalette {
  const fb = isDark ? FALLBACK.dark : FALLBACK.light;
  const cat = fb.map((value, i) => readVar(style, `--chart-cat-${i + 1}`, value));
  return {
    cat,
    // 折线用主系列色（规范中 cat-1 = 主系列色 / 核心对比），不另设令牌以免两处色值漂移
    line: cat[0],
    surface: readVar(style, '--bg-secondary', FALLBACK_SURFACE[isDark ? 'dark' : 'light']),
  };
}

/* ────────────────────────── WCAG 2.x 计算 ────────────────────────── */

/** WCAG 相对亮度 */
export function relLuminance(hex: string): number {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度 */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// 深墨沿用设计令牌 --on-accent 的 #12100C（与按钮/胶囊一致），不用纯黑。
const INK_DARK = '#12100C';
const INK_LIGHT = '#FFFFFF';

/**
 * 按底色选前景色：深墨或白，取两者中实测对比度更高者（WCAG 1.4.3）。
 *
 * 直接比较两种墨色的对比度，而不用「亮度阈值」判断——阈值极容易被拟合错：
 * 曾经用的 0.42 就是为了让 #d4a840（L=0.4237）刚好落到深墨一侧而反推出来的，
 * 结果亮度落在交叉点与 0.42 之间的系列色全被推给了白字，实测 #EF7800 2.85:1、
 * #e8963a 2.37:1、#54a0d8 2.84:1、#5cb896 2.40:1、#e06060 3.49:1、#8b6cce 4.09:1。
 *
 * 注意：深墨 #12100C 不是纯黑，两种墨色对比度相等的交叉点在 L≈0.1909，该点最差约 4.36:1，
 * 即「任意底色都 ≥4.5:1」在数学上无法保证。当前 20 个图表令牌都不落在该危险区间内，
 * 实测最差 4.88:1，并由审计脚本锁定。
 */
export function onColor(bg: string): string {
  return contrast(INK_DARK, bg) >= contrast(INK_LIGHT, bg) ? INK_DARK : INK_LIGHT;
}

/** 把 #RRGGBB 转成带透明度的 rgba()，用于面积渐变等需要同色淡化处。 */
export function withAlpha(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 有序型数据取色：按名次/分值依次取 cat-1..cat-10，超过色板长度时循环。
 * 传入的是「真实名次」而不是视觉数组下标——颜色跟着条目走，
 * 因此不依赖 yAxis 的 reverse/inverse 视觉方向。
 */
export function seriesColorByIndex(cat: string[], index: number): string {
  if (cat.length === 0) return '#808080';
  const i = ((Math.trunc(index) % cat.length) + cat.length) % cat.length;
  return cat[i];
}

/** 按媒体类型取分类色；未知类型回退到调用方给的兜底色。 */
export function categoryColor(cat: string[], type: string, fallback: string): string {
  const index = MEDIA_TYPE_INDEX[type];
  return index === undefined ? fallback : cat[index] ?? fallback;
}
