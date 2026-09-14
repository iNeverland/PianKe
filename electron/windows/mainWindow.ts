import { BrowserWindow, nativeTheme } from 'electron';
import path from 'path';

interface CreateMainWindowOptions {
  baseDir: string;
  devServerUrl?: string;
  onReadyToShow?: () => void;
}

/** 与 src/index.css 的 --bg-deep 保持一致，避免窗口创建瞬间的明暗闪烁。 */
const WINDOW_BACKGROUND = { dark: '#0c0c0a', light: '#f5f3ed' } as const;

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
