import { useState, useEffect } from 'react';
import AppIcon from '@/components/common/AppIcon';

type ToastSeverity = 'info' | 'error';

interface ToastItem {
  id: number;
  message: string;
  severity: ToastSeverity;
  action?: { label: string; onClick: () => void };
}

let toastId = 0;
const listeners: Set<(toast: ToastItem | null, exiting?: boolean) => void> = new Set();
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
let removeTimer: ReturnType<typeof setTimeout> | null = null;

// 计时器与当前 toast id 绑定：新 toast 出现时清掉旧计时器，
// 避免先弹出的 toast 到点后把后弹出的 toast 提前关掉。
function scheduleDismiss(id: number, duration: number): void {
  if (dismissTimer) clearTimeout(dismissTimer);
  if (removeTimer) clearTimeout(removeTimer);
  dismissTimer = setTimeout(() => {
    if (id !== toastId) return;
    listeners.forEach((fn) => fn(null, true));
    removeTimer = setTimeout(() => {
      if (id === toastId) listeners.forEach((fn) => fn(null, false));
    }, 200);
  }, duration);
}

export function showToast(message: string, duration = 2500, severity: ToastSeverity = 'info') {
  const id = ++toastId;
  listeners.forEach((fn) => fn({ id, message, severity }, false));
  scheduleDismiss(id, duration);
}

/** 立即关闭当前提示（WCAG 2.2.1：用户可主动结束自动消失的内容） */
export function dismissToast(): void {
  if (dismissTimer) clearTimeout(dismissTimer);
  if (removeTimer) clearTimeout(removeTimer);
  listeners.forEach((fn) => fn(null, true));
  removeTimer = setTimeout(() => listeners.forEach((fn) => fn(null, false)), 200);
}

/**
 * 错误提示：屏幕阅读器需要立即播报（role="alert" / aria-live="assertive"），
 * 因此单独导出，避免调用方漏传 severity；停留时间也更长（WCAG 4.1.3、2.2.1）。
 */
export function showErrorToast(message: string, duration = 5000) {
  showToast(message, duration, 'error');
}

export function showToastWithAction(
  message: string,
  actionLabel: string,
  onAction: () => void,
  duration = 4000
) {
  const id = ++toastId;
  listeners.forEach((fn) => fn({ id, message, severity: 'info', action: { label: actionLabel, onClick: onAction } }, false));
  scheduleDismiss(id, duration);
}

export default function Toast() {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const handler = (t: ToastItem | null, isExiting?: boolean) => {
      if (isExiting) {
        setExiting(true);
      } else {
        setExiting(false);
        setToast(t);
      }
    };
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  if (!toast && !exiting) return null;

  const isError = toast?.severity === 'error';

  return (
    <div
      className={`toast${exiting ? ' exiting' : ''}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <div className="toast-content">
        <span>{toast?.message}</span>
        {toast?.action && (
          <button
            className="toast-action-btn"
            onClick={() => {
              toast.action!.onClick();
              if (dismissTimer) clearTimeout(dismissTimer);
              if (removeTimer) clearTimeout(removeTimer);
              setToast(null);
              setExiting(false);
            }}
          >
            {toast.action.label}
          </button>
        )}
        <button type="button" className="toast-close-btn" onClick={dismissToast} aria-label="关闭提示" title="关闭提示">
          <AppIcon name="close" className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
