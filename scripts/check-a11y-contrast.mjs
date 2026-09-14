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
 * 用法：npm run audit:contrast
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');

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

let failures = 0;
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
}

console.log(
  failures === 0
    ? '\n✅ 全部对比度断言通过'
    : `\n❌ 有 ${failures} 项未达标，请检查 src/index.css 的主题令牌`,
);
process.exit(failures === 0 ? 0 : 1);
