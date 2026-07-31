import { BrowserWindow, screen } from 'electron';
import path from 'path';

let cropWindow: BrowserWindow | null = null;
let cropImageData: string | null = null;
let cropMovieId: string | null = null;

export function getCropData(): { imageDataUrl: string | null; movieId: string | null } {
  return {
    imageDataUrl: cropImageData,
    movieId: cropMovieId,
  };
}

export function getCropMovieId(): string | null {
  return cropMovieId;
}

export function closeCropWindow(): void {
  cropWindow?.close();
}

export function startCropWindow(baseDir: string, movieId: string | null, fullScreenDataUrl: string): void {
  cropMovieId = movieId;
  cropImageData = fullScreenDataUrl;

  if (cropWindow && !cropWindow.isDestroyed()) {
    cropWindow.focus();
    return;
  }

  const display = screen.getPrimaryDisplay();
  // macOS 工作区会排除顶部菜单栏及 Dock；裁剪窗口与截图源必须使用同一范围。
  const captureArea = process.platform === 'darwin' ? display.workArea : display.bounds;
  const { x, y, width, height } = captureArea;

  cropWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    backgroundColor: '#000',
    webPreferences: {
      preload: path.join(baseDir, 'crop-preload.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#000;overflow:hidden;cursor:crosshair;user-select:none;font-family:'Microsoft YaHei',sans-serif;}
#bg{position:fixed;inset:0;object-fit:contain;background:#000;}
#mask{position:fixed;inset:0;background:rgba(0,0,0,0.35);}
#sel{position:fixed;border:2px solid #ff8000;box-shadow:0 0 0 9999px rgba(0,0,0,0.35);display:none;}
#toolbar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;gap:8px;background:rgba(0,0,0,0.85);border-radius:10px;padding:6px 10px;z-index:10;}
#toolbar button{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;border:none;font-size:13px;cursor:pointer;color:#fff;background:transparent;}
#toolbar button:hover{background:rgba(255,255,255,0.1);}
#toolbar button.primary{background:#ff8000;font-weight:600;}
#toolbar button.primary:hover{filter:brightness(1.15);}
#toolbar button.primary:disabled{opacity:0.4;cursor:not-allowed;pointer-events:none;}
#hint{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.8);font-size:14px;}
#hint.hidden{display:none;}
</style></head><body>
<img id="bg" draggable="false">
<div id="mask"></div><div id="sel"></div>
<div id="hint">拖动鼠标选择截图区域，按 Enter 保存全屏，ESC 取消</div>
<div id="toolbar">
  <button id="btn-cancel">取消 (ESC)</button>
  <button id="btn-confirm" class="primary">确认截图</button>
</div>
</body></html>`;

  cropWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  cropWindow.once('ready-to-show', () => {
    cropWindow?.show();
    cropWindow?.focus();
  });
  cropWindow.on('closed', () => {
    cropWindow = null;
    cropImageData = null;
    cropMovieId = null;
  });
}
