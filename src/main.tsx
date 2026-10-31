import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist/wght.css';
import App from './App';
import ErrorBoundary from './components/common/ErrorBoundary';
import './index.css';

/**
 * 挡住「把链接/文件拖进窗口 → Chromium 默认导航主框架」这条路径。
 *
 * 主进程的 will-navigate 也拦了同样的事，这里是第一道：不让导航有机会开始。
 * 只针对 Files / text/uri-list 两种拖拽载荷，并且跳过输入框——否则会连带
 * 破坏「把选中的文字拖进 textarea」这种正常操作。业务组件（如海报拖放）
 * 自己处理过的 drop 已经 preventDefault，这里不再干预。
 */
function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
}

function isNavigationDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).some((type) => type === 'Files' || type === 'text/uri-list');
}

window.addEventListener('dragover', (event) => {
  if (!isEditableTarget(event.target) && isNavigationDrag(event)) event.preventDefault();
});

window.addEventListener('drop', (event) => {
  if (event.defaultPrevented || isEditableTarget(event.target)) return;
  if (isNavigationDrag(event)) event.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
