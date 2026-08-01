import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import type { MovieMetadata, DiaryEntry, ScreenshotInfo } from '@shared/types/index';
import { getLocalDateStr } from '@shared/utils/date';
import StarRating from '@/components/common/StarRating';
import Modal from '@/components/common/Modal';

import { showToast, showToastWithAction } from '@/components/common/Toast';
import LoadingSkeleton from '@/components/common/LoadingSkeleton';
import ScreenshotImage from '@/components/common/ScreenshotImage';
import Header from '@/components/layout/Header';
import FinishWatchingModal, { type FinishWatchingData } from '@/components/movie/FinishWatchingModal';

export default function MovieDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [movie, setMovie] = useState<MovieMetadata | null>(null);
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [showAddDiary, setShowAddDiary] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [showFinishWatching, setShowFinishWatching] = useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [diaryExpanded, setDiaryExpanded] = useState(false);
  const nowTime = () => `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
  const [diaryForm, setDiaryForm] = useState({ watchDate: getLocalDateStr(), watchTime: nowTime(), rating: 0, review: '' });
  const [progressForm, setProgressForm] = useState({ episode: 1 });
  const [screenshots, setScreenshots] = useState<ScreenshotInfo[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [editingTimestampFile, setEditingTimestampFile] = useState<string | null>(null);
  const [timestampForm, setTimestampForm] = useState({ episode: '1', hours: '', minutes: '', seconds: '' });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollPos, setScrollPos] = useState({ left: false, right: false });
  const [uploadHovered, setUploadHovered] = useState(false);
  const [wallHovered, setWallHovered] = useState(false);
  const [castOpen, setCastOpen] = useState(false);
  const castRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭主演弹窗
  useEffect(() => {
    if (!castOpen) return;
    const handler = (e: MouseEvent) => {
      if (castRef.current && !castRef.current.contains(e.target as Node)) setCastOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [castOpen]);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollPos({
      left: el.scrollLeft > 1,
      right: el.scrollLeft < el.scrollWidth - el.clientWidth - 1,
    });
  }, []);

  function scrollScreenshots(dir: 'left' | 'right') {
    const el = scrollRef.current;
    if (!el) return;
    const itemWidth = el.clientWidth / 3;
    el.scrollBy({ left: dir === 'left' ? -itemWidth : itemWidth, behavior: 'smooth' });
  }

  useEffect(() => {
    if (id) loadMovie();
  }, [id]);

  // 截图列表变化时更新箭头状态
  useEffect(() => {
    updateScrollState();
  }, [screenshots, updateScrollState]);

  // 粘贴上传截图（鼠标悬停上传框时 Ctrl+V）
  useEffect(() => {
    if (!uploadHovered || !id) return;
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (!item.type.startsWith('image/')) continue;
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        const ext = '.' + (item.type.split('/')[1] || 'png');
        try {
          const updated = await api.movie.addScreenshot(id, dataUrl, ext);
          setScreenshots(updated);
        } catch (err: any) {
          showToast(err.message || '上传失败');
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [uploadHovered, id]);

  // 监听截图快捷键 → 截全屏 → 打开桌面裁剪窗口
  useEffect(() => {
    if (!id) return;

    const captureScreenSnapshot = async (): Promise<string | null> => {
      return window.electronAPI.getPrimaryScreenSnapshot();
    };

    const handleCapture = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { movieId: string } | undefined;
      if (!detail || detail.movieId !== id) return;

      try {
        const dataUrl = await captureScreenSnapshot();
        if (!dataUrl) {
          window.electronAPI?.showScreenToast?.('未检测到可捕获的屏幕');
          return;
        }

        // 打开桌面裁剪窗口（普通窗口，不用 fullscreen/transparent）
        await window.electronAPI.startCrop(id, dataUrl);
      } catch (err: any) {
        console.error('[screenshot] capture failed:', err);
        window.electronAPI?.showScreenToast?.(err?.message || '截图失败');
      }
    };

    window.addEventListener('screenshot:capture', handleCapture);
    return () => window.removeEventListener('screenshot:capture', handleCapture);
  }, [id]);

  // 监听主进程裁剪保存完成
  useEffect(() => {
    const unsub = window.electronAPI?.onScreenshotSaved?.((updated) => {
      setScreenshots(updated);
      window.electronAPI?.showScreenToast?.('截图已保存，已复制到剪贴板');
    });
    return () => { unsub?.(); };
  }, []);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowLeft' && lightboxIndex > 0) setLightboxIndex(lightboxIndex - 1);
      if (e.key === 'ArrowRight' && lightboxIndex < screenshots.length - 1) setLightboxIndex(lightboxIndex + 1);
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [lightboxIndex, screenshots.length]);

  async function loadMovie() {
    if (!id) return;
    try {
      const [movieData, diaryData] = await Promise.all([
        api.movie.getById(id),
        api.diary.getByMovie(id),
      ]);
      setMovie(movieData);
      setEntries(diaryData);
      // 加载海报
      if (movieData.posterPath) {
        api.movie.getPosterUrl(id!).then(setPosterUrl).catch(() => {});
      }
      if (movieData.progress) {
        setProgressForm({ episode: movieData.progress.episode });
      }
      // 加载截图
      api.movie.listScreenshots(id!).then(setScreenshots).catch(() => {});
    } catch (err: any) {
      showToast(err.message || '加载失败');
    }
  }

  async function handleDelete() {
    if (!id) return;
    setShowDeleteConfirm(false);
    try {
      await api.movie.delete(id);
      showToast('已删除');
      navigate('/');
    } catch (err: any) {
      showToast(err.message || '删除失败');
    }
  }

  async function handleAddDiary() {
    if (!id) return;
    try {
      const entry = await api.diary.add(id, { ...diaryForm, watchTime: diaryForm.watchTime || nowTime() });
      setEntries((prev) => [...prev, entry]);
      setShowAddDiary(false);
      setDiaryForm({ watchDate: getLocalDateStr(), watchTime: nowTime(), rating: 0, review: '' });
      showToast('观影记录已添加');
    } catch (err: any) {
      showToast(err.message || '添加失败');
    }
  }

  async function handleUpdateDiary() {
    if (!id || !editingEntryId) return;
    try {
      const updated = await api.diary.update(id, editingEntryId, { ...diaryForm, watchTime: diaryForm.watchTime || nowTime() });
      setEntries((prev) => prev.map((e) => (e.id === editingEntryId ? updated : e)));
      setShowAddDiary(false);
      setEditingEntryId(null);
      setDiaryForm({ watchDate: getLocalDateStr(), watchTime: nowTime(), rating: 0, review: '' });
      showToast('观影记录已更新');
    } catch (err: any) {
      showToast(err.message || '更新失败');
    }
  }

  async function handleDeleteEntry(entryId: string) {
    if (!id) return;
    const entryToDelete = entries.find(e => e.id === entryId);
    try {
      // 乐观更新：先从 UI 移除
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
      setDeletingEntryId(null);
      await api.diary.delete(id, entryId);
      showToastWithAction('观影记录已删除', '撤销', async () => {
        try {
          if (entryToDelete) {
            const restored = await api.diary.add(id, {
              watchDate: entryToDelete.watchDate,
              rating: entryToDelete.rating,
              review: entryToDelete.review || '',
            });
            setEntries((prev) => [...prev, restored]);
          }
        } catch { showToast('撤销失败'); }
      });
    } catch (err: any) {
      // 回滚
      if (entryToDelete) setEntries((prev) => [...prev, entryToDelete]);
      showToast(err.message || '删除失败');
    }
  }

  async function handleUpdateProgress() {
    if (!id) return;
    if (movie?.progress?.totalEpisodes && progressForm.episode >= movie.progress.totalEpisodes) {
      setShowProgress(false);
      setShowFinishWatching(true);
      return;
    }
    try {
      const updated = await api.movie.updateProgress(id, progressForm.episode);
      setMovie(updated);
      setShowProgress(false);
      showToast('进度已更新');
    } catch (err: any) {
      showToast(err.message || '更新失败');
    }
  }

  async function handleNextEpisode() {
    if (!id || !movie?.progress?.totalEpisodes) return;
    const p = movie.progress;
    const nextEp = Math.min(p.episode + 1, p.totalEpisodes);
    if (nextEp >= p.totalEpisodes) {
      setShowFinishWatching(true);
      return;
    }

    try {
      const updated = await api.movie.updateProgress(id, nextEp);
      setMovie(updated);
      setProgressForm({ episode: nextEp });
      showToast(`进度 第${nextEp}集`);
    } catch (err: any) {
      showToast(err.message || '更新失败');
    }
  }

  async function handleFinishWatching(data: FinishWatchingData) {
    if (!id) return;
    try {
      await api.watchlist.markAsWatched(id, {
        watchDate: getLocalDateStr(),
        rating: data.rating,
        review: data.review,
      });
      setShowFinishWatching(false);
      await loadMovie();
      showToast(data.saveRecord ? '观影记录已保存' : '已标记为已看完');
    } catch (err: any) {
      showToast(err.message || '操作失败');
    }
  }

  async function handleStatusChange(status: '在看' | '已看完' | '想看') {
    if (!id || !movie) return;
    try {
      const updated = await api.movie.update(id, {
        ...movie,
        status,
        progress: movie.progress,
      });
      setMovie(updated);
      showToast(`状态已更新为「${status}」`);
    } catch (err: any) {
      showToast(err.message || '更新失败');
    }
  }

  async function handleUploadScreenshots(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || !id) return;
    for (const file of Array.from(files)) {
      try {
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        const ext = '.' + ((file.name.split('.').pop()) || 'jpg');
        const updated = await api.movie.addScreenshot(id, dataUrl, ext);
        setScreenshots(updated);
      } catch (err: any) {
        showToast(err.message || '上传失败');
      }
    }
    e.target.value = '';
  }

  async function handleDeleteScreenshot(filename: string) {
    if (!id) return;
    try {
      const updated = await api.movie.deleteScreenshot(id, filename);
      setScreenshots(updated);
      // 清理编辑状态
      if (editingTimestampFile === filename) setEditingTimestampFile(null);
      // 如果删除的是灯箱中当前图片，关闭灯箱或调整索引
      if (lightboxIndex !== null && screenshots[lightboxIndex]?.filename === filename) {
        if (updated.length === 0) {
          setLightboxIndex(null);
        } else {
          setLightboxIndex(Math.min(lightboxIndex, updated.length - 1));
        }
      }
      showToast('截图已删除');
    } catch (err: any) {
      showToast(err.message || '删除失败');
    }
  }

  async function handleSaveTimestamp(filename: string) {
    if (!id) return;
    try {
      const info = {
        episode: parseInt(timestampForm.episode) || 1,
        hours: timestampForm.hours !== '' ? parseInt(timestampForm.hours) : undefined,
        minutes: timestampForm.minutes !== '' ? parseInt(timestampForm.minutes) : undefined,
        seconds: timestampForm.seconds !== '' ? parseInt(timestampForm.seconds) : undefined,
      };
      const updated = await api.movie.updateScreenshotInfo(id, filename, info);
      setScreenshots(updated);
      setEditingTimestampFile(null);
    } catch (err: any) {
      showToast(err.message || '保存失败');
    }
  }

  function startEditTimestamp(shot: ScreenshotInfo) {
    setTimestampForm({
      episode: String(shot.episode ?? 1),
      hours: shot.hours != null ? String(shot.hours) : '',
      minutes: shot.minutes != null ? String(shot.minutes) : '',
      seconds: shot.seconds != null ? String(shot.seconds) : '',
    });
    setEditingTimestampFile(shot.filename);
  }

  function formatTimestamp(shot: ScreenshotInfo): string {
    if (shot.episode == null) return '';
    const h = String(shot.hours ?? 0).padStart(2, '0');
    const m = String(shot.minutes ?? 0).padStart(2, '0');
    const s = String(shot.seconds ?? 0).padStart(2, '0');
    return `第${shot.episode}集 · ${h}:${m}:${s}`;
  }

  // 计算平均个人评分
  const avgPersonalRating = useMemo(() => {
    const rated = entries.filter(e => e.rating > 0);
    if (rated.length === 0) return null;
    const sum = rated.reduce((acc, e) => acc + e.rating, 0);
    return (sum / rated.length).toFixed(1);
  }, [entries]);

  if (!movie) {
    return <LoadingSkeleton rows={5} />;
  }

  const statusConfig: Record<string, { label: string; cls: string }> = {
    '在看': { label: '追剧中', cls: 'active-watching' },
    '已看完': { label: '已看完', cls: 'active-watched' },
    '想看': { label: '想看', cls: 'active-want' },
  };

  // 进度百分比 = 当前集 / 总集数
  const progressPercent = movie.progress?.totalEpisodes
    ? Math.round(movie.progress.episode / movie.progress.totalEpisodes * 100)
    : 0;

  const subtitle = [movie.releaseDate?.substring(0, 4), movie.director, movie.mediaType].filter(Boolean).join(' · ');

  return (
    <div>
      <Header title={movie.title} subtitle={subtitle} showAdd={false} />

      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="section-link mb-6"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="15 18 9 12 15 6"/></svg>
        返回
      </button>

      {/* Hero section */}
      <div className="detail-hero">
        {/* Poster */}
        <div className="detail-poster">
          {posterUrl ? (
            <img src={posterUrl} alt={movie.title} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-text-muted bg-bg-elevated">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-16 h-16">
                <rect x="2" y="2" width="20" height="20" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
              </svg>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="detail-info">
          {/* Original title */}
          {movie.titleOriginal && (
            <p className="detail-original-title">{movie.titleOriginal}</p>
          )}

          {/* Status switcher */}
          <div className="detail-status-switcher">
            {(['在看', '已看完', '想看'] as const).map((s) => (
              <button
                key={s}
                onClick={() => handleStatusChange(s)}
                className={`status-btn${movie.status === s ? ` ${statusConfig[s].cls}` : ''}`}
              >
                {statusConfig[s].label}
              </button>
            ))}
          </div>

          {/* Rating row */}
          <div className="detail-rating-row">
            <div className="detail-public-rating">
              <span className="rating-num">{movie.rating.toFixed(1)}</span>
              <span className="rating-label">公众评分</span>
            </div>
            {avgPersonalRating && (
              <>
                <div className="rating-divider" />
                <div className="detail-public-rating">
                  <span className="rating-num">{avgPersonalRating}</span>
                  <span className="rating-label">我的评分</span>
                </div>
              </>
            )}
          </div>

          {/* Meta grid */}
          <div className="detail-meta-grid">
            <div className="meta-item">
              <span className="meta-label">导演</span>
              <span className="meta-value">{movie.director}</span>
            </div>
            {movie.cast && movie.cast.length > 0 && (
              <div className="meta-item relative" ref={castRef}>
                <span className="meta-label">主演</span>
                <span className="meta-value">
                  {movie.cast.slice(0, 2).join(' / ')}
                  {movie.cast.length > 2 && (
                    <span
                      className="inline-flex items-center cursor-pointer text-text-muted hover:text-text-secondary ml-1 gap-0.5"
                      onClick={() => setCastOpen(!castOpen)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`w-3 h-3 transition-transform ${castOpen ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9"/></svg>
                      <span className="text-xs">{castOpen ? '收起' : '更多'}</span>
                    </span>
                  )}
                </span>
                {castOpen && movie.cast.length > 2 && (
                  <div className="absolute left-0 top-full z-50 mt-1 bg-bg-elevated border border-border rounded-lg shadow-lg p-3 min-w-[180px]">
                    <div className="text-xs text-text-secondary leading-relaxed">
                      {movie.cast.map((name, i) => (
                        <span key={name}>{name}{i < movie.cast.length - 1 ? ' / ' : ''}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="meta-item">
              <span className="meta-label">{movie.progress ? '首播' : '上映'}</span>
              <span className="meta-value">{movie.releaseDate}</span>
            </div>
            {movie.progress?.totalEpisodes ? (
              <div className="meta-item">
                <span className="meta-label">集数</span>
                <span className="meta-value">共{movie.progress.totalEpisodes}集</span>
              </div>
            ) : (
              <div className="meta-item">
                <span className="meta-label">片长</span>
                <span className="meta-value">{movie.runtime}分钟</span>
              </div>
            )}
            <div className="meta-item">
              <span className="meta-label">国家</span>
              <span className="meta-value">{movie.country}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">类型</span>
              <span className="meta-value">
                {[...movie.genre, ...movie.tags].join(' / ')}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="detail-actions">
            <button onClick={() => { setEditingEntryId(null); setDiaryForm({ watchDate: getLocalDateStr(), watchTime: nowTime(), rating: 0, review: '' }); setShowAddDiary(true); }} className="btn btn-primary">
              添加记录
            </button>
            <button onClick={() => navigate(`/movie/${id}/edit`)} className="btn btn-secondary">
              编辑
            </button>
            <button onClick={() => setShowDeleteConfirm(true)} className="btn btn-ghost btn-sm text-text-muted" title="删除" aria-label="删除影视">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Synopsis */}
      {movie.synopsis && (
        <div className="mt-9">
          <h3 className="section-title">剧情简介</h3>
          {movie.synopsis.split(/\n+/).filter(Boolean).map((para, i) => (
            <p key={i} className="detail-synopsis">{para}</p>
          ))}
        </div>
      )}

      {/* Screenshots Photo Wall */}
      <div
        className="mt-9"
        onMouseEnter={() => setWallHovered(true)}
        onMouseLeave={() => setWallHovered(false)}
      >
        {/* 滚动容器 */}
        <div className="relative">
          {/* 左箭头 */}
          {scrollPos.left && wallHovered && (
            <button
              onClick={() => scrollScreenshots('left')}
              aria-label="向左滚动"
              className="absolute -left-3 top-[45%] -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-bg-card border border-border text-text-secondary flex items-center justify-center shadow-md hover:bg-bg-elevated hover:text-text-primary transition-colors cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          )}

          <div
            ref={scrollRef}
            onScroll={updateScrollState}
            className="flex gap-3 overflow-x-auto"
            style={{ scrollbarWidth: 'none' }}
          >
          {screenshots.map((shot, i) => {
            const tsLabel = formatTimestamp(shot);
            const isEditing = editingTimestampFile === shot.filename;
            return (
            <div
              key={shot.filename}
              className="flex-shrink-0 flex flex-col gap-1.5"
              style={{ width: 'calc((100% - 1.5rem) / 3)' }}
            >
              <div
                className="relative aspect-video rounded-lg overflow-hidden border border-border cursor-pointer group bg-bg-elevated w-full"
                onClick={() => setLightboxIndex(i)}
              >
                {shot.thumbBase64 ? (
                  <img src={shot.thumbBase64} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-text-muted">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
                      <rect x="2" y="2" width="20" height="20" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                    </svg>
                  </div>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteScreenshot(shot.filename); }}
                  className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center text-sm opacity-0 group-hover:opacity-100 transition-opacity border-none cursor-pointer"
                  title="删除截图" aria-label="删除截图"
                >×</button>
              </div>

              {/* 时间戳区域 */}
              {isEditing ? (
                <div className="screenshot-timestamp-edit" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] text-text-muted">第</span>
                    <input
                      type="number" min={1} max={999} placeholder="1"
                      value={timestampForm.episode}
                      onChange={(e) => setTimestampForm({ ...timestampForm, episode: e.target.value })}
                      className="screenshot-timestamp-input"
                    />
                    <span className="text-[10px] text-text-muted">集</span>
                    <span className="text-[10px] text-text-muted mx-0.5">·</span>
                    <input
                      type="number" min={0} max={23} placeholder="0"
                      value={timestampForm.hours}
                      onChange={(e) => setTimestampForm({ ...timestampForm, hours: e.target.value })}
                      className="screenshot-timestamp-input"
                      style={{ width: 26 }}
                    />
                    <span className="text-[10px] text-text-muted">:</span>
                    <input
                      type="number" min={0} max={59} placeholder="0"
                      value={timestampForm.minutes}
                      onChange={(e) => setTimestampForm({ ...timestampForm, minutes: e.target.value })}
                      className="screenshot-timestamp-input"
                      style={{ width: 26 }}
                    />
                    <span className="text-[10px] text-text-muted">:</span>
                    <input
                      type="number" min={0} max={59} placeholder="0"
                      value={timestampForm.seconds}
                      onChange={(e) => setTimestampForm({ ...timestampForm, seconds: e.target.value })}
                      className="screenshot-timestamp-input"
                      style={{ width: 26 }}
                    />
                    <button
                      onClick={() => handleSaveTimestamp(shot.filename)}
                      className="w-5 h-5 rounded bg-accent text-white flex items-center justify-center border-none cursor-pointer flex-shrink-0"
                      title="保存" aria-label="保存时间戳"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={`screenshot-timestamp ${tsLabel ? '' : 'screenshot-timestamp-empty'}`}
                  onClick={(e) => { e.stopPropagation(); startEditTimestamp(shot); }}
                  title={tsLabel || '点击填写时间戳'}
                >
                  {tsLabel || '点击标注 · 第几集 时:分:秒'}
                </div>
              )}
            </div>
          )})}
          <label
            className="flex-shrink-0 cursor-pointer"
            style={{ width: 'calc((100% - 1.5rem) / 3)' }}
            onMouseEnter={() => setUploadHovered(true)}
            onMouseLeave={() => setUploadHovered(false)}
          >
            <div className="aspect-video rounded-lg border border-dashed border-border flex flex-col items-center justify-center hover:border-accent transition-colors gap-1 w-full">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-text-muted">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span className="text-xs text-text-muted">{uploadHovered ? 'Ctrl+V 粘贴' : '上传截图'}</span>
            </div>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleUploadScreenshots}
            />
          </label>
        </div>

          {/* 右箭头 */}
          {scrollPos.right && wallHovered && (
            <button
              onClick={() => scrollScreenshots('right')}
              aria-label="向右滚动"
              className="absolute -right-3 top-[45%] -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-bg-card border border-border text-text-secondary flex items-center justify-center shadow-md hover:bg-bg-elevated hover:text-text-primary transition-colors cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Screenshot Lightbox */}
      {lightboxIndex !== null && screenshots[lightboxIndex] && (
        <div
          className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center"
          onClick={() => setLightboxIndex(null)}
        >
          {/* 关闭按钮 */}
          <button
            onClick={() => setLightboxIndex(null)}
            aria-label="关闭灯箱"
            className="absolute top-5 right-5 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center border-none cursor-pointer hover:bg-white/20 transition-colors z-10"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>

          {/* 删除按钮 */}
          <button
            onClick={(e) => { e.stopPropagation(); handleDeleteScreenshot(screenshots[lightboxIndex].filename); }}
            className="absolute top-5 right-[4.5rem] w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center border-none cursor-pointer hover:bg-white/20 transition-colors z-10"
            title="删除" aria-label="删除截图"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>

          {/* 上一张 */}
          {lightboxIndex > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex - 1); }}
              aria-label="上一张"
              className="absolute left-5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center border-none cursor-pointer hover:bg-white/20 transition-colors z-10"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
          )}

          {/* 下一张 */}
          {lightboxIndex < screenshots.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex + 1); }}
              aria-label="下一张"
              className="absolute right-5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center border-none cursor-pointer hover:bg-white/20 transition-colors z-10"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          )}

          {/* 计数 */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/80 text-sm bg-black/40 px-3 py-1 rounded-full">
            {lightboxIndex + 1} / {screenshots.length}
          </div>

          {/* 大图（懒加载原图） */}
          <ScreenshotImage
            movieId={id!}
            filename={screenshots[lightboxIndex].filename}
            thumbSrc={screenshots[lightboxIndex].thumbBase64}
          />
        </div>
      )}

      {/* Progress Card */}
      {movie.progress?.totalEpisodes && (
        <div className="stat-card-contained mt-9">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-text-primary">追剧进度</span>
              <span className="text-xs text-text-muted">共 {movie.progress.totalEpisodes} 集</span>
            </div>
            <span className="text-xs font-semibold text-text-secondary bg-bg-elevated px-2 py-0.5 rounded-md border border-border">
              第{movie.progress.episode}集
            </span>
          </div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-text-muted w-10">总进度</span>
            <div className="stat-bar-bg flex-1" style={{ height: 18 }}><div className="stat-bar-fill" style={{width: `${progressPercent}%`}} /></div>
            <span className="text-xs text-text-secondary font-semibold w-8 text-right">{progressPercent}%</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowProgress(true)} className="btn btn-secondary btn-sm">
              更新进度
            </button>
            <button onClick={handleNextEpisode} className="btn btn-secondary btn-sm" title="下一集">
              下一集
            </button>
          </div>
        </div>
      )}

      {/* Diary entries */}
      <div className="diary-section mt-9">
        <div className="diary-section-header">
          <span className="diary-section-title">观影记录 ({entries.length})</span>
          <button onClick={() => { setEditingEntryId(null); setDiaryForm({ watchDate: getLocalDateStr(), watchTime: nowTime(), rating: 0, review: '' }); setShowAddDiary(true); }} className="btn btn-secondary btn-sm">
            添加
          </button>
        </div>
        {entries.length === 0 ? (
          <p className="text-text-muted text-sm py-4">暂无观影记录</p>
        ) : (
          <div>
            {(diaryExpanded || entries.length <= 5 ? entries : entries.slice(0, 5)).map((entry) => (
              <div key={entry.id} className="diary-entry">
                <div className="flex items-start gap-3">
                  {/* 海报缩略图 */}
                  <div className="w-10 h-[60px] min-w-[40px] rounded overflow-hidden border border-border flex-shrink-0">
                    {posterUrl ? (
                      <img src={posterUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-text-muted bg-bg-elevated">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                          <rect x="2" y="2" width="20" height="20" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="diary-entry-header">
                      <span className="diary-entry-date">{entry.watchDate}{entry.watchTime ? ` ${entry.watchTime}` : ''} 观看</span>
                      <div className="flex items-center gap-1.5">
                        {entry.rating > 0 && (
                          <div className="flex items-center gap-2">
                            <StarRating value={entry.rating} readOnly size={14} />
                            <span className="text-xs text-text-muted font-medium">{entry.rating}</span>
                          </div>
                        )}
                        <button
                          onClick={() => {
                            setEditingEntryId(entry.id);
                            setDiaryForm({
                              watchDate: entry.watchDate,
                              watchTime: entry.watchTime || '',
                              rating: entry.rating,
                              review: entry.review || '',
                            });
                            setShowAddDiary(true);
                          }}
                          className="text-text-muted hover:text-text-primary transition-colors bg-transparent border-none cursor-pointer p-1.5"
                          title="编辑此记录" aria-label="编辑此记录"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setDeletingEntryId(entry.id)}
                          className="text-text-muted hover:text-text-primary transition-colors bg-transparent border-none cursor-pointer p-1.5"
                          title="删除此记录" aria-label="删除此记录"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                    {entry.review && (
                      <p className="diary-entry-review">{entry.review}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {entries.length > 5 && (
              <button
                onClick={() => setDiaryExpanded(!diaryExpanded)}
                className="btn btn-secondary btn-sm mt-3"
              >
                {diaryExpanded ? '收起' : `展开全部 (${entries.length})`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add / Edit Diary Modal */}
      <Modal open={showAddDiary} onClose={() => { setShowAddDiary(false); }} title={editingEntryId ? '编辑观影记录' : '添加观影记录'} hideClose>
        <div className="flex flex-col gap-4">
          <div>
            <label className="form-label">观看日期</label>
            <p className="text-sm text-text-primary mt-0.5">{diaryForm.watchDate} {diaryForm.watchTime || ''}</p>
          </div>
          <div>
            <label className="form-label">个人评分 (0-10)</label>
            <StarRating value={diaryForm.rating} onChange={(v) => setDiaryForm({ ...diaryForm, rating: v })} size={28} />
          </div>
          <div>
            <label className="form-label">短评</label>
            <textarea value={diaryForm.review} onChange={(e) => setDiaryForm({ ...diaryForm, review: e.target.value })}
              rows={3} className="review-textarea resize-none" placeholder="写下你的感受..." />
          </div>
          <div className="flex justify-end gap-2.5 pt-2">
            <button onClick={() => { setShowAddDiary(false); }} className="btn btn-ghost">取消</button>
            <button onClick={editingEntryId ? handleUpdateDiary : handleAddDiary} className="btn btn-primary">
              {editingEntryId ? '更新' : '保存'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Update Progress Modal */}
      <Modal open={showProgress} onClose={() => setShowProgress(false)} title="更新追剧进度" width="380px" hideClose>
        <div className="flex flex-col gap-4">
          <div>
            <label className="form-label">当前集号</label>
            <input type="number" min={1} max={movie.progress?.totalEpisodes || 1} value={progressForm.episode}
              onChange={(e) => setProgressForm({ episode: Math.min(movie.progress?.totalEpisodes || 1, Math.max(1, Number(e.target.value) || 1)) })}
              className="form-input" />
          </div>
          {movie.progress?.totalEpisodes && (
            <div className="text-xs text-text-muted">
              共 {movie.progress.totalEpisodes} 集 · 当前第 {progressForm.episode} 集
            </div>
          )}
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                setProgressForm({ episode: movie.progress?.totalEpisodes || 1 });
              }}
              className="btn btn-ghost btn-sm"
              type="button"
            >
              全部看完
            </button>
            <div className="flex gap-2.5">
              <button onClick={() => setShowProgress(false)} className="btn btn-ghost">取消</button>
              <button onClick={handleUpdateProgress} className="btn btn-primary">更新</button>
            </div>
          </div>
        </div>
      </Modal>

      <FinishWatchingModal
        open={showFinishWatching}
        movieTitle={movie.title}
        onClose={() => setShowFinishWatching(false)}
        onComplete={handleFinishWatching}
      />

      {/* Delete Confirm */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="确认删除" width="400px" hideClose>
        <p className="text-text-secondary text-sm mb-5">确定要删除「{movie.title}」吗？此操作不可撤销。</p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setShowDeleteConfirm(false)} className="btn btn-ghost">取消</button>
          <button onClick={handleDelete} className="btn btn-danger btn-sm">删除</button>
        </div>
      </Modal>

      {/* Delete Diary Entry Confirm */}
      <Modal open={Boolean(deletingEntryId)} onClose={() => setDeletingEntryId(null)} title="删除观影记录" width="400px" hideClose>
        <p className="text-text-secondary text-sm mb-5">确定要删除这条观影记录吗？</p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setDeletingEntryId(null)} className="btn btn-ghost">取消</button>
          <button
            onClick={() => deletingEntryId && handleDeleteEntry(deletingEntryId)}
            className="btn btn-danger btn-sm"
          >
            删除
          </button>
        </div>
      </Modal>

    </div>
  );
}
