#!/usr/bin/env node
/**
 * 设备凭据库运维工具。
 *
 * 用法：
 *   node device-admin.mjs list
 *   node device-admin.mjs revoke <deviceId>
 *   node device-admin.mjs prune --days 90 --yes
 *
 * 选项：
 *   --state-dir <dir>  设备库目录（默认取环境变量 STATE_DIRECTORY，否则用脚本同级的 data/）
 *   --port <port>      用来探测服务是否在运行（默认取 PORT，否则 8787）
 *   --force            服务正在运行时仍然强制写入（危险：服务的内存副本会覆盖本次改动）
 *
 * 重要：pianke-tmdb 会把设备库常驻在内存里并定时落盘。若服务正在运行，
 * 从外部改文件会在下一次落盘时被覆盖，因此本工具默认拒绝在服务运行时写入。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeviceStore } from './devices.mjs';

const argv = process.argv.slice(2);

function takeOption(name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  argv.splice(index, 2);
  return value ?? fallback;
}

const stateDirOption = takeOption('--state-dir', '');
const portOption = takeOption('--port', '');
const force = argv.includes('--force');
if (force) argv.splice(argv.indexOf('--force'), 1);
const assumeYes = argv.includes('--yes');
if (assumeYes) argv.splice(argv.indexOf('--yes'), 1);
const daysOption = takeOption('--days', '');

const [command, argument] = argv;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const stateDir = stateDirOption || process.env.STATE_DIRECTORY || path.join(scriptDir, 'data');
const port = Number(portOption || process.env.PORT || 8787);

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function serviceRunning() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/healthz`, { signal: AbortSignal.timeout(1500) });
    return res.status === 200 || res.status === 503; // 503 = 已启动但没配 TMDB_TOKEN
  } catch {
    return false;
  }
}

async function guardRunningService(action) {
  if (force) return;
  if (!(await serviceRunning())) return;
  fail([
    `检测到 pianke-tmdb 正在运行（127.0.0.1:${port}）。`,
    `服务把设备库常驻内存，现在执行「${action}」会在它下次落盘时被覆盖。`,
    '请先停服再操作：',
    '  systemctl stop pianke-tmdb',
    `  node device-admin.mjs ${action}`,
    '  systemctl start pianke-tmdb',
    '（确实要在运行中写入时加 --force，但改动很可能丢失。）',
  ].join('\n'));
}

function printList(store) {
  const records = store.list();
  if (records.length === 0) {
    console.log('设备库为空。');
    return;
  }
  console.log(`设备库：${store.filePath}`);
  console.log(`共 ${records.length} 个设备（上限 ${store.maxDevices}）\n`);
  console.log('deviceId          请求数    最近使用              注册时间              备注');
  console.log('─'.repeat(100));
  for (const record of records.sort((a, b) => (b.lastSeenAt || b.createdAt).localeCompare(a.lastSeenAt || a.createdAt))) {
    console.log([
      record.deviceId.padEnd(17),
      String(record.requests).padStart(6),
      '  ',
      (record.lastSeenAt || '从未使用').padEnd(21),
      record.createdAt.padEnd(21),
      record.label,
    ].join(''));
  }
  console.log('\n吊销某个设备：node device-admin.mjs revoke <deviceId>');
}

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    const text = fs.readFileSync(fileURLToPath(import.meta.url), 'utf-8');
    const usage = text.split('*/')[0].replace(/^\/\*\*?/, '').split('\n').map((line) => line.replace(/^\s?\* ?/, '')).join('\n');
    console.log(usage.trim());
    return;
  }

  const store = createDeviceStore({ stateDir });
  store.load();

  if (command === 'list') {
    printList(store);
    return;
  }

  if (command === 'revoke') {
    if (!argument) fail('用法：node device-admin.mjs revoke <deviceId>');
    await guardRunningService('revoke');
    const target = store.list().find((record) => record.deviceId.startsWith(argument));
    if (!target) fail(`找不到设备：${argument}`);
    if (!store.revoke(target.deviceId)) fail('吊销失败：设备不存在');
    console.log(`✓ 已吊销设备 ${target.deviceId}（${target.label || '未命名'}）`);
    console.log('  该设备下次请求会收到 401；客户端会自动重新注册并拿到新的凭据。');
    return;
  }

  if (command === 'prune') {
    const days = Number(daysOption);
    if (!Number.isFinite(days) || days <= 0) fail('用法：node device-admin.mjs prune --days 90 --yes');
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const stale = store.list().filter((record) => {
      const seen = record.lastSeenAt || record.createdAt || '';
      return seen && seen < cutoff;
    });
    if (stale.length === 0) {
      console.log(`没有超过 ${days} 天未使用的设备。`);
      return;
    }
    console.log(`以下 ${stale.length} 个设备超过 ${days} 天未使用：`);
    for (const record of stale) console.log(`  ${record.deviceId}  ${record.lastSeenAt || record.createdAt}  ${record.label}`);
    if (!assumeYes) {
      console.log('\n确认删除请追加 --yes 重新执行。');
      return;
    }
    await guardRunningService('prune');
    const removed = store.pruneNotSeenSince(cutoff);
    console.log(`✓ 已清理 ${removed.length} 个设备`);
    return;
  }

  fail(`未知命令：${command}（可用：list / revoke / prune）`);
}

await main();
