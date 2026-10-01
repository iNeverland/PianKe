import { BrowserWindow, nativeTheme, shell } from 'electron';
import path from 'path';
import { pinMainFrameDocument } from '../utils/senderGuard.js';

interface CreateMainWindowOptions {
  baseDir: string;
  devServerUrl?: string;
  onReadyToShow?: () => void;
}

/** 与 src/index.css 的 --bg-deep 保持一致，避免窗口创建瞬间的明暗闪烁。 */
const WINDOW_BACKGROUND = { dark: '#0c0c0a', light: '#f5f3ed' } as const;

/**
 * 主窗口允许停留的文档。
 *
 * 打包后只允许本地 file: 文档；开发时允许 Vite dev server 的源（HMR 会整页重载）。
 * 这不是唯一防线：即使某个本地 HTML 被拖进来加载，senderGuard 也因为它不是
 * 「钉住的主文档」而拒绝其一切 IPC 调用。
 */
function isAllowedNavigation(url: string, devServerUrl?: string): boolean {
  if (devServerUrl) {
    try {
      return new URL(url).origin === new URL(devServerUrl).origin;
    } catch {
      return false;
    }
  }
  return url.startsWith('file:');
}

export function themeBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light;
}

/** 主题切换后同步窗口底色（渲染进程通过 theme:update 通知主进程）。 */
export function applyThemeBackground(win: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) win.setBackgroundColor(themeBackgroundColor());
}

export function createMainWindow(options: CreateMainWindowOptions): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: 12 },
    webPreferences: {
      preload: path.join(options.baseDir, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: themeBackgroundColor(),
  });

  if (options.devServerUrl) {
    mainWindow.loadURL(options.devServerUrl);
  } else {
    mainWindow.loadFile(path.join(options.baseDir, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    options.onReadyToShow?.();
    mainWindow.show();
    mainWindow.focus();
  });

  // 钉住主文档：只钉第一次，之后任何其它文档调用 IPC 都会被 senderGuard 拒绝。
  mainWindow.webContents.once('did-finish-load', () => {
    pinMainFrameDocument(mainWindow.webContents.getURL());
  });

  // 主窗口不允许导航到外部页面。preload 会在每次导航后重新注入，外部页面同样能拿到
  // window.electronAPI（截屏、下载并安装更新都在里面），所以这里必须挡住。
  // 触发路径不止「攻击者构造」：把一个链接从浏览器拖到窗口上就会导航主框架。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, options.devServerUrl)) {
      event.preventDefault();
      console.warn('[security] 已拦截主窗口导航:', url);
    }
  });

  // 一律不开新窗口（window.open / target=_blank）；真正的 https 外链交给系统浏览器。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // 本应用没有合法子框架，任何子框架导航都按异常拦下。
  mainWindow.webContents.on('will-frame-navigate', (details: unknown) => {
    const info = details as { isMainFrame?: boolean; url?: string; preventDefault?: () => void } | undefined;
    if (info?.isMainFrame === false) {
      info.preventDefault?.();
      console.warn('[security] 已拦截子框架导航:', info.url);
    }
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximizeChanged', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximizeChanged', false);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main-window] render process gone:', details.reason);
    if (!mainWindow.isDestroyed()) mainWindow.reload();
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[main-window] failed to load:', errorCode, errorDescription);
  });

  return mainWindow;
}
