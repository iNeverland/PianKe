import { BrowserWindow, screen } from 'electron';
import path from 'path';
import type { MovieSummary } from '../../../shared/types/index.js';

export interface MoviePickerItem {
  id: string;
  title: string;
  titleOriginal?: string;
  year: string;
  mediaType: string;
}

let moviePickerWindow: BrowserWindow | null = null;

function toPickerItem(movie: MovieSummary): MoviePickerItem {
  return {
    id: movie.id,
    title: movie.title,
    titleOriginal: movie.titleOriginal,
    year: movie.releaseDate?.substring(0, 4) || '',
    mediaType: movie.mediaType,
  };
}

function getPickerHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    *{box-sizing:border-box}
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:"Microsoft YaHei",Arial,sans-serif;color:#fff}
    body{display:flex;align-items:flex-end;justify-content:center;padding:0 18px 0}
    .panel{width:100%;height:220px;background:rgba(18,18,18,.94);border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 18px 54px rgba(0,0,0,.36);padding:10px 16px}
    .top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px}
    .title-block{display:flex;flex-direction:column;gap:3px;min-width:0}
    .tools{display:flex;align-items:center;gap:8px;flex:0 0 auto}
    .title{font-size:15px;font-weight:700;letter-spacing:.02em}
    .hint{font-size:12px;color:rgba(255,255,255,.56)}
    .search{width:220px;height:30px;border:1px solid rgba(255,255,255,.14);border-radius:8px;background:rgba(255,255,255,.08);color:#fff;padding:0 10px;font-size:12px;outline:none}
    .search::placeholder{color:rgba(255,255,255,.38)}
    .search:focus{border-color:#ff8000;box-shadow:0 0 0 2px rgba(255,128,0,.18)}
    .cancel{border:0;background:transparent;color:rgba(255,255,255,.68);font-size:12px;padding:6px 8px;border-radius:6px;cursor:pointer}
    .cancel:hover{background:rgba(255,255,255,.08);color:#fff}
    .strip{position:relative;height:154px;padding:0 38px}
    .list{display:flex;gap:12px;overflow-x:auto;overflow-y:hidden;height:154px;scrollbar-width:none;scroll-behavior:smooth}
    .list::-webkit-scrollbar{display:none}
    .movie{flex:0 0 76px;width:76px;border:0;background:transparent;color:#fff;padding:0;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:flex-start}
    .poster{width:76px;height:104px;border-radius:6px;background:#2a2a2a;overflow:hidden;border:1px solid rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center}
    .poster img{width:100%;height:100%;object-fit:cover;display:block}
    .fallback{font-size:22px;color:rgba(255,255,255,.35);font-weight:800}
    .name{margin-top:6px;width:76px;font-size:11px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:rgba(255,255,255,.86);text-align:center}
    .meta{font-size:10px;color:rgba(255,255,255,.42);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:76px;text-align:center}
    .movie:hover .poster{border-color:#ff8000;box-shadow:0 0 0 2px rgba(255,128,0,.28)}
    .arrow{position:absolute;top:48px;width:30px;height:58px;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(255,255,255,.08);color:#fff;font-size:24px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2}
    .arrow:hover{background:rgba(255,128,0,.22);border-color:rgba(255,128,0,.45)}
    .arrow:disabled{opacity:.24;cursor:default;pointer-events:none}
    .arrow.left{left:0}
    .arrow.right{right:0}
    .empty{height:154px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.5);font-size:13px}
  </style>
</head>
<body>
  <div class="panel">
    <div class="top">
      <div class="title-block">
        <div class="title">请选择影片</div>
        <div class="hint">点击影片后，截图会保存到对应照片墙</div>
      </div>
      <div class="tools">
        <input class="search" id="search" placeholder="搜索影片名称" autocomplete="off">
        <button class="cancel" id="cancel">取消 ESC</button>
      </div>
    </div>
    <div class="strip">
      <button class="arrow left" id="prev">‹</button>
      <div class="list" id="list"></div>
      <button class="arrow right" id="next">›</button>
    </div>
  </div>
</body>
</html>`;
}

export function closeMoviePickerWindow(): void {
  moviePickerWindow?.close();
}

export function showMoviePickerWindow(baseDir: string, movies: MovieSummary[]): void {
  closeMoviePickerWindow();

  const sortedMovies = [...movies].sort((a, b) => {
    const left = a.createdAt || '';
    const right = b.createdAt || '';
    return right.localeCompare(left);
  });

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const width = Math.min(display.workArea.width - 32, 980);
  const height = 220;
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2);
  const y = Math.round(display.workArea.y + display.workArea.height - height - 8);
  const items = sortedMovies.map(movie => toPickerItem(movie));

  const pickerWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(baseDir, 'movie-picker-preload.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  moviePickerWindow = pickerWindow;

  let ready = false;
  const reveal = () => {
    if (ready || pickerWindow.isDestroyed() || pickerWindow.webContents.isDestroyed()) return;
    ready = true;
    pickerWindow.setAlwaysOnTop(true, 'screen-saver');
    pickerWindow.show();
    pickerWindow.focus();
    pickerWindow.webContents.send('screenshot:movie-picker-data', items);
  };

  const cancelPicker = () => {
    if (!pickerWindow.isDestroyed()) pickerWindow.close();
  };

  pickerWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      event.preventDefault();
      cancelPicker();
    }
    if (input.key === 'Enter' && items.length === 1) {
      event.preventDefault();
      pickerWindow.webContents.send('screenshot:movie-picker-data', items);
    }
  });

  pickerWindow.webContents.once('did-finish-load', reveal);
  pickerWindow.once('ready-to-show', reveal);
  pickerWindow
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getPickerHtml())}`)
    .then(reveal)
    .catch((err) => {
      console.error('[screenshot] movie picker load failed:', err);
    });
  setTimeout(reveal, 300);

  pickerWindow.on('closed', () => {
    if (moviePickerWindow === pickerWindow) {
      moviePickerWindow = null;
    }
  });
}
