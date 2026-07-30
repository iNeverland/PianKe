// 生成 NSIS 安装程序侧边栏 BMP（164×314，品牌色渐变）
const fs = require('fs');
const path = require('path');

const W = 164;
const H = 314;
const FILE_HEADER_SIZE = 14;
const DIB_HEADER_SIZE = 40;
const PIXEL_OFFSET = FILE_HEADER_SIZE + DIB_HEADER_SIZE;
const ROW_SIZE = ((W * 3 + 3) >> 2) << 2; // 每行 4 字节对齐
const PIXEL_SIZE = ROW_SIZE * H;
const FILE_SIZE = PIXEL_OFFSET + PIXEL_SIZE;

const buf = Buffer.alloc(FILE_SIZE);

// BMP File Header
buf.write('BM', 0);                    // magic
buf.writeUInt32LE(FILE_SIZE, 2);      // file size
buf.writeUInt32LE(0, 6);              // reserved
buf.writeUInt32LE(PIXEL_OFFSET, 10);  // pixel offset

// DIB Header (BITMAPINFOHEADER)
buf.writeUInt32LE(DIB_HEADER_SIZE, 14);  // header size
buf.writeInt32LE(W, 18);                  // width
buf.writeInt32LE(H, 22);                  // height
buf.writeUInt16LE(1, 26);                 // planes
buf.writeUInt16LE(24, 28);                // bpp
buf.writeUInt32LE(0, 30);                 // compression (BI_RGB)
buf.writeUInt32LE(PIXEL_SIZE, 34);        // image size
buf.writeInt32LE(2835, 38);               // h-res (72 DPI)
buf.writeInt32LE(2835, 42);               // v-res (72 DPI)
buf.writeUInt32LE(0, 46);                 // colors
buf.writeUInt32LE(0, 50);                 // important colors

// 渐变：顶部深色 → 中间橙色 → 底部深色
// 品牌色: 橙色 #FF8000, 深色 #1a1a1a
function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

for (let y = 0; y < H; y++) {
  const t = y / (H - 1); // 0 顶部 → 1 底部

  // 上方深色区域 (0-30%)：暗色 → 接近橙色
  // 中间橙色带 (30-50%)：最亮橙色
  // 下方深色区域 (50-100%)：橙色 → 暗色

  let r, g, b;
  if (t < 0.3) {
    // 顶部深色渐变到橙色
    const s = t / 0.3;
    r = lerp(26, 255, s);
    g = lerp(26, 128, s);
    b = lerp(26, 0, s);
  } else if (t < 0.5) {
    // 橙色高亮区域
    r = 255; g = 128; b = 0;
  } else {
    // 橙色渐变回深色
    const s = (t - 0.5) / 0.5;
    r = lerp(255, 26, s);
    g = lerp(128, 26, s);
    b = lerp(0, 26, s);
  }

  const rowOffset = PIXEL_OFFSET + y * ROW_SIZE;
  for (let x = 0; x < W; x++) {
    const pixelOffset = rowOffset + x * 3;
    buf[pixelOffset] = b;     // B
    buf[pixelOffset + 1] = g; // G
    buf[pixelOffset + 2] = r; // R
  }
}

const outPath = path.join(__dirname, '..', 'resources', 'installer-sidebar.bmp');
fs.writeFileSync(outPath, buf);
console.log(`Sidebar BMP generated: ${outPath} (${W}×${H})`);
