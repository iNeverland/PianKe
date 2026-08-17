# PianKe（片刻）项目结构

> 生成于当前仓库状态（v2.0.2）。本文档描述项目目录结构、分层边界与核心数据流，供快速理解代码库使用。

## 1. 项目概述

PianKe 是一款用于收藏影视、记录观看过程和沉淀观后感的**个人影院日记桌面应用**。

- 桌面容器：Electron 34
- 界面：React 19 + React Router 7（HashRouter）+ Vite 6 + Tailwind CSS 3
- 云端数据：PocketBase（认证、数据、私有文件）
- 离线缓存：IndexedDB（数据快照、海报、截图、头像）
- 影视元数据：TMDB + 自建代理（Vercel Serverless / Node.js 自托管）
- 图表：ECharts；校验：Zod；Excel 导出：SheetJS；图片处理：Sharp
- 打包发布：electron-builder + GitHub Actions + 自建更新服务器

**核心架构理念**：云端账户是唯一权威数据源。登录后数据同步到个人 PocketBase 空间；最近一次同步的数据与媒体缓存到本机 IndexedDB，弱网/离线时仍可浏览。

## 2. 目录总览

```text
PianKe/
├── electron/                  # Electron 主进程（Node 环境）
├── src/                       # React 渲染进程
├── shared/                    # 主/渲染进程共享的类型、校验与工具
├── server/                    # 服务端：PocketBase 迁移/hook + TMDB 代理
├── docs/                      # 架构与发布文档
├── build/                     # 安装器与签名配置
├── resources/                 # 图标与打包资源
├── .github/                   # CI 工作流
├── dist/                      # 前端构建产物（构建时生成）
├── dist-electron/             # 主进程构建产物（构建时生成）
├── node_modules/              # 依赖（不提交）
│
├── package.json               # 依赖与脚本（dev/build/electron:build 等）
├── electron-builder.yml       # 打包配置
├── vite.config.ts             # Vite + vite-plugin-electron 配置
├── tsconfig.json              # TypeScript 配置
├── tailwind.config.js         # Tailwind 主题配置
├── postcss.config.js
├── index.html                 # 渲染进程入口 HTML
├── splash.html                # 启动闪屏 HTML
├── README.md                  # 项目说明
└── LICENSE                    # MIT
```

## 3. 各目录详解

### 3.1 electron/ —— 主进程

```text
electron/
├── main.ts                    # 入口：单实例锁、CSP、主题、注册所有 handler、启动窗口
├── ipc.ts                     # registerAllHandlers()：聚合注册 7 个业务模块的 IPC handler
├── errors/
│   ├── AppError.ts            # 统一错误类型
│   └── errorCodes.ts          # 错误码定义
├── modules/                   # 业务模块，每个 = handler.ts（IPC 边界）+ service.ts（业务规则/文件读写）
│   ├── movie/                 # 影视 CRUD、进度、标签、海报、截图、Excel 导出
│   ├── diary/                 # 自动观影日记（进度/状态变更自动留痕）
│   ├── watchRecord/           # 手动追剧记录（用户评分与感想）
│   ├── watchlist/             # 想看清单
│   ├── stats/                 # 统计仪表盘（类型/年份/类型/国家/评分/月度趋势）
│   ├── screenshot/            # 全局截图快捷键、裁剪窗口、影片选择器、屏幕 Toast
│   │   ├── cropWindow.ts          # 裁剪窗口
│   │   ├── moviePickerWindow.ts   # 截图后影片选择器窗口
│   │   └── toast.ts               # 全屏 Toast
│   ├── tmdb/                  # TMDB 代理客户端（主进程转发到自建服务）
│   ├── updater/               # 自动更新（electron-updater）
│   └── window/                # 窗口控制（最小化/最大化/关闭/主题）
├── preload/
│   ├── main.cjs               # ⚠️ contextBridge 暴露 electronAPI；IPC 通道块由构建插件从 shared/types/index.ts 自动同步，勿手改
│   ├── crop.cjs               # 裁剪窗口 preload
│   └── movie-picker.cjs       # 影片选择器窗口 preload
├── store/
│   └── dataStore.ts           # 内存数据缓存（旧本地库架构遗留，含海报 LRU 缓存）
├── windows/
│   ├── mainWindow.ts          # 主窗口
│   └── splashWindow.ts        # 启动闪屏窗口
├── types/
│   └── sharp.d.ts             # sharp 类型声明
└── utils/
    ├── atomicWrite.ts         # 原子写入（本次更新新增）
    ├── paths.ts               # 资源库路径与影视目录命名的唯一入口
    ├── thumbnail.ts           # 缩略图生成
    └── writeQueue.ts          # 写队列串行化
```

### 3.2 src/ —— 渲染进程（React）

```text
src/
├── main.tsx                   # React 入口
├── App.tsx                    # ⭐ 根组件：路由、云认证门控、主题、全局快捷键、截图触发
├── index.css                  # 全局样式（含暗色/亮色主题变量）
├── vite-env.d.ts
├── assets/
│   ├── brand/                 # Logo 与品牌资源（default-avatar、PianKe.svg、library-folder）
│   └── icons/                 # 图标（home/diary/stats/watchlist/photo/search 等）
├── components/
│   ├── layout/                # AppShell、Header、Sidebar、TitleBar
│   ├── common/                # 通用组件：Modal、Toast、StarRating、ContextMenu、CustomSelect、
│   │                          # CustomDatePicker、PosterThumb、ScreenshotThumbnail、UpdateDialog、
│   │                          # EmptyState、ErrorBoundary、LoadingSkeleton、ProgressBar、AppIcon 等
│   └── movie/                 # MovieCard、MovieGrid、FinishWatchingModal
├── hooks/
│   └── useScreenshotShortcut.ts  # 截图快捷键配置读取与转换
├── lib/
│   ├── api.ts                 # ⭐ 代理：登录后业务调用自动路由到 cloudApi，其余走 Electron IPC
│   ├── cloudApi.ts            # ⭐ 云端业务核心（约 1000 行）：CRUD、快照缓存、单飞去重、离线恢复
│   ├── pocketbase.ts          # ⭐ 认证、当前用户、头像 token/缓存、会话失效处理
│   ├── offlineCache.ts        # IndexedDB：数据快照与媒体（海报/截图/头像）缓存
│   └── segmentInput.ts        # 综艺分段标签输入
├── pages/                     # 路由页面（10 个）
│   ├── Home/                  # 首页（影视库列表 + 搜索筛选）
│   ├── Watching/              # 在看
│   ├── MovieDetail/           # 影视详情（日记、追剧记录、截图、进度）
│   ├── MovieForm/             # 新建/编辑影视（含 TMDB 补全）
│   ├── Diary/                 # 观影日记时间线
│   ├── Watchlist/             # 想看清单
│   ├── Stats/                 # 数据统计（ECharts 仪表盘）
│   ├── PhotoWall/             # 截图照片墙
│   ├── Settings/              # 设置（主题、快捷键、更新、Excel 导出）
│   └── CloudAuth/             # 云账户登录/注册（邮箱验证码）
└── types/
    └── electron.d.ts          # window.electronAPI 类型声明
```

### 3.3 shared/ —— 主/渲染进程共享

```text
shared/
├── types/
│   └── index.ts               # ⭐ 全部业务类型 + IPC_CHANNELS 通道常量（唯一来源，preload 自动同步）
├── schemas/
│   └── index.ts               # Zod 校验 Schema
└── utils/
    └── date.ts                # 日期工具（本地日期/时间字符串）
```

### 3.4 server/ —— 服务端

```text
server/
├── index.mjs                  # 可自托管的 TMDB Node.js 代理（端口 8787、24h 内存缓存、IP 限流）
├── package.json
├── .env.example               # TMDB_TOKEN / APP_TOKEN / PORT
├── pocketbase/
│   ├── pb_hooks/              # PocketBase 服务端 hook
│   │   ├── email_verification.pb.js   # 注册/改密邮箱验证码（10 分钟有效、30s 间隔、5 次上限）
│   │   └── ownership.pb.js            # 数据所有权隔离
│   └── pb_migrations/         # 数据表迁移（导入生产实例执行）
│       ├── 1786445100_pianke_cloud_schema.js   # 基础集合：users/movies/diary_entries/watch_records/screenshots
│       ├── 1786500000_add_user_avatar.js
│       ├── 1786600000_add_cloud_query_indexes.js
│       ├── 1786700000_add_email_verification_codes.js
│       └── 1786800000_add_password_reset_code_purpose.js
└── vercel/                    # TMDB Vercel Serverless 代理（Root Directory）
    ├── vercel.json
    ├── api/
    │   ├── search.mjs         # TMDB 搜索
    │   ├── details.mjs        # TMDB 详情
    │   └── poster.mjs         # 海报代理
    └── lib/
        └── tmdb.mjs           # TMDB 客户端封装
```

### 3.5 其他目录

```text
docs/
├── architecture.md            # 分层边界与资源库数据说明
├── self-hosted-updates.md     # 自建更新服务器发布说明
└── windows-11-design-adaptation.md  # Windows 11 设计适配

build/
├── installer.nsh              # NSIS 安装器脚本
├── generate-sidebar.cjs       # 安装器侧栏图生成
├── win-signed.yml             # Windows 代码签名构建配置
└── win-signing.env.example    # 签名环境变量示例

resources/
├── icon.png                   # 应用图标
├── installer-sidebar.bmp      # 安装器侧栏图
└── tmdb-proxy.json            # TMDB 代理地址配置（打包进客户端）

.github/workflows/
└── build-installers.yml       # 标签触发的构建与更新发布工作流
```

## 4. 分层边界与数据流

```text
React 页面与组件 (src/)
  → lib/api.ts
  → Electron preload bridge (window.electronAPI) / 云端直接访问 (cloudApi → PocketBase)
  → IPC handler (electron/modules/<feature>/handler.ts)
  → 主进程 service (electron/modules/<feature>/service.ts)
  → 云端 PocketBase / 本地离线缓存 (IndexedDB)
```

设计约束（见 docs/architecture.md）：

- `shared/` 仅保存主进程和渲染进程共用的类型、Schema、日期工具和 IPC 契约。
- `src/assets/brand/` 是应用 Logo 和资源库文件夹图标的唯一来源；构建时分别交给 Vite 和 electron-builder 使用。
- `electron/modules/<feature>/handler.ts` 只负责 IPC 边界；业务规则和文件读写只放在对应 `service.ts`。
- `electron/utils/paths.ts` 是资源库路径和影视目录命名的唯一入口。
- `src/components/` 只放可复用 UI；`src/pages/` 只组织路由页面和页面级状态。

## 5. 核心机制

### 5.1 双数据源路由（src/lib/api.ts）

`api` 是一个 **Proxy**：

- 登录后（`isCloudAuthenticated()`），`library / movie / diary / watchRecord / watchlist / stats` 六组调用自动路由到 `cloudApi`（直连 PocketBase）。
- 其余能力（窗口控制、截图裁剪、TMDB、更新）始终走 Electron 安全 IPC 通道。

### 5.2 IPC 通道单一来源（shared/types/index.ts）

- `IPC_CHANNELS` 常量只在 `shared/types/index.ts` 定义。
- `vite.config.ts` 的 `copyPreloadPlugin` 在构建时自动把该块同步进 `electron/preload/main.cjs`（`dist-electron/preload.cjs`），避免两端不一致。

### 5.3 云端数据与离线缓存（src/lib/cloudApi.ts）

- 快照缓存：60s TTL；请求单飞去重，避免首页/统计/日记重复下载整套数据。
- 文件访问 token：4 分钟 TTL，头像/海报/截图 URL 附带短期 token。
- IndexedDB：保存数据快照与已下载媒体（海报缩略图 `300x450`、截图缩略图 `500x281`），离线时优先展示本地缓存。
- 媒体预热：并发 3 下载海报/截图，写入 IndexedDB。

### 5.4 数据模型（PocketBase 集合）

| 集合 | 内容 |
|---|---|
| `users` | 账户、昵称、头像（私有集合，文件 URL 需临时 token） |
| `movies` | 影视资料、海报、状态（想看/在看/已看完）、进度（剧集 episode/totalEpisodes；综艺 segments 标签） |
| `diary_entries` | 系统自动写入的进度/状态变更日记 |
| `watch_records` | 用户手动撰写的观看记录（评分、感想） |
| `screenshots` | 照片墙图片、集数与时间点信息 |

所有业务集合按 `owner` 与当前登录账户隔离；`ownership.pb.js` hook 强制数据所有权。

### 5.5 截图流程

全局快捷键 → 主进程捕获屏幕（`getPrimaryScreenSnapshot`）→ 打开裁剪窗口（`crop:start`）→ 裁剪完成后图片以 data URL 回传渲染进程 → 上传到当前云端账号。

### 5.6 自动更新

启动时（或设置中手动）检查 → `electron-updater` 从自建 HTTPS 更新服务器读取 `latest.yml` / `latest-mac.yml` → 下载/安装。状态通过 IPC 推送（`update:stateChanged`）到 `UpdateDialog` 组件展示。

## 6. 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 启动 Electron + Vite 开发环境 |
| `npm run typecheck` | 执行 TypeScript 类型检查 |
| `npm run check` | 类型检查并构建前端/主进程代码 |
| `npm run build` | 构建应用代码，不生成安装包 |
| `npm run electron:build` | 构建当前系统的安装包 |
| `npm run electron:build:win` | 构建 Windows NSIS 安装包 |
| `npm run electron:build:win:signed` | 使用 Windows 代码签名配置构建安装包 |

## 7. 版本状态

- 当前版本：v2.0.2
- 架构演进：v1 为纯本地库架构（`electron/store`、`library` 模块、`.pianke` 文件）；v2 转型为云端账户 + 本地离线缓存架构，完全以云端为唯一数据源，本地库及其迁移能力已移除。
