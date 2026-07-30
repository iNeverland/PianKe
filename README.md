# 🎬 PianKe（片刻）

**你的私人影视日记本** — 记录每一次观影，留下属于你的光影轨迹。

---

## ✨ 功能

| 模块 | 说明 |
|------|------|
| **影视管理** | 添加 / 编辑 / 搜索影视，支持电影、剧集、纪录片、综艺、动画五种类型 |
| **追剧进度** | 多季多集进度追踪，一键下一集，自动计算完成百分比 |
| **观影日记** | 为每部影视记录多次观看，评分 + 短评，按时间线浏览 |
| **截图照片墙** | 一键截屏标注时间戳，自动关联剧集和时间，支持灯箱浏览 |
| **数据统计** | 观影趋势、类型分布、评分分析、国家分布，ECharts 可视化热力图 |
| **想看清单** | 标记想看的影视，一键切换追剧中 / 已看完 |
| **CSV 导入导出** | 数据完全属于你，离线可用，无云端依赖 |
| **深色模式** | 浅色暖白纸张 / 深色墨水质感双主题，支持跟随系统 |
| **全局快捷键** | `Ctrl+K` 搜索、`Ctrl+N` 新建、自定义截图快捷键 |

---

## 🎨 设计

基于 **UI/UX Pro Max** 设计体系，采用 **暖白纸张 + 橙色强调** 的极简风格：

- **毛玻璃侧边栏** — 半透明胶囊 Dock，backdrop-blur 24px，双主题自适应
- **表单卡片化** — 分区卡片 + accent 色竖线指示器 + sticky 毛玻璃操作栏
- **统一 Icon 体系** — 全项目 60+ SVG 图标统一 `strokeWidth: 1.5` + `round` 线帽
- **CSS 变量驱动** — 完整的语义色彩 token，双主题无缝切换
- **入场动画** — fadeInUp / scaleIn + 逐项延迟 stagger，尊重 `prefers-reduced-motion`

---

## 🛠 技术栈

| 层 | 技术 |
|------|------|
| 桌面壳 | Electron 34 (Frameless 窗口) |
| 前端 | React 19 + React Router 7 + Tailwind CSS 3 |
| 构建 | Vite 6 + vite-plugin-electron |
| 打包 | electron-builder 25 (NSIS) |
| 数据校验 | Zod 3 |
| 图表 | ECharts 6 (echarts-for-react) |
| 图片处理 | sharp (海报缩略图 + 文件夹图标) |
| 字体 | DM Sans + Noto Serif SC + Microsoft YaHei |

---

## 🚀 开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建 Windows 安装包
npm run electron:build:win
```

### 目录结构

```
PianKe/
├── electron/              # 主进程 (Node.js 后端)
│   ├── main.ts            # Frameless 窗口、CSP、单实例锁、Splash
│   ├── preload.cjs        # contextBridge 暴露 API 给渲染进程
│   └── modules/           # library / movie / diary / watchlist / stats
├── src/                   # 渲染进程 (React 前端)
│   ├── components/
│   │   ├── layout/        # AppShell、Sidebar、TitleBar、Header
│   │   ├── common/        # Modal、Toast、StarRating、EmptyState 等
│   │   └── movie/         # MovieCard、MovieGrid
│   ├── pages/
│   │   ├── Welcome/       # 打开 / 创建库
│   │   ├── Home/          # 首页：统计摘要 + 搜索 / 筛选 + 影视网格
│   │   ├── MovieDetail/   # 详情：海报 + 状态 + 评分 + 日记 + 截图墙
│   │   ├── MovieForm/     # 添加 / 编辑影视
│   │   ├── Diary/         # 日记时间线 + 热力图
│   │   ├── Watchlist/     # 想看清单
│   │   ├── Stats/         # ECharts 数据统计
│   │   ├── Watching/      # 追剧进度
│   │   └── Settings/      # 库管理 / 外观 / 数据导入导出
│   └── hooks/             # useMovies、useLibrary、useDiary
└── shared/                # 主进程 + 渲染进程共享类型与 Schema
```

---

## 💾 数据存储

用户选择文件夹 → `文件夹名.pianke/`（兼容 OneDrive）

```
库名.pianke/
├── library.json           # 库元信息
├── folder-icon.ico        # Windows 文件夹图标
└── movies/
    └── 影视名 (年份)/
        ├── metadata.json
        ├── diary.json
        ├── poster.jpg
        └── poster_thumb.jpg
```

纯 JSON 文件存储，无数据库依赖，数据完全由你掌控。

---

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + K` / `Ctrl + F` | 聚焦搜索框 |
| `Ctrl + N` | 新建影视 |
| `Esc` | 关闭弹窗 / 灯箱 |

---

## 📦 下载

[→ 最新 Release](https://github.com/Xiaoliang624/PianKe/releases)

支持 Windows 10+，提供 NSIS 安装程序（含自定义安装路径 + 桌面快捷方式）。

---

## 📄 许可

MIT License © 2025 Xiaoliang
