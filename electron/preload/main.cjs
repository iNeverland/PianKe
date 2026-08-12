const { contextBridge, ipcRenderer } = require('electron');

// ⚠️ 此块由 generate-preload-channels 插件从 shared/types/index.ts 自动同步
// 请勿手动修改，如需新增通道请修改 shared/types/index.ts
const IPC_CHANNELS = {
  LIBRARY_OPEN: "library:open",
  LIBRARY_CREATE: "library:create",
  LIBRARY_REOPEN: "library:reopen",
  LIBRARY_GET_PATH: "library:getPath",
  LIBRARY_GET_INFO: "library:getInfo",
  LIBRARY_GET_SUMMARY: "library:getSummary",
  LIBRARY_GET_RECENT_WATCHES: "library:getRecentWatches",
  MOVIE_LIST: "movie:list",
  MOVIE_GET_BY_ID: "movie:getById",
  MOVIE_CREATE: "movie:create",
  MOVIE_UPDATE: "movie:update",
  MOVIE_DELETE: "movie:delete",
  MOVIE_SEARCH: "movie:search",
  MOVIE_UPDATE_PROGRESS: "movie:updateProgress",
  MOVIE_ADD_TAG: "movie:addTag",
  MOVIE_REMOVE_TAG: "movie:removeTag",
  MOVIE_GET_ALL_TAGS: "movie:getAllTags",
  MOVIE_GET_POSTER_URL: "movie:getPosterUrl",
  MOVIE_EXPORT_ALL: "movie:exportAll",
  MOVIE_IMPORT_CSV: "movie:importCsv",
  MOVIE_LIST_SCREENSHOTS: "movie:listScreenshots",
  MOVIE_ADD_SCREENSHOT: "movie:addScreenshot",
  MOVIE_DELETE_SCREENSHOT: "movie:deleteScreenshot",
  MOVIE_GET_SCREENSHOT: "movie:getScreenshot",
  MOVIE_GET_SCREENSHOT_THUMBNAIL: "movie:getScreenshotThumbnail",
  MOVIE_UPDATE_SCREENSHOT_INFO: "movie:updateScreenshotInfo",
  TMDB_SEARCH: "tmdb:search",
  TMDB_GET_DETAILS: "tmdb:getDetails",
  TMDB_GET_POSTER: "tmdb:getPoster",
  DIARY_ADD: "diary:add",
  DIARY_UPDATE: "diary:update",
  DIARY_DELETE: "diary:delete",
  DIARY_GET_BY_MOVIE: "diary:getByMovie",
  DIARY_GET_TIMELINE: "diary:getTimeline",
  WATCHLIST_LIST: "watchlist:list",
  WATCHLIST_MARK_AS_WATCHED: "watchlist:markAsWatched",
  WATCHLIST_MARK_AS_WATCHING: "watchlist:markAsWatching",
  STATS_DASHBOARD: "stats:dashboard",
  STATS_OVERVIEW: "stats:overview",
  STATS_BY_MEDIA_TYPE: "stats:byMediaType",
  STATS_BY_YEAR: "stats:byYear",
  STATS_BY_GENRE: "stats:byGenre",
  STATS_BY_RATING: "stats:byRating",
  STATS_BY_COUNTRY: "stats:byCountry",
  STATS_DIARY_RATING_DIST: "stats:diaryRatingDist",
  STATS_MONTHLY_TREND: "stats:monthlyTrend",
  STATS_MONTH_SUMMARY: "stats:monthSummary",
  STATS_DIARY_CALENDAR: "stats:diaryCalendar",
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

  // 获取桌面捕获源（用于屏幕截图）
  getDesktopSources: () => ipcRenderer.invoke('desktop-capturer:getSources'),
  getPrimaryScreenSnapshot: () => ipcRenderer.invoke('desktop-capturer:getPrimaryScreenSnapshot'),

  // 启动桌面裁剪窗口（从非详情页发起时同步当前数据源的影片列表）
  startCrop: (movieId, fullScreenDataUrl, movies) => ipcRenderer.invoke('crop:start', movieId, fullScreenDataUrl, movies),

  // 监听截图保存完成
  onScreenshotSaved: (callback) => {
    const handler = (_event, screenshots) => callback(screenshots);
    ipcRenderer.on('screenshot:saved', handler);
    return () => ipcRenderer.removeListener('screenshot:saved', handler);
  },

  // 裁剪窗口完成后将图片交给渲染进程上传到当前云端账号。
  onScreenshotCropped: (callback) => {
    const handler = (_event, movieId, dataUrl) => callback(movieId, dataUrl);
    ipcRenderer.on('screenshot:cropped', handler);
    return () => ipcRenderer.removeListener('screenshot:cropped', handler);
  },

  library: {
    open: () => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_OPEN),
    reopen: (dirPath) => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_REOPEN, dirPath),
    create: (name) => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_CREATE, name),
    getPath: () => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_GET_PATH),
    getInfo: () => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_GET_INFO),
    getSummary: () => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_GET_SUMMARY),
    getRecentWatches: (days) => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_GET_RECENT_WATCHES, days),
    createBackup: () => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_CREATE_BACKUP),
  },

  movie: {
    list: (filters) => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_LIST, filters),
    getById: (id) => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_GET_BY_ID, id),
    create: (data, posterFilePath) => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_CREATE, data, posterFilePath),
    update: (id, data, posterFilePath) => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_UPDATE, id, data, posterFilePath),
    delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_DELETE, id),
    search: (query, filters) => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_SEARCH, query, filters),
    updateProgress: (id, episode) => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_UPDATE_PROGRESS, id, episode),
    addTag: (id, tag) => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_ADD_TAG, id, tag),
    removeTag: (id, tag) => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_REMOVE_TAG, id, tag),
    getAllTags: () => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_GET_ALL_TAGS),
    getPosterUrl: (id, thumb) => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_GET_POSTER_URL, id, thumb),
    exportExcel: () => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_EXPORT_EXCEL),
    listScreenshots: (id) => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_LIST_SCREENSHOTS, id),
    addScreenshot: (id, base64Data, ext) => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_ADD_SCREENSHOT, id, base64Data, ext),
    deleteScreenshot: (id, filename) => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_DELETE_SCREENSHOT, id, filename),
    getScreenshot: (id, filename) => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_GET_SCREENSHOT, id, filename),
    getScreenshotThumbnail: (id, filename) => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_GET_SCREENSHOT_THUMBNAIL, id, filename),
    updateScreenshotInfo: (id, filename, info) => ipcRenderer.invoke(IPC_CHANNELS.MOVIE_UPDATE_SCREENSHOT_INFO, id, filename, info),
  },

  tmdb: {
    search: (query) => ipcRenderer.invoke(IPC_CHANNELS.TMDB_SEARCH, query),
    getDetails: (mediaType, id) => ipcRenderer.invoke(IPC_CHANNELS.TMDB_GET_DETAILS, mediaType, id),
    getPoster: (posterPath) => ipcRenderer.invoke(IPC_CHANNELS.TMDB_GET_POSTER, posterPath),
  },

  diary: {
    getByMovie: (movieId) => ipcRenderer.invoke(IPC_CHANNELS.DIARY_GET_BY_MOVIE, movieId),
    delete: (movieId, entryId) => ipcRenderer.invoke(IPC_CHANNELS.DIARY_DELETE, movieId, entryId),
    getTimeline: () => ipcRenderer.invoke(IPC_CHANNELS.DIARY_GET_TIMELINE),
  },

  watchRecord: {
    getByMovie: (movieId) => ipcRenderer.invoke(IPC_CHANNELS.WATCH_RECORD_GET_BY_MOVIE, movieId),
    add: (movieId, data) => ipcRenderer.invoke(IPC_CHANNELS.WATCH_RECORD_ADD, movieId, data),
    update: (movieId, entryId, data) => ipcRenderer.invoke(IPC_CHANNELS.WATCH_RECORD_UPDATE, movieId, entryId, data),
    delete: (movieId, entryId) => ipcRenderer.invoke(IPC_CHANNELS.WATCH_RECORD_DELETE, movieId, entryId),
  },

  watchlist: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.WATCHLIST_LIST),
    markAsWatched: (movieId, entryData) => ipcRenderer.invoke(IPC_CHANNELS.WATCHLIST_MARK_AS_WATCHED, movieId, entryData),
    markAsWatching: (movieId) => ipcRenderer.invoke(IPC_CHANNELS.WATCHLIST_MARK_AS_WATCHING, movieId),
  },

  stats: {
    dashboard: () => ipcRenderer.invoke(IPC_CHANNELS.STATS_DASHBOARD),
    overview: () => ipcRenderer.invoke(IPC_CHANNELS.STATS_OVERVIEW),
    byMediaType: () => ipcRenderer.invoke(IPC_CHANNELS.STATS_BY_MEDIA_TYPE),
    byYear: () => ipcRenderer.invoke(IPC_CHANNELS.STATS_BY_YEAR),
    byGenre: () => ipcRenderer.invoke(IPC_CHANNELS.STATS_BY_GENRE),
    byRating: () => ipcRenderer.invoke(IPC_CHANNELS.STATS_BY_RATING),
    byCountry: () => ipcRenderer.invoke(IPC_CHANNELS.STATS_BY_COUNTRY),
    diaryRatingDist: () => ipcRenderer.invoke(IPC_CHANNELS.STATS_DIARY_RATING_DIST),
    monthlyTrend: () => ipcRenderer.invoke(IPC_CHANNELS.STATS_MONTHLY_TREND),
    monthSummary: (year, month) => ipcRenderer.invoke(IPC_CHANNELS.STATS_MONTH_SUMMARY, year, month),
    diaryCalendar: (days) => ipcRenderer.invoke(IPC_CHANNELS.STATS_DIARY_CALENDAR, days),
  },

  onOpenLibraryPath: (callback) => {
    ipcRenderer.on('open-library-path', (_event, dirPath) => callback(dirPath));
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
