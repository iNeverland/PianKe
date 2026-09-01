// 从 src/assets/brand/PianKe.svg 生成 Capacitor Assets 需要的源图：
//   assets/icon.png        —— 1024x1024 应用图标（完整品牌 Logo，含橙色渐变背景）
//   assets/splash.png      —— 2732x2732 闪屏（深色背景 + 居中 Logo）
//   assets/splash-dark.png —— 2732x2732 深色模式闪屏（与应用暗色背景一致）
//
// 运行：node build/generate-android-assets.mjs
// 之后运行：npx @capacitor/assets generate --android

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const svgPath = path.join(root, 'src', 'assets', 'brand', 'PianKe.svg');
const assetsDir = path.join(root, 'assets');

const DARK_BG = { r: 8, g: 8, b: 13 }; // #08080d，与 index.html 首屏背景一致

fs.mkdirSync(assetsDir, { recursive: true });
const svgBuffer = fs.readFileSync(svgPath);

async function main() {
  // 1) 应用图标：完整 Logo 直接渲染到 1024x1024
  await sharp(svgBuffer).resize(1024, 1024).png().toFile(path.join(assetsDir, 'icon.png'));

  // 2) 闪屏 Logo：渲染到 900x900 后居中合成到深色背景
  const logo = await sharp(svgBuffer).resize(900, 900).png().toBuffer();

  const splashSvg = sharp({
    create: { width: 2732, height: 2732, channels: 3, background: DARK_BG },
  }).composite([{ input: logo, gravity: 'center' }]).png();

  await splashSvg.clone().toFile(path.join(assetsDir, 'splash.png'));
  await splashSvg.clone().toFile(path.join(assetsDir, 'splash-dark.png'));

  console.log('Generated:', path.join(assetsDir, 'icon.png'));
  console.log('Generated:', path.join(assetsDir, 'splash.png'));
  console.log('Generated:', path.join(assetsDir, 'splash-dark.png'));
}

main().catch((err) => {
  console.error('Failed to generate Android assets:', err);
  process.exit(1);
});
