import { useState, useEffect } from 'react';
import api from '@/lib/api';
import AppIcon from './AppIcon';

interface PosterThumbProps {
  movieId: string;
  hasPoster: boolean;
  alt: string;
  className?: string;
}

export default function PosterThumb({ movieId, hasPoster, alt, className }: PosterThumbProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (hasPoster) {
      api.movie.getPosterUrl(movieId, true).then(setUrl).catch(() => {});
    }
  }, [movieId, hasPoster]);

  if (!url) {
    return (
      <div className={`${className} flex items-center justify-center text-text-muted bg-bg-elevated`}>
        <AppIcon name="image" className="w-6 h-6" />
      </div>
    );
  }

  return <img src={url} alt={alt} className={className} loading="lazy" decoding="async" />;
}
