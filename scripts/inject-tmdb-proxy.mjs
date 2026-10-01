#!/usr/bin/env node
/**
 * 把 TMDB 代理配置写入 resources/tmdb-proxy.json。
 *
 * 背景：该文件含与服务端共享的 x-app-token，任何拿到安装包或仓库副本的人都能读出它，
 * 因此真实值绝不能进入版本库（`.gitignore` 已忽略该文件）。
 *
 * 取值优先级：
 *   1. 环境变量 PIANKE_TMDB_PROXY_URL / PIANKE_TMDB_PROXY_TOKEN（CI 用 Secret 注入，推荐）
 *   2. 已存在的本地 resources/tmdb-proxy.json（开发者自己的未跟踪副本）
 *
 * 用法：
 *   node scripts/inject-tmdb-proxy.mjs             # 尽力写入；两者都缺失时写占位文件并告警
 *   node scripts/inject-tmdb-proxy.mjs --require   # 发布构建用：两者都不可用则直接失败
 *
 * 安全约定：本脚本任何情况下都不打印令牌原文，只打印掩码与指纹，便于比对而不泄露。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'resources', 'tmdb-proxy.json');
const requireConfig = process.argv.includes('--require');

const envUrl = (process.env.PIANKE_TMDB_PROXY_URL || '').trim();
const envToken = (process.env.PIANKE_TMDB_PROXY_TOKEN || '').trim();

/** 令牌指纹：用于与服务器端日志比对，不可反推出原文。 */
function fingerprint(token) {
  if (!token) return '(未设置)';
  const hash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
  const masked = token.length <= 8 ? '****' : `${token.slice(0, 4)}…${token.slice(-4)}`;
  return `${masked} len=${token.length} fp=${hash}`;
}

function readExisting() {
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf-8'));
    const url = typeof parsed?.url === 'string' ? parsed.url.trim() : '';
    if (!url) return null;
    return { url, appToken: String(parsed.appToken || '').trim() };
  } catch {
    return null;
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

let config;
let source;

if (envUrl) {
  config = { url: envUrl, appToken: envToken };
  source = '环境变量 PIANKE_TMDB_PROXY_URL / PIANKE_TMDB_PROXY_TOKEN';
} else {
  const existing = readExisting();
  if (existing) {
    config = existing;
    source = `${path.relative(root, target)} 中的现有本地副本（未跟踪，不会被提交）`;
  }
}

if (!config) {
  if (requireConfig) {
    fail([
      '发布构建缺少 TMDB 代理配置。',
      '请在 CI 上配置 Secret 后重试：',
      '  PIANKE_TMDB_PROXY_URL   = https://你的代理域名',
      '  PIANKE_TMDB_PROXY_TOKEN = 与服务器 .env 的 APP_TOKEN 完全一致的值',
      '或在本机执行（PowerShell）：',
      '  $env:PIANKE_TMDB_PROXY_URL="https://你的代理域名"',
      '  $env:PIANKE_TMDB_PROXY_TOKEN="你的 APP_TOKEN"',
      '或先把 resources/tmdb-proxy.example.json 复制为 tmdb-proxy.json 并填好。',
    ].join('\n'));
  }
  // 非发布构建：写占位文件，保证 electron-builder 的 extraResources 一定有来源；
  // 运行时主进程会抛出「尚未配置 TMDB 代理服务器地址」，TMDB 导入不可用但应用正常。
  writeConfig({ url: '', appToken: '' });
  console.warn('⚠ 未提供 TMDB 代理配置，已写入占位文件；本构建的 TMDB 导入功能不可用。');
  process.exit(0);
}

if (!/^https?:\/\//i.test(config.url)) {
  fail(`TMDB 代理地址必须以 http(s):// 开头，当前为：${config.url}`);
}
if (!/^https:/i.test(config.url)) {
  console.warn('⚠ 代理地址不是 https，x-app-token 会在明文信道上传输，请尽快改用 https。');
}

writeConfig(config);

console.log(`✓ 已写入 ${path.relative(root, target)}`);
console.log(`  来源：${source}`);
console.log(`  地址：${config.url}`);
console.log(`  令牌：${fingerprint(config.appToken)}`);
if (!config.appToken) {
  console.warn('⚠ 未设置 appToken：代理将不鉴权，仅剩限流保护。');
}
if (requireConfig && source.startsWith('环境变量') === false) {
  console.warn('⚠ 本次发布使用的是本地未跟踪文件中的令牌；CI 发布请改用环境变量注入。');
}
