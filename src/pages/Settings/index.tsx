import { useState, useEffect, useRef } from 'react';
import api from '@/lib/api';
import { showToast } from '@/components/common/Toast';
import Header from '@/components/layout/Header';
import AppIcon from '@/components/common/AppIcon';
import { getShortcutConfig, getShortcutKey, saveShortcutConfig, toDisplayText, toAccelerator, getDefaultConfig, type ShortcutConfig } from '@/hooks/useScreenshotShortcut';

function getStoredTheme(): 'system' | 'dark' | 'light' {
  const stored = localStorage.getItem('film-log-theme');
  return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system';
}

export default function Settings() {
  const [theme, setTheme] = useState<'system' | 'dark' | 'light'>(getStoredTheme);
  const [screenshotShortcut, setScreenshotShortcut] = useState<ShortcutConfig>(getShortcutConfig);
  const [capturing, setCapturing] = useState(false);
  const [appVersion, setAppVersion] = useState(__APP_VERSION__);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const previousShortcutRef = useRef<ShortcutConfig | null>(null);

  useEffect(() => {
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

  async function handleExportExcel() {
    if (exportingExcel) return;
    setExportingExcel(true);
    try {
      const result = await api.movie.exportExcel();
      if (result) {
        showToast(`Excel 已导出（${result.movieCount} 部影视，${result.diaryCount} 条日记，${result.watchRecordCount} 条追剧记录）`, 5000);
      }
    } catch (err: any) {
      showToast(err.message || 'Excel 导出失败');
    } finally {
      setExportingExcel(false);
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

  return (
    <div>
      <Header title="设置" subtitle="管理你的影片库和偏好" showAdd={false} />

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
              <AppIcon name="screen" className="w-3.5 h-3.5" />
              系统
            </button>
            <button
              className={`theme-option${theme === 'dark' ? ' active' : ''}`}
              onClick={() => applyTheme('dark')}
            >
              <AppIcon name="moon" className="w-3.5 h-3.5" />
              深色
            </button>
            <button
              className={`theme-option${theme === 'light' ? ' active' : ''}`}
              onClick={() => applyTheme('light')}
            >
              <AppIcon name="sun" className="w-3.5 h-3.5" />
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
                : '截取屏幕画面并保存至照片墙'}
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
            <div className="settings-row-label">导出 Excel</div>
            <div className="settings-row-desc">导出影视清单、自动观影日记和手动追剧记录，可选择 .xlsx 或 .xls；不嵌入海报、截图等图片</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleExportExcel} disabled={exportingExcel}>
            {exportingExcel ? '导出中…' : '导出'}
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
