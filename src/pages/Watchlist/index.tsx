import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import type { MovieSummary } from '@shared/types/index';
import { getLocalDateStr } from '@shared/utils/date';
import EmptyState from '@/components/common/EmptyState';
import PosterThumb from '@/components/common/PosterThumb';
import { showToast } from '@/components/common/Toast';
import Header from '@/components/layout/Header';

export default function Watchlist() {
  const navigate = useNavigate();
  const [movies, setMovies] = useState<MovieSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWatchlist();
  }, []);

  async function loadWatchlist() {
    try {
      const data = await api.watchlist.list();
      setMovies(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkAsWatching(movie: MovieSummary) {
    try {
      await api.watchlist.markAsWatching(movie.id);
      showToast(`「${movie.title}」已标记为追剧中`);
      loadWatchlist();
    } catch (err: any) {
      showToast(err.message || '操作失败');
    }
  }

  async function handleMarkAsWatched(movie: MovieSummary) {
    const date = getLocalDateStr();
    try {
      await api.watchlist.markAsWatched(movie.id, { watchDate: date, rating: 0, review: '' });
      showToast(`「${movie.title}」已标记为已看完`);
      loadWatchlist();
    } catch (err: any) {
      showToast(err.message || '操作失败');
    }
  }

  async function handleTogglePin(movie: MovieSummary) {
    try {
      const isPinned = movie.tags.includes('置顶');
      if (isPinned) {
        await api.movie.removeTag(movie.id, '置顶');
      } else {
        await api.movie.addTag(movie.id, '置顶');
      }
      loadWatchlist();
    } catch (err: any) {
      showToast(err.message || '操作失败');
    }
  }

  if (loading) return (
    <div>
      <Header title="想看清单" subtitle="加载中..." showAdd={false} />
      <div className="text-text-muted text-sm py-10">加载中...</div>
    </div>
  );

  return (
    <div>
      <Header title="想看清单" subtitle={`${movies.length} 部想看的影视`} showAdd={false} />

      {movies.length === 0 ? (
        <EmptyState title="想看清单为空" description="添加影视时选择「想看」状态，影视会出现在这里" />
      ) : (
        <div className="stagger-children">
          {[...movies].sort((a, b) => {
            const aPin = a.tags.includes('置顶') ? 0 : 1;
            const bPin = b.tags.includes('置顶') ? 0 : 1;
            return aPin - bPin;
          }).map((movie) => {
            const isPinned = movie.tags.includes('置顶');
            return (
            <div key={movie.id} className={`row-item${isPinned ? ' pinned' : ''}`}>
              <div
                onClick={() => navigate(`/movie/${movie.id}`)}
                className="row-item-poster"
              >
                <PosterThumb
                  movieId={movie.id}
                  hasPoster={Boolean(movie.posterThumbPath)}
                  alt={movie.title}
                  className="w-full h-full object-cover"
                />
              </div>

              <div onClick={() => navigate(`/movie/${movie.id}`)} className="row-item-info">
                <div className="row-item-title">{movie.title}</div>
                <div className="row-item-meta">
                  {movie.releaseDate?.substring(0, 4)} · {movie.mediaType}{movie.genre.length > 0 ? ` · ${movie.genre.slice(0, 2).join('/')}` : ''}
                </div>
                {movie.titleOriginal && (
                  <div className="row-item-meta italic">{movie.titleOriginal}</div>
                )}
              </div>

              <div className="row-item-rating">
                ★ {movie.rating.toFixed(1)}
              </div>

              <div className="quick-actions">
                <button
                  onClick={() => handleTogglePin(movie)}
                  className={`quick-action-btn${isPinned ? ' primary' : ''}`}
                  title={isPinned ? '取消置顶' : '置顶'}
                >
                  {isPinned ? '已置顶' : '置顶'}
                </button>
                <button
                  onClick={() => handleMarkAsWatching(movie)}
                  className="quick-action-btn"
                >
                  追剧中
                </button>
                <button
                  onClick={() => handleMarkAsWatched(movie)}
                  className="quick-action-btn primary"
                >
                  已看完
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
