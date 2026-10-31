import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useInView } from '@/hooks/useInView';
import AppIcon from './AppIcon';

interface PosterThumbProps {
  movieId: string;
  hasPoster: boolean;
  alt: string;
  className?: string;
}

export default function PosterThumb({ movieId, hasPoster, alt, className }: PosterThumbProps) {
  const [url, setUrl] = useState<string | null>(null);
  const { ref, inView } = useInView<HTMLDivElement>();

  useEffect(() => {
    let active = true;
    setUrl(null);
    if (!inView || !hasPoster) {
      return () => { active = false; };
    }
    api.movie.getPosterCardUrl(movieId)
      .then((value) => {
        if (active && value) setUrl(value);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [inView, movieId, hasPoster]);

  if (!url) {
    return (
      <div ref={ref} className={`${className} flex items-center justify-center text-text-muted bg-bg-elevated`}>
        <AppIcon name="image" className="w-6 h-6" />
      </div>
    );
  }

  return (
    <div ref={ref} className={className}>
      <img
        src={url}
        alt={alt}
        className={className}
        loading="lazy"
        decoding="async"
        onError={() => setUrl(null)}
      />
    </div>
  );
}
