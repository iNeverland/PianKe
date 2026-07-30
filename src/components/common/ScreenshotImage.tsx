import { useState, useEffect } from 'react';
import api from '@/lib/api';

interface Props {
  movieId: string;
  filename: string;
  thumbSrc: string;
}

/** 灯箱大图：先展示缩略图，后台加载原图后无缝替换 */
export default function ScreenshotImage({ movieId, filename, thumbSrc }: Props) {
  const [fullSrc, setFullSrc] = useState<string | null>(null);

  useEffect(() => {
    setFullSrc(null);
    api.movie.getScreenshot(movieId, filename).then(setFullSrc).catch(() => {});
  }, [movieId, filename]);

  return (
    <img
      src={fullSrc || thumbSrc}
      alt=""
      className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg"
      style={{ filter: fullSrc ? 'none' : 'blur(10px)' }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
