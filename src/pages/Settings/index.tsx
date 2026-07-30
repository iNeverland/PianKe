import { useState, useEffect, useRef } from 'react';
import api from '@/lib/api';
import { getLocalDateStr } from '@shared/utils/date';
import { showToast } from '@/components/common/Toast';
import Header from '@/components/layout/Header';
import { getShortcutConfig, getShortcutKey, saveShortcutConfig, toDisplayText, toAccelerator, getDefaultConfig, type ShortcutConfig } from '@/hooks/useScreenshotShortcut';

function getStoredTheme(): 'system' | 'dark' | 'light' {
  const stored = localStorage.getItem('film-log-theme');
  return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system';
}

export default function Settings() {
  const [theme, setTheme] = useState<'system' | 'dark' | 'light'>(getStoredTheme);
  const [screenshotShortcut, setScreenshotShortcut] = useState<ShortcutConfig>(getShortcutConfig);
  const [capturing, setCapturing] = useState(false);
  const [libPath, setLibPath] = useState<string>('');
  const [appVersion, setAppVersion] = useState(__APP_VERSION__);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previousShortcutRef = useRef<ShortcutConfig | null>(null);

  useEffect(() => {
    api.library.getPath().then((p) => setLibPath(p || '')).catch(() => {});
    api.updater.getState().then((state) => setAppVersion(state.currentVersion)).catch(() => {});
  }, []);

  // 按键捕获模式：监听下一次有效按键组合
  useEffect(() => {
    if (!capturing) return;

    const restorePreviousShortcut = () => {
      const previous = previousShortcutRef.current;
      previousShortcutRef.current = null;
      if (previous && window.electronAPI?.registerShortcut) {
        void window.electronAPI.registerShortcut(toAccelerator(previous));
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // ESC 退出捕获模式
      if (e.key === 'Escape') {
        restorePreviousShortcut();
        setCapturing(false);
        return;
      }

      // 忽略纯修饰键
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

      // 使用物理键位，macOS 的 Option 不会将字母转换为特殊字符。
      const key = getShortcutKey(e);
      if (!key) return;

      // 至少需要一个修饰键
      if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        showToast('请使用组合键（Ctrl/Shift/Alt + 字母或数字）');
        return;
      }

      const newConfig: ShortcutConfig = {
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
        key,
      };

      const accel = toAccelerator(newConfig);

      // 检查与现有快捷键冲突
      if (accel === 'Ctrl+K' || accel === 'Ctrl+N') {
        showToast('与现有快捷键冲突，请更换');
        return;
      }

      // 注册到主进程。旧快捷键已注销，防止本次按键直接触发截图。
      if (window.electronAPI?.registerShortcut) {
        void window.electronAPI.registerShortcut(accel).then((ok) => {
          if (!ok) {
            showToast('快捷键注册失败，可能被系统占用，请更换');
            restorePreviousShortcut();
          } else {
            previousShortcutRef.current = null;
            saveShortcutConfig(newConfig);
            setScreenshotShortcut(newConfig);
            showToast('快捷键已更新');
          }
          setCapturing(false);
        });
      } else {
        previousShortcutRef.current = null;
        saveShortcutConfig(newConfig);
        setScreenshotShortcut(newConfig);
        setCapturing(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      restorePreviousShortcut();
    };
  }, [capturing]);

  async function beginShortcutCapture() {
    if (capturing) return;
    previousShortcutRef.current = screenshotShortcut;
    try {
      await window.electronAPI?.unregisterShortcut?.();
      setCapturing(true);
    } catch {
      previousShortcutRef.current = null;
      showToast('快捷键暂停失败，请重试');
    }
  }

  function applyTheme(mode: 'system' | 'dark' | 'light') {
    setTheme(mode);
    localStorage.setItem('film-log-theme', mode);

    if (mode === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (mode === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }

    // 同步 Electron 原生主题
    if (window.electronAPI?.setTheme) {
      window.electronAPI.setTheme(mode);
    }
  }

  async function handleSwitchLibrary() {
    try {
      const info = await api.library.open();
      if (info) {
        const rootPath = await api.library.getPath();
        if (rootPath) {
          localStorage.setItem('film-log-library-path', rootPath);
        }
        showToast('已切换资源库');
        window.location.reload();
      }
    } catch (err: any) {
      showToast(err.message || '切换失败');
    }
  }

  async function handleCreateLibrary() {
    if (!createName.trim()) {
      showToast('请输入资源库名称');
      return;
    }
    try {
      const info = await api.library.create(createName.trim());
      if (info) {
        const rootPath = await api.library.getPath();
        if (rootPath) {
          localStorage.setItem('film-log-library-path', rootPath);
        }
        showToast('资源库已创建');
        window.location.reload();
      }
    } catch (err: any) {
      showToast(err.message || '创建失败');
    }
  }

  async function handleExportCsv() {
    try {
      const movies = await api.movie.exportAll();
      if (!movies || movies.length === 0) {
        showToast('暂无影视数据可导出');
        return;
      }

      const headers = ['标题', '原始标题', '类型', '状态', '导演', '上映日期', '国家', '类型标签', '自定义标签', '片长(分钟)', '简介', '公众评分', '添加时间'];
      const rows = movies.map((m: any) => [
        csvEscape(m.title || ''),
        csvEscape(m.titleOriginal || ''),
        m.mediaType || '',
        m.status || '',
        csvEscape(m.director || ''),
        m.releaseDate || '',
        csvEscape(m.country || ''),
        (m.genre || []).join('/'),
        (m.tags || []).join('/'),
        m.runtime || '',
        csvEscape(m.synopsis || ''),
        m.rating ?? '',
        m.createdAt ? m.createdAt.split('T')[0] : '',
      ]);

      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `film-log-export-${getLocalDateStr()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('导出成功');
    } catch (err: any) {
      showToast(err.message || '导出失败');
    }
  }

  async function handleCreateFullBackup() {
    try {
      const result = await api.library.createBackup();
      if (!result) return;
      showToast(`完整备份已创建（${result.movieCount} 部影视）`, 5000);
    } catch (err: any) {
      showToast(err.message || '完整备份失败');
    }
  }

  async function handleCheckUpdate() {
    if (checkingUpdate) return;
    setCheckingUpdate(true);

    try {
      const result = await api.updater.check('manual');
      if (result.status === 'not-available') {
        showToast('当前已是最新版本');
      } else if (result.status === 'disabled') {
        showToast('开发环境不支持检查更新');
      } else if (result.status === 'error') {
        showToast(result.message || '检查更新失败，请稍后重试');
      }
    } catch {
      showToast('检查更新失败，请稍后重试');
    } finally {
      setCheckingUpdate(false);
    }
  }

  function csvEscape(val: string): string {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  }

  async function handleImportCsv() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      showToast('请选择 CSV 文件');
      return;
    }

    try {
      const csvText = await file.text();
      const result = await api.movie.importCsv(csvText);
      const msg = `导入完成：成功 ${result.imported} 条`;
      if (result.errors.length > 0) {
        showToast(`${msg}，${result.errors.length} 条失败（${result.errors.slice(0, 3).join('；')}${result.errors.length > 3 ? '...' : ''}）`, 8000);
      } else {
        showToast(msg);
      }
    } catch (err: any) {
      showToast(err.message || '导入失败');
    } finally {
      // 重置 file input 以便重复选择同一文件
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div>
      <Header title="设置" subtitle="管理你的影片库和偏好" showAdd={false} />

      {/* 影片库 */}
      <div className="settings-section">
        <div className="settings-section-title">影片库</div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">当前库路径</div>
            <div className="settings-row-desc">{libPath || '未加载'}</div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={handleSwitchLibrary}>
            切换库
          </button>
        </div>
        <div className="settings-row flex-wrap">
          <div className={showCreate ? 'mb-3' : ''}>
            <div className="settings-row-label">创建新库</div>
            <div className="settings-row-desc">在指定位置创建一个新的影片库</div>
          </div>
          {showCreate ? (
            <div className="flex gap-2 w-full">
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="输入资源库名称"
                className="form-input flex-1"
                aria-label="资源库名称"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateLibrary(); }}
              />
              <button className="btn btn-primary btn-sm" onClick={handleCreateLibrary}>
                确定
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowCreate(false); setCreateName(''); }}>
                取消
              </button>
            </div>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={() => setShowCreate(true)}>
              新建
            </button>
          )}
        </div>
      </div>

      {/* 外观 */}
      <div className="settings-section">
        <div className="settings-section-title">外观</div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">主题模式</div>
            <div className="settings-row-desc">跟随系统或手动选择深色/浅色</div>
          </div>
          <div className="theme-switcher">
            <button
              className={`theme-option${theme === 'system' ? ' active' : ''}`}
              onClick={() => applyTheme('system')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
              系统
            </button>
            <button
              className={`theme-option${theme === 'dark' ? ' active' : ''}`}
              onClick={() => applyTheme('dark')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
              </svg>
              深色
            </button>
            <button
              className={`theme-option${theme === 'light' ? ' active' : ''}`}
              onClick={() => applyTheme('light')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
              浅色
            </button>
          </div>
        </div>
      </div>

      {/* 快捷键 */}
      <div className="settings-section">
        <div className="settings-section-title">快捷键</div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">截图快捷键</div>
            <div className="settings-row-desc">
              {capturing
                ? '请按下新的快捷键组合...（按 ESC 取消）'
                : '在影视详情页使用，截取屏幕画面并自动保存到照片墙'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {capturing ? (
              <span className="text-sm text-accent font-semibold animate-pulse">等待按键...</span>
            ) : (
              <>
                <span className="text-sm text-text-primary font-semibold bg-bg-elevated px-3 py-1 rounded-md border border-border">
                  {toDisplayText(screenshotShortcut)}
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => { void beginShortcutCapture(); }}
                >
                  修改
                </button>
                <button
                  className="btn btn-ghost btn-sm text-text-muted"
                  title="恢复默认"
                  onClick={() => {
                    const def = getDefaultConfig();
                    const accel = toAccelerator(def);
                    if (window.electronAPI?.registerShortcut) {
                      window.electronAPI.registerShortcut(accel).then((ok) => {
                        if (ok) {
                          saveShortcutConfig(def);
                          setScreenshotShortcut(def);
                          showToast('已恢复默认快捷键');
                        } else {
                          showToast('恢复默认失败');
                        }
                      });
                    } else {
                      saveShortcutConfig(def);
                      setScreenshotShortcut(def);
                      showToast('已恢复默认快捷键');
                    }
                  }}
                >
                  重置
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 数据管理 */}
      <div className="settings-section">
        <div className="settings-section-title">数据管理</div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">完整备份</div>
            <div className="settings-row-desc">复制整个资源库，包含日记、海报与截图；备份文件夹可通过“切换库”直接打开</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleCreateFullBackup}>
            创建备份
          </button>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">导入 CSV</div>
            <div className="settings-row-desc">从 CSV 文件批量导入影视清单（不包含日记、海报与截图）</div>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            accept=".csv"
            className="hidden"
            onChange={handleImportCsv}
          />
          <button className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>
            导入
          </button>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">导出为 CSV</div>
            <div className="settings-row-desc">导出影视清单，便于在表格软件中查看或交换</div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={handleExportCsv}>
            导出
          </button>
        </div>
      </div>

      {/* 版本号 */}
      <div className="settings-section">
        <div className="settings-section-title">版本号</div>
        <div className="settings-row">
          <div className="settings-row-label">v{appVersion}</div>
          <button className="btn btn-secondary btn-sm" onClick={() => { void handleCheckUpdate(); }} disabled={checkingUpdate}>
            {checkingUpdate ? '检查中…' : '检查更新'}
          </button>
        </div>
      </div>
    </div>
  );
}
