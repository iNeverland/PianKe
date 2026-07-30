import { useState, useEffect, useCallback, useRef } from 'react';

interface ToastItem {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
}

let toastId = 0;
const listeners: Set<(toast: ToastItem | null, exiting?: boolean) => void> = new Set();

export function showToast(message: string, duration = 2500) {
  const id = ++toastId;
  listeners.forEach((fn) => fn({ id, message }, false));
  setTimeout(() => {
    listeners.forEach((fn) => fn(null, true));
    setTimeout(() => {
      listeners.forEach((fn) => fn(null, false));
    }, 200);
  }, duration);
}

export function showToastWithAction(
  message: string,
  actionLabel: string,
  onAction: () => void,
  duration = 4000
) {
  const id = ++toastId;
  listeners.forEach((fn) => fn({ id, message, action: { label: actionLabel, onClick: onAction } }, false));
  setTimeout(() => {
    listeners.forEach((fn) => fn(null, true));
    setTimeout(() => {
      listeners.forEach((fn) => fn(null, false));
    }, 200);
  }, duration);
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
