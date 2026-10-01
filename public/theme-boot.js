/*
 * 首屏主题引导。
 *
 * 必须在任何打包产物之前同步执行：避免浅色主题下闪一下暗色、深色主题下闪一下白色，
 * 并把 color-scheme 固定到实际主题，使原生控件、滚动条与自动填充跟随应用主题。
 * 与 src/App.tsx、src/pages/Settings 使用同一个 localStorage 键（film-log-theme）。
 *
 * 为什么是独立文件而不是 <script> 内联：Electron 主进程注入的生产 CSP 是
 * `script-src 'self' file:`，不含 'unsafe-inline'，内联脚本会被直接拒绝执行
 * （已用 Electron 实测确认：inline=false、external=true）。放在 public/ 下以
 * 普通脚本引入即可，既不依赖打包器，也保持同步阻塞、先于首帧执行。
 */
(function () {
  var stored = null;
  try {
    stored = localStorage.getItem('film-log-theme');
  } catch (e) {
    /* 隐私模式等场景忽略 */
  }
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var dark = stored === 'dark' || (stored !== 'light' && prefersDark);
  if (stored === 'dark' || stored === 'light') {
    document.documentElement.setAttribute('data-theme', stored);
  }
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
})();
