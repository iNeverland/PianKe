import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import PosterThumb from '@/components/common/PosterThumb';
import LoadingSkeleton from '@/components/common/LoadingSkeleton';
import type { MovieSummary, ScreenshotInfo } from '@shared/types/index';

const PHOTO_TILE_HEIGHT = 124;
const PHOTO_TILE_GAP = 12;
const ALPHABET = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
const PINYIN_INITIALS: Array<[string, string]> = [
  ['A', '阿'], ['B', '八'], ['C', '擦'], ['D', '搭'], ['E', '蛾'], ['F', '发'], ['G', '噶'], ['H', '哈'],
  ['J', '击'], ['K', '咖'], ['L', '垃'], ['M', '妈'], ['N', '拿'], ['O', '哦'], ['P', '啪'], ['Q', '期'],
  ['R', '然'], ['S', '撒'], ['T', '塌'], ['W', '挖'], ['X', '昔'], ['Y', '压'], ['Z', '匝'],
];
const PINYIN_COLLATOR = new Intl.Collator('zh-Hans-CN-u-co-pinyin');

type WallMedia = {
  key: string;
  kind: 'poster' | 'screenshot';
  src?: string;
  hasPoster?: boolean;
  filename?: string;
  episode?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
};

interface WallMovie {
  id: string;
  title: string;
  media: WallMedia[];
  screenshotCount: number;
}

function screenshotOrder(filename: string): number {
  const match = filename.match(/^shot_(\d+)/);
  return match ? Number(match[1]) : 0;
}

function sortScreenshotsNewestFirst(screenshots: ScreenshotInfo[]): ScreenshotInfo[] {
  return [...screenshots].sort((a, b) => {
    const bySequence = screenshotOrder(a.filename) - screenshotOrder(b.filename);
    return bySequence || b.filename.localeCompare(a.filename);
  });
}

function compareMoviesByPinyin(a: WallMovie, b: WallMovie): number {
  return a.title.localeCompare(b.title, 'zh-Hans-CN-u-co-pinyin');
}

function getTitleInitial(title: string): string {
  const first = title.trim().replace(/^[^a-zA-Z0-9\u4e00-\u9fff]+/, '').charAt(0);
  if (!first) return '#';
  if (/[a-z]/i.test(first)) return first.toUpperCase();
  if (!/[\u4e00-\u9fff]/.test(first)) return '#';

  for (let index = PINYIN_INITIALS.length - 1; index >= 0; index--) {
    const [initial, boundary] = PINYIN_INITIALS[index];
    if (PINYIN_COLLATOR.compare(first, boundary) >= 0) return initial;
  }
  return '#';
}

function getScreenshotCaption(media: WallMedia): string {
  const hasTimestamp = media.hours !== undefined || media.minutes !== undefined || media.seconds !== undefined;
  const timestamp = hasTimestamp
    ? [media.hours || 0, media.minutes || 0, media.seconds || 0].map((value) => String(value).padStart(2, '0')).join(':')
    : '未标注时间';
  return `第 ${media.episode ?? 1} 集 · ${timestamp}`;
}

function previewImage(seed: number, poster = false): string {
  const palettes = [
    ['#172235', '#597a88', '#f3c57d'],
    ['#301d27', '#946563', '#e5b68a'],
    ['#17261e', '#678774', '#e0b657'],
    ['#263449', '#7e9db5', '#e9e2cf'],
  ];
  const [deep, mid, light] = palettes[seed % palettes.length];
  const width = poster ? 600 : 960;
  const height = poster ? 900 : 540;
  const shape = poster
    ? `<circle cx="300" cy="325" r="134" fill="${light}" fill-opacity=".22"/><path d="M0 700 C120 570 230 755 370 640 C460 565 520 590 600 505 V900 H0Z" fill="${deep}" fill-opacity=".58"/>`
    : `<circle cx="735" cy="190" r="110" fill="${light}" fill-opacity=".26"/><path d="M0 430 C180 310 300 480 470 385 C620 302 735 415 960 270 V540 H0Z" fill="${deep}" fill-opacity=".56"/>`;

  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${deep}"/><stop offset="1" stop-color="${mid}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${shape}<path d="M0 0H${width}V${height}H0Z" fill="none" stroke="${light}" stroke-opacity=".2" stroke-width="18"/></svg>`)}`;
}

const PREVIEW_WALL: WallMovie[] = [
  { id: 'preview-interstellar', title: '星际穿越', screenshotCount: 17, media: [
    { key: 'poster', kind: 'poster', src: previewImage(0, true), hasPoster: true },
    ...Array.from({ length: 17 }, (_, index) => ({ key: `shot-${index}`, kind: 'screenshot' as const, src: previewImage(index + 1), episode: Math.floor(index / 5) + 1, hours: 0, minutes: (12 + index * 3) % 60, seconds: index * 7 % 60 })),
  ] },
  { id: 'preview-in-the-mood', title: '花样年华', screenshotCount: 7, media: [
    { key: 'poster', kind: 'poster', src: previewImage(1, true), hasPoster: true },
    ...Array.from({ length: 7 }, (_, index) => ({ key: `shot-${index}`, kind: 'screenshot' as const, src: previewImage(index + 8), episode: 1, hours: 0, minutes: 8 + index * 5, seconds: index * 9 % 60 })),
  ] },
  { id: 'preview-perfect-days', title: '完美的日子', screenshotCount: 3, media: [
    { key: 'poster', kind: 'poster', src: previewImage(2, true), hasPoster: true },
    ...Array.from({ length: 3 }, (_, index) => ({ key: `shot-${index}`, kind: 'screenshot' as const, src: previewImage(index + 15), episode: 1, hours: 0, minutes: 22 + index * 6, seconds: index * 11 % 60 })),
  ] },
];

function PhotoTile({ movieId, movieTitle, media, onPreview }: { movieId: string; movieTitle: string; media: WallMedia; onPreview: (movieId: string, movieTitle: string, media: WallMedia) => void }) {
  const isPoster = media.kind === 'poster';

  return (
    <button className={`photo-wall-tile${isPoster ? ' photo-wall-poster' : ''}`} onClick={() => onPreview(movieId, movieTitle, media)} title={`放大查看「${movieTitle}」`}>
      {media.src ? (
        <img src={media.src} alt={isPoster ? `${movieTitle}海报` : `${movieTitle}截图`} />
      ) : isPoster ? (
        <PosterThumb movieId={movieId} hasPoster={Boolean(media.hasPoster)} alt={`${movieTitle}海报`} className="w-full h-full object-contain" />
      ) : null}
      {isPoster && <span className="photo-wall-media-label">海报</span>}
      {!isPoster && <span className="photo-wall-screenshot-caption">{getScreenshotCaption(media)}</span>}
    </button>
  );
}

function PhotoWallGroup({ movie, initial, wallWidth, onPreview }: { movie: WallMovie; initial: string; wallWidth: number; onPreview: (movieId: string, movieTitle: string, media: WallMedia) => void }) {
  const [expanded, setExpanded] = useState(false);
  const visibleLimit = useMemo(() => {
    if (!wallWidth) return 8;

    let line = 1;
    let usedWidth = 0;
    for (let index = 0; index < movie.media.length; index++) {
      const media = movie.media[index];
      const tileWidth = media.kind === 'poster'
        ? PHOTO_TILE_HEIGHT * 2 / 3
        : PHOTO_TILE_HEIGHT * 16 / 10;
      const nextWidth = usedWidth === 0 ? tileWidth : usedWidth + PHOTO_TILE_GAP + tileWidth;
      if (usedWidth > 0 && nextWidth > wallWidth) {
        line++;
        if (line > 2) return index;
        usedWidth = tileWidth;
      } else {
        usedWidth = nextWidth;
      }
    }
    return movie.media.length;
  }, [movie.media, wallWidth]);
  const canCollapse = movie.media.length > visibleLimit;
  const visibleMedia = expanded || !canCollapse ? movie.media : movie.media.slice(0, visibleLimit);
  const hiddenCount = movie.media.length - visibleLimit;

  return (
    <section className="photo-wall-group" data-photo-wall-initial={initial}>
      <div className="photo-wall-group-heading">
        <h3 className="photo-wall-movie-title">{movie.title}</h3>
        <div className="photo-wall-divider" />
        {movie.screenshotCount > 0 && <span>{movie.screenshotCount} 张截图</span>}
      </div>
      <div className="photo-wall-grid">
        {visibleMedia.map((media) => <PhotoTile key={media.key} movieId={movie.id} movieTitle={movie.title} media={media} onPreview={onPreview} />)}
      </div>
      {canCollapse && (
        <button className="photo-wall-expand" onClick={() => setExpanded((value) => !value)}>
          {expanded ? '收起图片' : `展开其余 ${hiddenCount} 张图片`}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points={expanded ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
          </svg>
        </button>
      )}
    </section>
  );
}

function PhotoLightbox({ movieId, movieTitle, media, onClose, onPrevious, onNext, hasPrevious, hasNext }: {
  movieId: string;
  movieTitle: string;
  media: WallMedia;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(media.filename ? null : media.src || null);

  useEffect(() => {
    let active = true;
    setImageUrl(media.filename ? null : media.src || null);
    if (!media.filename && media.src) return;

    const request = media.kind === 'poster'
      ? api.movie.getPosterUrl(movieId)
      : api.movie.getScreenshot(movieId, media.filename!);
    request.then((url) => { if (active) setImageUrl(url); }).catch(() => { if (active) setImageUrl(null); });
    return () => { active = false; };
  }, [media, movieId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && hasPrevious) onPrevious();
      if (event.key === 'ArrowRight' && hasNext) onNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasNext, hasPrevious, onClose, onNext, onPrevious]);

  return (
    <div className="photo-wall-lightbox" role="dialog" aria-modal="true" aria-label={`${movieTitle}${media.kind === 'poster' ? '海报' : '截图'}预览`} onClick={onClose}>
      <button className="photo-wall-lightbox-close" onClick={onClose} aria-label="关闭预览">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <button className="photo-wall-lightbox-nav previous" onClick={(event) => { event.stopPropagation(); onPrevious(); }} disabled={!hasPrevious} aria-label="上一张">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <div className="photo-wall-lightbox-content" onClick={(event) => event.stopPropagation()}>
        {imageUrl ? <img src={imageUrl} alt={`${movieTitle}${media.kind === 'poster' ? '海报' : '截图'}`} /> : <span>{media.kind === 'poster' ? '请上传海报' : '图片加载失败'}</span>}
        {media.kind === 'screenshot' && <p>{getScreenshotCaption(media)}</p>}
      </div>
      <button className="photo-wall-lightbox-nav next" onClick={(event) => { event.stopPropagation(); onNext(); }} disabled={!hasNext} aria-label="下一张">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
      </button>
    </div>
  );
}

export default function PhotoWall() {
  const location = useLocation();
  const previewMode = import.meta.env.DEV && new URLSearchParams(location.search).get('preview') === '1';
  const [movies, setMovies] = useState<WallMovie[]>(previewMode ? PREVIEW_WALL : []);
  const [loading, setLoading] = useState(!previewMode);
  const [wallWidth, setWallWidth] = useState(0);
  const [selectedMedia, setSelectedMedia] = useState<{ movie: WallMovie; index: number } | null>(null);
  const [activeInitial, setActiveInitial] = useState<string | null>(null);

  useEffect(() => {
    if (previewMode) return;

    let active = true;
    const loadPhotoWall = async (showLoading = false) => {
      if (showLoading && active) setLoading(true);
      try {
        const summaries = await api.movie.list();
        const groups = await Promise.all(summaries.map(async (movie: MovieSummary) => {
          const screenshots = sortScreenshotsNewestFirst(await api.movie.listScreenshots(movie.id));
          return {
            id: movie.id,
            title: movie.title,
            screenshotCount: screenshots.length,
            media: [
              { key: 'poster', kind: 'poster' as const, hasPoster: Boolean(movie.posterThumbPath) },
              ...screenshots.map((shot) => ({
                key: shot.filename,
                kind: 'screenshot' as const,
                src: shot.thumbBase64,
                filename: shot.filename,
                episode: shot.episode,
                hours: shot.hours,
                minutes: shot.minutes,
                seconds: shot.seconds,
              })),
            ],
          };
        }));
        if (active) setMovies(groups);
      } catch (error) {
        console.error('加载照片墙失败', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadPhotoWall(true);
    const refreshWhenFocused = () => { void loadPhotoWall(); };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshWhenFocused();
    };
    window.addEventListener('focus', refreshWhenFocused);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      active = false;
      window.removeEventListener('focus', refreshWhenFocused);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [previewMode]);

  useEffect(() => {
    const updateWidth = () => setWallWidth(document.querySelector<HTMLElement>('.photo-wall-list')?.clientWidth || 0);
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const screenshotCount = useMemo(() => movies.reduce((total, movie) => total + movie.screenshotCount, 0), [movies]);
  const sortedMovies = useMemo(() => [...movies].sort(compareMoviesByPinyin), [movies]);
  const availableInitials = useMemo(() => new Set(sortedMovies.map((movie) => getTitleInitial(movie.title))), [sortedMovies]);

  function scrollToInitial(initial: string) {
    document.querySelector<HTMLElement>(`[data-photo-wall-initial="${initial}"] .photo-wall-group-heading`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveInitial(initial);
  }

  if (loading) return <><Header title="照片墙" subtitle="加载中..." showAdd={false} /><LoadingSkeleton rows={6} /></>;

  return (
    <div className="photo-wall-page">
      <Header title="照片墙" subtitle={previewMode ? '本地预览数据' : `${sortedMovies.length} 部影视 · ${screenshotCount} 张截图`} showAdd={false} />
      {sortedMovies.length === 0 ? (
        <div className="photo-wall-empty">添加影视海报或截图后，它们会在这里按影片汇集展示。</div>
      ) : (
        <div className="photo-wall-layout">
          <div className="photo-wall-list">
            {sortedMovies.map((movie) => <PhotoWallGroup key={movie.id} movie={movie} initial={getTitleInitial(movie.title)} wallWidth={wallWidth} onPreview={(movieId, _movieTitle, media) => {
              const targetMovie = sortedMovies.find((item) => item.id === movieId);
              const index = targetMovie?.media.findIndex((item) => item.key === media.key) ?? -1;
              if (targetMovie && index >= 0) setSelectedMedia({ movie: targetMovie, index });
            }} />)}
          </div>
          <nav className="photo-wall-index" aria-label="影视名称字母索引">
            {ALPHABET.filter((initial) => availableInitials.has(initial)).map((initial) => (
              <button key={initial} onClick={() => scrollToInitial(initial)} className={activeInitial === initial ? 'active' : ''}>{initial}</button>
            ))}
          </nav>
        </div>
      )}
      {selectedMedia && <PhotoLightbox
        movieId={selectedMedia.movie.id}
        movieTitle={selectedMedia.movie.title}
        media={selectedMedia.movie.media[selectedMedia.index]}
        hasPrevious={selectedMedia.index > 0}
        hasNext={selectedMedia.index < selectedMedia.movie.media.length - 1}
        onPrevious={() => setSelectedMedia((current) => current && { ...current, index: current.index - 1 })}
        onNext={() => setSelectedMedia((current) => current && { ...current, index: current.index + 1 })}
        onClose={() => setSelectedMedia(null)}
      />}
    </div>
  );
}
