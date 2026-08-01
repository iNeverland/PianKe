import { BrowserWindow } from 'electron';
import path from 'path';

export function createSplashWindow(baseDir: string): BrowserWindow {
  const splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    show: false,
    backgroundColor: '#08080d',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashWindow.loadFile(path.join(baseDir, '../dist/splash.html'));
  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
  });

  return splashWindow;
}
