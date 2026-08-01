## 语言规则
始终使用中文回复，无论我用什么语言提问。

# PianKe（片刻）— 项目总览

个人影视日记桌面应用。Electron + React + TypeScript，极简黑白灰 + 橙色强调风格，Frameless 窗口。

## 技术栈

| 层 | 技术 |
|------|------|
| 桌面壳 | Electron 34 (frameless) |
| 前端 | React 19 + React Router 7 + Tailwind CSS 3 |
| 构建 | Vite 6 + vite-plugin-electron |
| 打包 | electron-builder 25 (NSIS) |
| 数据校验 | Zod |
| 图表 | ECharts (echarts-for-react) |
| 图片 | sharp (海报缩略图 + 文件夹图标) |
| 字体 | DM Sans + Microsoft YaHei |
| 包管理 | npm |

## 目录结构

```
PianKe/
├── electron/              # 主进程 (Node.js 后端)
│   ├── main.ts            # Electron 入口：frameless 窗口、CSP、单实例锁、窗口控制 IPC、Splash 屏
│   ├── ipc.ts             # 聚合注册 IPC handlers
│   ├── preload.cjs        # contextBridge 暴露 API 给渲染进程（含 window 控制接口）
│   ├── store/
│   │   └── dataStore.ts   # 内存数据库（Map），含 loaded 标记、LRU 海报缓存
│   ├── modules/           # Handler + Service 分层
│   │   ├── library/       # 库管理（打开/创建/迁移/加载/摘要/最近观看）
│   │   ├── movie/         # 影视 CRUD + 进度 + 标签 + 海报 + 搜索 + CSV 导入导出
│   │   ├── diary/         # 日记增删改查 + 时间线
│   │   ├── watchlist/     # 想看清单 + 状态切换
│   │   └── stats/         # 统计概览/类型/评分/月度/日记评分分布/日历
│   ├── errors/            # AppError + ErrorCode
│   └── utils/             # paths.ts, writeQueue.ts, thumbnail.ts
│
├── src/                   # 渲染进程 (React 前端)
│   ├── App.tsx            # 根：库状态管理 + 路由 + 主题 + 全局快捷键
│   ├── main.tsx           # React 入口（含字体异步加载）
│   ├── index.css          # 全局样式（CSS 变量双主题 + Tailwind + 组件类）
│   ├── lib/api.ts         # electronAPI 惰性代理
│   ├── types/electron.d.ts# Window.electronAPI 类型声明（含 window 控制接口）
│   ├── components/
│   │   ├── layout/        # AppShell + Sidebar + TitleBar + Header
│   │   ├── common/        # Modal, Toast, StarRating, PosterThumb, EmptyState, LoadingSkeleton, ProgressBar
│   │   └── movie/         # MovieCard, MovieGrid
│   ├── pages/
│   │   ├── Welcome/       # 打开/创建库（双卡片布局 + 背景光斑）
│   │   ├── Home/          # 首页：统计摘要 + 搜索/筛选/排序工具栏 + 最近观看 + 影视网格
│   │   ├── MovieDetail/   # 影视详情：海报 + 状态按钮 + 评分 + 元信息网格 + 日记
│   │   ├── MovieForm/     # 添加/编辑影视（两栏布局：左海报 + 右表单分区）
│   │   ├── Diary/         # 日记时间线（竖线 + 日期分组）+ 右侧热力图（每日+月度）
│   │   ├── Watchlist/     # 想看清单（行列表 + 快捷操作）
│   │   ├── Stats/         # ECharts 数据统计（概览/趋势/类型/评分/国家）
│   │   ├── Watching/      # 追剧进度（行列表 + 进度条百分比 + 快捷操作）
│   │   └── Settings/      # 设置：库管理/外观/数据管理（导入导出CSV）
│   └── hooks/             # useMovies, useLibrary, useDiary
│
├── shared/                # 主进程 + 渲染进程共享
│   ├── types/index.ts     # 类型定义 + IPC_CHANNELS 常量
│   └── schemas/index.ts   # Zod 校验 Schema（含旧数据迁移 preprocess）
│
├── build/                 # 构建脚本
│   └── installer.nsh      # NSIS 自定义安装页（路径选择 + 桌面快捷方式合并单页）
├── logo/                  # 应用图标素材
│   ├── PianKe.svg         # 应用 Logo
│   └── 文件夹.svg          # 库文件夹图标
├── resources/             # electron-builder 资源（icon.png, installer-sidebar.bmp）
├── docs/                  # 设计文档（style.md, design-philosophy.md）
└── electron-builder.yml   # 打包配置（NSIS, extraResources, fileAssociations）
```

## 数据模型

```typescript
MovieMetadata { id, title, titleOriginal, mediaType, director, releaseDate,
  country, genre[], tags[], runtime, synopsis, rating, posterPath,
  posterThumbPath, status, progress, createdAt }

MovieSummary {
  id, title, titleOriginal?, mediaType, rating, personalRating?, posterThumbPath?,
  releaseDate, genre[], tags[], status, progress?,
  latestWatchDate?, createdAt?  // 排序用，从后端传入
}

Progress { season, episode, seasonEpisodes: number[] }
// seasonEpisodes[i] = 第 i+1 季的总集数

DiaryEntry { id, watchDate, rating, review?, images[] }

MediaType = '电影' | '剧集' | '综艺' | '纪录片' | '动画'
WatchStatus = '在看' | '已看完' | '想看'
```

## 数据存储

用户选择文件夹 → `文件夹名.pianke/`（OneDrive 兼容）
```
库名.pianke/
├── library.json    # 版本号 + 元信息（LATEST_VERSION=2）
├── folder-icon.ico # 文件夹图标（SVG → sharp → PNG → ICO）
├── desktop.ini     # Windows 文件夹图标配置
└── movies/
    └── 影视名 (年份)/
        ├── metadata.json
        ├── diary.json
        ├── poster.jpg
        └── poster_thumb.jpg
```

## 版本迁移机制

`library/service.ts` 中 `LATEST_VERSION=2`，`MIGRATIONS` 表定义每个版本的升级逻辑。
打开旧库时迁移与加载合并为同一遍历（避免二次 I/O），迁移写回异步不阻塞。
`schemas/index.ts` 中 `z.preprocess` 作为兜底。

## 设计风格

### 视觉原则
- **极简黑白灰 + 橙色强调**：背景纯白 `#ffffff`，文字深灰，仅关键操作用橙色 `#ff8000`
- **去卡片化**：概览统计、时间线等区域无背景无边框，纯排版布局
- **有边框卡片**：行列表项（Watching/Watchlist）和图表容器保留浅色边框 + 圆角
- **星星评分**：金黄色 `#f5a623`
- **进度条**：橙色填充 `var(--accent)`，高 3px 细条，右侧显示百分比

### 布局
- **Frameless 窗口**：自定义标题栏（36px），左侧应用名，右侧最小化/最大化/关闭
- **侧边栏**：80px 宽，深色胶囊 Dock 风格，图标导航 + tooltip
- **主内容区**：全宽，无 max-width 限制，`padding: 32px 48px`
- **影视网格**：`grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))`，一排约 6 个
- **日记页双栏**：左侧时间线 flex-1 + 右侧热力图 252px（sticky 定位）

### CSS 架构
- **双主题**：`:root`（浅色）+ `:root[data-theme="dark"]`（深色），CSS 变量驱动
- **组件类命名**：`.row-item`、`.quick-action-btn`、`.stat-card-contained` 等
- **滚动条隐藏**：`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`
- **入场动画**：`fadeInUp`、`scaleIn` 关键帧，`.stagger-children` 逐项延迟
- **弹性交互**：`cubic-bezier(0.34, 1.56, 0.64, 1)` 用于按钮/卡片 hover/active

### 关键 CSS 类
| 类名 | 用途 |
|------|------|
| `.app-shell` | 顶层 flex-col：标题栏 + 侧边栏/内容 |
| `.titlebar` | 自定义标题栏，`-webkit-app-region: drag` |
| `.sidebar-capsule` | 深色胶囊导航，`border-radius: 40px` |
| `.nav-item` | 导航图标按钮，active 时橙色背景 |
| `.movie-card` | 影视卡片，hover 上浮 4px + 海报缩放 |
| `.row-item` | 行列表项（Watching/Watchlist），有边框圆角卡片 |
| `.quick-action-btn` | 快捷操作按钮，`.primary` 为橙色强调 |
| `.stat-card` | 概览统计卡片，透明无边框 |
| `.stat-card-contained` | 图表容器，浅色背景 + 边框 |
| `.filter-chip` | 筛选标签，无边框，active 时加边框 |
| `.tag` | 类型/自定义标签，圆角胶囊 |
| `.status-btn` | 状态切换按钮，padding 4px 12px，字号 0.72rem |
| `.form-layout` | 表单两栏布局 |
| `.diary-timeline` | 日记时间线，竖线 + 日期分组 |
| `.tool-icon` | 工具栏图标按钮，透明底 32×32，hover 显底色 |
| `.detail-hero` | 影视详情顶部：海报 + 信息 Grid，`align-items: center` |
| `.detail-meta-grid` | 元信息 3 列网格（导演/上映/片长/国家/类型） |
| `.meta-item` | 元信息单项：label + value |
| `.search-bar` | 搜索框容器，折叠态仅图标，展开态输入框平滑滑出 |
| `.timeline-item` | 日记时间线条目行，左侧海报 + 右侧标题/评分/评论 |

## 关键逻辑

### 启动流程
- **生产环境**：Splash 屏（`splash.html`）→ 主窗口加载 React → 读取 localStorage 库路径 → IPC `reopen` → `openLibrary` → `await loadAllMovies` → 返回 info → 渲染首页
- **开发环境**：跳过 Splash，直接加载 Vite dev server
- `openLibrary`：读 library.json → Zod 校验 → 异步图标生成（不阻塞）→ `await loadAllMovies`（去 access 检查 + 合并迁移）→ 标记 loaded → 缩略图迁移后台执行

### 首页排序逻辑
- `getSummary()` / `getRecentWatches()` / `searchMovies()` / `listMovies()` 均返回含 `latestWatchDate` 和 `createdAt` 的 `MovieSummary`
- 前端排序：`recent` 按 `latestWatchDate` 倒序、`added` 按 `createdAt` 倒序、`rating` 按评分倒序、`year` 按上映日期倒序、`title` 按标题拼音
- 默认排序「最近观看」，每次切换后正确重排（不依赖数组原始顺序）

### 工具栏（Home 页）
- 三个图标按钮：搜索 → 筛选 → 排序（`.tool-icon`：透明底 32×32，hover 浅灰底，active 橙色）
- 搜索：点击图标后输入框向右展开（0.25s 过渡），失焦空内容则收回
- 筛选：弹出下拉菜单选择类型/状态/评分
- 排序：弹出下拉菜单选择排序方式
- Ctrl+K 全局快捷键展开搜索框

### 日记页热力图
- **本月每日**：7 列月历网格，按影视去重计数，0=透明 1=浅绿 `#d8f0db` 2=亮黄 `#f0d030` 3+=红 `#e53e3e`
- **年度每月**：4 列 12 月方块，0=透明 1-3=浅绿 4-6=深绿 `#40c463` 7-9=亮黄 10+=红
- 统计摘要条：本月 N 部 · 共 M 条记录 · 平均评分 X.X
- 评论单独成行，`line-clamp-2` 两行截断

### 追剧进度联动日记
- `updateProgress` → 当天无日记则自动创建（watchDate=今天, rating=0）
- 状态变为追剧中/已看完（`updateMovie`、`markAsWatching`）→ 自动日记
- `markAsWatched` → 手动填日期
- 日记时间线 + 最近观看：`status === '已看完'` 或有 `progress` 的多集影视

### 统计页
- 「观影日历」板块已移除
- 「观影趋势」统计 `status === '已看完'` 或 `status === '在看'` 的影视（不含「想看」），按影视去重

### 影视详情页
- 海报与信息区 `align-items: center` 垂直居中
- 状态按钮：padding 4px 12px，字号 0.72rem，圆角 16px
- 类型标签并入元信息网格「类型」行
- 元信息 3 列网格：导演/首播/集数/国家/类型

### 文件夹图标
- `createLibrary` + `openLibrary` 都调用 `generateFolderIcon`
- SVG → sharp 渲染 256×256 PNG → `pngToIco()` 封装 ICO 头部 → 写入 `folder-icon.ico`
- 写入 `desktop.ini`，设 `attrib +s +h` 隐藏
- 已有图标则跳过（检查文件存在）

### 安装程序（NSIS）
- 自定义单页：安装路径选择 + 创建桌面快捷方式勾选框合并（`build/installer.nsh`）
- `allowToChangeInstallationDirectory: false`（使用自定义页替代内置目录页）

### 窗口控制
- Electron `frame: false` + `titleBarStyle: 'hidden'`
- IPC：`window:minimize/maximize/close/isMaximized`
- Preload 暴露 `api.window` 接口，TitleBar 组件通过 IPC 控制窗口
- 窗口 maximize/unmaximize 事件在 `createWindow()` 内部监听

### 路由
HashRouter：`/` `/watching` `/movie/new` `/movie/:id` `/movie/:id/edit` `/diary` `/watchlist` `/stats` `/settings`

### 主题
CSS 变量双主题（`data-theme="dark"|"light"`），localStorage 持久化，IPC 同步 Electron 标题栏颜色。支持跟随系统。
设置页「外观」板块：系统/深色/浅色三选一。
