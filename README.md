# 🎬 PianKe（片刻）

PianKe 是一款用于收藏影视、记录观看过程和沉淀观后感的桌面应用。它以 Electron 为桌面容器，提供个人账户隔离的云端同步、离线缓存、追剧进度、观影日记、截图照片墙和数据统计等能力。

> 当前版本以云端账户为数据源：登录后，你的影视资料、记录与图片会同步到个人空间；最近一次同步的数据和媒体会缓存到本机，弱网或暂时离线时仍可浏览。

## 功能

- **影视库**：管理电影、剧集、综艺、纪录片和动画，记录海报、导演、演员、首播日期、国家地区、类型、标签、简介与评分。
- **搜索与筛选**：支持关键词搜索、媒体类型/观看状态/评分筛选，以及最近观看、添加时间、评分、年份和标题等排序。
- **观看状态与进度**：在“想看、在看、已看完”之间切换；剧集按集记录，综艺可用自定义分段标签记录进度。
- **观影日记与追剧记录**：进度、状态变更自动留痕；手动补充日期、评分和观后感，按时间线回顾观看历程。
- **照片墙**：通过全局截图快捷键截取画面，裁剪后关联影视、集数和时间点，集中浏览收藏的画面。
- **数据统计**：查看观影数量、时长、平均评分、偏好类型、月度趋势、评分分布与国家/地区分布。
- **个人资料与云端同步**：支持注册、登录、昵称和头像；每个账户仅能访问自己的数据与媒体文件。
- **离线体验**：使用 IndexedDB 缓存数据快照、海报、截图和头像，网络恢复后继续从云端读取最新内容。
- **TMDB 信息补全**：影片表单可通过自建代理搜索 TMDB，并自动补齐基础信息与海报。
- **个性化与效率**：深色、浅色、跟随系统主题；支持 `Ctrl/Cmd + K` 搜索、`Ctrl/Cmd + N` 新建影视和可配置的全局截图快捷键。
- **Excel 导出与自动更新**：可导出影视、日记与追剧记录；正式版启动时自动检查自建更新服务器，也可在设置中手动检查。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 桌面应用 | Electron 34、TypeScript、`electron-updater` |
| 界面 | React 19、React Router 7、Vite 6、Tailwind CSS 3 |
| 图表与数据 | ECharts、Zod、SheetJS（Excel 导出） |
| 图片处理 | Sharp（缩略图与图片处理） |
| 云端数据 | PocketBase（认证、数据、私有文件） |
| 影视元数据 | TMDB + 自建 Node.js/Vercel 代理 |
| 打包与发布 | electron-builder、GitHub Actions、SSH/rsync 自建更新服务器 |

## 项目结构

```text
PianKe/
├── electron/                  # Electron 主进程、IPC 和系统能力
│   ├── modules/               # 影视、日记、统计、截图、TMDB、更新等业务模块
│   ├── preload/               # 安全暴露给渲染进程的 API
│   └── windows/               # 主窗口、裁剪窗口、影片选择器
├── src/                       # React 渲染进程
│   ├── components/            # 布局、通用组件、影视组件
│   ├── pages/                 # 首页、日记、照片墙、追剧、想看、统计、设置等页面
│   └── lib/                   # PocketBase、云端数据、离线缓存和 Electron API
├── shared/                    # 主/渲染进程共享类型、校验与工具
├── server/
│   ├── pocketbase/            # PocketBase 数据表迁移
│   ├── vercel/                # TMDB Vercel Serverless 代理
│   └── index.mjs              # 可自托管的 TMDB Node.js 代理
├── resources/                 # 图标与打包资源
├── build/                     # 安装器与签名配置
└── .github/workflows/         # 标签触发的构建与更新发布工作流
```

## 本地开发

### 环境要求

- Node.js 22（推荐）
- npm 10+
- macOS 或 Windows；Windows 安装包请在 Windows 环境构建
- 可访问的 PocketBase 服务与 TMDB 代理（完整功能所需）

### 安装与启动

```bash
git clone https://github.com/iNeverland/PianKe.git
cd PianKe
npm ci
npm run dev
```

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Electron + Vite 开发环境 |
| `npm run typecheck` | 执行 TypeScript 类型检查 |
| `npm run check` | 类型检查并构建前端/主进程代码 |
| `npm run build` | 构建应用代码，不生成安装包 |
| `npm run electron:build` | 构建当前系统的安装包 |
| `npm run electron:build:win` | 构建 Windows NSIS 安装包 |
| `npm run electron:build:win:signed` | 使用 Windows 代码签名配置构建安装包 |

## 云端服务配置

### PocketBase

客户端连接地址定义在 [src/lib/pocketbase.ts](src/lib/pocketbase.ts)。PocketBase 负责用户认证、影视、日记、追剧记录、截图与私有媒体文件。

部署新的 PocketBase 实例后，运行或导入 [server/pocketbase/pb_migrations](server/pocketbase/pb_migrations) 下的迁移。迁移会创建并约束以下数据：

- `users`：账户、昵称与头像；
- `movies`：影视资料、海报、状态和进度；
- `diary_entries`：系统自动写入的状态/进度日记；
- `watch_records`：用户手动撰写的观看记录；
- `screenshots`：照片墙图片和集数、时间点信息。

所有业务集合按 `owner` 与当前登录账户隔离，海报和截图使用受保护的文件访问策略。生产环境请使用 HTTPS，并为 PocketBase 做数据库和文件目录备份。

### TMDB 代理（可选）

TMDB Token 必须只保存在服务端，不能放入 Electron 客户端或仓库。

**Vercel 部署**

1. 在 TMDB 后台创建 Read Access Token（也兼容传统 v3 API Key）。
2. 在 Vercel 导入本仓库，设置 **Root Directory** 为 `server/vercel`。
3. 在 Vercel 项目的环境变量中设置 `TMDB_TOKEN`；可选设置 `APP_TOKEN`。
4. 将代理地址填入 [resources/tmdb-proxy.json](resources/tmdb-proxy.json) 的 `url`，然后重新打包客户端。

**Node.js 自托管**

```bash
cd server
cp .env.example .env
# 编辑 .env，填入 TMDB_TOKEN；可选填入 APP_TOKEN
npm start
```

若设置 `APP_TOKEN`，客户端配置文件中的 `appToken` 必须使用同一个值。它仅用于降低接口滥用，不应视作桌面客户端中的安全边界；生产环境仍应配合 HTTPS、限流与 WAF/网关策略。

## 打包、签名与自动更新

Windows 正式发布建议进行代码签名。复制 [build/win-signing.env.example](build/win-signing.env.example) 中的环境变量示例，配置 `WIN_CSC_LINK` 和 `WIN_CSC_KEY_PASSWORD` 后运行：

```bash
npm run electron:build:win:signed
```

应用更新使用 `electron-updater` 的通用 HTTPS 更新源。推送版本标签后，GitHub Actions 会构建 macOS/Windows 产物，再经 SSH 上传到更新服务器；客户端从 `latest.yml` 或 `latest-mac.yml` 检查版本。

完整的服务器、GitHub Secrets 与发布流程见：[自建更新服务器发布说明](docs/self-hosted-updates.md)。

## 数据与隐私

- 云端内容与文件按账户隔离；认证会话保存在应用本地。
- 数据快照和已下载媒体会写入本机 IndexedDB，用于离线浏览和首屏加速。
- Excel 导出不包含海报、头像、截图等二进制图片。
- 请自行备份 PocketBase 的数据库和文件目录；云端同步不是替代备份的唯一措施。

## 许可证

[MIT](LICENSE)
