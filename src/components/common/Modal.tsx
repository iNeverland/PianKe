import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: string;
  contentClassName?: string;
}

const modalStack: symbol[] = [];

/**
 * 锁定背景滚动并让背景对键盘/读屏不可达。
 * 注意：应用真正的滚动容器是 AppShell 的 .main-content（body 并不滚动），
 * 只锁 body 会让弹窗打开后背景仍可滚动/穿透；inert 则同时覆盖键盘 Tab 与读屏漫游。
 */
function lockBackgroundScroll(locked: boolean): void {
  const scroller = document.querySelector<HTMLElement>('.main-content');
  const shell = document.querySelector<HTMLElement>('.app-shell');
  if (locked) {
    if (scroller) scroller.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    shell?.setAttribute('inert', '');
  } else {
    if (scroller) scroller.style.overflow = '';
    document.body.style.overflow = '';
    shell?.removeAttribute('inert');
  }
}

export default function Modal({ open, onClose, title, children, width = '560px', contentClassName = '' }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const modalId = useRef(Symbol('modal')).current;
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!modalStack.includes(modalId)) modalStack.push(modalId);
      setVisible(true);
      setClosing(false);
      // 真正的滚动容器是 AppShell 的 .main-content，锁定它才能阻止背景滚动穿透；
      // body 也一并锁定以覆盖登录页等无 .main-content 的场景。
      lockBackgroundScroll(true);
      requestAnimationFrame(() => contentRef.current?.focus());
    } else if (visible) {
      // 播放退出动画后隐藏
      setClosing(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setClosing(false);
        modalStack.splice(modalStack.indexOf(modalId), 1);
        if (!modalStack.length) lockBackgroundScroll(false);
        returnFocusRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [open, visible, modalId]);

  useEffect(() => () => {
      const index = modalStack.indexOf(modalId);
      if (index >= 0) modalStack.splice(index, 1);
      if (!modalStack.length) lockBackgroundScroll(false);
  }, [modalId]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack.at(-1) === modalId) onClose();
    };
    const trapFocus = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || modalStack.at(-1) !== modalId || !contentRef.current) return;
      const focusable = Array.from(contentRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      // 只保留真正可见的元素：hidden 属性、display:none、visibility:hidden 都应排除
      )).filter((element) => !element.hasAttribute('hidden') && element.offsetParent !== null);
      if (!focusable.length) {
        e.preventDefault();
        contentRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    if (open) {
      window.addEventListener('keydown', handleEsc);
      window.addEventListener('keydown', trapFocus);
    }
    return () => {
      window.removeEventListener('keydown', handleEsc);
      window.removeEventListener('keydown', trapFocus);
    };
  }, [open, onClose, modalId]);

  if (!visible) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className={`modal-overlay${closing ? ' closing' : ''}`}
      onClick={(e) => { if (e.target === overlayRef.current && modalStack.at(-1) === modalId) onClose(); }}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || '对话框'}
        tabIndex={-1}
        className={`modal-content${contentClassName ? ` ${contentClassName}` : ''}`}
        style={{ width, maxWidth: '90vw' }}
      >
        {title && (
          <div className="modal-title">
            <h2>{title}</h2>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
