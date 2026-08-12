import { useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import AppIcon from './AppIcon';

interface Props {
  movieId: string;
  filename: string;
  alt: string;
  className?: string;
}

/** 仅在即将进入可视区域时获取单张截图缩略图。 */
export default function ScreenshotThumbnail({ movieId, filename, alt, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    if (!('IntersectionObserver' in window)) {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { rootMargin: '160px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoad) return;
    let active = true;
    setSrc(null);
    setFailed(false);
    api.movie.getScreenshotThumbnail(movieId, filename)
      .then((url) => {
        if (!active) return;
        setSrc(url);
        setFailed(!url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => { active = false; };
  }, [filename, movieId, shouldLoad]);

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center text-text-muted">
      {src ? (
        <img src={src} alt={alt} className={className} loading="lazy" decoding="async" />
      ) : (
        <AppIcon name="image" className={failed ? 'w-8 h-8 opacity-50' : 'w-8 h-8 animate-pulse'} title={failed ? '图片加载失败' : '图片加载中'} />
      )}
    </div>
  );
}
