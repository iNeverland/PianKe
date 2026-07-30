const { ipcRenderer } = require('electron');

// 裁剪 UI 全部逻辑在 preload 中运行
window.addEventListener('DOMContentLoaded', () => {
  let startX, startY, dragging = false;
  let rect = null;
  let saving = false;

  const bg = document.getElementById('bg');
  const sel = document.getElementById('sel');
  const mask = document.getElementById('mask');
  const hint = document.getElementById('hint');
  const toolbar = document.getElementById('toolbar');
  const btnConfirm = document.getElementById('btn-confirm');
  const btnCancel = document.getElementById('btn-cancel');

  // 加载截图数据
  ipcRenderer.invoke('crop:get-data').then((data) => {
    if (!data || !data.imageDataUrl) {
      ipcRenderer.invoke('crop:cancel');
      return;
    }
    bg.src = data.imageDataUrl;
    btnConfirm.disabled = false;
  }).catch(() => {
    ipcRenderer.invoke('crop:cancel');
  });

  // ESC 取消，Enter 确认
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ipcRenderer.invoke('crop:cancel');
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmCrop();
    }
  });

  // 按钮事件
  btnCancel.onclick = () => ipcRenderer.invoke('crop:cancel');
  btnConfirm.onclick = () => confirmCrop();

  // 工具栏点击不参与截图选区拖拽，否则会在按钮 click 前清空 rect。
  ['mousedown', 'mousemove', 'mouseup'].forEach((eventName) => {
    toolbar.addEventListener(eventName, (e) => e.stopPropagation());
  });

  function getPos(e) { return { x: e.clientX, y: e.clientY }; }

  document.body.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('#toolbar')) return;
    const p = getPos(e);
    startX = p.x; startY = p.y;
    rect = null; dragging = true;
    sel.style.display = 'none';
    hint.classList.add('hidden');
    btnConfirm.disabled = true;
  });

  document.body.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const p = getPos(e);
    const x = Math.min(startX, p.x), y = Math.min(startY, p.y);
    const w = Math.abs(p.x - startX), h = Math.abs(p.y - startY);
    if (w > 4 || h > 4) {
      rect = { x, y, w, h };
      sel.style.display = 'block';
      sel.style.left = x + 'px';
      sel.style.top = y + 'px';
      sel.style.width = w + 'px';
      sel.style.height = h + 'px';
      mask.style.display = 'none';
    }
  });

  document.body.addEventListener('mouseup', () => {
    dragging = false;
    btnConfirm.disabled = false;
  });

  function confirmCrop() {
    if (saving || !bg.src) return;
    saving = true;
    btnConfirm.disabled = true;
    const img = new Image();
    img.onload = () => {
      const cropRect = rect && rect.w > 10 && rect.h > 10
        ? rect
        : { x: 0, y: 0, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
      const c = document.createElement('canvas');
      c.width = cropRect.w; c.height = cropRect.h;
      c.getContext('2d').drawImage(img, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h);
      ipcRenderer.invoke('crop:save', c.toDataURL('image/png'));
    };
    img.src = bg.src;
  }
});
