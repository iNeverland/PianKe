#!/usr/bin/env node
/**
 * 密钥与"不该入库的文件"扫描门禁（零依赖）。
 *
 * 背景：`resources/tmdb-proxy.json` 曾带着真实 appToken 进入版本库（审查报告 H-1）。
 * 光把它移出索引不够——只要有人在别处再写一个明文口令，同样的坑就会再踩一次。
 * 这个脚本把"不该出现的东西"变成可执行的检查，挂到 CI 与本地校验里。
 *
 * 用法：
 *   node scripts/check-secrets.mjs
 *   npm run audit:secrets
 *
 * 退出码：0 = 通过；1 = 发现问题。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 允许含示例值的文件（模板文件天然会写"看起来像密钥"的占位符）。 */
const EXAMPLE_ALLOWLIST = [/(^|\/)\.env\.example$/, /\.example\.[a-z]+$/i, /win-signing\.env\.example$/];
/** 扫描器自身：里面的正则字面量不算泄露。 */
const SELF = path.join('scripts', 'check-secrets.mjs');

/** 绝对不允许被版本控制跟踪的路径。 */
const FORBIDDEN_TRACKED = [
  { pattern: /^resources\/tmdb-proxy\.json$/, why: '含与服务器共享的 x-app-token（真实口令）' },
  { pattern: /^server\/\.env$/, why: '含 TMDB_TOKEN 等真实凭据' },
  { pattern: /(^|\/)\.env$/, why: '环境变量文件通常含真实凭据' },
  { pattern: /\.(pfx|p12|pvk|key|pem)$/i, why: '私钥或签名证书' },
];

/** 内容规则：命中即失败。exclude 用于排除模板/示例文件。 */
const CONTENT_RULES = [
  {
    name: 'appToken 明文',
    pattern: /"appToken"\s*:\s*"[0-9a-fA-F]{32,}"/,
    why: '客户端配置文件里的真实共享口令不能入库',
  },
  {
    name: 'APP_TOKEN 赋值',
    pattern: /^\s*APP_TOKEN\s*=\s*[0-9a-fA-F]{32,}\s*$/m,
    why: '真实共享口令不能入库',
  },
  {
    name: 'TMDB v4 Token（JWT）',
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    why: 'TMDB 访问令牌不能入库',
  },
  {
    name: '私钥文件内容',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    why: '私钥不能入库',
  },
  {
    name: '签名口令赋值',
    pattern: /^\s*(WIN_CSC_KEY_PASSWORD|CSC_KEY_PASSWORD)\s*=\s*\S+/m,
    why: '证书口令不能入库',
  },
];

/** 已知泄露口令的指纹（只保留前 8 位十六进制，不足以还原原值）。 */
const KNOWN_LEAKED_PREFIX = 'b8e28de3';

function listTrackedFiles() {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf-8' });
    return output.split('\0').filter(Boolean).map((file) => file.replace(/\//g, path.sep));
  } catch {
    return null;
  }
}

function walkFallback() {
  const skipDirs = new Set(['.git', 'node_modules', 'dist', 'dist-electron', 'release', '.gradle-home', '.android-sdk', '.android-home', 'build', 'data']);
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        visit(full);
      } else {
        files.push(path.relative(root, full));
      }
    }
  };
  visit(root);
  return files;
}

function isAllowlisted(relative) {
  const posix = relative.replace(/\\/g, '/');
  return posix === SELF.replace(/\\/g, '/') || EXAMPLE_ALLOWLIST.some((rule) => rule.test(posix));
}

function mask(evidence) {
  const trimmed = evidence.trim();
  if (trimmed.length <= 16) return `${trimmed.slice(0, 6)}…`;
  return `${trimmed.slice(0, 12)}…（共 ${trimmed.length} 字符，已截断）`;
}

const tracked = listTrackedFiles();
const usingGit = tracked !== null;
const files = tracked ?? walkFallback();
const findings = [];

if (!usingGit) {
  console.warn('! 未检测到 git（或不在仓库内），退化为目录扫描；结果可能包含未跟踪文件。\n');
}

for (const relative of files) {
  const posix = relative.replace(/\\/g, '/');

  for (const rule of FORBIDDEN_TRACKED) {
    if (rule.pattern.test(posix)) {
      findings.push({ file: relative, line: 0, rule: '禁止入库的文件', why: rule.why, evidence: posix });
    }
  }

  if (isAllowlisted(relative)) continue;

  let content;
  try {
    const stat = fs.statSync(path.join(root, relative));
    if (stat.size > 2 * 1024 * 1024) continue; // 跳过超大文件（图片/锁文件）
    content = fs.readFileSync(path.join(root, relative), 'utf-8');
  } catch {
    continue;
  }
  if (content.includes('\0')) continue; // 二进制

  for (const rule of CONTENT_RULES) {
    const global = new RegExp(rule.pattern.source, rule.pattern.flags.includes('m') ? 'gm' : 'g');
    for (const match of content.matchAll(global)) {
      const line = content.slice(0, match.index).split('\n').length;
      findings.push({ file: relative, line, rule: rule.name, why: rule.why, evidence: mask(match[0]) });
    }
  }

  if (content.includes(KNOWN_LEAKED_PREFIX)) {
    const line = content.slice(0, content.indexOf(KNOWN_LEAKED_PREFIX)).split('\n').length;
    findings.push({
      file: relative,
      line,
      rule: '已知泄露口令',
      why: '这是 H-1 中已公开的旧口令片段，必须完全移除',
      evidence: KNOWN_LEAKED_PREFIX,
    });
  }
}

// 策略检查：这些路径必须始终被 .gitignore 忽略（防止有人删掉规则）
const MUST_BE_IGNORED = ['resources/tmdb-proxy.json', 'server/.env'];
if (usingGit) {
  for (const target of MUST_BE_IGNORED) {
    try {
      execFileSync('git', ['check-ignore', '-q', target], { cwd: root });
    } catch {
      findings.push({
        file: '.gitignore',
        line: 0,
        rule: '忽略规则缺失',
        why: `${target} 必须被 .gitignore 忽略`,
        evidence: target,
      });
    }
  }
}

console.log(`扫描了 ${files.length} 个${usingGit ? '已跟踪' : ''}文件，规则 ${CONTENT_RULES.length + FORBIDDEN_TRACKED.length + 1} 条\n`);

if (findings.length === 0) {
  console.log('✓ 未发现明文密钥或不应入库的文件');
  process.exit(0);
}

console.error(`✗ 发现 ${findings.length} 处问题：\n`);
for (const finding of findings) {
  const location = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
  console.error(`  ${location}`);
  console.error(`    规则：${finding.rule} —— ${finding.why}`);
  console.error(`    证据：${finding.evidence}\n`);
}
console.error('处理建议：');
console.error('  1) 从文件里删除真实值，改为从环境变量/CI Secret 注入（参见 scripts/inject-tmdb-proxy.mjs）；');
console.error('  2) 若该值曾经提交过，先轮换再清理历史（参见 scripts/purge-leaked-token.ps1）；');
console.error('  3) 模板文件请命名为 *.example.*，本脚本会跳过它们。');
process.exit(1);
