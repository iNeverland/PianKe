import { useEffect, useState } from 'react';
import type { AppUpdateState } from '@shared/types/index';
import { showToast } from './Toast';
import Modal from './Modal';
import AppIcon from './AppIcon';

const AUTO_PROMPT_VERSION_KEY = 'pianke-auto-update-prompt-version';

function getLocalDateKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${date}`;
}

function shouldOpenDialog(state: AppUpdateState): boolean {
  if (state.status !== 'available') return state.status === 'downloading' || state.status === 'downloaded';
  if (state.checkSource === 'manual') return true;

  const promptToken = `${getLocalDateKey()}:${state.version || 'unknown'}`;
  if (localStorage.getItem(AUTO_PROMPT_VERSION_KEY) === promptToken) return false;
  localStorage.setItem(AUTO_PROMPT_VERSION_KEY, promptToken);
  return true;
}

export default function UpdateDialog() {
  const [update, setUpdate] = useState<AppUpdateState | null>(null);
  const [visible, setVisible] = useState(false);
  const [startingDownload, setStartingDownload] = useState(false);

  useEffect(() => {
    const updater = window.electronAPI?.updater;
    if (!updater) return;

    const receiveState = (nextState: AppUpdateState) => {
      setUpdate(nextState);
      if (shouldOpenDialog(nextState)) {
        setVisible(true);
        if (nextState.status !== 'available') setStartingDownload(false);
      }
    };

    const unsubscribe = updater.onStateChange(receiveState);
    void updater.getState().then(receiveState).catch(() => undefined);
    return unsubscribe;
  }, []);

  const handleDownload = async () => {
    if (!update || update.status !== 'available') return;
    setStartingDownload(true);

    try {
      const started = await window.electronAPI.updater.download();
      if (!started) {
        setStartingDownload(false);
        showToast('更新下载未能开始，请稍后重试');
      }
    } catch {
      setStartingDownload(false);
      showToast('更新下载失败，请稍后重试');
    }
  };

  if (!update || !visible || !['available', 'downloading', 'downloaded'].includes(update.status)) return null;

  const isAvailable = update.status === 'available';
  const isDownloaded = update.status === 'downloaded';
  const percent = update.percent ?? 0;

  return (
    <Modal
      open={visible}
      onClose={() => setVisible(false)}
      title={isAvailable ? '发现新版本' : isDownloaded ? '更新下载完成' : '正在下载更新'}
      width="440px"
    >
      <div className="px-6 pb-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 shrink-0 rounded-xl bg-accent-dim text-accent flex items-center justify-center">
            <AppIcon name="download" className="w-5 h-5" />
          </div>
          <div className="min-w-0 pt-0.5">
            <p className="text-sm font-medium text-text-primary">
              片刻 {update.version ? `v${update.version}` : '有可用更新'}
            </p>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              {isAvailable
                ? '立即更新会下载新版本，并在完成后自动重启安装。'
                : isDownloaded
                  ? '正在保存数据并准备重启安装。'
                  : '下载完成后将自动重启并安装，你可以继续使用片刻。'}
            </p>
          </div>
        </div>

        {!isAvailable && !isDownloaded && (
          <div className="mt-5">
            <div className="h-[3px] overflow-hidden rounded-full bg-border-light">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${Math.max(3, percent)}%` }}
              />
            </div>
            <p className="mt-2 text-right text-[11px] text-text-muted">{percent}%</p>
          </div>
        )}

        {update.releaseNotes && (
          <p className="mt-4 max-h-20 overflow-y-auto whitespace-pre-line border-l-2 border-accent-dim pl-3 text-xs leading-5 text-text-secondary">
            {update.releaseNotes}
          </p>
        )}

        {isAvailable && (
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setVisible(false)}
              className="rounded-btn px-4 py-2 text-xs text-text-secondary transition-colors hover:bg-bg-secondary"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => { void handleDownload(); }}
              disabled={startingDownload}
              className="rounded-btn bg-accent px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            >
              {startingDownload ? '正在开始下载…' : '立即更新'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
