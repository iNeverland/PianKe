import { ipcMain, nativeTheme, type BrowserWindow } from 'electron';

type MainWindowGetter = () => BrowserWindow | null;

export function registerWindowHandlers(getMainWindow: MainWindowGetter): void {
  ipcMain.handle('theme:update', (_event, mode: 'dark' | 'light' | 'system') => {
    nativeTheme.themeSource = mode;
  });

  ipcMain.handle('window:minimize', () => getMainWindow()?.minimize());
  ipcMain.handle('window:maximize', () => {
    const mainWindow = getMainWindow();
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle('window:close', () => getMainWindow()?.close());
  ipcMain.handle('window:isMaximized', () => getMainWindow()?.isMaximized() ?? false);
}
