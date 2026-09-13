# 🎬 PianKe（片刻）

影视收藏与观影日记应用：Electron 桌面端 + Capacitor Android，以云端账户为唯一数据源，本机 IndexedDB 离线缓存。

- **管理**：影视库、状态与进度、搜索筛选排序。
- **记录**：变更自动留痕、评分感想、照片墙、ECharts 统计。
- **账户**：PocketBase 认证与 owner 隔离；TMDB 补全、主题、导出、自动更新。

技术栈：Electron 34、React 19、Vite 6、Tailwind、PocketBase、Capacitor 8；electron-builder + GitHub Actions 发布。

## 项目结构

```text
PianKe/
├── electron/   # 主进程：modules 业务、preload、windows
├── src/        # React 渲染进程：components、pages、platform、lib
├── shared/     # 共享类型、IPC 契约与 Zod 校验
├── server/     # PocketBase 迁移/hook、TMDB 代理与部署脚本
├── android/    # Capacitor Android 工程
├── docs/       # 架构与发布文档
└── .github/workflows/   # 构建与更新发布
```

## 本地开发

需 Node.js 22+，执行 `npm ci && npm run dev`；另有 `npm run check`、`npm run electron:build:win`、`npm run android:sync`。

分层与部署见 [structure.md](structure.md)、[docs/architecture.md](docs/architecture.md)、[docs/self-hosted-updates.md](docs/self-hosted-updates.md)。

## 许可证

[MIT](LICENSE)
