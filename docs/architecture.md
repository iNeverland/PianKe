# 架构说明

## 分层边界

```text
React 页面与组件 (src/)
  → lib/api.ts
      业务数据：cloudApi → PocketBase（直连，不经 IPC）
      原生能力：Electron preload bridge → IPC handler → 主进程 service（tmdb / updater / window）
```

- `shared/` 仅保存主进程和渲染进程共用的类型、日期工具和 IPC 契约。
- `src/assets/brand/` 是应用 Logo 和资源库文件夹图标的唯一来源；构建时分别交给 Vite 和 electron-builder 使用。
- `electron/modules/<feature>/handler.ts` 只负责 IPC 边界；业务规则只放在对应 `service.ts`。业务数据不设 IPC 通道。
- `src/components/` 只放可复用 UI；`src/pages/` 只组织路由页面和页面级状态。

## 数据存储

云端 PocketBase 是唯一权威数据源，按集合组织：

| 集合 | 内容 |
|---|---|
| `movies` | 影视资料、海报、状态与进度 |
| `diary_entries` | 系统自动写入的进度/状态变更日记 |
| `watch_records` | 用户手动撰写的观看记录（评分、感想） |
| `screenshots` | 截图与截图元信息 |

本机 IndexedDB 只保存最近一次同步的快照与已下载媒体（海报/截图缩略图），供弱网、离线时浏览；不再有本地资源库文件。所有写入经 `cloudApi`（`cloudWrite`）完成，写后可影响首页、追剧进度、日记时间线与统计，需按需调用 `invalidateSnapshot()` / `scheduleCloudSync()` 保持缓存一致。

## 验证命令

```sh
npm run typecheck
npm run build
```
