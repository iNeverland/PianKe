import { useState, useEffect } from 'react';
import api from '@/lib/api';

interface Props {
  movieId: string;
  filename: string;
}

/** 灯箱大图：仅在用户打开灯箱后请求原图。 */
export default function ScreenshotImage({ movieId, filename }: Props) {
  const [fullSrc, setFullSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFullSrc(null);
    setFailed(false);
    api.movie.getScreenshot(movieId, filename)
      .then((url) => {
        if (!active) return;
        setFullSrc(url);
        setFailed(!url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => { active = false; };
  }, [movieId, filename]);

  if (!fullSrc) {
    return <div className="w-[min(90vw,960px)] h-[min(85vh,540px)] flex items-center justify-center text-white/70">{failed ? '图片加载失败' : '正在加载图片...'}</div>;
  }

  return (
    <img
      src={fullSrc}
      alt=""
      className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg"
      decoding="async"
      onClick={(e) => e.stopPropagation()}
    />
  );
}
