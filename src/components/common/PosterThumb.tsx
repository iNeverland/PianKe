import { useState, useEffect } from 'react';
import api from '@/lib/api';

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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <rect x="2" y="2" width="20" height="20" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
        </svg>
      </div>
    );
  }

  return <img src={url} alt={alt} className={className} />;
}
