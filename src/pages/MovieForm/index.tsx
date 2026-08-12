import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '@/lib/api';
import { getSegmentInputWidth } from '@/lib/segmentInput';
import type { MediaType, WatchStatus, Progress, TmdbSearchResult } from '@shared/types/index';
import { showToast } from '@/components/common/Toast';
import Header from '@/components/layout/Header';
import CustomSelect from '@/components/common/CustomSelect';
import CustomDatePicker from '@/components/common/CustomDatePicker';
import AppIcon from '@/components/common/AppIcon';

const GENRE_OPTIONS = [
  '动作', '冒险', '喜剧', '犯罪',
  '剧情', '家庭', '奇幻', '历史',
  '恐怖', '音乐', '悬疑', '爱情', '科幻', '古装', '真人秀',
  '惊悚', '战争', '西部',
];

const EMPTY_FORM = {
  title: '',
  titleOriginal: '',
  mediaType: '电影' as MediaType,
  director: '',
  cast: '',
  releaseDate: '',
  country: '',
  genre: [] as string[],
  tags: [] as string[],
  runtime: 0,
  synopsis: '',
  rating: 0,
  status: '想看' as WatchStatus,
  progress: null as Progress | null,
};

export default function MovieForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEditing = Boolean(id);

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [posterBase64, setPosterBase64] = useState<string | undefined>(undefined);
  const [posterExt, setPosterExt] = useState<string>('.jpg');
  const [posterPreview, setPosterPreview] = useState<string | null>(null);
  const [existingPosterUrl, setExistingPosterUrl] = useState<string | null>(null);
  const [isPosterDragging, setIsPosterDragging] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialForm, setInitialForm] = useState<string>('');
  const [tmdbQuery, setTmdbQuery] = useState('');
  const [tmdbResults, setTmdbResults] = useState<TmdbSearchResult[]>([]);
  const [tmdbSearching, setTmdbSearching] = useState(false);
  const [tmdbImportingId, setTmdbImportingId] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    (async () => {
      try {
        const movie = await api.movie.getById(id);
        setForm({
          title: movie.title,
          titleOriginal: movie.titleOriginal || '',
          mediaType: movie.mediaType,
          director: movie.director,
          cast: (movie.cast || []).join('、'),
          releaseDate: movie.releaseDate,
          country: movie.country,
          genre: movie.genre,
          tags: movie.tags,
          runtime: movie.runtime,
          synopsis: movie.synopsis || '',
          rating: movie.rating,
          status: movie.status,
          progress: movie.progress,
        });
        if (movie.posterPath) {
          const url = await api.movie.getPosterUrl(id);
          if (url) setExistingPosterUrl(url);
        }
        setInitialForm(JSON.stringify({
          title: movie.title, titleOriginal: movie.titleOriginal || '',
          mediaType: movie.mediaType, director: movie.director,
          cast: (movie.cast || []).join('、'),
          releaseDate: movie.releaseDate, country: movie.country,
          genre: movie.genre, tags: movie.tags, runtime: movie.runtime,
          synopsis: movie.synopsis || '', rating: movie.rating,
          status: movie.status, progress: movie.progress,
        }));
      } catch (err: any) {
        showToast(err.message || '加载失败');
        navigate('/');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const hasChanges = useMemo(() => {
    if (!initialForm) return false;
    const current = JSON.stringify({
      title: form.title, titleOriginal: form.titleOriginal,
      mediaType: form.mediaType, director: form.director,
      cast: form.cast,
      releaseDate: form.releaseDate, country: form.country,
      genre: form.genre, tags: form.tags, runtime: form.runtime,
      synopsis: form.synopsis, rating: form.rating,
      status: form.status, progress: form.progress,
    });
    return current !== initialForm || posterBase64 !== undefined;
  }, [form, initialForm, posterBase64]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasChanges) { e.preventDefault(); }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

  function handleGoBack() {
    if (hasChanges) {
      const ok = window.confirm('有未保存的修改，确定要离开吗？');
      if (!ok) return;
    }
    navigate(-1);
  }

  function handlePosterFile(file: File) {
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const ext = file.name.includes('.')
        ? `.${file.name.split('.').pop()?.toLowerCase()}`
        : ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.type] || '.jpg');
      if (posterPreview) URL.revokeObjectURL(posterPreview);
      setPosterBase64(dataUrl);
      setPosterExt(ext);
      setPosterPreview(dataUrl);
      setExistingPosterUrl(null);
    };
    reader.onerror = () => showToast('读取图片失败，请重试');
    reader.readAsDataURL(file);
  }

  function handlePosterSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handlePosterFile(file);
    // 允许再次选择同一张图片。
    e.target.value = '';
  }

  function handlePosterDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsPosterDragging(false);
    const file = Array.from(e.dataTransfer.files).find((item) => item.type.startsWith('image/'));
    if (file) handlePosterFile(file);
    else showToast('请拖入图片文件');
  }

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;

      const file = Array.from(e.clipboardData?.files || []).find((item) => item.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      handlePosterFile(file);
      showToast('已粘贴海报');
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  function handleRemovePoster() {
    if (posterPreview) URL.revokeObjectURL(posterPreview);
    setPosterBase64(undefined);
    setPosterExt('.jpg');
    setPosterPreview(null);
    setExistingPosterUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleTmdbSearch() {
    const query = tmdbQuery.trim();
    if (!query) {
      showToast('请输入片名后再搜索');
      return;
    }
    try {
      setTmdbSearching(true);
      setTmdbResults(await api.tmdb.search(query));
    } catch (err: any) {
      showToast(err.message || 'TMDB 搜索失败');
    } finally {
      setTmdbSearching(false);
    }
  }

  async function handleTmdbImport(result: TmdbSearchResult) {
    try {
      setTmdbImportingId(result.id);
      const details = await api.tmdb.getDetails(result.mediaType, result.id);
      const progress = details.totalEpisodes
        ? { episode: 0, totalEpisodes: details.totalEpisodes }
        : null;
      setForm((current) => ({
        ...current,
        title: details.title,
        titleOriginal: details.titleOriginal || '',
        mediaType: details.mediaType,
        director: details.director || '',
        cast: details.cast.join('、'),
        releaseDate: details.releaseDate,
        country: details.country,
        genre: details.genre,
        runtime: details.runtime,
        synopsis: details.synopsis,
        rating: details.rating,
        progress,
      }));

      if (details.posterPath) {
        const poster = await api.tmdb.getPoster(details.posterPath);
        if (poster.dataUrl) {
          const imageType = poster.dataUrl.match(/^data:image\/([^;]+)/)?.[1];
          const ext = imageType === 'png' ? '.png' : imageType === 'webp' ? '.webp' : '.jpg';
          setPosterBase64(poster.dataUrl);
          setPosterExt(ext);
          setPosterPreview(poster.dataUrl);
          setExistingPosterUrl(null);
        }
      }
      setTmdbResults([]);
      showToast('已填充 TMDB 信息，请确认后保存');
    } catch (err: any) {
      showToast(err.message || '导入 TMDB 信息失败');
    } finally {
      setTmdbImportingId(null);
    }
  }

  function toggleGenre(g: string) {
    setForm((f) => ({
      ...f,
      genre: f.genre.includes(g) ? f.genre.filter((x) => x !== g) : [...f.genre, g],
    }));
  }

  function addTag() {
    const tag = tagInput.trim();
    if (!tag || form.tags.includes(tag)) return;
    setForm({ ...form, tags: [...form.tags, tag] });
    setTagInput('');
  }

  function removeTag(tag: string) {
    setForm({ ...form, tags: form.tags.filter((t) => t !== tag) });
  }

  async function handleSave() {
    if (!form.title.trim()) { showToast('标题不能为空'); return; }
    try {
      const movieData = {
        ...form,
        cast: form.cast ? form.cast.split(/[、,，/]/).map((s: string) => s.trim()).filter(Boolean) : [],
        posterBase64: posterBase64 || undefined,
        posterExt: posterBase64 ? posterExt : undefined,
      };
      if (isEditing && id) {
        await api.movie.update(id, movieData);
        showToast('更新成功');
        navigate(-1);
      } else {
        const movie = await api.movie.create(movieData);
        showToast('添加成功');
        navigate(`/movie/${movie.id}`, { replace: true });
      }
    } catch (err: any) {
      showToast(err.message || '保存失败');
    }
  }

  if (loading) {
    return (
      <div>
        <Header title={isEditing ? '编辑影视' : '添加影视'} subtitle="加载中..." showAdd={false} />
        <div className="text-text-muted text-sm py-20 text-center">加载中...</div>
      </div>
    );
  }

  const shownPoster = posterPreview || existingPosterUrl;

  return (
    <div>
      <Header title={isEditing ? '编辑影视' : '添加影视'} subtitle={isEditing ? '修改影视信息与进度' : '记录一部新的影视'} showAdd={false} />

      <button onClick={handleGoBack} className="section-link mb-6">
        <AppIcon name="chevronLeft" className="w-3.5 h-3.5" />
        返回
      </button>

      {/* 两栏布局：左海报 + 右表单 */}
      <div className="form-layout">
        {/* 左栏：海报 */}
        <div className="form-poster-col">
          <div
            className={`form-poster-zone${shownPoster ? ' has-poster' : ''}${isPosterDragging ? ' is-dragging' : ''}`}
            onClick={() => !shownPoster && fileInputRef.current?.click()}
            onDragEnter={(e) => { e.preventDefault(); setIsPosterDragging(true); }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsPosterDragging(false);
            }}
            onDrop={handlePosterDrop}
          >
            {shownPoster ? (
              <img src={shownPoster} alt="海报预览" className="form-poster-img" />
            ) : (
              <div className="form-poster-empty">
                <AppIcon name="image" className="w-12 h-12" />
                <span>{isPosterDragging ? '松开以上传海报' : '点击或拖入图片上传'}</span>
              </div>
            )}
          </div>
          {shownPoster && (
            <div className="form-poster-actions">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="form-poster-btn">更换</button>
              <button type="button" onClick={handleRemovePoster} className="form-poster-btn form-poster-btn-danger">移除</button>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePosterSelect} className="hidden" />
        </div>

        {/* 右栏：表单字段 */}
        <div className="form-fields-col">
          <div className="form-section-card">
            <div className="form-section-title">从 TMDB 导入</div>
            <div className="flex gap-2">
              <input
                type="search"
                value={tmdbQuery}
                onChange={(e) => setTmdbQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleTmdbSearch(); } }}
                className="form-input flex-1"
                placeholder="输入片名，例如：星际穿越"
                aria-label="搜索 TMDB"
              />
              <button type="button" onClick={() => void handleTmdbSearch()} disabled={tmdbSearching} className="btn btn-secondary whitespace-nowrap">
                {tmdbSearching ? '搜索中...' : '搜索'}
              </button>
            </div>
            {tmdbResults.length > 0 && (
              <div className="mt-3 max-h-64 overflow-y-auto border-t border-border divide-y divide-border">
                {tmdbResults.map((result) => (
                  <button
                    key={`${result.mediaType}-${result.id}`}
                    type="button"
                    onClick={() => void handleTmdbImport(result)}
                    disabled={tmdbImportingId !== null}
                    className="w-full flex items-center justify-between gap-3 py-2.5 text-left bg-transparent border-none cursor-pointer hover:text-accent disabled:cursor-wait"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{result.title}</span>
                      <span className="block text-xs text-text-muted truncate">{result.titleOriginal || '无原始标题'} · {result.releaseDate.slice(0, 4) || '日期未知'} · {result.mediaType}</span>
                    </span>
                    <span className="text-xs text-text-muted whitespace-nowrap">{tmdbImportingId === result.id ? '导入中...' : `${result.rating || '—'} 分`}</span>
                  </button>
                ))}
              </div>
            )}
            {!tmdbSearching && tmdbQuery.trim() && tmdbResults.length === 0 && (
              <p className="mt-2 text-xs text-text-muted">搜索后会在此处显示结果。</p>
            )}
          </div>

          {/* 基本信息 */}
          <div className="form-section-card basic-info-card">
            <div className="form-section-title">基本信息</div>
            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="form-label" htmlFor="form-title">标题 *</label>
                <input id="form-title" type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="form-input" placeholder="星际穿越" />
              </div>
              <div>
                <label className="form-label" htmlFor="form-title-original">原始标题</label>
                <input id="form-title-original" type="text" value={form.titleOriginal} onChange={(e) => setForm({ ...form, titleOriginal: e.target.value })} className="form-input" placeholder="Interstellar" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="form-label" htmlFor="form-director">导演</label>
                <input id="form-director" type="text" value={form.director} onChange={(e) => setForm({ ...form, director: e.target.value })} className="form-input" placeholder="克里斯托弗·诺兰" />
              </div>
              <div>
                <label className="form-label">上映日期</label>
                <CustomDatePicker value={form.releaseDate} onChange={(v) => setForm({ ...form, releaseDate: v })} />
              </div>
            </div>
            <div>
              <label className="form-label" htmlFor="form-cast">主演</label>
              <input id="form-cast" type="text" value={form.cast} onChange={(e) => setForm({ ...form, cast: e.target.value })} className="form-input" placeholder={'多个主演用 / 号分隔'} />
            </div>
            <div className="grid grid-cols-3 gap-5">
              <div>
                <label className="form-label">类型</label>
                <CustomSelect
                  value={form.mediaType}
                  onChange={(v) => setForm({ ...form, mediaType: v as MediaType })}
                  options={[
                    { label: '电影', value: '电影' },
                    { label: '剧集', value: '剧集' },
                    { label: '纪录片', value: '纪录片' },
                    { label: '综艺', value: '综艺' },
                    { label: '动画', value: '动画' },
                  ]}
                />
              </div>
              <div>
                <label className="form-label">状态</label>
                <CustomSelect
                  value={form.status}
                  onChange={(v) => {
                    const status = v as WatchStatus;
                    setForm({
                      ...form,
                      status,
                      progress: status === '想看' && form.progress ? { ...form.progress, episode: 0 } : form.progress,
                    });
                  }}
                  options={[
                    { label: '已看完', value: '已看完' },
                    { label: '追剧中', value: '在看' },
                    { label: '想看', value: '想看' },
                  ]}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="form-country">国家</label>
                <input id="form-country" type="text" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="form-input" placeholder="美国 / 英国 / 加拿大" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="form-label" htmlFor="form-runtime">片长</label>
                <input id="form-runtime" type="number" value={form.runtime || ''} onChange={(e) => setForm({ ...form, runtime: Number(e.target.value) })} className="form-input" placeholder="169分钟" />
              </div>
              <div>
                <label className="form-label" htmlFor="form-rating">评分</label>
                <div className="rating-input-wrap">
                  <input id="form-rating" type="number" step="0.1" min="0" max="10" value={form.rating || ''} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} className="form-input flex-1" placeholder="9.4" />
                  {form.rating > 0 && (
                    <span className="rating-stars-preview" title={`${form.rating} 分`}>
                      {(() => {
                        const stars = Math.round(form.rating / 2);
                        return Array.from({ length: 5 }, (_, i) => (
                          <svg key={i} viewBox="0 0 24 24" fill={i < stars ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
                          </svg>
                        ));
                      })()}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 剧集进度 */}
          <div className="form-section-card">
            <div className="form-section-title">剧集信息</div>
            <label className="flex items-center gap-2 cursor-pointer select-none" onClick={() => {
              if (form.progress) {
                setForm({ ...form, progress: null });
              } else if (form.mediaType === '综艺') {
                setForm({ ...form, progress: { episode: 0, totalEpisodes: 1, segments: [''] } });
              } else {
                setForm({ ...form, progress: { episode: form.status === '想看' ? 0 : 1, totalEpisodes: 1 } });
              }
            }}>
              <div className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${form.progress ? 'bg-accent border-accent' : 'border-border'}`}>
                {form.progress && (
                  <AppIcon name="check" className="w-2.5 h-2.5" />
                )}
              </div>
              多集
            </label>
            {form.progress && (() => {
              const p = form.progress!;
              const isVariety = form.mediaType === '综艺';

              if (isVariety) {
                const segs = p.segments || [''];
                return (
                  <div className="mt-4">
                    <label className="form-label">进度条目</label>
                    <div className="flex flex-wrap gap-2">
                      {segs.map((label, i) => (
                        <div key={i} className="relative group">
                          <input
                            type="text"
                            value={label}
                            onChange={(e) => {
                              const newSegs = [...segs];
                              newSegs[i] = e.target.value;
                              setForm({ ...form, progress: { ...p, segments: newSegs, episode: newSegs.filter(s => s.trim()).length, totalEpisodes: newSegs.length } });
                            }}
                            className={`min-w-[48px] px-3.5 h-8 text-center text-xs rounded border outline-none focus-visible:outline-none focus-visible:rounded ${label.trim() ? 'bg-accent border-accent text-white' : 'bg-bg-elevated border-border'}`}
                            style={{ width: getSegmentInputWidth(label) }}
                            placeholder={`#${i + 1}`}
                          />
                          <button
                            onClick={() => {
                              const newSegs = segs.filter((_, j) => j !== i);
                              if (newSegs.length === 0) newSegs.push('');
                              setForm({ ...form, progress: { ...p, segments: newSegs, episode: newSegs.filter(s => s.trim()).length, totalEpisodes: newSegs.length } });
                            }}
                            className={`absolute top-0 right-0.5 text-xs border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity bg-transparent leading-none ${label.trim() ? 'text-white' : 'text-[#e53e3e]'}`}
                          >×</button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const newSegs = [...segs, ''];
                          setForm({ ...form, progress: { ...p, segments: newSegs, totalEpisodes: newSegs.length } });
                        }}
                        className="w-8 h-8 rounded border border-dashed border-border text-text-muted hover:border-accent hover:text-accent transition-colors flex items-center justify-center bg-transparent cursor-pointer"
                      >+</button>
                    </div>
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-2 gap-5 mt-4">
                  <div>
                    <label className="form-label">总集数</label>
                    <input type="number" min="1" value={p.totalEpisodes} onChange={(e) => {
                      const total = Math.max(1, Number(e.target.value) || 1);
                      setForm({ ...form, progress: { totalEpisodes: total, episode: Math.min(p.episode, total) } });
                    }} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">当前集号</label>
                    <input type="number" min="0" max={p.totalEpisodes} value={p.episode} onChange={(e) => {
                      const ep = Math.min(p.totalEpisodes, Math.max(0, Number(e.target.value) || 0));
                      setForm({ ...form, progress: { ...p, episode: ep } });
                    }} className="form-input" />
                  </div>
                </div>
              );
            })()}
          </div>

          {/* 类型标签 */}
          <div className="form-section-card">
            <div className="form-section-title">分类标签</div>
            <div className="flex flex-wrap gap-1.5">
              {GENRE_OPTIONS.map((g) => (
                <button key={g} type="button" onClick={() => toggleGenre(g)} className={`tag tag-selectable${form.genre.includes(g) ? ' selected' : ''}`}>{g}</button>
              ))}
            </div>
            <div>
              <label className="form-label">自定义标签</label>
              <div className="flex gap-2">
                <input type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} placeholder="输入标签后回车添加" className="form-tag-input" />
                <button type="button" onClick={addTag} className="btn btn-secondary btn-sm form-tag-add-btn">添加</button>
              </div>
            </div>
            {form.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {form.tags.map((t) => (
                  <span key={t} onClick={() => removeTag(t)} className="tag tag-accent cursor-pointer">{t} ×</span>
                ))}
              </div>
            )}
          </div>

          {/* 简介 */}
          <div className="form-section-card">
            <div className="form-section-title">简介</div>
            <textarea id="form-synopsis" value={form.synopsis} onChange={(e) => setForm({ ...form, synopsis: e.target.value })} rows={4} className="review-textarea resize-none" placeholder="输入影视简介..." aria-label="简介" />
          </div>

          {/* 操作 — sticky 底部栏 */}
          <div className="form-actions-bar">
            <button type="button" onClick={handleGoBack} className="btn btn-ghost">取消</button>
            <button type="button" onClick={handleSave} className="btn btn-primary">{isEditing ? '保存修改' : '保存'}</button>
          </div>
        </div>
      </div>

    </div>
  );
}
