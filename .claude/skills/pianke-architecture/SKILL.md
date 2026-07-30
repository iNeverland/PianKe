---
name: pianke-architecture
description: Use when working on the PianKe Electron+React desktop app — understanding IPC patterns, data storage, business logic couplings, CSS conventions, or build pipeline. Reference for stable architectural decisions that are unlikely to change.
---

# PianKe 架构参考

个人影视日记桌面应用。Electron 34 + React 19 + TypeScript，文件存储，Frameless 窗口。

## 进程架构

```
┌─ 主进程 (electron/) ─────────────────────────┐
│  main.ts      窗口管理、CSP、单实例锁           │
│  preload.cjs   contextBridge 暴露 API          │
│  store/        Map-based 内存数据库 + LRU 缓存  │
│  modules/      Handler → Service 分层          │
│    library/    库打开/创建/迁移/摘要             │
│    movie/      影视 CRUD + 进度 + 海报 + 搜索   │
│    diary/      日记增删改查 + 时间线             │
│    watchlist/  想看清单 + 状态切换               │
│    stats/      统计概览/趋势/评分/日历           │
│  errors/       AppError + ErrorCode            │
│  utils/        paths, writeQueue, thumbnail    │
├───────────────────────────────────────────────┤
│  shared/       IPC_CHANNELS + Zod schemas      │
│                + 全部 TS 类型定义               │
├───────────────────────────────────────────────┤
│  src/          渲染进程 (React 前端)             │
│  components/   layout/, common/, movie/        │
│  pages/        8 个路由页面                     │
│  hooks/        useMovies, useLibrary, useDiary │
└───────────────────────────────────────────────┘
```

## IPC 通信模式

**通道常量**定义在 `shared/types/index.ts` → `IPC_CHANNELS` 对象。新增通道时需同步修改：
1. `shared/types/index.ts` — 通道常量
2. `electron/modules/<module>/handler.ts` — `ipcMain.handle`
3. `electron/modules/<module>/service.ts` — 业务逻辑
4. `electron/preload.cjs` — `IPC_CHANNELS` 常量 + `electronAPI` 方法
5. `src/types/electron.d.ts` — TS 类型声明

前端 API 透传：`src/lib/api.ts` 是 `window.electronAPI` 的 Proxy，惰性访问。Preload 暴露方法 → api.movie.xxx() 直接调用。

**重要**：preload.cjs 不会被 Vite 热更新，修改后必须重启整个 Electron 应用。

## 数据模型

```typescript
MovieMetadata {
  id, title, titleOriginal?, mediaType: '电影'|'剧集'|'综艺'|'纪录片'|'动画',
  director, releaseDate, country, genre[], tags[], runtime, synopsis?,
  rating: 0-10, posterPath?, posterThumbPath?,
  status: '在看'|'已看完'|'想看',
  progress: Progress | null, createdAt
}

Progress {
  season: number        // 当前季 (从1开始)
  episode: number       // 当前集
  seasonEpisodes: number[]  // [S1总集数, S2总集数, ...]
}

DiaryEntry {
  id, watchDate: 'YYYY-MM-DD', watchTime?: 'HH:mm',
  rating: -1|0-10, review?, images[]
}
// rating=-1 表示未评分（自动生成的记录）
```

## 文件存储结构

```
库名.pianke/
├── library.json       # { name, version, createdAt, movieCount }  LATEST_VERSION=2
├── folder-icon.ico    # SVG → sharp→PNG→ICO
├── desktop.ini        # Windows 文件夹图标
└── movies/
    └── 影视名 (年份)/
        ├── metadata.json    # MovieMetadata
        ├── diary.json       # DiaryEntry[]
        ├── poster.jpg       # 原海报
        ├── poster_thumb.jpg # 500px 缩略图
        └── screenshots/     # 截图相册
            ├── shot_001.jpg
            └── shot_001_thumb.jpg
```

## 关键业务逻辑

### 状态变更 → 进度联动（`movie/service.ts → updateMovie`）

```
status 变为 '已看完' + 有 progress.seasonEpisodes
  → progress.episode = seasonEpisodes[season-1]  // 当前季 100%
  → 不跨季修改
```

同样逻辑在 `watchlist/service.ts → markAsWatched` 中。

### 状态变更 → 自动日记（`updateMovie` + `markAsWatching`）

```
status 从非'在看'→'在看' 或 非'已看完'→'已看完'
  → 当天无记录则自动创建 DiaryEntry
  → review 文案："状态变更为「在看/已看完」"
  → rating = -1（未评分）
```

### 追剧进度 → 自动日记 + 状态（`updateProgress`）

```
updateProgress(id, season, episode)
  → 当天有记录则更新 review（S1E3 · 进度 30%），无则创建
  → 最后一季最后一集 → 自动切 status='已看完'
```

### 库版本迁移

`library/service.ts` 中 `MIGRATIONS` 表，迁移与加载合并为同一遍历（避免二次 I/O）。`schemas/index.ts` 中 `z.preprocess` 作为兜底。

### 首页排序

后端 `getSummary()` 返回含 `latestWatchDate`/`createdAt` 的 `MovieSummary`。前端负责排序：recent / added / rating / year / title，每次切换后重排。

### 海报缓存

`dataStore` 内存 LRU 缓存（Map，最大 50 张 base64），按 `movieId:thumb` 键存取。

## CSS 设计系统

### 主题变量

`:root`（浅色）和 `:root[data-theme="dark"]`（深色），CSS 变量驱动。

### 核心设计标记

| Token | 值 | 用途 |
|-------|-----|------|
| `--accent` | `#ff8000` | 橙色强调 |
| `--star` | `#f5a623` | 评分星 |
| `--bg-primary` | `#ffffff` / `#1a1a1a` | 主背景 |
| `--text-primary` | `#1a1a1a` / `#f0f0f0` | 主文字 |

### 关键组件类

| 类名 | 用途 |
|------|------|
| `.app-shell` | 顶层 flex-col 布局 |
| `.titlebar` | 36px 拖拽标题栏 |
| `.sidebar-capsule` | 80px 宽深色胶囊导航 |
| `.nav-item` | 导航图标，active 橙色背景 |
| `.movie-card` | 海报卡片，hover 上浮 4px |
| `.stat-card` | 透明无边框统计卡片 |
| `.stat-card-contained` | 有边框图表容器 |
| `.row-item` | Watching/Watchlist 行卡片 |
| `.status-btn` | 状态切换按钮 4px/12px 0.72rem |
| `.detail-hero` | 海报+信息 flex 区 |
| `.detail-meta-grid` | 3 列元信息网格 |
| `.diary-timeline` | 日记竖线时间线 |
| `.form-layout` | 表单两栏布局 |

### 布局规格

- Frameless 窗口，标题栏 36px
- 主内容区 `padding: 32px 48px`，无 max-width
- 影视网格 `grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))`
- 截图墙单行横向滚动，每项 `calc((100% - 1.5rem) / 3)`
- 日记页：左侧时间线 flex-1 + 右侧热力图 252px sticky
- 滚动条全局隐藏

### 动画

- `fadeInUp` / `scaleIn` 入场关键帧
- `.stagger-children` 逐项延迟
- 交互动画 `cubic-bezier(0.34, 1.56, 0.64, 1)`
- Modal 150ms 退出动画（`closing` 类）

## 构建与打包

- **开发**：Vite dev server，跳过 Splash
- **生产**：`splash.html` → 主窗口加载 React → `vite build` → electron-builder
- **打包**：electron-builder 25，NSIS 安装器
- **安装器**：`build/installer.nsh` 自定义单页（路径选择 + 桌面快捷方式合并）
- **资源**：`resources/icon.png`，`logo/PianKe.svg`

## 路由

HashRouter：`/` `/watching` `/movie/new` `/movie/:id` `/movie/:id/edit` `/diary` `/watchlist` `/stats` `/settings`
