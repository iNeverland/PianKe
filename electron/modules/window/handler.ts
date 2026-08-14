import { ipcMain, nativeTheme, type BrowserWindow } from 'electron';
import { assertTrustedSender } from '../../utils/senderGuard.js';

type MainWindowGetter = () => BrowserWindow | null;

export function registerWindowHandlers(getMainWindow: MainWindowGetter): void {
  ipcMain.handle('theme:update', (event, mode: 'dark' | 'light' | 'system') => {
    assertTrustedSender(event);
    nativeTheme.themeSource = mode;
  });

  ipcMain.handle('window:minimize', (event) => {
    assertTrustedSender(event);
    return getMainWindow()?.minimize();
  });
  ipcMain.handle('window:maximize', (event) => {
    assertTrustedSender(event);
    const mainWindow = getMainWindow();
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle('window:close', (event) => {
    assertTrustedSender(event);
    return getMainWindow()?.close();
  });
  ipcMain.handle('window:isMaximized', (event) => {
    assertTrustedSender(event);
    return getMainWindow()?.isMaximized() ?? false;
  });
}
