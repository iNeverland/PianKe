#!/usr/bin/env node
/**
 * 无障碍对比度回归检查（WCAG 2.1/2.2）
 *
 * 直接解析 src/index.css 的三套主题令牌（浅色 / 手动深色 / 系统深色），
 * 对关键「前景 × 背景」组合断言阈值：
 *   - 正文与强调色文字：≥ 4.5:1（WCAG 1.4.3 AA）
 *   - 控件边界、焦点环、图形状态：≥ 3:1（WCAG 1.4.11 AA）
 * 任一组合不达标则以退出码 1 结束，可直接接入 CI。
 *
 * 另含图表配色（--chart-*）专项断言：
 *   - 图形（色阶/分类色/折线）对图表底 --bg-secondary：≥ 3:1
 *   - 扇区内文字标签（色阶/分类色作底）：≥ 4.5:1
 *   - 色阶亮度单调（有序量必须读得出高低）
 *   - 分类色两两可区分（色相或亮度拉开距离）
 *   - src/lib/chartPalette.ts 的兜底值与 CSS 令牌一致（CSS 是唯一事实来源）
 *
 * 用法：npm run audit:contrast
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
const paletteSrc = fs.readFileSync(path.join(root, 'src/lib/chartPalette.ts'), 'utf8');

/* ---------- 颜色计算 ---------- */
const parseHex = (h) => {
  let s = h.trim().replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
};
const linear = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const luminance = (hex) => {
  const [r, g, b] = parseHex(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * 扇区内文字取「深墨或白」两种墨色中对比度更高者——与 src/lib/chartPalette.ts
 * 的 onColor() 同一策略。这里断言「较优的那种墨色 ≥4.5:1」，
 * 等价于保证实际渲染出的标签达标（也顺带锁死「墨色死区」L∈(0.1833,0.1987)：
 * 落进该区间则两种墨色都不足 4.5:1，断言会直接失败）。
 */
const INK_CANDIDATES = ['#12100C', '#ffffff'];
const bestInkContrast = (bg) => Math.max(...INK_CANDIDATES.map((ink) => contrast(ink, bg)));

/** 色相（0-360），用于分类色区分度检查 */
const hue = (hex) => {
  const [r, g, b] = parseHex(hex);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  let h;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return (h + 360) % 360;
};
const hueDelta = (a, b) => {
  const d = Math.abs(hue(a) - hue(b));
  return d > 180 ? 360 - d : d;
};

/* ---------- 解析主题块 ---------- */
function blockAt(selector, fromIndex = 0) {
  const at = css.indexOf(selector, fromIndex);
  if (at < 0) throw new Error(`未找到主题块：${selector}`);
  const open = css.indexOf('{', at);
  let depth = 0;
  let i = open;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return css.slice(open, i + 1);
}

function tokensIn(body) {
  const tokens = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const value = m[2].trim();
    // 以去掉 `--` 的短名做键，方便断言表书写
    if (/^#[0-9a-fA-F]{3,8}$/.test(value)) tokens[m[1].replace(/^--/, '')] = value;
  }
  return tokens;
}

/** 浅色主题块是文件里第二个 `:root {`（第一个只放字体变量），按是否含 --bg-deep 识别。 */
function lightTokens() {
  let from = 0;
  for (;;) {
    const at = css.indexOf(':root {', from);
    if (at < 0) throw new Error('未找到浅色主题块');
    const tokens = tokensIn(blockAt(':root {', at));
    if (tokens['bg-deep']) return tokens;
    from = at + 1;
  }
}

const themes = {
  '浅色 light': lightTokens(),
  '深色 dark（手动）': tokensIn(blockAt(':root[data-theme="dark"] {')),
  '深色 dark（系统）': tokensIn(blockAt(':root:not([data-theme="light"]) {')),
};

/* ---------- 断言表 ---------- */
const checks = [
  ['正文 text-primary / bg-deep', 'text-primary', 'bg-deep', 4.5],
  ['次级文字 text-secondary / bg-deep', 'text-secondary', 'bg-deep', 4.5],
  ['弱化文字 text-muted / bg-deep', 'text-muted', 'bg-deep', 4.5],
  ['弱化文字 text-muted / bg-elevated', 'text-muted', 'bg-elevated', 4.5],
  ['强调色文字 accent-text / bg-deep', 'accent-text', 'bg-deep', 4.5],
  ['强调色文字 accent-text / bg-elevated', 'accent-text', 'bg-elevated', 4.5],
  ['实心强调块前景 on-accent / accent', 'on-accent', 'accent', 4.5],
  ['评分 star-color / bg-card', 'star-color', 'bg-card', 4.5],
  ['错误色 red / bg-card', 'red', 'bg-card', 4.5],
  ['成功色 green / bg-card', 'green', 'bg-card', 4.5],
  ['信息色 blue / bg-card', 'blue', 'bg-card', 4.5],
  ['危险按钮白字 #ffffff / red-solid', '#ffffff', 'red-solid', 4.5],
  ['状态徽标 on-accent / status-watching', 'on-accent', 'status-watching', 4.5],
  ['状态徽标 on-accent / status-watched', 'on-accent', 'status-watched', 4.5],
  ['状态徽标 on-accent / status-want', 'on-accent', 'status-want', 4.5],
  ['热力图 l1 前景/填充', 'heat-l1-on', 'heat-l1', 4.5],
  ['热力图 l2 前景/填充', 'heat-l2-on', 'heat-l2', 4.5],
  ['热力图 l3 前景/填充', 'heat-l3-on', 'heat-l3', 4.5],
  ['热力图 l4 前景/填充', 'heat-l4-on', 'heat-l4', 4.5],
  // 输入类控件的 3:1 边界（下划线形态承载，WCAG 1.4.11）
  ['输入类边界 border-control / bg-deep', 'border-control', 'bg-deep', 3],
  ['输入类边界 border-control / bg-elevated', 'border-control', 'bg-elevated', 3],
  ['输入类边界 border-control / bg-card', 'border-control', 'bg-card', 3],
  // 弹窗/菜单/带标签按钮的描边：柔和发丝线，只守"肉眼可见"下限（1.4.11 不强制面板边界）
  ['描边可见性 border-strong / bg-deep（下限）', 'border-strong', 'bg-deep', 1.5],
  ['描边可见性 border-strong / bg-elevated（下限）', 'border-strong', 'bg-elevated', 1.5],
  ['描边可见性 border-strong / bg-card（下限）', 'border-strong', 'bg-card', 1.5],
  ['焦点环 focus-ring / bg-deep', 'focus-ring', 'bg-deep', 3],
  ['焦点环 focus-ring / bg-elevated', 'focus-ring', 'bg-elevated', 3],
];

const resolve = (tokens, key) => (key.startsWith('#') ? key : tokens[key]);

/* ---------- 图表配色契约 ---------- */
/**
 * 设计方《图表色彩规范表》提供 10 个分类色，浅/深各一套。
 * 有序图表按名次/分值依次取 cat-1..cat-10；折线用 cat-1（主系列色）。
 */
const CAT_KEYS = Array.from({ length: 10 }, (_, i) => `chart-cat-${i + 1}`);
/** 分类色两两至少要拉开这么多色相，或这么多亮度（仅告警） */
const MIN_HUE_DELTA = 30;
const MIN_LUM_DELTA = 0.15;

/**
 * 浅色主题的「图形对底色」对比度只告警、不判失败。
 *
 * 原因：设计方明确选择保留其规范表的 HEX 原值，而该表按 #FFFFFF~#F8F9FA 环境调校；
 * 本 App 图表卡片底是 --bg-secondary(#f0ede7)，更暖更深，于是 8/10 个色块对该底仅
 * 1.47–2.92:1（即便换纯白底，cat-2/4/6/8/10 也只有 1.72–2.06:1），低于 3:1 的图形
 * 可见度设计下限。这是已确认的设计取舍，不应让 CI 变红。
 *
 * 仍然保持「失败级」的部分：深色主题的图形对比、两套主题的扇区内文字对比、
 * 令牌是否存在、兜底值是否同步 —— 这些一旦回归必须拦住。
 */
const RELAX_LIGHT_MARK = true;

let failures = 0;
let warnings = 0;
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };
const warn = (msg) => { warnings++; console.log(`  WARN  ${msg}`); };
const pass = (msg) => console.log(`  PASS  ${msg}`);

for (const [themeName, tokens] of Object.entries(themes)) {
  console.log(`\n===== ${themeName} =====`);
  for (const [label, fgKey, bgKey, need] of checks) {
    const fg = resolve(tokens, fgKey);
    const bg = resolve(tokens, bgKey);
    if (!fg || !bg) {
      console.log(`  ??  跳过（缺少令牌）${label}`);
      failures++;
      continue;
    }
    const ratio = contrast(fg, bg);
    const ok = ratio >= need;
    if (!ok) failures++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${ratio.toFixed(2).padStart(5)}:1 (需 ${need})  ${label}`);
  }

  /* ── 图表配色 ── */
  console.log('  ── 图表配色（--chart-cat-1..10）──');
  const chartBg = tokens['bg-secondary'];
  const isLightTheme = themeName.startsWith('浅色');
  if (!chartBg) {
    fail('缺少 --bg-secondary（图表容器 .stat-card-contained 的底色）');
  } else {
    for (const key of CAT_KEYS) {
      const color = tokens[key];
      if (!color) {
        fail(`缺少 --${key}（图形色 / 扇区内文字底色）`);
        continue;
      }
      const mark = contrast(color, chartBg);
      const markOk = mark >= 3;
      const labelRatio = bestInkContrast(color);
      const labelOk = labelRatio >= 4.5;
      // 文字对比永远是失败级；图形对比在浅色主题按设计取舍降为告警
      const markIsWarning = !markOk && isLightTheme && RELAX_LIGHT_MARK;
      if (!labelOk) failures++;
      else if (!markOk && !markIsWarning) failures++;

      const labelPart = `  扇区内文字 ${labelRatio.toFixed(2).padStart(5)}:1 (需 4.5)${labelOk ? '' : ' ←不达标'}`;
      const markPart = `图形 ${mark.toFixed(2).padStart(5)}:1 (需 3)${markOk ? '' : markIsWarning ? ' ←按设计取舍告警' : ' ←不达标'}`;
      const status = !labelOk ? 'FAIL' : !markOk ? (markIsWarning ? 'WARN' : 'FAIL') : 'PASS';
      console.log(`  ${status}  ${markPart}${labelPart}  --${key}`);
    }

    // 分类色两两可区分：色相或亮度必须拉开。设计方配色有若干近色对，故只告警。
    const cats = CAT_KEYS.map((k) => tokens[k]).filter(Boolean);
    if (cats.length === CAT_KEYS.length) {
      const tooClose = [];
      for (let i = 0; i < cats.length; i++) {
        for (let j = i + 1; j < cats.length; j++) {
          const dh = hueDelta(cats[i], cats[j]);
          const dl = Math.abs(luminance(cats[i]) - luminance(cats[j]));
          if (dh < MIN_HUE_DELTA && dl < MIN_LUM_DELTA) {
            tooClose.push(`cat-${i + 1}(${cats[i]}) ↔ cat-${j + 1}(${cats[j]}) Δ色相=${dh.toFixed(0)}° Δ亮度=${dl.toFixed(3)}`);
          }
        }
      }
      if (tooClose.length === 0) pass(`分类色两两可区分（Δ色相 ≥${MIN_HUE_DELTA}° 或 Δ亮度 ≥${MIN_LUM_DELTA}）`);
      else {
        warn(`分类色有 ${tooClose.length} 对在色相与亮度上都较接近（设计方原值，仅提示）：`);
        tooClose.forEach((m) => warn(`  ${m}`));
      }
    }
  }
}

/* ---------- 兜底值与 CSS 令牌一致性（CSS 是唯一事实来源） ---------- */
console.log('\n===== chartPalette.ts 兜底值 vs index.css 令牌 =====');
// FALLBACK 是 `{ light: [...], dark: [...] }` 形式的数组；FALLBACK_SURFACE 是字符串表。
const fbArray = (theme) => paletteSrc.match(new RegExp(`${theme}:\\s*\\[([\\s\\S]*?)\\]`))?.[1].match(/#[0-9a-fA-F]{6}/g) || [];
const fbSurface = (theme) => paletteSrc.match(new RegExp(`FALLBACK_SURFACE[\\s\\S]*?${theme}:\\s*'(#[0-9a-fA-F]{6})'`))?.[1];

for (const [theme, tokens] of [['light', themes['浅色 light']], ['dark', themes['深色 dark（手动）']]]) {
  const fbs = fbArray(theme);
  const pairs = [
    ...CAT_KEYS.map((k, i) => [`cat[${i}]`, fbs[i], tokens[k]]),
    ['surface', fbSurface(theme), tokens['bg-secondary']],
  ];
  for (const [name, fb, token] of pairs) {
    if (!fb) { fail(`FALLBACK.${theme}.${name} 未解析到色值`); continue; }
    if (!token) { fail(`index.css 缺少对应令牌（${name}）`); continue; }
    const ok = fb.toLowerCase() === token.toLowerCase();
    if (!ok) failures++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${theme}.${name}: ${fb} vs ${token}${ok ? '' : ' ←两者不一致，请同步'}`);
  }
}

if (warnings > 0) {
  console.log(`\nℹ️  ${warnings} 项告警（不阻塞 CI）`);
  console.log('    浅色图形对比与分类色近色对均来自设计方规范原值，属已确认的设计取舍；');
  console.log('    详见 src/index.css 中 --chart-cat-* 上方注释与 scripts/check-a11y-contrast.mjs 的 RELAX_LIGHT_MARK。');
}
console.log(
  failures === 0
    ? '\n✅ 全部对比度断言通过'
    : `\n❌ 有 ${failures} 项未达标，请检查 src/index.css 的主题令牌`,
);
process.exit(failures === 0 ? 0 : 1);
