import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, lazy, Suspense } from 'react';
import AppShell from './components/layout/AppShell';
import TitleBar from './components/layout/TitleBar';
import Toast from './components/common/Toast';
import UpdateDialog from './components/common/UpdateDialog';
import { getShortcutConfig, toAccelerator } from './hooks/useScreenshotShortcut';
import CloudAuth from './pages/CloudAuth';
import { getCloudUser, subscribeCloudAuth, type CloudUser } from './lib/pocketbase';
import { hydrateOfflineCloudCache } from './lib/cloudApi';
import { getOfflineMedia } from './lib/offlineCache';
import api from './lib/api';
import type { MovieSummary, ScreenshotMoviePickerItem } from '@shared/types/index';

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

function blobToDataUrl(blob: Blob): Promise<string | undefined> {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve('');
    reader.readAsDataURL(blob);
  }).then((dataUrl) => dataUrl || undefined);
}

async function getPickerPosterDataUrl(movie: MovieSummary): Promise<string | undefined> {
  const filename = movie.posterThumbPath;
  if (!filename) return undefined;

  // 选择器优先读取 IndexedDB 中已同步的海报缩略图：不依赖网络、也不受独立窗口
  // 登录态限制。key 与 cloudApi 的缩略图预热逻辑保持一致。
  const ownerId = getCloudUser()?.id;
  if (ownerId) {
    const mediaKey = `movies:${movie.id}:${filename}:300x450`;
    const cachedBlob = await getOfflineMedia(ownerId, mediaKey).catch(() => null);
    if (cachedBlob) return blobToDataUrl(cachedBlob);
  }

  // 本地缓存尚未预热时才请求云端，并转成可跨 Electron 窗口显示的 data URL。
  const url = await api.movie.getPosterUrl(movie.id, true).catch(() => null);
  if (!url) return undefined;
  if (url.startsWith('data:')) return url;
  const blob = await fetch(url).then((response) => response.ok ? response.blob() : null).catch(() => null);
  return blob ? blobToDataUrl(blob) : undefined;
}

async function toScreenshotPickerMovies(movies: MovieSummary[]): Promise<ScreenshotMoviePickerItem[]> {
  return Promise.all(movies.map(async (movie) => ({
    id: movie.id,
    title: movie.title,
    titleOriginal: movie.titleOriginal,
    mediaType: movie.mediaType,
    releaseDate: movie.releaseDate,
    createdAt: movie.createdAt,
    posterDataUrl: await getPickerPosterDataUrl(movie),
  })));
}

export default function App() {
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(getCloudUser);
  const [libraryLoaded, setLibraryLoaded] = useState(isPhotoWallPreview || Boolean(getCloudUser()));
  const [libraryName, setLibraryName] = useState<string>(() => getCloudUser()?.displayName || getCloudUser()?.email || '我的云端影院');
  const [checking, setChecking] = useState(!isPhotoWallPreview);

  // 云端为唯一权威数据源；认证状态变化会自动切换到登录页或主应用。
  useEffect(() => subscribeCloudAuth((user) => {
    setCloudUser(user);
    setLibraryLoaded(isPhotoWallPreview || Boolean(user));
    setLibraryName(user?.displayName || user?.email || '我的云端影院');
    setChecking(false);
    // 缓存恢复不阻塞首屏；后续页面会优先从 IndexedDB 显示最近一次同步的数据。
    if (user) void hydrateOfflineCloudCache();
  }), []);

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

  // 云端模式不再自动打开本地 .pianke 库，保留事件监听以避免旧安装包触发异常。
  useEffect(() => {
    const api = window.electronAPI;
    if (api?.onOpenLibraryPath) {
      api.onOpenLibraryPath(() => {});
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
            // 选择器使用当前数据源，并将海报转为独立窗口也可显示的 data URL。
            return api.movie.list()
              .then(toScreenshotPickerMovies)
              .then((movies) => window.electronAPI.startCrop(null, dataUrl, movies));
          })
          .catch((err) => {
            window.electronAPI?.showScreenToast?.(err?.message || '截图失败');
          });
      }
    });

    return () => { unsub?.(); };
  }, [libraryLoaded]);

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

  if (!libraryLoaded || (!cloudUser && !isPhotoWallPreview)) {
    return (
      <>
        <TitleBar />
        <CloudAuth />
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
