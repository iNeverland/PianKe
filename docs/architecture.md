# 架构说明

## 分层边界

```text
React 页面与组件 (src/)
  → lib/api.ts
  → Electron preload bridge
  → IPC handler
  → 主进程 service
  → dataStore / 本地资源库
```

- `shared/` 仅保存主进程和渲染进程共用的类型、Schema、日期工具和 IPC 契约。
- `src/assets/brand/` 是应用 Logo 和资源库文件夹图标的唯一来源；构建时分别交给 Vite 和 electron-builder 使用。
- `electron/modules/<feature>/handler.ts` 只负责 IPC 边界；业务规则和文件读写只放在对应 `service.ts`。
- `electron/utils/paths.ts` 是资源库路径和影视目录命名的唯一入口，避免跨模块计算出不一致的目录名。
- `src/components/` 只放可复用 UI；`src/pages/` 只组织路由页面和页面级状态。

## 资源库数据

每部影视的自动事件和手动感想分开持久化：

```text
movies/<标题> (年份)/
  metadata.json        # 影视元数据
  diary.json           # 自动进度、状态事件
  watch-records.json   # 用户手动评分与感想
```

所有写入通过 `writeQueue` 串行化。更新状态或进度时，必须同时检查受影响的首页、追剧进度、日记时间线和统计数据。

## 验证命令

```sh
npm run typecheck
npm run build
```
