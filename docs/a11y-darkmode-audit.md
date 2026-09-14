# PianKe 深色模式 & 无障碍（A11y）走查报告

> 审查对象：PianKe v2.0.6（Electron 34 + React 19 + Tailwind 3，同一套产物经 Capacitor 打包 Android）
> 审查维度：① 深色模式视觉与色彩架构 ② WCAG 2.1/2.2 AA+ 对比度 ③ 触控热区与布局弹性 ④ 读屏语义与交互流
> 方法：静态走查 `src/index.css`（3644 行令牌与组件规则）、`src/**/*.tsx`（27 个页面/组件）、`index.html`、`electron/windows/*`、`src/assets/**/*.svg`；
> 对比度使用 WCAG 2.x 相对亮度公式逐值实算（非估算），阈值取 4.5:1（正文）、3:1（大字/非文本/组件边界）。
> 未覆盖：真机 VoiceOver / TalkBack / NVDA 语音验证、真实海报明度分布、运行时玻璃层（backdrop-filter）合成后的实测取样。

---

## 1. 综合评级

# 【存在严重合规风险】

分维度结论：

| 维度 | 结论 | 说明 |
|---|---|---|
| 深色模式色彩架构 | **基本合格，需微调** | 基底 `#0c0c0a` 非纯黑、6 级表面明度递增清晰、18 个功能图标全部 `currentColor`、手动/系统深色覆盖集完全对称（10/10 选择器一一对应）、`prefers-reduced-motion` 全局响应——架构是规范的。扣分点：品牌/功能色未做暗底降饱和，硬编码色散落 5 个文件，首屏与窗口底色不跟主题。 |
| WCAG 色彩对比度 | **存在严重合规风险** | 主按钮文字 2.85:1、海报状态徽标 1.78/2.85/2.16:1、强调色当文字用 2.57–2.85:1、星级量表填充 2.37:1、卡片/输入框描边 1.14–1.43:1（系统性）、浅色主题焦点环 2.57:1。均为 AA 级失败项（1.4.3 / 1.4.11）。 |
| 触控热区与布局弹性 | **存在严重合规风险** | 照片墙首字母索引 25×17px 直接违反 WCAG 2.2 AA 2.5.8（24×24）；32 个 `<button>` 中约 1/3 热区 < 44×44；日记页双栏 + 固定 252px 热力图列无任何断点，390px 视口下时间线仅剩约 74px（1.4.10 Reflow 失败）。 |
| 读屏与交互流 | **存在严重合规风险** | 全项目 **0 处 `aria-live`/`role="status"`**，Toast 与加载态完全不播报；14 处可点击 `div/span` 无键盘可达；4 处关键操作按钮仅 `group-hover` 显示（键盘聚焦不可见、触屏不可发现）；卡片右键菜单无键盘入口且无 menu 语义。 |

---

## 2. 问题清单与定位

### 2.1 深色模式视觉与色彩架构（DM）

| # | 元素/模块（定位） | 问题 | 违反规范 | 严重度 |
|---|---|---|---|---|
| DM-1 | `src/index.css:33` vs `:81`、`:41-43` vs `:89-91` | `--accent`(#EF7800) 与 `--status-watching`(#00E054)/`--status-want`(#40BCF4)/`--status-watched`(#EF7800) 在浅/深两套 token 中**完全相同**，未做暗底降饱和与明度提升；实测 #00E054 在深色卡片上 9.38:1、在浅色卡片上 1.78:1，属于"用同一个高饱和色覆盖两种底" | HIG Dark Mode / M3 tonal palette；1.4.3、1.4.11 | 高 |
| DM-2 | `src/index.css:85`、`:119` | 深色 `--red:#e74c3c` 作文字用：卡片 4.37:1、浮层 4.08:1，未达 4.5:1 | 1.4.3 | 中 |
| DM-3 | `src/index.css:92-94`、`:126-128` | 深色三档 `--shadow-*` 均为 6%–18% 黑，暗底上实际不可见；层级完全依赖 `--border`，而 `--border` 与底色仅 1.14–1.43:1（见 CT-5） | HIG「用表面明度而非阴影表达层级」只做到一半 | 中 |
| DM-4 | `src/index.css:3486-3487` | 深色弹窗 `--bg-elevated #242420` 与 48% 黑遮罩下的页面（合成 ≈#050504）对比仅 **1.31:1**，边框 1.49:1，弹窗"浮起感"不足 | 1.4.11（组件/表面边界） | 中 |
| DM-5 | `index.html:17-18`、`electron/windows/mainWindow.ts:26` | 首屏内联样式硬编码暗底 `#08080d`/`#e8e8f0`，Electron 窗口 `backgroundColor:'#ffffff'`：浅色主题用户看到暗闪、深色主题用户看到白闪（FOUC） | HIG「减少启动闪烁」 | 中 |
| DM-6 | `index.html` 全文 | 未声明 `color-scheme`（也无 `theme-color`）：深色模式下原生控件、`input[type=date]` 弹层、Chromium 自动填充（浅黄/浅蓝底）仍按浅色绘制 | 1.4.3 周边一致性 | 中 |
| DM-7 | `src/pages/Diary/index.tsx:18-28,418,457-471`、`src/pages/Stats/index.tsx:14-23,267,309`、`src/pages/PhotoWall/index.tsx:73-76`、`src/index.css:385,2031?` | 硬编码色绕过 token：日记热力图 6 组色 + `#c5c3bd`/`#8a8985`、Stats 7 色调色板 + 标签色、照片墙 12 色占位渐变、删除按钮 `#e53e3e`、窗口关闭 `#e81123` | 设计令牌单一来源 | 中 |
| DM-8 | `src/assets/brand/PianKe.svg`、`library-folder.svg` | 品牌资产硬编码 `white` + 渐变（`#00E054`/`#40BCF4`/`#DF7101`），不随主题变化（18 个功能图标反而全部 `currentColor`，形成反差） | HIG 资产适配 | 低 |

### 2.2 无障碍色彩对比度（CT，全部为实测值）

| # | 元素/模块（定位） | 问题 | 违反规范 | 严重度 |
|---|---|---|---|---|
| CT-1 | `src/index.css:865`、`3306`、`.btn-primary` / `.quick-action-btn.primary:1682` | **白字压品牌橙 `#EF7800` = 2.85:1**（14px/600 属正文级），全站主 CTA 不达标 | 1.4.3 AA | 高 |
| CT-2 | `src/index.css:1167-1169`、`1377-1393` | 状态徽标/状态按钮白字压 `#00E054`=**1.78:1**、压 `#40BCF4`=**2.16:1**、压 `#EF7800`=**2.85:1**；且三类状态**仅靠颜色**区分 | 1.4.3、1.4.1 | 高 |
| CT-3 | `src/index.css:3307,3374-3386,3380,2558,1680`；`Diary/index.tsx:493`、`Stats` 链接等 | 强调色当**文字**用（hover 态、链接、`.custom-datepicker-day.today:2414`）：浅色下 2.57:1（on `--bg-deep`）/ 2.85:1（on `#fff`） | 1.4.3 AA | 高 |
| CT-4 | `StarRating.tsx:52-68` | 评分数字与实心星 `--star-color:#d4a030` = **2.37:1**（浅色）；未选中星用 `--border` 描边 = **1.32:1**，5 星量表几乎不可辨（数量靠颜色单通道） | 1.4.3、1.4.11、1.4.1 | 高 |
| CT-5 | `src/index.css:26-27,74-75`；`.form-input:3493-3498`、`.custom-select-trigger:2161-2168`、`.custom-datepicker-trigger:2256`、`.status-btn:1363` | 组件描边系统性不足 3:1：浅色 `--border` 1.19:1(on bg-deep)/1.32:1(on #fff)、深色 1.43:1/1.14:1；`--border-light` 1.05–1.26:1。输入框边界是识别控件的必要视觉信息 | 1.4.11 AA | 高 |
| CT-6 | `src/index.css:3538`（全局 `:focus-visible`） | 焦点环用 `--accent`：浅色 2.57:1 / 2.85:1（<3:1）；深色 6.86:1（合格） | 1.4.11 / 2.4.11 | 中 |
| CT-7 | `src/index.css:2031` | 照片墙首字母索引文字 `color-mix(--text-muted 42%, --bg-primary)`：实测合成 `#bebebc`，对底 **1.68:1**（深色 2.11:1） | 1.4.3 | 中 |
| CT-8 | `src/index.css:1148,1163` | 海报叠加徽标 `rgba(0,0,0,.5)` + 白字：浅色海报最坏 **3.95:1**；默认徽标文字 `rgba(255,255,255,.85)` ≈ **3.34:1**，且随海报明度不可控 | 1.4.3 | 中 |
| CT-9 | `Diary/index.tsx:22-27,460-471` | 热力图分级配字：浅色 5+ 级 `#e53e3e`+深墨字 = 4.22:1、+白字 = 4.13:1（均不达标）；深色 3-4 级 `#9e8020`+`#f0ede5` = 3.23:1 | 1.4.3 | 中 |
| CT-10 | `Diary/index.tsx:411-424` | 「每日热力图」纯色块编码数量级，无数字/纹理，仅 `title` 悬浮提示（触屏不可用） | 1.4.1 | 中 |
| CT-11 | `Stats/index.tsx:267,309` | 图表扇区标签用主题色而非"按底色选色"：浅色主题白字压 `#d4a840` = 2.22:1、压 `#e8963a` = 2.37:1、压 `#EF7800` = 2.85:1 | 1.4.3 | 中 |
| CT-12 | `Settings/index.tsx:184-206`、`Home` filter-chip、`.status-btn.active-*` | 选中态仅靠背景/阴影表达，无图标、无文本标记、无 `aria-*` 状态 | 1.4.1、4.1.2 | 中 |
| CT-13 | `src/index.css:1161,1151`、`Diary` 热力图周标题 `text-[0.6rem]` | 徽标/图表标签字号 9.6–9.9px（`0.6-0.62rem`），即便对比达标也低于可读下限 | 可读性（非硬性 AA） | 低 |

### 2.3 触控热区与布局弹性（TG）

| # | 元素/模块（定位） | 问题 | 违反规范 | 严重度 |
|---|---|---|---|---|
| TG-1 | `src/index.css:2029`（`.photo-wall-index button`） | **25×17px** 交互热区，低于 WCAG 2.2 AA 最小 24×24，更远低于 44/48 | 2.5.8 AA、HIG 44pt、M3 48dp | 高 |
| TG-2 | `.tool-icon:2578`/`.sort-trigger:2469`（32×32）、`.password-toggle:1893`（30×30）、`.custom-datepicker-nav:2341`（28×28）、`.custom-datepicker-day:2391`（≈31×31，260px 弹层/7 列）、`.photo-wall-lightbox-close:2094`（40×40）、`StarRating` 默认 `size=20`（20×20，间距 4px） | 桌面端小图标控件密集不达 44×44；`StarRating` 20px 且相邻仅隔 4px，极易误触 | HIG 44×44、M3 48×48（WCAG 2.5.8 通过但体验不达标） | 高 |
| TG-3 | `src/index.css:3618-3619`、`3601-3602`（`.platform-mobile .nav-item` 40×40、头像 40×40） | 移动端底部导航热区反而缩小到 40×40 | M3 48dp | 中 |
| TG-4 | `.btn-sm:3305`（28 高）、`.filter-chip:3353`/`.status-btn:3358`/`.quick-action-btn:3362`（28 高）、`.theme-option:3534`（28 高）、`Diary` 删除按钮 `px-1.5 py-0.5`+`text-xs`（≈22 高） | 次按钮普遍 22–28px 高，触屏点按容错低 | M3 48dp、HIG 44pt | 中 |
| TG-5 | `src/pages/Diary/index.tsx:308-310,378` | 两栏 `flex gap-8` + 右列固定 `w-[252px] flex-shrink-0`，`index.css` 内**无任何针对该布局的断点**（全文无 `252px`/heat 相关媒体查询）。390px 视口下（`--platform-mobile` padding 16px）时间线仅剩 ≈74px，320px 下不可用 | 1.4.10 Reflow AA、M3 自适应布局 | 高 |
| TG-6 | `src/index.css:135`（`html{font-size:16px}`）、`.btn:3304`（固定 `height:32px`+`line-height:20px`）、`.theme-option` `min-height`、`.movie-title:1177`（`nowrap+ellipsis`）、多处 `white-space:nowrap` | `html` 用 px 覆盖用户默认字号；固定高 + 固定行高的按钮在"仅放大文字"（非整页缩放）场景会裁切/溢出；标题截断加剧 | 1.4.4 AA | 中 |
| TG-7 | `src/index.css:3319-3326`（`.main-content` 移动端 padding/`overflow-y:auto`）、安全区处理 | **正例**：移动端已用 `env(safe-area-inset-*)` 避让刘海/手势条，滚动容器唯一且明确 | — | — |

### 2.4 读屏语义与交互流（SR）

| # | 元素/模块（定位） | 问题 | 违反规范 | 严重度 |
|---|---|---|---|---|
| SR-1 | `Toast.tsx:64-84`、`LoadingSkeleton.tsx`、`CloudAuth/index.tsx:96`、`MovieForm` 错误提示 | 全项目 **0 处 `aria-live`/`role="status"`/`role="alert"`**：删除/保存成功、失败提示、表单校验错误、加载中状态均不播报 | 4.1.3 AA、3.3.1 | 高 |
| SR-2 | `Diary/index.tsx:359-365`、`MovieDetail/index.tsx:718,922`、`MovieForm/index.tsx:520-527` | 关键操作按钮默认 `opacity-0 group-hover:opacity-100`：键盘 Tab 聚焦时**仍不可见**（无 `focus-visible` 同步），触屏无 hover → 删除入口不可发现 | 2.4.7、2.4.11 AA、2.5.8 邻接 | 高 |
| SR-3 | `MovieCard.tsx:91-95,158-164`、`ContextMenu.tsx:74-98` | 卡片操作菜单只能右键打开；菜单无 `role="menu"/"menuitem"`、打开不移动焦点、无 ↑↓/Home/End、关闭不还原焦点 → 键盘用户**完全无法**执行"标记已看完/编辑/删除" | 2.1.1 AA、4.1.2、ARIA APG | 高 |
| SR-4 | `Diary:341`、`Watching:133,144`、`Watchlist:90,101`、`MovieDetail:607,708,725,771,817`、`MovieForm:317,582`、`PhotoWall:215`（共 14 处） | 可点击 `div/span/label` 无 `role`/`tabIndex`/键盘事件，键盘与读屏都不可操作（其中 `PhotoWall:215`/`MovieDetail:725` 为 `stopPropagation` 容器，可降级处理） | 2.1.1、4.1.2 | 高 |
| SR-5 | `CustomDatePicker.tsx:135,202-210` | 日期弹层 `role="dialog"` 但不移入焦点、不困焦点；日期格无 `aria-selected`/`aria-current="date"`；无方向键网格导航（需 Tab 穿过 ~30 个按钮）；选择结果无播报 | 4.1.2、2.4.3、ARIA APG Date Picker | 中 |
| SR-6 | `Settings/index.tsx:184-206`、`Home` filter-chip、`.status-btn` | 主题切换三按钮无 `aria-pressed`/`radiogroup`+`aria-checked`；筛选 chip 与状态按钮同样无 `aria-pressed` → 读屏无法得知当前选中项 | 4.1.2 AA | 中 |
| SR-7 | `Modal.tsx:29,87-111` | 仅锁 `document.body.style.overflow`，但真实滚动容器是 `.main-content` → 弹窗打开后背景仍可滚动（滚轮/触摸穿透）；背景内容未 `inert`/`aria-hidden`，部分读屏仍可漫游到下层 | 1.4.13?/最佳实践、2.4.3 | 中 |
| SR-8 | `Header.tsx:18`、`MovieCard.tsx:137` | 页面标题用 `<h2>`，应用内不存在 `<h1>`（仅登录页有），标题大纲缺根节点；MovieCard 的 `<h3>` 嵌在 `<button>` 内（`button` 内容模型不允许流内容），语义被吞 | 1.3.1、2.4.6（最佳实践） | 中 |
| SR-9 | `MovieForm/index.tsx:520-527,530-537` | `×` / `+` 符号按钮无可访问名称（读屏播报"乘号/加号"） | 4.1.2 | 中 |
| SR-10 | `MovieCard.tsx:102-111,137-144` | 卡片按钮的可访问名称 = 整卡文本（"片名 2024 · 电影 剧情/喜剧"），且内含 `alt={title}` 图片 → 片名被重复播报；卡片内部 `h3` 失去标题语义 | 1.1.1、2.4.6 | 低 |
| SR-11 | `Toast.tsx:16-32` | Toast 2.5s/4s 自动消失且无法暂停/手动关闭；带操作按钮的 4s 窗口对行动不便用户偏短 | 2.2.1 A | 低 |
| SR-12 | `Modal.tsx:55-74` | 焦点陷阱用 `hasAttribute('hidden')` 过滤，无法排除 `display:none`/`visibility:hidden` 的隐藏元素，Tab 可能落到不可见控件 | 2.4.3 | 低 |
| SR-13 | `CustomDatePicker.tsx:129`、`Modal.tsx:95-97`、`AppIcon.tsx:66,94`、`Sidebar.tsx:35`、`AppShell.tsx:15` | **正例**：日期触发器 `aria-haspopup/aria-expanded`、弹层 `role=dialog`、模态 `role=dialog`+`aria-modal`+焦点陷阱+Esc+回焦、装饰图标 `aria-hidden`、`<aside>`/`<main>` 地标、内容图片均有 `alt`、`<html lang="zh-CN">` | — | — |

---

## 3. 针对性修改建议（带具体参数）

### 3.1 令牌层：把「一个颜色」拆成「语义双轨」

当前问题的根因是**一个颜色同时承担"实心填充"和"前景文字"两种角色**。建议按 M3 的 `primary / on-primary / primary-container` 思路拆分为：

```
--x         ：品牌原色，只用于装饰、大面积图形、非文字描边
--x-text    ：当文字/小图标用（对 bg-deep / bg-elevated 均 ≥4.5:1）
--x-solid   ：实心按钮/徽标底色
--on-x      ：压在 --x-solid 上的前景色（≥4.5:1）
--border-strong：控件与弹窗边界（可见发丝线；3:1 合规版为 #8F8878 / #6E6E62）
--focus-ring：焦点环（对相邻底色 ≥3:1）
```

| 令牌 | 浅色现值 | 浅色建议值 | 实测（on `--bg-deep` / on `#fff`） | 深色现值 | 深色建议值 | 实测（on `#0c0c0a` / on `#1e1e1b`） |
|---|---|---|---|---|---|---|
| `--accent` | #EF7800 | #EF7800（保留） | 图形用 | #EF7800 | #EF7800（保留） | 图形用 |
| `--accent-text` | — | **#A85400** | 4.81 / 5.34 ✅ | — | **#FFB067** | 10.87 / 9.28 ✅ |
| `--on-accent` | #fff ❌2.85 | **#12100C** | 6.66（压在 #EF7800 上）✅ | #fff ❌2.85 | **#12100C** | 6.66 ✅ |
| `--accent-solid`（若要保白字） | #EF7800 ❌2.85 | **#B85C00** | 白字 4.60 ✅ | #EF7800 ❌2.85 | **#B85C00** | 白字 4.60 ✅ |
| `--border-control`（输入类 3:1） | — | **#8F8878**（下划线形态承载） | 3.18 / 3.52 ✅ | — | **#6E6E62** | 3.79 / 3.02 / 3.24 ✅ |
| `--border-strong`（弹窗/菜单/带标签按钮） | — | **#C4BDAD**（柔和发丝线） | 1.69 / 1.87（可见性下限；1.4.11 不强制面板边界） | — | **#4F4F46** | 2.37 / 2.02 / 1.88（同上） |
| `--focus-ring` | — | **#A85400** | 4.81 / 5.34 ✅ | — | **#FFA94D** | 10.29 / 8.18 ✅ |
| `--star-color` | #d4a030 ❌2.37 | **#8A6A12** | 4.56 / 5.06 ✅ | #d4a840 ✅ | #E8BE5A（更亮） | 11.14 / 9.50 ✅ |
| `--red`（文字） | #c0392b ✅5.44 | #B42318（更稳） | 5.92 / 6.57 ✅ | #e74c3c ❌4.37 | **#FF7A6B** | 7.69 / 6.56 ✅ |
| `--red-solid`（填充） | #c0392b | #C0392B | 白字 5.44 ✅ | #e74c3c | **#B3352B** | 白字 6.07 ✅ |
| `--green` | #2d8c4a ❌4.23 | **#177245** | 5.36 / 5.95 ✅ | #3cb368 ✅ | #4ED07C | 9.92 / 8.46 ✅ |
| `--blue` | #3b7cb8 ❌4.41 | **#1B5E9E** | 6.02 / 6.68 ✅ | #5ca0d8 ✅ | #7CC0F5 | 9.99 / 8.53 ✅ |
| `--status-watching`（填充） | #00E054 | 保留填充，前景改 `--on-accent` | 深墨字 **10.67** ✅ | 同左 | 同左 | 10.67 ✅ |
| `--status-want`（填充） | #40BCF4 | 保留填充，前景改 `--on-accent` | 深墨字 **8.79** ✅ | 同左 | 同左 | 8.79 ✅ |
| `--status-watched`（填充） | #EF7800 | 保留填充，前景改 `--on-accent` | 深墨字 **6.66** ✅ | 同左 | 同左 | 6.66 ✅ |

若产品坚持"白字压状态色"，则需把三个填充压暗（实测白字达标）：`watching → #0E7C3A`(5.30)、`want → #1268A8`(5.88)、`watched → #B85C00`(4.60)。

配套 CSS（示例）：

```css
:root {                       /* 浅色 */
  --accent:        #EF7800;
  --accent-text:   #A85400;
  --on-accent:     #12100C;
  --border-strong: #C4BDAD;   /* 3:1 合规版：#8F8878 */
  --focus-ring:    #A85400;
  --star-color:    #8A6A12;
  --red:           #B42318;
  --red-solid:     #C0392B;
  --green:         #177245;
  --blue:          #1B5E9E;
}
:root[data-theme="dark"] {    /* 深色：同结构，值提升明度 */
  --accent:        #EF7800;
  --accent-text:   #FFB067;
  --on-accent:     #12100C;
  --border-strong: #4F4F46;   /* 3:1 合规版：#6E6E62 */
  --focus-ring:    #FFA94D;
  --star-color:    #E8BE5A;
  --red:           #FF7A6B;
  --red-solid:     #B3352B;
  --green:         #4ED07C;
  --blue:          #7CC0F5;
}
/* 系统深色需同步一份（当前工程用 @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) } 双写，务必与 data-theme 版本一一对应） */
```

> 注意：`--accent` 被 30+ 处规则引用。落地策略建议 **先改前景语义**（`color:` 用 `--accent-text` / `--on-accent`），再评估是否替换填充，避免一次性大范围视觉回归。

### 3.2 逐项修复（CSS / TSX）

**① 主按钮与实心元素前景（CT-1 / CT-2 / CT-12）**

```css
/* 保留品牌橙作填充，文字改深墨（6.66:1） */
.btn-primary, .quick-action-btn.primary, .filter-chip.active,
.custom-datepicker-day.selected, .custom-datepicker-year.selected { color: var(--on-accent); }
.poster-status.watching, .poster-status.watched, .poster-status.want,
.status-btn.active-watching, .status-btn.active-watched, .status-btn.active-want { color: var(--on-accent); }
/* 次要按钮 hover 的文字用 --accent-text 而不是 --accent */
.tool-icon:hover, .sort-trigger:hover, .filter-chip:hover,
.sort-item:hover, .section-link, .quick-action-btn:hover { color: var(--accent-text); }
```

**② 非文本对比：控件边界与焦点环（CT-5 / CT-6）**

```css
/* 两档边界：3:1 只给"靠边界识别"的输入类，并以更轻的"下划线"形态承载；
   弹窗/菜单/带标签按钮的面板边界不属 1.4.11 必需，保持柔和发丝线。 */
.form-input, .review-textarea, .form-tag-input,
.custom-select-trigger, .custom-datepicker-trigger {
  border: 0; border-bottom: 1px solid var(--border-control); border-radius: 0; background: transparent;
}
.custom-select-menu, .custom-datepicker-popup, .sort-menu, .context-menu,
.modal-content, .toast-content,
.status-btn, .tag-selectable { border-color: var(--border-strong); }
:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
/* 浮层/玻璃面上的焦点环：加深色第二环，保证任意底色 ≥3:1 */
.modal-content :focus-visible,
.custom-select-menu :focus-visible { outline-color: var(--focus-ring); }
```

**③ 星级量表（CT-4）**

```tsx
// StarRating.tsx：未选中描边改用可辨识的弱化前景色，热区外扩到 44×44
<button
  className="star-btn"                 /* 新增：min-width/height:44px; display:grid; place-items:center */
  role="radio" aria-checked={value === star} aria-label={`${star / 2} 星`}
  style={{ width: 44, height: 44 }}    /* 图标仍 20px，热区 44px */
>
  <svg width={size} height={size} className={filled ? 'text-star' : 'text-muted'}>
```
```css
.movie-card .rating-stars svg[data-empty] { stroke: var(--text-muted); } /* 未选中：对比 ≥4.5:1 */
```
外层容器加 `role="radiogroup" aria-label="评分"`，配合方向键（←/→）切换。

**④ 触控热区（TG-1~TG-4）** —「视觉不变、热区外扩」通用写法：

```css
/* 需要 ≥44×44 的图标按钮：视觉保持 28–32px，用透明外扩补足热区 */
.tool-icon, .sort-trigger, .password-toggle, .custom-datepicker-nav, .modal-close-btn {
  position: relative;
}
.tool-icon::after, .sort-trigger::after, .password-toggle::after,
.custom-datepicker-nav::after, .modal-close-btn::after {
  content: ''; position: absolute; inset: -7px; border-radius: 8px;
}
/* 或直接 min 尺寸（更稳，建议用于移动端） */
@media (pointer: coarse) {
  .tool-icon, .sort-trigger, .modal-close-btn { min-width: 44px; min-height: 44px; }
  .filter-chip, .status-btn, .quick-action-btn, .theme-option, .btn-sm { min-height: 44px; }
  .photo-wall-index button { min-width: 44px; min-height: 44px; }  /* 原 25×17 */
  .platform-mobile .nav-item, .platform-mobile .sidebar-profile-entry { width: 48px; height: 48px; }
}
```
（`::after` 外扩方案要注意父容器 `overflow:hidden` 会被裁掉——`.custom-datepicker-popup`/`.movie-poster` 需检查。）

**⑤ 日记页 Reflow（TG-5）**

```tsx
// src/pages/Diary/index.tsx
<div className="diary-layout">                       {/* 原 flex gap-8 */}
  <div className="flex-1 min-w-0 diary-timeline stagger-children">…</div>
  <div className="diary-heatmap">                    {/* 原 w-[252px] flex-shrink-0 */}
```
```css
.diary-layout { display: flex; gap: 32px; }
.diary-heatmap { width: 252px; flex-shrink: 0; }
@media (max-width: 900px) {
  .diary-layout { flex-direction: column; }
  .diary-heatmap { width: 100%; order: -1; }          /* 热力图置顶或折叠 */
  .diary-heatmap .sticky { position: static; }
}
```
验收标准：320 CSS px 宽度下无横向滚动、无内容重叠（1.4.10）。

**⑥ 动态字体（TG-6）**

```css
html { font-size: 100%; }            /* 原 16px：覆盖了用户的默认字号，改为跟随 */
.btn { min-height: 32px; height: auto; line-height: 1.4; }   /* 去掉固定高与固定行高 */
.theme-option { min-height: 28px; height: auto; }
.movie-title { /* 保留省略号，但把 min-height 交给内容，避免放大后裁切 */ }
```
验证：浏览器最小字号设为 24px、或系统字体放大 200% 时，按钮文字不溢出、卡片不重叠。

**⑦ 读屏实时区域（SR-1）**

```tsx
// Toast.tsx：按严重级别区分 live region
<div className={`toast${exiting ? ' exiting' : ''}`} role={toast?.severity === 'error' ? 'alert' : 'status'}
     aria-live={toast?.severity === 'error' ? 'assertive' : 'polite'} aria-atomic="true">
```
```tsx
// LoadingSkeleton.tsx
<div role="status" aria-live="polite" aria-busy="true">
  <span className="sr-only">加载中…</span>
```
```css
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
```
```tsx
// CloudAuth/index.tsx:96 与各表单：错误提示关联到字段
<p id="auth-error" role="alert" className="...">{error}</p>
<input aria-invalid={Boolean(error)} aria-describedby="auth-error" … />
```

**⑧ 键盘可达：悬浮按钮 / 右键菜单 / 可点击容器（SR-2 / SR-3 / SR-4）**

```css
/* 悬浮才显示的操作按钮：键盘聚焦与触屏必须可见 */
.group:hover .group-hover-action,
.group:focus-within .group-hover-action { opacity: 1; }
@media (hover: none) { .group-hover-action { opacity: 1; } }
```
```tsx
/* 卡片：补一个可见的"更多"入口，菜单具备完整 menu 语义与键盘流 */
<button aria-haspopup="menu" aria-expanded={open} aria-label={`${movie.title} 更多操作`} onClick={openMenu}>
<ContextMenu role="menu" … />   {/* 打开时 focus 第一项；↑↓/Home/End 移动；Esc 关闭并回焦触发按钮 */}
```
```tsx
/* 可点击容器 → 语义化按钮（14 处，示例） */
<button type="button" className="row-item-info text-left" onClick={() => navigate(`/movie/${movie.id}`)}>
```
若因布局无法改标签，最少需：`role="button" tabIndex={0} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handler()}`。

**⑨ 模态行为（SR-7 / SR-12）**

```tsx
// Modal.tsx
// 1) 锁真正的滚动容器
const scroller = document.querySelector<HTMLElement>('.main-content');
if (scroller) { scroller.style.overflow = 'hidden'; scroller.dataset.modalLocked = '1'; }
// 2) 背景 inert（Chromium 102+ 支持），替代不完整的 aria-hidden
const shell = document.querySelector('.app-shell');
shell?.setAttribute('inert', '');
// 3) 焦点陷阱过滤可见元素
const focusable = Array.from(...).filter(el => el.offsetParent !== null && !el.hasAttribute('hidden'));
```

**⑩ 语义与状态补齐（SR-5 / SR-6 / SR-8 / SR-9）**

```tsx
// 主题切换
<div className="theme-switcher" role="radiogroup" aria-label="主题模式">
  <button role="radio" aria-checked={theme === 'system'} …>系统</button>
// 筛选/状态按钮
<button className="filter-chip" aria-pressed={filterType === opt.value} …>
// 日期格
<button aria-selected={cell.isSelected} aria-current={cell.isToday ? 'date' : undefined} …>
// 符号按钮
<button aria-label="删除该分段">×</button>   <button aria-label="新增分段">+</button>
// 页面标题层级：Header 增加 as 支持，页面标题输出 <h1>
```

**⑪ 深色资产与首屏（DM-5 / DM-6 / DM-7 / DM-8）**

```html
<!-- index.html：先定 color-scheme，再按主题上底色，消除 FOUC -->
<meta name="color-scheme" content="light dark" />
<meta name="theme-color" content="#f5f3ed" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0c0c0a" media="(prefers-color-scheme: dark)" />
<script>
  // 与 Settings 的 localStorage 键保持一致
  const t = localStorage.getItem('pianke-theme');
  const dark = t === 'dark' || (!t || t === 'system') && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
</script>
```
```ts
// electron/windows/mainWindow.ts
backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0c0a' : '#f5f3ed',
```
```css
/* 自动填充在深色下不再"贴白" */
input:-webkit-autofill { -webkit-text-fill-color: var(--text-primary); box-shadow: 0 0 0 100px var(--bg-elevated) inset; }
```
品牌 SVG：把 `fill="white"` 等改为 `currentColor`（或按 `data-theme` 切换两版资源）；新增令牌收纳硬编码色：`--heat-1..3`、`--chart-1..7`、`--placeholder-1..4`。

**⑫ 图表可访问性（CT-11 / CT-10）**

```ts
// Stats/index.tsx：ECharts 原生无障碍（自动生成描述）+ 色盲安全纹理
option = {
  aria: { enabled: true, decal: { show: true }, label: { description: '月度观影趋势，按月份显示观看部数' } },
  series: [{ label: { color: onColor(seriesColor) } }],   // 按底色选字色，而非按主题
};
const onColor = (hex: string) => luminance(hex) > 0.42 ? '#12100C' : '#FFFFFF';
```
实测：调色板 7 色配 `#12100C` 全部达标（4.65–8.57:1）；浅色主题若继续用白字，7 色中 6 色不达标（最低 2.22:1）。
日记热力图：浅色最高档填充改 `#C62828`（白字 5.62:1）或格内数字改 `#12100C`（5.03:1）；深色 3–4 档填充改 `#7A6410`（配 `#f0ede5` 4.91:1），并给色块加数字/纹理以脱离"仅颜色"编码。

### 3.3 回归验证建议

1. 按本报告的实算方法（WCAG 2.x 相对亮度公式）固化为脚本并纳入 CI（如 `npm run audit:contrast`），对 `--*` 令牌两两组合断言阈值，主题改动即报错。
2. 接入 `@axe-core/cli` 或 Playwright + axe，对 5 个主页面（登录/首页/详情/日记/统计）跑自动扫描，锁死 `color-contrast`、`aria-*`、`target-size` 规则。
3. 触控与读屏人工回归清单：iOS VoiceOver（模态焦点、Toast 播报）、TalkBack（日记页删除、底部导航 48dp）、键盘 only（Tab 全站走一遍，确认无"消失的焦点"）。
4. 200% 字号与 320px 宽度两档截图对比，纳入发版检查（1.4.4 / 1.4.10）。

---

## 附录 A：实测对比度原始数据（节选）

| 组合 | 浅色 | 深色 |
|---|---|---|
| text-primary / bg-deep | 15.69 ✅ | 16.74 ✅ |
| text-secondary / bg-deep | 9.79 ✅ | 9.54 ✅ |
| text-muted / bg-deep | 4.80 ✅ | 6.21 ✅ |
| text-muted / bg-secondary | 4.56 ✅（最紧） | 5.54 ✅ |
| text-muted / bg-elevated | 5.33 ✅ | 4.94 ✅（最紧） |
| accent / bg-deep | 2.57 ❌ | 6.86 ✅ |
| accent / bg-elevated | 2.85 ❌ | 5.46 ✅ |
| #fff / accent（主按钮） | 2.85 ❌ | 2.85 ❌ |
| red / bg-card | 5.44 ✅ | 4.37 ❌ |
| green / bg-card | 4.23 ❌ | 6.24 ✅ |
| star / bg-card | 2.37 ❌ | 7.54 ✅ |
| blue / bg-card | 4.41 ❌ | 5.95 ✅ |
| border / bg-deep | 1.19 ❌ | 1.43 ❌ |
| border / bg-elevated | 1.32 ❌ | 1.14 ❌ |
| border-light / bg-deep | 1.05 ❌ | 1.26 ❌ |
| accent 焦点环 / bg-deep | 2.57 ❌ | 6.86 ✅ |
| 海报徽标 #fff / #00E054 | 1.78 ❌ | 1.78 ❌ |
| 海报徽标 #fff / #40BCF4 | 2.16 ❌ | 2.16 ❌ |
| 海报叠加 #fff / 50% 黑（浅海报最坏） | 3.95 ❌ | 3.95 ❌ |
| 深色弹窗 #242420 / 遮罩后 #050504 | — | 1.31 ❌ |

## 附录 B：已达标项（建议保持）

- 深色基底 `#0c0c0a`（非纯黑）+ 6 级表面明度递增：`#0c0c0a → #121210 → #1a1a17 → #1e1e1b → #242420 → #262622`，符合"明度递增表达 Z 轴"。
- 18 个功能图标 SVG 全部 `currentColor`；`AppIcon` 在无 `title` 时自动 `aria-hidden`。
- 手动深色（`data-theme="dark"`）与系统深色（`prefers-color-scheme`）覆盖集**完全对称**（各 10 个选择器一一对应），无主题遗漏。
- `prefers-reduced-motion: reduce` 全局降级（含新加入的回到顶部按钮的 JS 平滑滚动判断）。
- Modal：Portal + `role="dialog"` + `aria-modal` + Tab 陷阱 + Esc + 关闭后回焦（`Modal.tsx:23-83`）。
- 地标与结构：`<aside>`（Sidebar）、`<main>`（AppShell）、`<header>`（Header）、`<html lang="zh-CN">`；内容图片均有 `alt`，头像/装饰图 `alt=""` 正确。
- 移动端安全区与滚动容器处理：`env(safe-area-inset-*)` + `.main-content` 单一滚动容器（`index.css:3541-3620`）。
- 表单输入采用 `min-height` 而非固定 `height`（`.form-input:3498`），放大字号时不会裁切。

---

*报告生成：基于仓库 v2.0.6 当前工作区状态（含未提交的 `BackToTop`/标题栏分割线改动，CSS 行号以当时文件为准）。*

---

## 附录 C：修复进展（按本报告结论分批实施，随 v2.0.7 发布）

验证方式：`npm run audit:contrast`（72 项令牌对比度断言，三套主题全通过）、`npm run typecheck`、`npm run build`，以及脚本化复测（下方指标）。

### 已修复

| 批次 | 内容 | 关键落点 |
|---|---|---|
| ① 令牌与对比度 | 新增 `--accent-text` / `--on-accent` / `--focus-ring` / `--border-strong` / `--red-solid` / `--heat-l1..l4(+on)`，三套主题同步；`--red`/`--green`/`--blue`/`--star-color` 浅深分别校正 | `src/index.css` 主题块 |
| ① | 实心强调块/状态徽标前景由 `#fff`（1.78–2.85:1）改为 `--on-accent`（6.66–10.67:1）；强调色当文字统一 `--accent-text`（56 处）；焦点环 `--focus-ring`；危险按钮改 `--red-solid`；焦点态描边 ≥3:1 | 同上 + `.btn-primary`、`.poster-status.*`、`.status-btn.active-*`、`.filter-chip.active`、`.sort-item.active`、`.custom-datepicker-day/year.selected`、`.nav-item.active` |
| ① | 控件边界按用途分两档：`--border-control`（输入类的 3:1 边界，并以**下划线形态**承载，避免"满屏黑框"）+ `--border-strong`（弹窗/菜单/toast/卡片/带标签按钮的柔和发丝线，浅 1.69–1.87:1、深 1.88–2.37:1）；`--border` 仅保留装饰用途。开关轨道、主题切换选中态一并加强 | `index.css` 末尾「A11Y：控件边界与状态对比度」 |
| ① | 日记热力图 6 组硬编码色改由 `--heat-*` 令牌驱动（月度 4 档 + 每日 3 档，删掉 `isDark` 分支与 MutationObserver）；照片墙索引字母由 1.68:1 改为 `--text-muted`（4.80:1）；海报叠加徽标提到 72% 黑（≥4.5:1）；`#e53e3e` → `--red` | `Diary/index.tsx`、`index.css` |
| ① | 自动填充样式、`color-scheme`、首屏主题引导脚本（按 `film-log-theme` 预置 `data-theme`，消除明暗闪烁）；Electron 窗口底色改为跟随主题并在 `theme:update` 时同步；`themeSource` 默认 `system`；启动闪屏增加浅色变体 | `index.html`、`splash.html`、`electron/windows/mainWindow.ts`、`electron/main.ts`、`electron/modules/window/handler.ts` |
| ② 触控与布局 | 日记页两栏加断点（≤900px 单栏，`sticky` 取消）；`html` 字号改 `100%`；`.btn`/`.btn-sm`/`.theme-option` 去掉固定高；`@media (pointer: coarse)` 提升关键控件到 44–48px（含日期格 40px、照片墙索引、移动端导航 48px）；0.55–0.64rem 的微型字号提到 0.62–0.68rem | `index.css`、`Diary/index.tsx` |
| ③ 键盘与读屏 | Toast 增加 `role="status"/"alert"` + `aria-live`（错误提示走新的 `showErrorToast`，39 处调用点已改），并支持手动关闭；`LoadingSkeleton` 加 `role="status"` + `.sr-only`；表单错误 `role="alert"` + `aria-invalid`/`aria-describedby` | `Toast.tsx`、`LoadingSkeleton.tsx`、`CloudAuth/index.tsx`、`PasswordInput.tsx` |
| ③ | 悬浮才显示的删除按钮改 `.hover-reveal`（键盘聚焦可见 + `hover:none` 常显）；可点击 `div/span` → 真实 `button`（行项目、日记时间线、截图时间戳、演员展开、标签删除、海报区），14 → 4（剩余 4 处为灯箱遮罩/`stopPropagation` 容器与文件输入的 `label`，均属正常模式） | `Watching/Watchlist/Diary/MovieDetail/MovieForm/index.tsx` |
| ③ | 右键菜单补齐 `role="menu"/menuitem`、↑↓/Home/End、打开聚焦首项、关闭回焦；卡片支持 Shift+F10/菜单键与触摸长按打开；Modal 改为锁定 `.main-content` 并对 `.app-shell` 加 `inert`，焦点陷阱过滤不可见元素；照片墙灯箱补焦点移入/循环/回焦与背景滚动锁 | `ContextMenu.tsx`、`MovieCard.tsx`、`Modal.tsx`、`PhotoWall/index.tsx` |
| ③ | 状态语义：主题切换 `radiogroup`/`aria-checked`、筛选与状态按钮 `aria-pressed`、日期格 `aria-selected`/`aria-current`、星级 `radiogroup` + 44px 命中区 + 只读态合并播报；页面标题由 `h2` 改 `h1` | `Settings/Home/MovieDetail/MovieForm`、`CustomDatePicker.tsx`、`StarRating.tsx`、`Header.tsx` |
| ④ 图表 | ECharts 全部开启 `aria.enabled`（生成图表描述，读屏可读）；`decal` 纹理按设计反馈**显式关闭**（`show: false`），色盲场景改由轴标签/图例文案与数值标签承担；扇区标签改为按底色选前景（`onColor()`），浅色主题白字压 `#d4a840`（2.22:1）等 6 类失败已消除 | `Stats/index.tsx` |

### 复测指标

| 指标 | 修复前 | 修复后 |
|---|---|---|
| `aria-live` / `role="status"｜"alert"` | 0 / 0 | 4 / 4 |
| 无键盘语义的可点击容器 | 14 | 4（均为合理模式） |
| 悬浮才可见的操作按钮 | 4 | 0 |
| `aria-pressed` / `aria-checked｜selected` / `aria-expanded` | 0 / 0 / 0 | 6 / 7 / 3 |
| 令牌对比度断言 | 大量失败 | 72/72 通过（浅色 + 手动深色 + 系统深色） |

### 尚未处理（建议下一轮）

1. **日期选择器方向键网格导航**：已具备 `aria-selected`/`aria-current` 与焦点移入/归还，但格子间仍需 Tab 逐个移动；建议按 ARIA APG Date Picker 补 ←→↑↓/PageUp/PageDown。
2. **图表调色板与照片墙占位渐变的硬编码色**：属数据可视化配色与装饰性渐变，未纳入令牌；如需主题联动可抽 `--chart-1..7`。
3. **深色弹窗层级**：弹窗与遮罩后页面的填充差仅 1.31:1，现靠 `--border-strong` 的边界做区分（面板边界不受 1.4.11 强制）；若想更接近 M3 elevation 语义，可单独提高弹窗表面明度。
4. **品牌 SVG**：`PianKe.svg` / `library-folder.svg` 的白色与渐变是图标内部构成（白字形压在橙色底上），并非透明底反色问题；按 WCAG 1.4.3「logo 不受对比度约束」无需整改，仅属维护性建议。
5. **真机读屏回归**：本次为代码与构建层验证，仍建议在 VoiceOver/TalkBack 上走一遍模态焦点、Toast 播报与日记页删除路径。
