import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

export default function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const adjustedPos = useRef(position);
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);

  /** 关闭时把焦点还给触发元素（WCAG 2.4.3 焦点顺序） */
  const closeAndRestoreFocus = useCallback(() => {
    onClose();
    const target = returnFocusRef.current;
    if (target && document.contains(target)) target.focus();
  }, [onClose]);

  // 计算调整后的位置，防止溢出屏幕
  const calcPosition = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return position;

    const rect = menu.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    let x = position.x;
    let y = position.y;

    if (x + rect.width > winW) x = winW - rect.width - 8;
    if (y + rect.height > winH) y = winH - rect.height - 8;
    if (x < 0) x = 8;
    if (y < 0) y = 8;

    return { x, y };
  }, [position]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAndRestoreFocus();
    };
    /** ↑↓ / Home / End 在菜单项之间移动焦点（ARIA APG menu 模式） */
    const handleArrowKeys = (e: KeyboardEvent) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('.context-menu-item') ?? []);
      if (!nodes.length) return;
      e.preventDefault();
      const current = nodes.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? nodes.length - 1
          : e.key === 'ArrowDown'
            ? (current + 1 + nodes.length) % nodes.length
            : (current - 1 + nodes.length) % nodes.length;
      nodes[next]?.focus();
    };

    // 延迟绑定，避免触发右键的 mouseup 也被视为 click outside
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('contextmenu', handleClickOutside);
    }, 0);
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('keydown', handleArrowKeys);

    // 首次渲染后：定位并把焦点移到第一个菜单项
    requestAnimationFrame(() => {
      adjustedPos.current = calcPosition();
      if (menuRef.current) {
        menuRef.current.style.left = `${adjustedPos.current.x}px`;
        menuRef.current.style.top = `${adjustedPos.current.y}px`;
        menuRef.current.querySelector<HTMLButtonElement>('.context-menu-item')?.focus();
      }
    });

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('contextmenu', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('keydown', handleArrowKeys);
    };
  }, [onClose, calcPosition, closeAndRestoreFocus]);

  const menu = (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label="影片操作"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 2000,
      }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          className={`context-menu-item${item.danger ? ' danger' : ''}`}
          onClick={() => {
            item.onClick();
            closeAndRestoreFocus();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  return createPortal(menu, document.body);
}
