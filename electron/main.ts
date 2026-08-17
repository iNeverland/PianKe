import { app, BrowserWindow, Menu, nativeTheme, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerAllHandlers } from './ipc.js';
import { registerScreenshotHandlers, unregisterScreenshotShortcut } from './modules/screenshot/handler.js';
import { registerWindowHandlers } from './modules/window/handler.js';
import { setMainWebContentsGetter } from './utils/senderGuard.js';
import { createMainWindow } from './windows/mainWindow.js';
import { createSplashWindow } from './windows/splashWindow.js';
import { checkForUpdates, startAutoUpdater } from './modules/updater/service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

function closeSplashWindow(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

function createWindow(): void {
  const win = createMainWindow({
    baseDir: __dirname,
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
    onReadyToShow: closeSplashWindow,
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      // macOS 上关窗后应用常驻，再次启动时主窗口可能已被销毁/置空，需重建。
      createWindow();
    }
  });
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  Menu.setApplicationMenu(null);

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          process.env.VITE_DEV_SERVER_URL
            // 海报、截图与头像从 IndexedDB 读取时会以 blob: URL 呈现。它们仅来自
            // 当前账号写入的本地缓存，必须显式放行，否则会出现卡片留白。
            ? "default-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost:5173; img-src 'self' data: blob: https:; connect-src 'self' http://localhost:5173 https://pb.astara.space"
            // 生产环境从 file:// 加载：Chromium 对 file:// 文档的 'self' 会按独立
            // 源处理，显式放行 file: 才能稳定加载 dist 内的脚本与本地资源。
            : "default-src 'self' file:; script-src 'self' file:; style-src 'self' 'unsafe-inline' file:; img-src 'self' file: data: blob: https:; connect-src https://pb.astara.space",
        ],
      },
    });
  });

  if (!process.env.VITE_DEV_SERVER_URL) {
    splashWindow = createSplashWindow(__dirname);
    // 主窗口加载失败兜底：15 秒仍未 ready 则关闭闪屏，避免应用看似无响应。
    setTimeout(() => {
      if (splashWindow) closeSplashWindow();
    }, 15000);
  }

  setMainWebContentsGetter(() => mainWindow?.webContents ?? null);

  registerAllHandlers();
  registerWindowHandlers(() => mainWindow);
  registerScreenshotHandlers(__dirname, () => mainWindow);

  createWindow();
  startAutoUpdater();
  mainWindow?.webContents.once('did-finish-load', () => {
    // 首屏加载完成后立即检查；后续检查由下次启动或用户手动触发。
    void checkForUpdates('automatic');
  });

  app.on('will-quit', () => {
    unregisterScreenshotShortcut();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
