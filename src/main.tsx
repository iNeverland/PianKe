import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist/wght.css';
import App from './App';
import ErrorBoundary from './components/common/ErrorBoundary';
import { platform } from '@/platform';
import './index.css';

// 非 Electron 环境（Capacitor/Web）添加移动端标记类，供 CSS 做响应式布局适配。
// 在首次渲染前同步设置，避免移动端先闪现桌面布局。
if (platform.name !== 'electron') {
  document.documentElement.classList.add('platform-mobile');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
