import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/common/ErrorBoundary';
import './index.css';

// Playfair Display + Noto Serif SC 通过 CSS @import 在 index.css 中同步加载
// 以下异步加载 @fontsource DM Sans 作为 fallback
function loadFallbackFonts() {
  const fonts = [
    '@fontsource/dm-sans/400.css',
    '@fontsource/dm-sans/600.css',
  ];
  fonts.forEach((font) => {
    import(/* @vite-ignore */ font).catch(() => {
      // 字体加载失败不影响核心功能
    });
  });
}

// 使用 requestIdleCallback 或 setTimeout 延迟加载字体，优先渲染
if ('requestIdleCallback' in window) {
  requestIdleCallback(loadFallbackFonts, { timeout: 2000 });
} else {
  setTimeout(loadFallbackFonts, 0);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
