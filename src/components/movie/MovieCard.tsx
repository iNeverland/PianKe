import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import type { MovieSummary } from '@shared/types/index';
import ContextMenu from '@/components/common/ContextMenu';
import type { ContextMenuItem } from '@/components/common/ContextMenu';
import Modal from '@/components/common/Modal';
import { showToast } from '@/components/common/Toast';
import AppIcon from '@/components/common/AppIcon';

interface MovieCardProps {
  movie: MovieSummary;
  onStatusChange?: () => void;
  onDelete?: (id: string) => void;
}

const statusConfig: Record<string, { label: string; cls: string }> = {
  '在看': { label: '追剧中', cls: 'watching' },
  '已看完': { label: '已看完', cls: 'watched' },
  '想看': { label: '想看', cls: 'want' },
};

export default function MovieCard({ movie, onStatusChange, onDelete }: MovieCardProps) {
  const navigate = useNavigate();
  const status = statusConfig[movie.status];
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (movie.posterThumbPath) {
      api.movie.getPosterUrl(movie.id, true).then(setPosterUrl).catch(() => {});
    }
  }, [movie.id, movie.posterThumbPath]);

  const handleImgLoad = useCallback(() => setImgLoaded(true), []);
  const handleImgError = useCallback(() => {
    // 海报 URL 失效/离线时回退到占位图标，避免骨架屏与评分/状态徽标永久隐藏。
    setImgLoaded(true);
    setPosterUrl(null);
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  async function handleStatusChange(status: '在看' | '已看完' | '想看') {
    try {
      const full = await api.movie.getById(movie.id);
      await api.movie.update(movie.id, {
        ...full,
        status,
        progress: full.progress,
      });
      showToast(`状态已更新为「${statusConfig[status]?.label || status}」`);
      onStatusChange?.();
    } catch (err: any) {
      showToast(err.message || '操作失败');
    }
  }

  function handleDelete() {
    setContextMenu(null);
    setShowDeleteConfirm(true);
  }

  async function executeDelete() {
    setShowDeleteConfirm(false);
    try {
      await api.movie.delete(movie.id);
      showToast('已删除');
      onDelete?.(movie.id);
    } catch (err: any) {
      showToast(err.message || '删除失败');
    }
  }

  const contextMenuItems: ContextMenuItem[] = [
    { label: '标记已看完', onClick: () => handleStatusChange('已看完') },
    { label: '追剧中', onClick: () => handleStatusChange('在看') },
    { label: '想看', onClick: () => handleStatusChange('想看') },
    { label: '编辑', onClick: () => navigate(`/movie/${movie.id}/edit`) },
    { label: '删除', onClick: handleDelete, danger: true },
  ];

  return (
    <>
      <button
        onClick={() => navigate(`/movie/${movie.id}`)}
        onContextMenu={handleContextMenu}
        className="movie-card"
      >
        <div className="movie-poster">
          {/* Skeleton placeholder — shown until image loads */}
          {posterUrl && !imgLoaded && (
            <div className="absolute inset-0 skeleton-shimmer z-10" />
          )}
          {posterUrl ? (
            <img
              src={posterUrl}
              alt={movie.title}
              loading="lazy"
              decoding="async"
              onLoad={handleImgLoad}
              onError={handleImgError}
              className={imgLoaded ? 'loaded' : 'loading'}
              style={imgLoaded ? undefined : { opacity: 0 }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-text-muted">
              <AppIcon name="image" className="w-10 h-10" />
            </div>
          )}

          {/* Top-right rating badge */}
          <div className="poster-rating" style={posterUrl && !imgLoaded ? { opacity: 0 } : undefined}>
            <AppIcon name="star" />
            {movie.rating.toFixed(1)}
          </div>

          {/* Top-left status badge */}
          {status && (
            <span className={`poster-status ${status.cls}`} style={posterUrl && !imgLoaded ? { opacity: 0 } : undefined}>
              {status.label}
            </span>
          )}

          {/* Hover gradient overlay */}
          <div className="poster-overlay" />
        </div>

        {/* Movie info */}
        <div className="movie-info">
          <h3 className="movie-title">
            {movie.title}
            {movie.progress?.totalEpisodes ? (
              <span className="text-text-muted font-normal ml-1 text-[0.68rem]">
                共{movie.progress.totalEpisodes}集
              </span>
            ) : null}
          </h3>
          <div className="movie-meta">
            <span className="movie-year">{movie.releaseDate?.substring(0, 4) || '—'}</span>
            <span className="movie-separator">·</span>
            <span className="movie-type">{movie.mediaType}</span>
            {movie.genre.length > 0 && (
              <span className="movie-genres">
                {movie.genre.slice(0, 2).join('/')}
              </span>
            )}
          </div>
        </div>
      </button>

      {contextMenu && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      )}

      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="确认删除" width="400px">
        <p className="text-text-secondary text-sm mb-5">确定要删除「{movie.title}」吗？此操作不可撤销。</p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setShowDeleteConfirm(false)} className="btn btn-ghost">取消</button>
          <button onClick={executeDelete} className="btn btn-danger">删除</button>
        </div>
      </Modal>
    </>
  );
}
