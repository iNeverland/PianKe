/**
 * TMDB 代理连通性与口令一致性诊断。
 *
 * 用法：node scripts/check-tmdb-proxy.mjs
 *
 * 取值优先级与 scripts/inject-tmdb-proxy.mjs 保持一致：
 *   1. 环境变量 PIANKE_TMDB_PROXY_URL / PIANKE_TMDB_PROXY_TOKEN
 *   2. resources/tmdb-proxy.json（本地未跟踪副本，由 inject 脚本或手工生成）
 *
 * 它会分别测试：代理服务器的真实接口、代理根路径、TMDB 官方地址，
 * 用来区分「连不上自己的代理」和「TMDB 被封」这两种完全不同的故障。
 * 全程只打印口令的掩码与指纹，不会输出令牌原文。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'resources', 'tmdb-proxy.json');
const timeout = 15000;

/** 与服务端启动日志同算法的指纹，便于两端比对而不泄露原文。 */
function fingerprint(token) {
  if (!token) return '(未设置)';
  const hash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
  const masked = token.length <= 8 ? '****' : `${token.slice(0, 4)}…${token.slice(-4)}`;
  return `${masked} len=${token.length} fp=${hash}`;
}

function loadConfig() {
  const envUrl = (process.env.PIANKE_TMDB_PROXY_URL || '').trim();
  if (envUrl) {
    return {
      source: '环境变量 PIANKE_TMDB_PROXY_URL',
      config: { url: envUrl, appToken: (process.env.PIANKE_TMDB_PROXY_TOKEN || '').trim() },
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const url = typeof parsed?.url === 'string' ? parsed.url.trim() : '';
    if (url) {
      return {
        source: path.relative(root, configPath),
        config: { url, appToken: String(parsed.appToken || '').trim() },
      };
    }
  } catch {
    // 落到下面的引导信息
  }
  return null;
}

const loaded = loadConfig();
if (!loaded) {
  console.error('✗ 找不到 TMDB 代理配置。\n');
  console.error('  该配置含与服务端共享的口令，已从版本库移除（见 .gitignore）。三种提供方式：');
  console.error('  1) 临时环境变量（PowerShell）：');
  console.error('       $env:PIANKE_TMDB_PROXY_URL="https://你的代理域名"');
  console.error('       $env:PIANKE_TMDB_PROXY_TOKEN="你的 APP_TOKEN"');
  console.error('  2) 复制模板后填值：resources/tmdb-proxy.example.json → resources/tmdb-proxy.json');
  console.error('  3) 生成给打包用的文件：npm run tmdb:proxy:config\n');
  process.exit(1);
}

const { config, source } = loaded;
const base = config.url.replace(/\/+$/, '');
const headers = config.appToken ? { 'x-app-token': config.appToken } : {};

async function probe(label, url, requestHeaders = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: requestHeaders, signal: AbortSignal.timeout(timeout) });
    const text = (await res.text()).slice(0, 160).replace(/\s+/g, ' ');
    console.log(`✓ ${label}: HTTP ${res.status} (${Date.now() - started}ms) ${text}`);
    return res.status;
  } catch (err) {
    console.log(`✗ ${label}: ${err.name} - ${err.message}${err.cause ? ` (${err.cause.code || err.cause.message})` : ''}`);
    return null;
  }
}

console.log(`配置来源: ${source}`);
console.log(`代理地址: ${base}`);
console.log(`客户端口令: ${fingerprint(config.appToken)}`);
console.log('');

await probe('1. 代理服务器 /api/search（应用真正调用的接口）', `${base}/api/search?q=test`, headers);
await probe('2. 代理服务器根路径', `${base}/`, headers);
await probe('3. TMDB 官方 api.themoviedb.org（预期在国内不通）', 'https://api.themoviedb.org/3/search/multi?query=test');
await probe('4. TMDB 图片 image.tmdb.org（预期在国内不通）', 'https://image.tmdb.org/t/p/w500/test.jpg');

console.log('');
console.log('判读：');
console.log('  1 通 + 3/4 不通 → 正常设计，代理在起作用。');
console.log('  1 不通        → 当前网络访问不到代理域名（DNS/连接层）。');
console.log('  1 返回 401    → 反代或服务端的口令与上面这个不一致：');
console.log('                  比对三处：反代配置里的 __APP_TOKEN_REGEX__、/opt/pianke/server/.env 的');
console.log('                  APP_TOKEN(/APP_TOKEN_PREVIOUS)、以及本次打包注入的 PIANKE_TMDB_PROXY_TOKEN。');
console.log('                  服务端启动日志会打印每个有效口令的指纹，可直接与本脚本的 fp 对照。');
console.log('  1 返回 500    → 代理服务器没有配置 TMDB_TOKEN（见 server/.env.example）。');
if (!config.appToken) {
  console.log('  提示：本次未携带口令。若服务端配置了 APP_TOKEN，上面的 401 就属预期。');
}
console.log('');
console.log(`打包时请用同一组值：npm run tmdb:proxy:config（或配置 CI Secret）。`);
