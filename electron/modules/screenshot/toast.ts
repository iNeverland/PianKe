import { BrowserWindow, screen } from 'electron';

let screenToastWindow: BrowserWindow | null = null;
let screenToastTimer: NodeJS.Timeout | null = null;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function showScreenToast(message: string, duration = 2200): void {
  const text = String(message || '').trim();
  if (!text) return;

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const width = Math.min(520, Math.max(220, text.length * 18 + 56));
  const height = 52;
  const x = Math.round(display.bounds.x + (display.bounds.width - width) / 2);
  const y = Math.round(display.bounds.y + display.bounds.height * 0.16);

  if (screenToastTimer) {
    clearTimeout(screenToastTimer);
    screenToastTimer = null;
  }

  if (!screenToastWindow || screenToastWindow.isDestroyed()) {
    screenToastWindow = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      hasShadow: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    screenToastWindow.setIgnoreMouseEvents(true);
  } else {
    screenToastWindow.setBounds({ x, y, width, height });
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:'Microsoft YaHei',sans-serif}
body{display:flex;align-items:center;justify-content:center}
.toast{max-width:100%;height:44px;display:flex;align-items:center;justify-content:center;padding:0 22px;border-radius:22px;background:rgba(20,20,20,.88);color:#fff;font-size:14px;font-weight:600;white-space:nowrap}
</style></head><body><div class="toast">${escapeHtml(text)}</div></body></html>`;

  screenToastWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  screenToastWindow.once('ready-to-show', () => {
    screenToastWindow?.showInactive();
  });
  screenToastTimer = setTimeout(() => {
    if (screenToastWindow && !screenToastWindow.isDestroyed()) {
      screenToastWindow.close();
    }
    screenToastWindow = null;
    screenToastTimer = null;
  }, duration);
}
