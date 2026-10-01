const { contextBridge, ipcRenderer } = require('electron');

// ⚠️ 此块由 vite.config.ts 的 copy-preload 插件从 shared/types/index.ts 自动生成，
// 请勿手动修改；如需新增通道请改 shared/types/index.ts 的 IPC_CHANNELS。
// 业务数据（影视/日记/追剧/想看/统计）不走 IPC，因此这里只有原生能力通道。
const IPC_CHANNELS = {
  TMDB_SEARCH: "tmdb:search",
  TMDB_GET_DETAILS: "tmdb:getDetails",
  TMDB_GET_POSTER: "tmdb:getPoster",
  UPDATE_GET_STATE: "update:getState",
  UPDATE_CHECK: "update:check",
  UPDATE_DOWNLOAD: "update:download",
};

const electronAPI = {
  platform: process.platform,
  setTheme: (mode) => ipcRenderer.invoke('theme:update', mode),

  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizeChange: (callback) => {
      ipcRenderer.on('window:maximizeChanged', (_event, isMaximized) => callback(isMaximized));
    },
  },

  updater: {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_GET_STATE),
    check: (source) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK, source),
    download: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD),
    onStateChange: (callback) => {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on('update:stateChanged', handler);
      return () => ipcRenderer.removeListener('update:stateChanged', handler);
    },
  },

  // 截图快捷键：主进程 → 渲染进程事件
  onScreenshotTrigger: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('screenshot:trigger', handler);
    // 返回取消订阅函数
    return () => ipcRenderer.removeListener('screenshot:trigger', handler);
  },

  // 注册快捷键到主进程
  registerShortcut: (accelerator) => ipcRenderer.invoke('shortcut:register', accelerator),
  unregisterShortcut: () => ipcRenderer.invoke('shortcut:unregister'),
  showScreenToast: (message, duration) => ipcRenderer.invoke('screen-toast:show', message, duration),

  // 主屏快照（截图的输入源）。原先还暴露过一个 getDesktopSources（枚举屏幕与窗口），
  // 全项目无人调用，已移除以免平白多一个可枚举屏幕的入口。
  getPrimaryScreenSnapshot: () => ipcRenderer.invoke('desktop-capturer:getPrimaryScreenSnapshot'),

  // 启动桌面裁剪窗口（从非详情页发起时同步当前数据源的影片列表）
  startCrop: (movieId, fullScreenDataUrl, movies) => ipcRenderer.invoke('crop:start', movieId, fullScreenDataUrl, movies),

  // 裁剪窗口完成后将图片交给渲染进程上传到当前云端账号。
  onScreenshotCropped: (callback) => {
    const handler = (_event, movieId, dataUrl) => callback(movieId, dataUrl);
    ipcRenderer.on('screenshot:cropped', handler);
    return () => ipcRenderer.removeListener('screenshot:cropped', handler);
  },

  tmdb: {
    search: (query) => ipcRenderer.invoke(IPC_CHANNELS.TMDB_SEARCH, query),
    getDetails: (mediaType, id) => ipcRenderer.invoke(IPC_CHANNELS.TMDB_GET_DETAILS, mediaType, id),
    getPoster: (posterPath) => ipcRenderer.invoke(IPC_CHANNELS.TMDB_GET_POSTER, posterPath),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
