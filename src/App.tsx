import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, lazy, Suspense } from 'react';
import AppShell from './components/layout/AppShell';
import TitleBar from './components/layout/TitleBar';
import Toast from './components/common/Toast';
import UpdateDialog from './components/common/UpdateDialog';
import { getShortcutConfig, toAccelerator } from './hooks/useScreenshotShortcut';
import Welcome from './pages/Welcome';
import type { LibraryInfo } from '@shared/types/index';

const Home = lazy(() => import('./pages/Home'));
const MovieDetail = lazy(() => import('./pages/MovieDetail'));
const MovieForm = lazy(() => import('./pages/MovieForm'));
const Diary = lazy(() => import('./pages/Diary'));
const Watchlist = lazy(() => import('./pages/Watchlist'));
const Stats = lazy(() => import('./pages/Stats'));
const Settings = lazy(() => import('./pages/Settings'));
const Watching = lazy(() => import('./pages/Watching'));
const PhotoWall = lazy(() => import('./pages/PhotoWall'));

// 仅开发环境的照片墙视觉预览，不会读取或写入用户的影视库。
const isPhotoWallPreview = import.meta.env.DEV && window.location.hash.startsWith('#/photos?preview=1');

const PageLoader = () => (
  <div className="flex items-center justify-center py-20">
    <div className="text-text-muted text-sm">加载中...</div>
  </div>
);

export default function App() {
  const [libraryLoaded, setLibraryLoaded] = useState(isPhotoWallPreview);
  const [libraryName, setLibraryName] = useState<string>('');
  const [checking, setChecking] = useState(!isPhotoWallPreview);

  // 初始化主题 + 标题栏颜色
  useEffect(() => {
    const theme = localStorage.getItem('film-log-theme');
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    if (window.electronAPI?.setTheme) {
      window.electronAPI.setTheme((theme === 'dark' || theme === 'light') ? theme : 'system');
    }
  }, []);

  // 监听双击 .pianke 文件打开库
  useEffect(() => {
    const api = window.electronAPI;
    if (api?.onOpenLibraryPath) {
      api.onOpenLibraryPath((dirPath: string) => {
        localStorage.setItem('film-log-library-path', dirPath);
        api.library.reopen(dirPath).then((info: LibraryInfo | null) => {
          if (info) {
            setLibraryName(info.name);
            setLibraryLoaded(true);
          }
          setChecking(false);
        }).catch(() => {
          setChecking(false);
        });
      });
    }
  }, []);

  // 注册截图全局快捷键到主进程
  useEffect(() => {
    if (!libraryLoaded) return;

    const config = getShortcutConfig();
    const accelerator = toAccelerator(config);
    if (window.electronAPI?.registerShortcut) {
      window.electronAPI.registerShortcut(accelerator).then((ok) => {
        if (!ok) {
          console.warn('[screenshot] shortcut registration failed:', accelerator);
        }
      });
    }
  }, [libraryLoaded]);

  // 全局键盘快捷键
  useEffect(() => {
    if (!libraryLoaded) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // Ctrl+K 或 Ctrl+F：聚焦首页搜索框
      if (mod && (e.key === 'k' || e.key === 'K' || e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('focus-home-search'));
        return;
      }

      // Ctrl+N：新建影视
      if (mod && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        window.location.hash = '#/movie/new';
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [libraryLoaded]);

  // 监听主进程截图触发事件
  useEffect(() => {
    if (!libraryLoaded) return;

    const unsub = window.electronAPI?.onScreenshotTrigger?.(() => {
      const hash = window.location.hash;
      const match = hash.match(/^#\/movie\/(.+)$/);
      if (match) {
        // 在影视详情页 → 触发截图
        const movieId = match[1];
        window.dispatchEvent(new CustomEvent('screenshot:capture', { detail: { movieId } }));
      } else {
        window.electronAPI.getPrimaryScreenSnapshot()
          .then((dataUrl) => {
            if (!dataUrl) {
              window.electronAPI?.showScreenToast?.('未检测到可捕获的屏幕');
              return;
            }
            return window.electronAPI.startCrop(null, dataUrl);
          })
          .catch((err) => {
            window.electronAPI?.showScreenToast?.(err?.message || '截图失败');
          });
      }
    });

    return () => { unsub?.(); };
  }, [libraryLoaded]);

  useEffect(() => {
    const savedPath = localStorage.getItem('film-log-library-path');
    if (savedPath && window.electronAPI) {
      // 旧版遗留的 'opened'/'created' 标记不再有效，清除后显示 Welcome 页面
      if (savedPath === 'opened' || savedPath === 'created') {
        localStorage.removeItem('film-log-library-path');
        setChecking(false);
        return;
      }

      // 使用实际路径直接重新打开，不弹对话框
      window.electronAPI.library.reopen(savedPath)
        .then((info) => {
          if (info) {
            setLibraryName(info.name);
            setLibraryLoaded(true);
          }
          setChecking(false);
        }).catch(() => {
          // 路径无效，清除后显示 Welcome 页面
          localStorage.removeItem('film-log-library-path');
          setChecking(false);
        });
    } else {
      setChecking(false);
    }
  }, []);

  const handleLibraryOpen = (name: string) => {
    setLibraryName(name);
    setLibraryLoaded(true);
  };

  if (checking) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-bg-deep">
        <div className="w-10 h-10 mb-5">
          <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="64" height="64" rx="16" fill="#d4a853" fillOpacity="0.12"/>
            <path d="M20 16L20 48L28 48L28 34L36 48L46 48L36 30L44 16L34 16L28 28L28 16L20 16Z" fill="#d4a853"/>
          </svg>
        </div>
        <div className="text-text-primary text-lg font-semibold tracking-widest mb-1">片刻</div>
        <div className="text-text-muted text-xs tracking-widest mb-6">PIANKE</div>
        <div className="w-5 h-5 border-2 border-border-deep border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (!libraryLoaded) {
    return (
      <>
        <TitleBar />
        <Welcome onLibraryOpen={handleLibraryOpen} />
        <UpdateDialog />
        <Toast />
      </>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell libraryName={libraryName} />}>
          <Route path="/" element={<Suspense fallback={<PageLoader />}><Home /></Suspense>} />
          <Route path="/watching" element={<Suspense fallback={<PageLoader />}><Watching /></Suspense>} />
          <Route path="/movie/new" element={<Suspense fallback={<PageLoader />}><MovieForm /></Suspense>} />
          <Route path="/movie/:id" element={<Suspense fallback={<PageLoader />}><MovieDetail /></Suspense>} />
          <Route path="/movie/:id/edit" element={<Suspense fallback={<PageLoader />}><MovieForm /></Suspense>} />
          <Route path="/diary" element={<Suspense fallback={<PageLoader />}><Diary /></Suspense>} />
          <Route path="/watchlist" element={<Suspense fallback={<PageLoader />}><Watchlist /></Suspense>} />
          <Route path="/stats" element={<Suspense fallback={<PageLoader />}><Stats /></Suspense>} />
          <Route path="/photos" element={<Suspense fallback={<PageLoader />}><PhotoWall /></Suspense>} />
          <Route path="/settings" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <UpdateDialog />
      <Toast />
    </HashRouter>
  );
}
