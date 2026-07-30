import { clipboard, desktopCapturer, globalShortcut, ipcMain, nativeImage, screen, type BrowserWindow } from 'electron';
import { closeCropWindow, getCropData, getCropMovieId, startCropWindow } from './cropWindow.js';
import { closeMoviePickerWindow, showMoviePickerWindow } from './moviePickerWindow.js';
import { showScreenToast } from './toast.js';
import type { ScreenshotInfo } from '../../../shared/types/index.js';

type MainWindowGetter = () => BrowserWindow | null;

let screenshotAccelerator: string | null = null;
let pendingCroppedDataUrl: string | null = null;

function registerScreenshotShortcut(accelerator: string, getMainWindow: MainWindowGetter): boolean {
  if (screenshotAccelerator) {
    globalShortcut.unregister(screenshotAccelerator);
    screenshotAccelerator = null;
  }

  const ok = globalShortcut.register(accelerator, () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('screenshot:trigger');
    }
  });
  if (ok) {
    screenshotAccelerator = accelerator;
  }
  return ok;
}

export function unregisterScreenshotShortcut(): void {
  if (screenshotAccelerator) {
    globalShortcut.unregister(screenshotAccelerator);
    screenshotAccelerator = null;
  }
}

export function registerScreenshotHandlers(baseDir: string, getMainWindow: MainWindowGetter): void {
  ipcMain.handle('shortcut:register', (_event, accelerator: string) => registerScreenshotShortcut(accelerator, getMainWindow));

  ipcMain.handle('screen-toast:show', (_event, message: string, duration?: number) => {
    showScreenToast(message, duration);
  });

  ipcMain.handle('desktop-capturer:getSources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumb: s.thumbnail.toDataURL(),
    }));
  });

  ipcMain.handle('desktop-capturer:getPrimaryScreenSnapshot', async () => {
    const primaryDisplay = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: primaryDisplay.bounds.width,
        height: primaryDisplay.bounds.height,
      },
    });

    const primaryDisplayId = String(primaryDisplay.id);
    const source =
      sources.find((s) => s.display_id === primaryDisplayId) ||
      sources.find((s) => s.name === 'Entire Screen' || s.name.includes('Screen')) ||
      sources[0];

    if (!source || source.thumbnail.isEmpty()) {
      return null;
    }

    return source.thumbnail.toDataURL();
  });

  ipcMain.handle('crop:start', (_event, movieId: string | null, fullScreenDataUrl: string) => {
    startCropWindow(baseDir, movieId, fullScreenDataUrl);
  });

  ipcMain.handle('crop:get-data', () => getCropData());
  ipcMain.handle('crop:cancel', () => closeCropWindow());
  ipcMain.handle('crop:save', async (_event, croppedDataUrl: string) => {
    const cropMovieId = getCropMovieId();
    if (!cropMovieId) {
      pendingCroppedDataUrl = croppedDataUrl;
      closeCropWindow();
      setTimeout(() => {
        showMoviePicker(baseDir).catch((err) => {
          console.error('[screenshot] movie picker failed:', err);
          showScreenToast('影片选择器打开失败');
        });
      }, 120);
      return;
    }

    try {
      await saveScreenshotToMovie(cropMovieId, croppedDataUrl, getMainWindow);
    } catch (err) {
      console.error('[screenshot] save failed:', err);
    }

    closeCropWindow();
  });

  ipcMain.handle('screenshot:movie-picker-select', async (_event, movieId: string) => {
    if (!pendingCroppedDataUrl) return;
    const dataUrl = pendingCroppedDataUrl;
    pendingCroppedDataUrl = null;
    closeMoviePickerWindow();

    try {
      await saveScreenshotToMovie(movieId, dataUrl, getMainWindow);
      showScreenToast('截图已保存，并已复制到剪贴板');
    } catch (err) {
      console.error('[screenshot] save failed:', err);
      showScreenToast('截图保存失败');
    }
  });

  ipcMain.handle('screenshot:movie-picker-cancel', () => {
    pendingCroppedDataUrl = null;
    closeMoviePickerWindow();
  });
}

async function saveScreenshotToMovie(
  movieId: string,
  croppedDataUrl: string,
  getMainWindow: MainWindowGetter
): Promise<ScreenshotInfo[]> {
  const { addScreenshot } = await import('../movie/service.js');
  const result = await addScreenshot(movieId, croppedDataUrl, '.png');
  const image = nativeImage.createFromDataURL(croppedDataUrl);
  if (!image.isEmpty()) {
    clipboard.writeImage(image);
  }

  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('screenshot:saved', result);
  }

  return result;
}

async function showMoviePicker(baseDir: string): Promise<void> {
  const { listMovies } = await import('../movie/service.js');
  const movies = listMovies();

  if (!movies.length) {
    pendingCroppedDataUrl = null;
    showScreenToast('没有可选的影片');
    return;
  }

  showScreenToast('请选择影片');
  showMoviePickerWindow(baseDir, movies);
}
