import { BrowserWindow } from 'electron';
import path from 'path';

interface CreateMainWindowOptions {
  baseDir: string;
  devServerUrl?: string;
  onReadyToShow?: () => void;
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
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#ffffff',
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

  return mainWindow;
}
