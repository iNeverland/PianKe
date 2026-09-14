import { useCallback, useEffect, useRef, useState } from 'react';
import AppIcon from './AppIcon';

interface BackToTopProps {
  /** 滚动超过该距离（px）后显示按钮 */
  threshold?: number;
  /** 滚动容器选择器；默认使用 AppShell 的主内容区 */
  containerSelector?: string;
  className?: string;
}

/**
 * 页面滚动到一定距离后浮现的「回到顶部」按钮。
 * 默认监听 AppShell 的 .main-content 滚动容器，找不到时回退到 window。
 */
export default function BackToTop({
  threshold = 300,
  containerSelector = '.main-content',
  className,
}: BackToTopProps) {
  const scrollTargetRef = useRef<HTMLElement | Window | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const container = document.querySelector<HTMLElement>(containerSelector);
    const target: HTMLElement | Window = container ?? window;
    scrollTargetRef.current = target;

    const readScrollTop = () => (container ? container.scrollTop : window.scrollY);
    const handleScroll = () => setVisible(readScrollTop() > threshold);

    // 初次挂载时同步一次，避免刷新后停在页面中部却不显示按钮
    handleScroll();
    target.addEventListener('scroll', handleScroll, { passive: true });
    return () => target.removeEventListener('scroll', handleScroll);
  }, [containerSelector, threshold]);

  const scrollToTop = useCallback(() => {
    const target = scrollTargetRef.current;
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth';

    if (target instanceof HTMLElement) {
      target.scrollTo({ top: 0, behavior });
    } else {
      window.scrollTo({ top: 0, behavior });
    }
  }, []);

  return (
    <button
      type="button"
      onClick={scrollToTop}
      className={`back-to-top${visible ? ' is-visible' : ''}${className ? ` ${className}` : ''}`}
      title="回到顶部"
      aria-label="回到顶部"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
    >
      <AppIcon name="chevronUp" className="w-[18px] h-[18px]" />
    </button>
  );
}
