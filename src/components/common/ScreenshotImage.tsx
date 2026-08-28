import { useState, useEffect } from 'react';
import api from '@/lib/api';
import ZoomableImage from './ZoomableImage';

interface Props {
  movieId: string;
  filename: string;
}

/** 灯箱大图：仅在用户打开灯箱后请求原图，支持滚轮缩放与拖拽平移。 */
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
    <ZoomableImage
      src={fullSrc}
      alt=""
    />
  );
}
