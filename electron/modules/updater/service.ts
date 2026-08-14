import { app, BrowserWindow } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import type { AppUpdateState, UpdateCheckSource } from '../../../shared/types/index.js';
import { writeQueue } from '../../utils/writeQueue.js';

export const UPDATE_STATE_EVENT = 'update:stateChanged';

let started = false;
let installRequested = false;
let activeCheckSource: UpdateCheckSource = 'automatic';
let state: AppUpdateState = {
  status: 'idle',
  currentVersion: '0.0.0',
};

function isEnabled(): boolean {
  return app.isPackaged && !process.env.VITE_DEV_SERVER_URL;
}

function formatReleaseNotes(releaseNotes: UpdateInfo['releaseNotes']): string | undefined {
  if (!releaseNotes) return undefined;
  if (typeof releaseNotes === 'string') return releaseNotes;
  return releaseNotes
    .map((note) => note.note)
    .filter((note): note is string => Boolean(note))
    .join('\n\n') || undefined;
}

function broadcast(nextState: AppUpdateState): void {
  state = nextState;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(UPDATE_STATE_EVENT, state);
    }
  }
}

function setState(nextState: Omit<AppUpdateState, 'currentVersion' | 'checkSource'>): void {
  broadcast({
    currentVersion: app.getVersion(),
    checkSource: activeCheckSource,
    ...nextState,
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return '检查更新时发生未知错误';
}

export function getUpdateState(): AppUpdateState {
  return { ...state, currentVersion: app.getVersion() };
}

export async function checkForUpdates(source: UpdateCheckSource = 'automatic'): Promise<AppUpdateState> {
  if (!isEnabled()) {
    setState({ status: 'disabled' });
    return state;
  }

  if (state.status === 'checking' || state.status === 'downloading') {
    return state;
  }

  try {
    activeCheckSource = source;
    setState({ status: 'checking' });
    await autoUpdater.checkForUpdates();
  } catch (error) {
    setState({ status: 'error', message: getErrorMessage(error) });
  }

  return state;
}

export function downloadUpdate(): boolean {
  if (!isEnabled() || state.status !== 'available') return false;

  setState({
    status: 'downloading',
    version: state.version,
    releaseDate: state.releaseDate,
    releaseNotes: state.releaseNotes,
    percent: 0,
  });
  void autoUpdater.downloadUpdate().catch((error) => {
    setState({ status: 'error', message: getErrorMessage(error) });
  });
  return true;
}

async function restartAndInstall(): Promise<void> {
  if (installRequested) return;
  installRequested = true;

  // 等待已经提交的日记、进度等文件写入完成，再关闭安装。
  await writeQueue.drain();
  // Squirrel.Mac 会在旧进程完全退出前启动新版本。提前释放单实例锁，
  // 防止新版本因无法取得锁而立即退出。
  if (process.platform === 'darwin') {
    app.releaseSingleInstanceLock();
  }
  // Windows 使用 NSIS 静默安装，完成后强制重新启动；macOS 由原生更新器无界面处理。
  autoUpdater.quitAndInstall(true, true);
}

export function startAutoUpdater(): void {
  if (started) return;
  started = true;

  if (!isEnabled()) {
    setState({ status: 'disabled' });
    return;
  }

  autoUpdater.autoDownload = false;
  // 更新只在下载完成后的显式流程中安装，避免普通退出也触发安装。
  autoUpdater.autoInstallOnAppQuit = false;
  // 不依赖 electron-updater 的默认值，安装完成后必须拉起新版本。
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setState({
      status: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: formatReleaseNotes(info.releaseNotes),
    });
  });

  autoUpdater.on('update-not-available', () => {
    setState({ status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    setState({
      status: 'downloading',
      version: state.version,
      releaseDate: state.releaseDate,
      releaseNotes: state.releaseNotes,
      percent: Math.min(100, Math.max(0, Math.round(progress.percent))),
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setState({
      status: 'downloaded',
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: formatReleaseNotes(info.releaseNotes),
      percent: 100,
    });
    // 此下载由用户在弹窗中确认；下载完成后自动重启安装。
    void restartAndInstall();
  });

  autoUpdater.on('error', (error: Error) => {
    setState({ status: 'error', message: getErrorMessage(error) });
  });

}
