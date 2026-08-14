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
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(() => contentRef.current?.focus());
    } else if (visible) {
      // 播放退出动画后隐藏
      setClosing(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setClosing(false);
        modalStack.splice(modalStack.indexOf(modalId), 1);
        if (!modalStack.length) document.body.style.overflow = '';
        returnFocusRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [open, visible, modalId]);

  useEffect(() => () => {
      const index = modalStack.indexOf(modalId);
      if (index >= 0) modalStack.splice(index, 1);
      if (!modalStack.length) document.body.style.overflow = '';
  }, [modalId]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack.at(-1) === modalId) onClose();
    };
    const trapFocus = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || modalStack.at(-1) !== modalId || !contentRef.current) return;
      const focusable = Array.from(contentRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => !element.hasAttribute('hidden'));
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
