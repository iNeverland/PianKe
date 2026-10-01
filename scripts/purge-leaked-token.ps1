#Requires -Version 5.1
<#
.SYNOPSIS
  从 Git 历史中彻底移除「曾经提交过的密钥文件」（审查报告 H-1 的历史残留部分）。

.DESCRIPTION
  `git rm --cached` 只能让文件不再出现在「以后的提交」里，历史提交中的内容依然可见
  （`git log --all -- resources/tmdb-proxy.json` 依旧能翻出来）。本脚本负责把历史也清掉。

  默认是「预演」：只打印将要做什么，不动任何数据。确认后再加 -Execute 真正执行。

  重要前提（务必先读）：
    1. 先轮换口令，再清历史。轮换之后旧口令已经失效，历史里的那串字符就不再是秘密，
       清历史此时只是「卫生」而非「救火」；反过来只清历史不轮换则毫无意义。
    2. 重写历史会改写所有提交哈希，因此：
       - 已有的 tag（例如 v1.3.0）指向的提交会变，GitHub Release 需要重新发布；
       - 所有协作者必须重新 clone，不能继续用旧仓库直接 pull；
       - 必须强制推送（--force-with-lease 或 --force），否则远端不会更新。
    3. 脚本一定会先做一份 mirror 备份，并且**不会**替你推送。

.PARAMETER Path
  要清理的仓库相对路径。默认 resources/tmdb-proxy.json。

.PARAMETER Execute
  真正执行重写。不加则只预演。

.PARAMETER Force
  工作区有未提交改动时也继续（默认拒绝）。

.EXAMPLE
  .\scripts\purge-leaked-token.ps1
  .\scripts\purge-leaked-token.ps1 -Execute
#>
[CmdletBinding()]
param(
  [string]$Path = 'resources/tmdb-proxy.json',
  [switch]$Execute,
  [switch]$Force
)

function Write-Info($message) { Write-Host "==> $message" -ForegroundColor Green }
function Write-Warn2($message) { Write-Host "[!] $message" -ForegroundColor Yellow }
function Die($message) { Write-Host "[x] $message" -ForegroundColor Red; exit 1 }

function Invoke-Git {
  param([string[]]$Arguments)
  & git @Arguments
  return $LASTEXITCODE
}

# ── 0. 基本环境 ──────────────────────────────────────────────────────────────
$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $repoRoot) { Die '当前目录不是 Git 仓库。' }
Set-Location $repoRoot
Write-Info "仓库根目录：$repoRoot"
Write-Info "目标路径：$Path"

$historyHits = @(& git log --all "--pretty=format:%h|%ad|%s" --date=short -- $Path 2>$null)
if ($historyHits.Count -eq 0) {
  Write-Host ''
  Write-Host '✓ 历史中未发现该文件，无需清理。' -ForegroundColor Green
  exit 0
}

# ── 1. 预演 / 说明 ───────────────────────────────────────────────────────────
Write-Host ''
Write-Warn2 "该文件出现在 $($historyHits.Count) 个历史提交中（只显示前 5 条）："
$historyHits | Select-Object -First 5 | ForEach-Object { Write-Host "    $_" }

$remoteUrl = (& git remote get-url origin 2>$null)
$backupDir = Join-Path (Split-Path $repoRoot -Parent) ("{0}-history-backup-{1}.git" -f (Split-Path $repoRoot -Leaf), (Get-Date -Format 'yyyyMMdd-HHmmss'))

Write-Host ''
Write-Host '将要执行的操作：'
Write-Host "  1) 备份整个仓库到 $backupDir"
Write-Host "  2) 用 git filter-repo（缺失时回退 git filter-branch）从所有分支与标签中删除 $Path"
Write-Host '  3) 过期 reflog 并 gc，确保旧对象不可达'
Write-Host '  4) 校验历史中不再包含该路径'
Write-Host ''
Write-Host '会产生的后果：'
Write-Host '  · 所有提交哈希改变；已有 tag 指向的提交随之改变，GitHub Release 需重新发布'
Write-Host '  · 协作者必须重新 clone；继续 pull 会把旧历史合并回来'
Write-Host "  · git filter-repo 默认会移除 origin 远端（结束后需重新 add，原地址：$remoteUrl）"
Write-Host ''

if (-not $Execute) {
  Write-Warn2 '以上为预演。确认无误后加 -Execute 真正执行：'
  Write-Host "    .\scripts\purge-leaked-token.ps1 -Path '$Path' -Execute"
  Write-Host ''
  Write-Host '再次提醒：请先完成口令轮换（见 docs/tmdb-proxy-selfhost.md 的「口令轮换」）。'
  exit 0
}

# ── 2. 安全前置检查 ──────────────────────────────────────────────────────────
$dirty = @(& git status --porcelain 2>$null)
if ($dirty.Count -gt 0 -and -not $Force) {
  Write-Warn2 '工作区有未提交改动：'
  $dirty | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" }
  Die '请先提交或 stash，确认无误后可加 -Force 跳过本检查。'
}

# ── 3. 备份 ─────────────────────────────────────────────────────────────────
Write-Info "备份到 $backupDir"
& git clone --mirror $repoRoot $backupDir
if ($LASTEXITCODE -ne 0) { Die '备份失败，已中止（未做任何修改）。' }
Write-Info '备份完成'

# ── 4. 重写历史 ─────────────────────────────────────────────────────────────
& git filter-repo --version *> $null
$hasFilterRepo = ($LASTEXITCODE -eq 0)

if ($hasFilterRepo) {
  Write-Info '使用 git filter-repo'
  Invoke-Git @('filter-repo', '--path', $Path, '--invert-paths', '--force') | Out-Null
} else {
  Write-Warn2 '未找到 git filter-repo，回退到 git filter-branch（较慢，且需要额外清理）'
  Write-Warn2 '推荐安装：pip install git-filter-repo'
  $indexFilter = "git rm --cached --ignore-unmatch `"$Path`""
  Invoke-Git @('filter-branch', '--force', '--index-filter', $indexFilter, '--prune-empty', '--tag-name-filter', 'cat', '--', '--all') | Out-Null
  if ($LASTEXITCODE -ne 0) { Die "重写失败；仓库仍可用，备份在 $backupDir" }
  Write-Info '清理 refs/original 与 reflog'
  Invoke-Git @('for-each-ref', '--format=%(refname)', 'refs/original/') 2>$null | ForEach-Object {
    if ($_) { Invoke-Git @('update-ref', '-d', $_) | Out-Null }
  }
  Invoke-Git @('reflog', 'expire', '--expire=now', '--all') | Out-Null
}

Write-Info '回收不可达对象'
Invoke-Git @('gc', '--prune=now', '--quiet') | Out-Null

# ── 5. 校验 ─────────────────────────────────────────────────────────────────
Write-Host ''
$stillInLog = @(& git log --all "--pretty=format:%h" -- $Path 2>$null)
$stillInObjects = @(& git rev-list --all --objects 2>$null | Select-String -SimpleMatch $Path)

if ($stillInLog.Count -eq 0 -and $stillInObjects.Count -eq 0) {
  Write-Host '✓ 校验通过：历史提交与对象列表中都不再包含该路径。' -ForegroundColor Green
} else {
  Write-Warn2 "校验未完全通过：log 命中 $($stillInLog.Count) 条，object 命中 $($stillInObjects.Count) 条。"
  Write-Warn2 "备份仍在 $backupDir，可随时恢复。"
}

Write-Host ''
Write-Info '还需要你手动完成：'
Write-Host '  1) 检查远端地址是否仍在（filter-repo 会移除 origin）：'
Write-Host "       git remote -v        # 若为空：git remote add origin $remoteUrl"
Write-Host '  2) 强制推送（确认协作者已知会后执行）：'
Write-Host '       git push --force-with-lease --all'
Write-Host '       git push --force-with-lease --tags'
Write-Host '  3) 通知协作者重新 clone；GitHub 上的 Release 需要按新哈希重新发布。'
Write-Host "  4) 确认一切正常后再删除备份：Remove-Item -Recurse -Force '$backupDir'"
