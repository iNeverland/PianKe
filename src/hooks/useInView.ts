import { useEffect, useRef, useState } from 'react';

/**
 * 元素首次进入视口后返回 true。
 *
 * 用于把海报 URL 解析、缩略图下载推迟到卡片真正接近视口时，避免首页
 * 一次性为几十张卡片发起请求。<img loading="lazy"> 只延迟图片元素本身，
 * 不会延迟这里的前置请求，所以需要单独的观察器。
 */
export function useInView<T extends HTMLElement>(rootMargin = '200px') {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setInView(true);
        observer.disconnect();
      }
    }, { rootMargin });

    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, inView };
}
