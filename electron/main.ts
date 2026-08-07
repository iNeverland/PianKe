import { app, BrowserWindow, Menu, nativeTheme, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerAllHandlers } from './ipc.js';
import { registerScreenshotHandlers, unregisterScreenshotShortcut } from './modules/screenshot/handler.js';
import { registerWindowHandlers } from './modules/window/handler.js';
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
  mainWindow = createMainWindow({
    baseDir: __dirname,
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
    onReadyToShow: closeSplashWindow,
  });
}

function sendOpenLibraryPath(filePath: string): void {
  const targetWindow = mainWindow ?? BrowserWindow.getAllWindows()[0];
  if (targetWindow && !targetWindow.isDestroyed() && !targetWindow.webContents.isDestroyed()) {
    targetWindow.webContents.send('open-library-path', filePath);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }

    const libPath = argv.find((a: string) => a.endsWith('.pianke'));
    if (libPath) {
      sendOpenLibraryPath(libPath);
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
            ? "default-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost:5173; img-src 'self' data: https:"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:",
        ],
      },
    });
  });

  if (!process.env.VITE_DEV_SERVER_URL) {
    splashWindow = createSplashWindow(__dirname);
  }

  registerAllHandlers();
  registerWindowHandlers(() => mainWindow);
  registerScreenshotHandlers(__dirname, () => mainWindow);

  createWindow();
  startAutoUpdater();
  mainWindow?.webContents.once('did-finish-load', () => {
    // 首屏加载完成后立即检查；后续检查由下次启动或用户手动触发。
    void checkForUpdates('automatic');
  });

  const openLibraryPath = process.argv.find(a => a.endsWith('.pianke'));
  if (openLibraryPath && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      sendOpenLibraryPath(openLibraryPath);
    });
  }

  app.on('will-quit', () => {
    unregisterScreenshotShortcut();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-finish-launching', () => {
  app.on('open-file', (_event, filePath) => {
    if (BrowserWindow.getAllWindows().length > 0) {
      sendOpenLibraryPath(filePath);
    } else {
      app.once('browser-window-created', () => {
        setTimeout(() => sendOpenLibraryPath(filePath), 500);
      });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
