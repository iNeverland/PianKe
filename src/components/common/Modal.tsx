import { useEffect, useRef, useState } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: string;
}

export default function Modal({ open, onClose, title, children, width = '560px' }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      setClosing(false);
      document.body.style.overflow = 'hidden';
    } else if (visible) {
      // 播放退出动画后隐藏
      setClosing(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setClosing(false);
        document.body.style.overflow = '';
      }, 150);
      return () => clearTimeout(timer);
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  if (!visible) return null;

  return (
    <div
      ref={overlayRef}
      className={`modal-overlay${closing ? ' closing' : ''}`}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className="modal-content"
        style={{ width, maxWidth: '90vw' }}
      >
        {title && (
          <div className="modal-title">
            <h2>{title}</h2>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
