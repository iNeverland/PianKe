import { useState, useEffect } from 'react';

interface ToastItem {
  id: number;
  message: string;
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

export function showToast(message: string, duration = 2500) {
  const id = ++toastId;
  listeners.forEach((fn) => fn({ id, message }, false));
  scheduleDismiss(id, duration);
}

export function showToastWithAction(
  message: string,
  actionLabel: string,
  onAction: () => void,
  duration = 4000
) {
  const id = ++toastId;
  listeners.forEach((fn) => fn({ id, message, action: { label: actionLabel, onClick: onAction } }, false));
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

  return (
    <div className={`toast${exiting ? ' exiting' : ''}`}>
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
      </div>
    </div>
  );
}
