/**
 * TMDB 代理连通性诊断脚本。
 *
 * 用法：node scripts/check-tmdb-proxy.mjs
 *
 * 它会分别测试：客户端配置文件里的代理地址、TMDB 官方地址、以及「直连 TMDB」，
 * 用来区分「连不上自己的代理」和「TMDB 被封」这两种完全不同的故障。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'resources', 'tmdb-proxy.json');

let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch {
  console.error(`✗ 读不到 ${configPath}`);
  process.exit(1);
}

const timeout = 15000;

async function probe(label, url, headers = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
    const text = (await res.text()).slice(0, 160).replace(/\s+/g, ' ');
    console.log(`✓ ${label}: HTTP ${res.status} (${Date.now() - started}ms) ${text}`);
    return res.status;
  } catch (err) {
    console.log(`✗ ${label}: ${err.name} - ${err.message}${err.cause ? ` (${err.cause.code || err.cause.message})` : ''}`);
    return null;
  }
}

console.log(`代理地址: ${config.url || '(未配置)'}`);
console.log('');

const headers = config.appToken ? { 'x-app-token': config.appToken } : {};

await probe('1. 代理服务器 /api/search（应用真正调用的接口）', `${config.url}/api/search?q=test`, headers);
await probe('2. 代理服务器根路径', `${config.url}/`, headers);
await probe('3. TMDB 官方 api.themoviedb.org（预期在国内不通）', 'https://api.themoviedb.org/3/search/multi?query=test');
await probe('4. TMDB 图片 image.tmdb.org（预期在国内不通）', 'https://image.tmdb.org/t/p/w500/test.jpg');

console.log('');
console.log('判读：');
console.log('  1 通 + 3/4 不通 → 正常设计，代理在起作用；应用仍报错请检查客户端里的 tmdb-proxy.json 是否与这里一致。');
console.log('  1 不通 → 你的网络访问不到代理域名（换一个国内可达的部署地址，或改写 resources/tmdb-proxy.json 后重新打包）。');
console.log('  1 返回 401 → 代理服务器 APP_TOKEN 与客户端 appToken 不一致。');
console.log('  1 返回 500 → 代理服务器没有配置 TMDB_TOKEN。');
