import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { getSegmentInputWidth } from '@/lib/segmentInput';
import type { MovieMetadata, DiaryEntry, WatchRecord, ScreenshotInfo } from '@shared/types/index';
import { getLocalDateStr, getLocalTimeStr } from '@shared/utils/date';
import StarRating from '@/components/common/StarRating';
import Modal from '@/components/common/Modal';

import { showToast, showToastWithAction } from '@/components/common/Toast';
import LoadingSkeleton from '@/components/common/LoadingSkeleton';
import ScreenshotImage from '@/components/common/ScreenshotImage';
import ScreenshotThumbnail from '@/components/common/ScreenshotThumbnail';
import FinishWatchingModal, { type FinishWatchingData } from '@/components/movie/FinishWatchingModal';
import AppIcon from '@/components/common/AppIcon';

export default function MovieDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [movie, setMovie] = useState<MovieMetadata | null>(null);
  const [entries, setEntries] = useState<WatchRecord[]>([]);
  const [diaryEntries, setDiaryEntries] = useState<DiaryEntry[]>([]);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [showAddDiary, setShowAddDiary] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [showFinishWatching, setShowFinishWatching] = useState(false);
  const [updatingProgress, setUpdatingProgress] = useState(false);
  const [localSegs, setLocalSegs] = useState<string[] | null>(null);
  const localSegsRef = useRef(localSegs);
  localSegsRef.current = localSegs;
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [deletingDiaryEntryId, setDeletingDiaryEntryId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [diaryExpanded, setDiaryExpanded] = useState(false);
  const [recordsExpanded, setRecordsExpanded] = useState(false);
  const [diaryForm, setDiaryForm] = useState({ watchDate: getLocalDateStr(), watchTime: getLocalTimeStr(), rating: 0, review: '' });
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
  const [uploadingScreenshots, setUploadingScreenshots] = useState(false);
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
    if (movie?.mediaType === '综艺' && movie.progress) {
      if (movie.progress.segments) {
        setLocalSegs([...movie.progress.segments]);
      } else {
        // 兼容没有 segments 字段的旧综艺数据
        setLocalSegs(Array(movie.progress.totalEpisodes || 1).fill(''));
      }
    }
  }, [movie?.mediaType, movie?.progress?.segments, movie?.progress?.totalEpisodes]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    void loadMovie(() => active);
    return () => { active = false; };
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

  // 裁剪窗口不接触云端凭据；由当前已登录的渲染进程将图片上传到 PocketBase。
  useEffect(() => {
    const unsub = window.electronAPI?.onScreenshotCropped?.((movieId, dataUrl) => {
      if (movieId !== id) return;
      void api.movie.addScreenshot(movieId, dataUrl, '.png')
        .then((updated) => {
          setScreenshots(updated);
          window.electronAPI?.showScreenToast?.('截图已保存，并已同步到云端');
        })
        .catch((err: any) => window.electronAPI?.showScreenToast?.(err?.message || '截图上传失败'));
    });
    return () => { unsub?.(); };
  }, [id]);

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

  async function loadMovie(isActive: () => boolean = () => true) {
    if (!id) return;
    try {
      // 首屏只依赖影片本身；日记、追剧记录和截图在下方独立补齐，避免其中一项
      // 网络慢或失败时让整个详情页持续骨架屏。
      const movieData = await api.movie.getById(id);
      if (!isActive()) return;
      setMovie(movieData);
      // 加载海报
      if (movieData.posterPath) {
        void api.movie.getPosterUrl(id, true).then((url) => {
          if (isActive()) setPosterUrl(url);
        }).catch(() => {});
      } else {
        setPosterUrl(null);
      }
      if (movieData.progress) {
        setProgressForm({ episode: movieData.progress.episode });
      }

      void Promise.allSettled([
        api.diary.getByMovie(id),
        api.watchRecord.getByMovie(id),
        api.movie.listScreenshots(id),
      ]).then(([diaries, records, shots]) => {
        if (!isActive()) return;
        if (diaries.status === 'fulfilled') setDiaryEntries(diaries.value);
        if (records.status === 'fulfilled') setEntries(records.value);
        if (shots.status === 'fulfilled') setScreenshots(shots.value);
      });
    } catch (err: any) {
      if (isActive()) showToast(err.message || '加载失败');
    }
  }

  async function refreshDiary() {
    if (!id) return;
    try {
      setDiaryEntries(await api.diary.getByMovie(id));
    } catch {
      // 日记刷新失败不影响刚刚保存的影视状态或进度。
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
      const entry = await api.watchRecord.add(id, { ...diaryForm, watchTime: diaryForm.watchTime || getLocalTimeStr() });
      setEntries((prev) => [entry, ...prev]);
      setShowAddDiary(false);
      setDiaryForm({ watchDate: getLocalDateStr(), watchTime: getLocalTimeStr(), rating: 0, review: '' });
      showToast('追剧记录已添加');
    } catch (err: any) {
      showToast(err.message || '添加失败');
    }
  }

  async function handleUpdateDiary() {
    if (!id || !editingEntryId) return;
    try {
      const updated = await api.watchRecord.update(id, editingEntryId, { ...diaryForm, watchTime: diaryForm.watchTime || getLocalTimeStr() });
      setEntries((prev) => prev.map((e) => (e.id === editingEntryId ? updated : e)));
      setShowAddDiary(false);
      setEditingEntryId(null);
      setDiaryForm({ watchDate: getLocalDateStr(), watchTime: getLocalTimeStr(), rating: 0, review: '' });
      showToast('追剧记录已更新');
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
      await api.watchRecord.delete(id, entryId);
      showToastWithAction('追剧记录已删除', '撤销', async () => {
        try {
          if (entryToDelete) {
            const restored = await api.watchRecord.add(id, {
              watchDate: entryToDelete.watchDate,
              watchTime: entryToDelete.watchTime,
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

  async function handleDeleteDiaryEntry(entryId: string) {
    if (!id) return;
    const entryToDelete = diaryEntries.find((entry) => entry.id === entryId);
    try {
      setDiaryEntries((prev) => prev.filter((entry) => entry.id !== entryId));
      setDeletingDiaryEntryId(null);
      await api.diary.delete(id, entryId);
      showToast('观影日记已删除');
    } catch (err: any) {
      if (entryToDelete) setDiaryEntries((prev) => [...prev, entryToDelete]);
      showToast(err.message || '删除失败');
    }
  }

  async function handleUpdateProgress() {
    if (!id) return;
    const totalEpisodes = movie?.progress?.totalEpisodes;
    const reachingLast = Boolean(totalEpisodes && progressForm.episode >= totalEpisodes);
    const targetEpisode = reachingLast ? totalEpisodes! : progressForm.episode;
    try {
      // 先持久化进度，再弹出「看完了？」弹窗；取消弹窗不会丢失已到达最后一集的进度。
      const updated = await api.movie.updateProgress(id, targetEpisode);
      setMovie(updated);
      setProgressForm({ episode: updated.progress?.episode ?? targetEpisode });
      setShowProgress(false);
      void refreshDiary();
      if (reachingLast) {
        setShowFinishWatching(true);
      } else {
        showToast('进度已更新');
      }
    } catch (err: any) {
      showToast(err.message || '更新失败');
    }
  }

  async function handleNextEpisode() {
    if (!id || !movie?.progress?.totalEpisodes || updatingProgress) return;
    const p = movie.progress;
    const nextEp = Math.min(p.episode + 1, p.totalEpisodes);
    const reachingLast = nextEp >= p.totalEpisodes;

    const previousMovie = movie;
    setMovie({ ...movie, progress: { ...p, episode: nextEp } });
    setProgressForm({ episode: nextEp });
    setUpdatingProgress(true);
    try {
      const updated = await api.movie.updateProgress(id, nextEp);
      setMovie(updated);
      void refreshDiary();
      if (reachingLast) {
        // 进度已更新到最后一集，弹窗仅用于补录评分/短评；取消不会丢进度。
        setShowFinishWatching(true);
      } else {
        showToast(`进度 第${nextEp}集`);
      }
    } catch (err: any) {
      setMovie(previousMovie);
      setProgressForm({ episode: p.episode });
      showToast(err.message || '更新失败');
    } finally {
      setUpdatingProgress(false);
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
      showToast(data.saveRecord ? '追剧记录已保存' : '已标记为已看完');
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
      void refreshDiary();
      showToast(`状态已更新为「${status}」`);
    } catch (err: any) {
      showToast(err.message || '更新失败');
    }
  }

  async function handleUploadScreenshots(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files || !id) return;
    const maxFileSize = 30 * 1024 * 1024;
    if (files.length > 20) {
      showToast('一次最多上传 20 张截图');
      e.target.value = '';
      return;
    }
    const validFiles = files.filter((file) => file.type.startsWith('image/') && file.size <= maxFileSize);
    if (validFiles.length !== files.length) showToast('已跳过非图片或超过 30 MB 的文件');
    if (!validFiles.length) {
      e.target.value = '';
      return;
    }
    setUploadingScreenshots(true);
    let failures = 0;
    const upload = async (file: File) => {
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
          reader.readAsDataURL(file);
        });
        const ext = '.' + ((file.name.split('.').pop()) || 'jpg');
        await api.movie.addScreenshot(id, dataUrl, ext);
      } catch {
        failures++;
      }
    };
    try {
      for (let offset = 0; offset < validFiles.length; offset += 3) {
        await Promise.all(validFiles.slice(offset, offset + 3).map(upload));
      }
      setScreenshots(await api.movie.listScreenshots(id));
      showToast(failures ? `${validFiles.length - failures} 张已上传，${failures} 张失败` : `已上传 ${validFiles.length} 张截图`);
    } finally {
      setUploadingScreenshots(false);
      e.target.value = '';
    }
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
    const parseValue = (value: string, min: number, max: number, label: string): number | undefined => {
      if (value === '') return undefined;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label}应在 ${min}-${max} 之间`);
      return parsed;
    };
    try {
      const info = {
        episode: parseValue(timestampForm.episode || '1', 1, 999, '集数') || 1,
        hours: parseValue(timestampForm.hours, 0, 23, '小时'),
        minutes: parseValue(timestampForm.minutes, 0, 59, '分钟'),
        seconds: parseValue(timestampForm.seconds, 0, 59, '秒数'),
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

  return (
    <div>
      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="section-link mb-6"
      >
        <AppIcon name="chevronLeft" className="w-3.5 h-3.5" />
        返回
      </button>

      {/* Hero section */}
      <div className="detail-hero">
        {/* Poster */}
        <div className="detail-poster">
          {posterUrl ? (
            <img src={posterUrl} alt={movie.title} decoding="async" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-text-muted bg-bg-elevated">
              <AppIcon name="image" className="w-16 h-16" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="detail-info">
          {/* Title + actions */}
          <div className="flex items-baseline gap-3 mb-6">
            <p className="detail-original-title !mb-0">{movie.title}</p>
            <button onClick={() => navigate(`/movie/${id}/edit`)} className="text-text-muted hover:text-text-primary transition-colors bg-transparent border-none cursor-pointer p-1" title="编辑" aria-label="编辑">
              <AppIcon name="edit" className="w-4 h-4" />
            </button>
          </div>
          {movie.titleOriginal && (
            <p className="text-text-muted text-sm -mt-2 mb-6">{movie.titleOriginal}</p>
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
            {movie.director && (
              <div className="meta-item">
                <span className="meta-label">导演</span>
                <span className="meta-value">{movie.director}</span>
              </div>
            )}
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
                      <AppIcon name="chevronDown" className={`w-3 h-3 transition-transform ${castOpen ? 'rotate-180' : ''}`} />
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
            {movie.releaseDate && (
              <div className="meta-item">
                <span className="meta-label">{movie.progress ? '首播' : '上映'}</span>
                <span className="meta-value">{movie.releaseDate}</span>
              </div>
            )}
            {movie.progress?.totalEpisodes ? (
              <div className="meta-item">
                <span className="meta-label">集数</span>
                <span className="meta-value">共{movie.progress.totalEpisodes}集</span>
              </div>
            ) : movie.runtime > 0 ? (
              <div className="meta-item">
                <span className="meta-label">片长</span>
                <span className="meta-value">{movie.runtime}分钟</span>
              </div>
            ) : null}
            {movie.country && (
              <div className="meta-item">
                <span className="meta-label">国家</span>
                <span className="meta-value">{movie.country}</span>
              </div>
            )}
            {[...movie.genre, ...movie.tags].length > 0 && (
              <div className="meta-item">
                <span className="meta-label">类型</span>
                <span className="meta-value">
                  {[...movie.genre, ...movie.tags].join(' / ')}
                </span>
              </div>
            )}
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
              <AppIcon name="chevronLeft" className="w-4 h-4" />
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
                <ScreenshotThumbnail
                  movieId={id!}
                  filename={shot.filename}
                  alt=""
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
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
                      <AppIcon name="check" className="w-3 h-3" />
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
              <AppIcon name="add" className="w-6 h-6 text-text-muted" />
              <span className="text-xs text-text-muted">{uploadHovered ? 'Ctrl+V 粘贴' : '上传截图'}</span>
            </div>
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={uploadingScreenshots}
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
              <AppIcon name="chevronRight" className="w-4 h-4" />
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
            <AppIcon name="close" className="w-5 h-5" />
          </button>

          {/* 删除按钮 */}
          <button
            onClick={(e) => { e.stopPropagation(); handleDeleteScreenshot(screenshots[lightboxIndex].filename); }}
            className="absolute top-5 right-[4.5rem] w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center border-none cursor-pointer hover:bg-white/20 transition-colors z-10"
            title="删除" aria-label="删除截图"
          >
            <AppIcon name="trash" className="w-4 h-4" />
          </button>

          {/* 上一张 */}
          {lightboxIndex > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex - 1); }}
              aria-label="上一张"
              className="absolute left-5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center border-none cursor-pointer hover:bg-white/20 transition-colors z-10"
            >
              <AppIcon name="chevronLeft" className="w-5 h-5" />
            </button>
          )}

          {/* 下一张 */}
          {lightboxIndex < screenshots.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex + 1); }}
              aria-label="下一张"
              className="absolute right-5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center border-none cursor-pointer hover:bg-white/20 transition-colors z-10"
            >
              <AppIcon name="chevronRight" className="w-5 h-5" />
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
          />
        </div>
      )}

      {/* Progress Card — 综艺：自定义标签块 */}
      {movie.mediaType === '综艺' && localSegs && (() => {
        const segs = localSegs;
        const filled = segs.filter(s => s.trim()).length;
        const saveSegs = async (newSegs: string[]) => {
          const updated = await api.movie.update(id!, {
            ...movie,
            progress: { ...movie.progress!, segments: newSegs, episode: newSegs.filter(s => s.trim()).length, totalEpisodes: newSegs.length },
          });
          setMovie(updated);
          void refreshDiary();
        };
        return (
          <div className="stat-card-contained mt-9">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-text-primary">追剧进度</span>
                <span className="text-xs text-text-muted">{filled}/{segs.length} 已看</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              {segs.map((label, i) => (
                <div key={i} className="relative group">
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => {
                      const newSegs = [...segs];
                      newSegs[i] = e.target.value;
                      setLocalSegs(newSegs);
                    }}
                    onBlur={(e) => {
                      const val = e.target.value;
                      if (val !== (movie.progress!.segments?.[i] || '')) {
                        const newSegs = [...localSegsRef.current!];
                        newSegs[i] = val;
                        void saveSegs(newSegs);
                      }
                    }}
                    className={`min-w-[48px] px-3.5 h-7 text-center text-xs rounded border outline-none focus-visible:outline-none focus-visible:rounded transition-colors ${label.trim() ? 'bg-accent border-accent text-white' : 'bg-bg-elevated border-border text-text-muted'}`}
                    style={{ width: getSegmentInputWidth(label) }}
                    placeholder={`#${i + 1}`}
                  />
                  <button
                    onClick={() => {
                      const newSegs = segs.filter((_, j) => j !== i);
                      if (newSegs.length === 0) newSegs.push('');
                      setLocalSegs(newSegs);
                      void saveSegs(newSegs);
                    }}
                    className={`absolute top-0 right-0.5 text-xs border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity bg-transparent leading-none ${label.trim() ? 'text-white' : 'text-[#e53e3e]'}`}
                  >×</button>
                </div>
              ))}
              <button
                onClick={() => {
                  const newSegs = [...segs, ''];
                  setLocalSegs(newSegs);
                  void saveSegs(newSegs);
                }}
                className="w-7 h-7 rounded border border-dashed border-border text-text-muted hover:border-accent hover:text-accent transition-colors flex items-center justify-center text-sm bg-transparent cursor-pointer"
                title="添加条目"
              >+</button>
            </div>
          </div>
        );
      })()}

      {/* Progress Card — 剧集：分段进度条 */}
      {movie.mediaType !== '综艺' && movie.progress?.totalEpisodes ? (
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
            <span className="text-xs text-text-muted w-10 flex-shrink-0">进度</span>
            <div className="flex flex-1 gap-[3px]">
              {Array.from({ length: movie.progress.totalEpisodes }, (_, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-sm transition-colors duration-200 ${i < movie.progress!.episode ? 'bg-accent' : 'bg-border'}`}
                  style={{ height: 9 }}
                />
              ))}
            </div>
            <span className="text-xs text-text-secondary font-semibold w-8 text-right flex-shrink-0">{progressPercent}%</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowProgress(true)} className="btn btn-secondary btn-sm">
              更新进度
            </button>
            <button onClick={handleNextEpisode} className="btn btn-secondary btn-sm" title="下一集" disabled={updatingProgress}>
              下一集
            </button>
          </div>
        </div>
      ) : null}

      {/* Watch records */}
      <div className="diary-section mt-9">
        <div className="diary-section-header">
          <span className="diary-section-title">追剧记录 ({entries.length})</span>
          <button onClick={() => { setEditingEntryId(null); setDiaryForm({ watchDate: getLocalDateStr(), watchTime: getLocalTimeStr(), rating: 0, review: '' }); setShowAddDiary(true); }} className="btn btn-secondary btn-sm">
            添加
          </button>
        </div>
        {entries.length === 0 ? (
          <p className="text-text-muted text-sm py-4">暂无追剧记录</p>
        ) : (
          <div>
            {(recordsExpanded || entries.length <= 5 ? entries : entries.slice(0, 5)).map((entry) => (
              <div key={entry.id} className="diary-entry">
                <div className="flex items-start gap-3">
                  {/* 海报缩略图 */}
                  <div className="w-10 h-[60px] min-w-[40px] rounded overflow-hidden border border-border flex-shrink-0">
                    {posterUrl ? (
                      <img src={posterUrl} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-text-muted bg-bg-elevated">
                        <AppIcon name="image" className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="diary-entry-header">
                      <span className="diary-entry-date">{entry.watchDate}{entry.watchTime ? ` ${entry.watchTime}` : ''} 记录</span>
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
                          title="编辑此追剧记录" aria-label="编辑此追剧记录"
                        >
                          <AppIcon name="edit" className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeletingEntryId(entry.id)}
                          className="text-text-muted hover:text-text-primary transition-colors bg-transparent border-none cursor-pointer p-1.5"
                          title="删除此追剧记录" aria-label="删除此追剧记录"
                        >
                          <AppIcon name="close" className="w-4 h-4" />
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
                onClick={() => setRecordsExpanded(!recordsExpanded)}
                className="btn btn-secondary btn-sm mt-3"
              >
                {recordsExpanded ? '收起' : `展开全部 (${entries.length})`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Automatic diary */}
      <div className="diary-section mt-9">
        <div className="diary-section-header">
          <span className="diary-section-title">观影日记 ({diaryEntries.length})</span>
        </div>
        {diaryEntries.length === 0 ? (
          <p className="text-text-muted text-sm py-4">暂无自动观影日记</p>
        ) : (
          <div>
            {(diaryExpanded || diaryEntries.length <= 5 ? diaryEntries : diaryEntries.slice(0, 5)).map((entry) => (
              <div key={entry.id} className="diary-entry">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-[60px] min-w-[40px] rounded overflow-hidden border border-border flex-shrink-0">
                    {posterUrl ? (
                      <img src={posterUrl} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-text-muted bg-bg-elevated">
                        <AppIcon name="image" className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="diary-entry-header">
                      <span className="diary-entry-date">
                        {entry.watchDate}{entry.watchTime ? ` ${entry.watchTime}` : ''}
                      </span>
                      <button
                        onClick={() => setDeletingDiaryEntryId(entry.id)}
                        className="text-text-muted hover:text-text-primary transition-colors bg-transparent border-none cursor-pointer p-1.5"
                        title="删除此观影日记" aria-label="删除此观影日记"
                      >
                        <AppIcon name="close" className="w-4 h-4" />
                      </button>
                    </div>
                    {entry.review && (
                      <p className="diary-entry-review">{entry.review}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {diaryEntries.length > 5 && (
              <button
                onClick={() => setDiaryExpanded(!diaryExpanded)}
                className="btn btn-secondary btn-sm mt-3"
              >
                {diaryExpanded ? '收起' : `展开全部 (${diaryEntries.length})`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add / Edit Watch Record Modal */}
      <Modal open={showAddDiary} onClose={() => { setShowAddDiary(false); }} title={editingEntryId ? '编辑追剧记录' : '添加追剧记录'}>
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
      <Modal open={showProgress} onClose={() => setShowProgress(false)} title="更新追剧进度" width="380px">
        <div className="flex flex-col gap-4">
          <div>
            <label className="form-label">当前集号</label>
            <input type="number" min={0} max={movie.progress?.totalEpisodes || 1} value={progressForm.episode}
              onChange={(e) => setProgressForm({ episode: Math.min(movie.progress?.totalEpisodes || 1, Math.max(0, Number(e.target.value) || 0)) })}
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
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="确认删除" width="400px">
        <p className="text-text-secondary text-sm mb-5">确定要删除「{movie.title}」吗？此操作不可撤销。</p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setShowDeleteConfirm(false)} className="btn btn-ghost">取消</button>
          <button onClick={handleDelete} className="btn btn-danger">删除</button>
        </div>
      </Modal>

      {/* Delete Watch Record Confirm */}
      <Modal open={Boolean(deletingEntryId)} onClose={() => setDeletingEntryId(null)} title="删除追剧记录" width="400px">
        <p className="text-text-secondary text-sm mb-5">确定要删除这条追剧记录吗？</p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setDeletingEntryId(null)} className="btn btn-ghost">取消</button>
          <button
            onClick={() => deletingEntryId && handleDeleteEntry(deletingEntryId)}
            className="btn btn-danger"
          >
            删除
          </button>
        </div>
      </Modal>

      <Modal open={Boolean(deletingDiaryEntryId)} onClose={() => setDeletingDiaryEntryId(null)} title="删除观影日记" width="400px">
        <p className="text-text-secondary text-sm mb-5">确定要删除这条观影日记吗？</p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setDeletingDiaryEntryId(null)} className="btn btn-ghost">取消</button>
          <button
            onClick={() => deletingDiaryEntryId && handleDeleteDiaryEntry(deletingDiaryEntryId)}
            className="btn btn-danger"
          >
            删除
          </button>
        </div>
      </Modal>

    </div>
  );
}
