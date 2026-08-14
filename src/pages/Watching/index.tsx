import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import type { MovieSummary, WatchStatus } from '@shared/types/index';
import { getLocalDateStr } from '@shared/utils/date';
import EmptyState from '@/components/common/EmptyState';
import PosterThumb from '@/components/common/PosterThumb';
import { showToast } from '@/components/common/Toast';
import LoadingSkeleton from '@/components/common/LoadingSkeleton';
import ProgressBar from '@/components/common/ProgressBar';
import Header from '@/components/layout/Header';
import Modal from '@/components/common/Modal';
import FinishWatchingModal, { type FinishWatchingData } from '@/components/movie/FinishWatchingModal';

export default function Watching() {
  const navigate = useNavigate();
  const [movies, setMovies] = useState<MovieSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [jumpMovie, setJumpMovie] = useState<MovieSummary | null>(null);
  const [jumpEpisode, setJumpEpisode] = useState(1);
  const [finishingMovie, setFinishingMovie] = useState<MovieSummary | null>(null);
  const [updatingMovieId, setUpdatingMovieId] = useState<string | null>(null);

  useEffect(() => {
    loadMovies();
  }, []);

  async function loadMovies() {
    try {
      const watchingStatus: WatchStatus = '在看';
      const data = await api.movie.list({ status: watchingStatus });
      setMovies(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function saveProgress(movie: MovieSummary, episode: number) {
    const previousProgress = movie.progress;
    if (!previousProgress) return;
    setMovies((prev) => prev.map((item) => (
      item.id === movie.id
        ? { ...item, progress: { ...previousProgress, episode } }
        : item
    )));
    try {
      setUpdatingMovieId(movie.id);
      const updated = await api.movie.updateProgress(movie.id, episode);
      setMovies((prev) => prev.map((m) => (m.id === movie.id ? { ...m, progress: updated.progress } : m)));
      showToast(`「${movie.title}」进度 第${episode}集`);
    } catch (err: any) {
      setMovies((prev) => prev.map((item) => (
        item.id === movie.id ? { ...item, progress: previousProgress } : item
      )));
      showToast(err.message || '操作失败');
    } finally {
      setUpdatingMovieId(null);
    }
  }

  async function handleQuickProgress(movie: MovieSummary) {
    if (!movie.progress?.totalEpisodes) return;
    const p = movie.progress;
    const newEp = Math.min(p.episode + 1, p.totalEpisodes);
    if (newEp >= p.totalEpisodes) {
      setFinishingMovie(movie);
      return;
    }
    await saveProgress(movie, newEp);
  }

  function openJumpModal(movie: MovieSummary) {
    const p = movie.progress;
    if (!p?.totalEpisodes) return;
    setJumpMovie(movie);
    setJumpEpisode(Math.min(p.episode + 1, p.totalEpisodes));
  }

  async function handleJumpSave() {
    if (!jumpMovie?.progress?.totalEpisodes) return;
    const target = Math.min(jumpMovie.progress.totalEpisodes, Math.max(1, jumpEpisode));
    if (target >= jumpMovie.progress.totalEpisodes) {
      setJumpMovie(null);
      setFinishingMovie(jumpMovie);
      return;
    }
    setJumpMovie(null);
    await saveProgress(jumpMovie, target);
  }

  async function handleFinishWatching(data: FinishWatchingData) {
    if (!finishingMovie) return;
    try {
      await api.watchlist.markAsWatched(finishingMovie.id, {
        watchDate: getLocalDateStr(),
        rating: data.rating,
        review: data.review,
      });
      showToast(data.saveRecord ? `「${finishingMovie.title}」追剧记录已保存` : `「${finishingMovie.title}」已标记为已看完`);
      setFinishingMovie(null);
      await loadMovies();
    } catch (err: any) {
      showToast(err.message || '操作失败');
    }
  }

  if (loading) return (
    <div>
      <Header title="追剧中" subtitle="加载中..." showAdd={false} />
      <LoadingSkeleton rows={4} />
    </div>
  );

  return (
    <div>
      <Header title="追剧中" subtitle={`${movies.length} 部正在追`} showAdd={false} />

      {movies.length === 0 ? (
        <EmptyState title="暂无追剧中的影视" description="在影视详情页将状态切换为「追剧中」，影视会出现在这里" />
      ) : (
        <div className="stagger-children">
          {movies.map((movie) => {
            const p = movie.progress;
            const totalEps = p?.totalEpisodes || 0;
            const watchedEps = p?.episode || 0;
            const totalPercent = totalEps > 0 ? Math.min(100, Math.round(watchedEps / totalEps * 100)) : 0;

            return (
              <div key={movie.id} className="row-item">
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
                  {p && p.totalEpisodes && (
                    <div className="mt-1.5">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[0.65rem] text-text-muted">
                          第{p.episode}集 / 共{totalEps}集
                        </span>
                      </div>
                      <ProgressBar label="总进度" percent={totalPercent} />
                    </div>
                  )}
                </div>

                <div className="row-item-rating">
                  ★ {movie.rating.toFixed(1)}
                </div>

                <div className="quick-actions">
                  <button
                    onClick={() => handleQuickProgress(movie)}
                    className="quick-action-btn"
                    title="下一集"
                    disabled={updatingMovieId === movie.id}
                  >
                    +1集
                  </button>
                  <button
                    onClick={() => openJumpModal(movie)}
                    className="quick-action-btn"
                    title="跳转到指定集数"
                    disabled={updatingMovieId === movie.id}
                  >
                    跳集
                  </button>
                  <button
                    onClick={() => setFinishingMovie(movie)}
                    className="quick-action-btn primary"
                    title="标记已看完"
                    disabled={updatingMovieId === movie.id}
                  >
                    看完
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={Boolean(jumpMovie)} onClose={() => setJumpMovie(null)} title="跳至指定集数" width="360px">
        <div className="flex flex-col gap-4">
          <div>
            <label className="form-label">目标集数</label>
            <input
              type="number"
              min={1}
              max={jumpMovie?.progress?.totalEpisodes || 1}
              value={jumpEpisode}
              onChange={(e) => setJumpEpisode(Math.min(jumpMovie?.progress?.totalEpisodes || 1, Math.max(1, Number(e.target.value) || 1)))}
              className="form-input"
              autoFocus
            />
          </div>
          <p className="text-xs text-text-muted">共 {jumpMovie?.progress?.totalEpisodes || 0} 集；跳至最后一集将进入完成记录。</p>
          <div className="flex justify-end gap-2.5">
            <button onClick={() => setJumpMovie(null)} className="btn btn-ghost">取消</button>
            <button onClick={handleJumpSave} className="btn btn-primary">更新进度</button>
          </div>
        </div>
      </Modal>

      <FinishWatchingModal
        open={Boolean(finishingMovie)}
        movieTitle={finishingMovie?.title || ''}
        onClose={() => setFinishingMovie(null)}
        onComplete={handleFinishWatching}
      />
    </div>
  );
}
