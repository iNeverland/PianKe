---
name: pianke-project
description: 维护和扩展 PianKe（片刻）个人影视日记桌面应用。用于在此 Electron + React + TypeScript 仓库中实现、审查、调试或规划功能，尤其涉及磁盘资源库格式、IPC 模块、影视/日记/追剧进度业务规则、统计、截图、更新或无边框桌面 UI 时。
---

# PianKe 项目

将下列路径视为仓库根目录的相对路径。此技能只记录稳定的架构和不变量；当前实现细节始终以列出的源文件为准。

## 架构

PianKe 使用 Electron 34、React 19、TypeScript、Vite、Tailwind、Zod、ECharts 与 sharp。

```text
Electron 主进程
  main.ts → 窗口/生命周期 → ipc.ts → modules/*/{handler,service}.ts
                                      ↕ contextBridge
React 渲染进程 (src/) → lib/api.ts → preload/main.cjs → shared IPC 契约
                                      ↕
用户选择的 .pianke 磁盘资源库
```

- 将业务逻辑和文件 I/O 放在 `electron/modules/*/service.ts`；handler 只负责 IPC 边界校验和委派。
- 将 IPC 通道常量、共享领域类型和 Zod schema 放在 `shared/`。新增能力时同步更新 `electron/preload/main.cjs`、`src/types/electron.d.ts` 与 `src/lib/api.ts`。
- 将 `electron/store/dataStore.ts` 视为已加载资源库的内存缓存，而不是持久化真相来源；其中海报缓存为 LRU。
- 通过 `electron/utils/writeQueue.ts` 串行化同一文件的写入；完整备份前先 drain。
- 对可预期的领域错误使用 `AppError` 与 `ErrorCode`。

## 资源库持久化契约

每个用户资源库都是以 `.pianke` 结尾的目录：

```text
<资源库>.pianke/
  library.json
  movies/
    <清理后的标题> (年份)/
      metadata.json
      diary.json
      watch-records.json
      poster.* / poster_thumb.*
      screenshots/                 # 可选
      diary_images/                # 可选
```

- 只通过 `electron/utils/paths.ts` 解析路径；可读的目录名不是影视 ID。
- 用 `shared/schemas/index.ts` 校验已加载数据。`library/service.ts` 拥有版本迁移：保留已有迁移，并为不兼容格式新增顺序迁移。
- `openLibrary` 必须在加载全部影视后再标记 `dataStore.loaded`；缩略图和文件夹图标等后台任务不得阻塞首屏。
- 完整备份必须复制整个目录，包含 `library.json`、海报、日记与截图，而不只是导出元数据。

## 领域不变量

### 影视与日记

- `MovieMetadata.rating` 是公共评分（0–10）；个人评分从 `rating > 0` 的手动追剧记录计算。
- `DiaryEntry.rating === -1` 表示自动系统事件；`kind` 区分 `progress` 与 `status`。`WatchRecord` 保存用户手动写下的评分和感想。
- 自动进度和状态事件只能追加到 `diary.json`，绝不能创建或覆盖 `watch-records.json` 中的手动记录。
- 带进度的已看完影视必须满足 `episode === totalEpisodes`。进度当前为单剧集形态 `{ episode, totalEpisodes }`；schema 和资源库迁移仍兼容旧的多季数据。
- 影视目录由标题和年份推导；标题或上映日期变更时，必须使用同一辅助逻辑重命名或定位目录。

### 状态联动

- 切换到 `在看` 或 `已看完` 时创建状态事件。
- 更新进度时创建进度事件。
- 将想看项标记为已看完时，原子地更新状态、完成已有进度，并追加状态日记；用户填写的评分或感想单独写入追剧记录。
- 日记时间线展示已看完影视和带进度影视。统计面板的月度趋势对 `在看`/`已看完` 影视按月去重，排除 `想看`。

## 产品界面

- `src/App.tsx` 负责恢复已保存的资源库路径、安装全局快捷键并定义 HashRouter 路由；无有效资源库时保持 Welcome 状态和页面懒加载。
- `electron/main.ts` 负责单实例、`.pianke` 打开事件、Splash 生命周期、CSP、全局截图注册与更新器启动。
- 应用使用无边框窗口。窗口控制应保持在 window IPC 模块与渲染层标题栏中，不要轻易恢复原生窗口边框。
- 在 `src/index.css` 通过 CSS 变量实现主题；在本地持久化选择，并经 IPC 同步 Electron 标题栏主题。

核心模块职责：

| 模块 | 稳定职责 |
| --- | --- |
| `library` | 打开/创建/重开、加载/迁移、摘要、备份、资源库文件夹图标 |
| `movie` | CRUD、海报缩略图、搜索筛选、进度、标签、CSV、截图 |
| `diary` | 单部影视日记与按时间排序的时间线 |
| `watchlist` | 想看清单与状态迁移 |
| `stats` | 基于缓存数据的面板聚合与月度总结 |
| `screenshot` | 全局快捷键、截图/裁剪、影视选择与截图持久化 |
| `updater` | 更新状态、手动检查、下载和安装流程 |

## 修改流程

1. 先找到所属 service，并在修改前检查其 handler、共享类型/schema 和渲染层 API 调用。
2. 新增持久化字段时，同时更新类型、Zod schema 默认值或迁移、读写路径以及受影响的摘要/统计，并保证旧资源库可读。
3. 新增 IPC 能力时，依次更新通道常量、handler、preload bridge、渲染层声明和 API proxy，再接入页面或 hook。
4. 修改状态、进度或日记时，检查自动事件规则及所有消费者：Home 最近观看、Watching、Watchlist、Diary 时间线和 Stats。
5. TypeScript 变更后运行 `npm run build`。不要手动删除 `release/`；打包脚本会有意管理它。

## 约束

- 优先进行模块内的小范围修改，避免跨层重复业务逻辑。
- 不要只修改 `dataStore`；必须通过写队列持久化对应文件。
- 不要用 `rating: 0` 表示系统事件；它是未评分的手动值。系统事件应使用 `-1` 和正确的 `kind`。
- 未进行兼容性分析时，不要修改磁盘数据形态或 IPC 通道字符串。
