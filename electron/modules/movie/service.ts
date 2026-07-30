import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { dataStore } from '../../store/dataStore.js';
import { getMoviesDir, getMovieDir, getMetadataPath, getDiaryPath, getScreenshotsDir } from '../../utils/paths.js';
import { writeQueue } from '../../utils/writeQueue.js';
import { createPosterThumbnail, needsPosterThumbnailRegen } from '../../utils/thumbnail.js';
import { AppError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';
import { MovieMetadataSchema, CreateMovieInputSchema, UpdateMovieInputSchema } from '../../../shared/schemas/index.js';
import type { MovieMetadata, MovieSummary, DiaryEntry, MediaType, WatchStatus, Progress, SearchFilters, ScreenshotInfo } from '../../../shared/types/index.js';
import { getLocalDateStr } from '../../../shared/utils/date.js';

/** 从日记中计算某部影视的平均个人评分，无评分返回 null */
function getPersonalRating(movieId: string): number | null {
  const entries = dataStore.getDiary(movieId);
  if (!entries || entries.length === 0) return null;
  const rated = entries.filter(e => e.rating > 0);
  if (rated.length === 0) return null;
  return Math.round(rated.reduce((sum, e) => sum + e.rating, 0) / rated.length * 10) / 10;
}

function getLatestWatchDate(movieId: string): string {
  const entries = dataStore.getDiary(movieId);
  if (!entries || entries.length === 0) return '';
  return entries.reduce((latest, e) => e.watchDate > latest ? e.watchDate : latest, entries[0].watchDate);
}

/** 从标题和日期生成文件夹名 */
function makeFolderName(title: string, releaseDate?: string): string {
  const year = releaseDate ? releaseDate.split('-')[0] : null;
  return year ? `${title} (${year})` : title;
}

// 列表（支持筛选）
export function listMovies(filters?: {
  mediaType?: MediaType;
  status?: WatchStatus;
  genre?: string;
  tag?: string;
  year?: string;
}): MovieSummary[] {
  let movies = dataStore.getAllMovies();

  if (filters?.mediaType) {
    movies = movies.filter((m) => m.mediaType === filters.mediaType);
  }
  if (filters?.status) {
    movies = movies.filter((m) => m.status === filters.status);
  }
  if (filters?.genre) {
    movies = movies.filter((m) => m.genre.includes(filters.genre!));
  }
  if (filters?.tag) {
    movies = movies.filter((m) => m.tags.includes(filters.tag!));
  }
  if (filters?.year) {
    movies = movies.filter((m) => m.releaseDate.startsWith(filters.year!));
  }

  return movies.map((m) => ({
    id: m.id,
    title: m.title,
    titleOriginal: m.titleOriginal,
    mediaType: m.mediaType,
    rating: m.rating,
    personalRating: getPersonalRating(m.id),
    posterThumbPath: m.posterThumbPath,
    releaseDate: m.releaseDate,
    genre: m.genre,
    tags: m.tags,
    status: m.status,
    progress: m.progress,
    latestWatchDate: getLatestWatchDate(m.id) || undefined,
    createdAt: m.createdAt,
  }));
}

// 获取单部影视详情
export function getMovieById(id: string): MovieMetadata {
  const movie = dataStore.getMovie(id);
  if (!movie) {
    throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
  }
  return movie;
}

/** 将 base64 data URL 写入海报文件并生成缩略图 */
async function savePosterFromBase64(
  base64DataUrl: string,
  ext: string,
  movieDir: string
): Promise<{ posterPath: string; posterThumbPath: string }> {
  const base64Data = base64DataUrl.includes(',') ? base64DataUrl.split(',')[1] : base64DataUrl;
  const buffer = Buffer.from(base64Data, 'base64');
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
  const posterFilename = `poster${normalizedExt}`;
  const thumbFilename = `poster_thumb${normalizedExt}`;

  fs.writeFileSync(path.join(movieDir, posterFilename), buffer);

  // sharp Lanczos 缩放质量远高于浏览器，缩至 500 宽接近卡片显示尺寸
  try {
    await createPosterThumbnail(buffer, path.join(movieDir, thumbFilename));
  } catch {
    fs.writeFileSync(path.join(movieDir, thumbFilename), buffer);
  }

  return { posterPath: posterFilename, posterThumbPath: thumbFilename };
}

// 创建影视
export async function createMovie(
  data: Record<string, unknown>,
  posterFilePath?: string
): Promise<MovieMetadata> {
  const validated = CreateMovieInputSchema.parse(data);

  // 查重：相同标题 + 相同上映年份视为重复
  const inputYear = validated.releaseDate ? validated.releaseDate.split('-')[0] : null;
  const duplicate = dataStore.getAllMovies().find((m) => {
    const mYear = m.releaseDate ? m.releaseDate.split('-')[0] : null;
    return m.title === validated.title && mYear === inputYear;
  });
  if (duplicate) {
    throw new AppError(ErrorCode.MOVIE_DUPLICATE, `影视「${validated.title}」已存在`);
  }

  const id = uuidv4();
  const year = inputYear;
  const folderName = year ? `${validated.title} (${year})` : validated.title;
  const movieDir = getMovieDir(id, folderName);

  // 创建影视文件夹
  fs.mkdirSync(movieDir, { recursive: true });

  let posterPath: string | undefined;
  let posterThumbPath: string | undefined;

  // 处理海报（优先 base64 数据，其次文件路径）
  if (validated.posterBase64 && validated.posterExt) {
    const result = await savePosterFromBase64(validated.posterBase64, validated.posterExt, movieDir);
    posterPath = result.posterPath;
    posterThumbPath = result.posterThumbPath;
  } else if (posterFilePath && fs.existsSync(posterFilePath)) {
    const ext = path.extname(posterFilePath) || '.jpg';
    const posterFilename = `poster${ext}`;
    const thumbFilename = `poster_thumb${ext}`;

    fs.copyFileSync(posterFilePath, path.join(movieDir, posterFilename));
    posterPath = posterFilename;
    posterThumbPath = thumbFilename;

    try {
      await createPosterThumbnail(posterFilePath, path.join(movieDir, thumbFilename));
    } catch {
      fs.copyFileSync(posterFilePath, path.join(movieDir, thumbFilename));
    }
  }

  const metadata: MovieMetadata = {
    id,
    title: validated.title,
    titleOriginal: validated.titleOriginal,
    mediaType: validated.mediaType,
    director: validated.director,
    cast: validated.cast,
    releaseDate: validated.releaseDate,
    country: validated.country,
    genre: validated.genre,
    tags: validated.tags,
    runtime: validated.runtime,
    synopsis: validated.synopsis,
    rating: validated.rating,
    posterPath,
    posterThumbPath,
    status: validated.status,
    progress: validated.progress,
    createdAt: new Date().toISOString(),
  };

  // 写入 metadata.json
  const metadataPath = getMetadataPath(movieDir);
  await writeQueue.enqueue(metadataPath, async () => {
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  });

  // 创建空的 diary.json
  const diaryPath = getDiaryPath(movieDir);
  await writeQueue.enqueue(diaryPath, async () => {
    fs.writeFileSync(diaryPath, JSON.stringify([], null, 2), 'utf-8');
  });

  // 更新内存
  dataStore.setMovie(id, metadata);
  dataStore.setDiary(id, []);
  dataStore.updateMovieCount();

  return metadata;
}

// 更新影视
export async function updateMovie(
  id: string,
  data: Record<string, unknown>,
  posterFilePath?: string
): Promise<MovieMetadata> {
  const existing = dataStore.getMovie(id);
  if (!existing) {
    throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
  }

  // 白名单校验，防止覆盖 id/createdAt 等字段
  const validated = UpdateMovieInputSchema.parse(data);
  // 过滤 undefined 值，避免展开时覆盖已有字段（如 rewatchCount）
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(validated)) {
    if (v !== undefined) cleaned[k] = v;
  }
  const updated = { ...existing, ...cleaned, id: existing.id, createdAt: existing.createdAt };

  // 计算新旧文件夹名，如果标题或日期变化则迁移目录
  const oldFolderName = makeFolderName(existing.title, existing.releaseDate);
  const newFolderName = makeFolderName(updated.title, updated.releaseDate);
  const oldMovieDir = getMovieDir(id, oldFolderName);
  const newMovieDir = getMovieDir(id, newFolderName);

  if (oldFolderName !== newFolderName && fs.existsSync(oldMovieDir)) {
    fs.mkdirSync(path.dirname(newMovieDir), { recursive: true });
    try {
      fs.renameSync(oldMovieDir, newMovieDir);
    } catch {
      // renameSync 可能跨盘失败，回退到复制+删除
      try {
        (fs as any).cpSync(oldMovieDir, newMovieDir, { recursive: true });
      } catch {
        copyDirSync(oldMovieDir, newMovieDir);
      }
      fs.rmSync(oldMovieDir, { recursive: true, force: true });
    }
  }

  // 确保新目录存在
  fs.mkdirSync(newMovieDir, { recursive: true });

  // 处理海报更新（优先 base64 数据，其次文件路径）
  const posterBase64 = validated.posterBase64;
  const posterExt = validated.posterExt;
  if (posterBase64 && posterExt) {
    const result = await savePosterFromBase64(posterBase64, posterExt, newMovieDir);
    updated.posterPath = result.posterPath;
    updated.posterThumbPath = result.posterThumbPath;
  } else if (posterFilePath && fs.existsSync(posterFilePath)) {
    const ext = path.extname(posterFilePath) || '.jpg';
    const posterFilename = `poster${ext}`;
    const thumbFilename = `poster_thumb${ext}`;

    fs.copyFileSync(posterFilePath, path.join(newMovieDir, posterFilename));
    updated.posterPath = posterFilename;
    updated.posterThumbPath = thumbFilename;

    try {
      await createPosterThumbnail(posterFilePath, path.join(newMovieDir, thumbFilename));
    } catch {
      fs.copyFileSync(posterFilePath, path.join(newMovieDir, thumbFilename));
    }
  }

  // 状态变为已看完 → 自动将进度设为100%
  if (
    existing.status !== updated.status &&
    updated.status === '已看完' &&
    updated.progress?.totalEpisodes
  ) {
    updated.progress = {
      ...updated.progress,
      episode: updated.progress.totalEpisodes,
    };
  }

  // 写入文件
  const metadataPath = getMetadataPath(newMovieDir);
  await writeQueue.enqueue(metadataPath, async () => {
    fs.writeFileSync(metadataPath, JSON.stringify(updated, null, 2), 'utf-8');
  });

  dataStore.setMovie(id, updated);

  // 状态变更单独记录为系统事件，绝不占用或覆盖用户当天写下的日记。
  if (
    existing.status !== updated.status &&
    (updated.status === '在看' || updated.status === '已看完')
  ) {
    const today = getLocalDateStr();
    const diaryEntries = dataStore.getDiary(id);
    const review = `状态变更为「${updated.status}」`;
    if (!diaryEntries.some(e => e.watchDate === today && e.kind === 'status' && e.review === review)) {
      const now = new Date();
      const watchTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      diaryEntries.push({ id: uuidv4(), watchDate: today, watchTime, rating: -1, review, images: [], kind: 'status' });
      dataStore.setDiary(id, diaryEntries);
      const diaryPath = getDiaryPath(newMovieDir);
      await writeQueue.enqueue(diaryPath, async () => {
        fs.writeFileSync(diaryPath, JSON.stringify(diaryEntries, null, 2), 'utf-8');
      });
    }
  }

  return updated;
}

/** 递归复制目录（兼容旧 Node） */
function copyDirSync(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 删除影视
// 导出全部影视完整数据
export function getAllFullMovies(): MovieMetadata[] {
  return dataStore.getAllMovies();
}

/** 解析 CSV 一行，处理引号包裹字段 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      let field = '';
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          field += line[i];
          i++;
        }
      }
      fields.push(field);
      if (i < line.length && line[i] === ',') i++;
    } else {
      let field = '';
      while (i < line.length && line[i] !== ',') {
        field += line[i];
        i++;
      }
      fields.push(field);
      if (i < line.length && line[i] === ',') i++;
    }
  }
  return fields;
}

/** 解析 CSV 文本为二维数组 */
function parseCsv(csvText: string): string[][] {
  // 移除 BOM
  if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);
  // 统一换行符
  csvText = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = csvText.split('\n').filter((l) => l.trim());
  return lines.map(parseCsvLine);
}

/** 从 CSV 导入影视 */
export async function importMoviesFromCsv(csvText: string): Promise<{ imported: number; errors: string[] }> {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    throw new AppError(ErrorCode.IMPORT_FAILED, 'CSV 文件为空或格式不正确');
  }

  const headers = rows[0];
  const titleIdx = headers.indexOf('标题');
  const originalTitleIdx = headers.indexOf('原始标题');
  const typeIdx = headers.indexOf('类型');
  const statusIdx = headers.indexOf('状态');
  const directorIdx = headers.indexOf('导演');
  const castIdx = headers.indexOf('主演');
  const dateIdx = headers.indexOf('上映日期');
  const countryIdx = headers.indexOf('国家');
  const genreIdx = headers.indexOf('类型标签');
  const tagsIdx = headers.indexOf('自定义标签');
  const runtimeIdx = headers.indexOf('片长(分钟)');
  const synopsisIdx = headers.indexOf('简介');
  const ratingIdx = headers.indexOf('公众评分');

  if (titleIdx === -1) {
    throw new AppError(ErrorCode.IMPORT_FAILED, 'CSV 缺少"标题"列');
  }

  const result = { imported: 0, errors: [] as string[] };
  const validTypes = ['电影', '剧集', '综艺', '纪录片', '动画'];
  const validStatuses = ['在看', '已看完', '想看'];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    try {
      const title = (row[titleIdx] || '').trim();
      if (!title) {
        result.errors.push(`第 ${i + 1} 行：标题为空，已跳过`);
        continue;
      }

      const mediaType = row[typeIdx]?.trim() || '电影';
      const finalType = validTypes.includes(mediaType) ? mediaType : '电影';

      const status = row[statusIdx]?.trim() || '已看完';
      const finalStatus = validStatuses.includes(status) ? status : '已看完';

      let releaseDate = (row[dateIdx] || '').trim();
      if (releaseDate && /^\d{4}$/.test(releaseDate)) {
        releaseDate = `${releaseDate}-01-01`;
      }

      const genreStr = row[genreIdx] || '';
      const genre = genreStr ? genreStr.split('/').map((s: string) => s.trim()).filter(Boolean) : [];

      const tagsStr = row[tagsIdx] || '';
      const tags = tagsStr ? tagsStr.split('/').map((s: string) => s.trim()).filter(Boolean) : [];

      const castStr = row[castIdx] || '';
      const cast = castStr ? castStr.split('/').map((s: string) => s.trim()).filter(Boolean) : [];

      const runtime = parseInt(row[runtimeIdx], 10) || 0;
      const rating = Math.min(10, Math.max(0, parseFloat(row[ratingIdx]) || 0));

      const data: Record<string, unknown> = {
        title,
        titleOriginal: (row[originalTitleIdx] || '').trim() || undefined,
        mediaType: finalType,
        director: (row[directorIdx] || '').trim() || '未知',
        cast,
        releaseDate: releaseDate || '',
        country: (row[countryIdx] || '').trim() || '',
        genre,
        tags,
        runtime,
        synopsis: (row[synopsisIdx] || '').trim() || undefined,
        rating,
        status: finalStatus,
      };

      await createMovie(data);
      result.imported++;
    } catch (err: any) {
      result.errors.push(`第 ${i + 1} 行：${err.message}`);
    }
  }

  return result;
}

export async function deleteMovie(id: string): Promise<void> {
  const movie = dataStore.getMovie(id);
  if (!movie) {
    throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
  }

  const folderName = movie.releaseDate
    ? `${movie.title} (${movie.releaseDate.split('-')[0]})`
    : movie.title;
  const movieDir = getMovieDir(id, folderName);

  if (fs.existsSync(movieDir)) {
    fs.rmSync(movieDir, { recursive: true, force: true });
  }

  dataStore.removeMovie(id);
  dataStore.updateMovieCount();
}

// 搜索影视（支持可选的年份/评分过滤）
export function searchMovies(query: string, filters?: SearchFilters): MovieSummary[] {
  const q = query.toLowerCase();

  return dataStore.getAllMovies()
    .filter((m) => {
      // 文本匹配：空查询时跳过文本匹配（仅凭 filters 筛选）
      if (q !== '') {
        const textMatch =
          m.title.toLowerCase().includes(q) ||
          (m.titleOriginal && m.titleOriginal.toLowerCase().includes(q)) ||
          m.director.toLowerCase().includes(q) ||
          m.cast.some((c) => c.toLowerCase().includes(q)) ||
          m.genre.some((g) => g.toLowerCase().includes(q)) ||
          m.tags.some((t) => t.toLowerCase().includes(q));
        if (!textMatch) return false;
      }

      // 年份过滤
      if (filters?.year && !m.releaseDate.startsWith(filters.year)) return false;

      // 评分过滤（基于个人评分）
      if (filters?.minRating != null || filters?.maxRating != null) {
        const pr = getPersonalRating(m.id);
        if (filters?.minRating != null && (pr == null || pr < filters.minRating)) return false;
        if (filters?.maxRating != null && (pr == null || pr > filters.maxRating)) return false;
      }

      return true;
    })
    .map((m) => ({
      id: m.id,
      title: m.title,
      titleOriginal: m.titleOriginal,
      mediaType: m.mediaType,
      rating: m.rating,
      personalRating: getPersonalRating(m.id),
      posterThumbPath: m.posterThumbPath,
      releaseDate: m.releaseDate,
      genre: m.genre,
      tags: m.tags,
      status: m.status,
      progress: m.progress,
      latestWatchDate: getLatestWatchDate(m.id) || undefined,
      rewatchCount: m.rewatchCount,
      createdAt: m.createdAt,
    }));
}

// 更新剧集进度
export async function updateProgress(
  id: string,
  episode: number
): Promise<MovieMetadata> {
  const movie = dataStore.getMovie(id);
  if (!movie) {
    throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
  }

  if (!movie.progress?.totalEpisodes) {
    throw new AppError(ErrorCode.PROGRESS_INVALID, '该影视不支持进度追踪');
  }

  const updatedProgress: Progress = {
    ...movie.progress,
    episode: Math.min(episode, movie.progress.totalEpisodes),
  };

  const updated = {
    ...movie,
    progress: updatedProgress,
  };

  const folderName = makeFolderName(updated.title, updated.releaseDate);
  const movieDir = getMovieDir(id, folderName);
  const metadataPath = getMetadataPath(movieDir);
  await writeQueue.enqueue(metadataPath, async () => {
    fs.writeFileSync(metadataPath, JSON.stringify(updated, null, 2), 'utf-8');
  });

  dataStore.setMovie(id, updated);

  // 每一次进度更新都保留为独立事件；手动日记同样不会被触碰。
  const today = getLocalDateStr();
  const diaryEntries = dataStore.getDiary(id);
  const review = `第${episode}集 · 进度 ${Math.round((episode / movie.progress.totalEpisodes) * 100)}%`;
  const now = new Date();
  const watchTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  diaryEntries.push({ id: uuidv4(), watchDate: today, watchTime, rating: -1, review, images: [], kind: 'progress' });

  dataStore.setDiary(id, diaryEntries);
  const diaryPath = getDiaryPath(movieDir);
  await writeQueue.enqueue(diaryPath, async () => {
    fs.writeFileSync(diaryPath, JSON.stringify(diaryEntries, null, 2), 'utf-8');
  });

  return updated;
}

// 添加标签
export async function addTag(id: string, tag: string): Promise<MovieMetadata> {
  const movie = dataStore.getMovie(id);
  if (!movie) {
    throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
  }

  if (movie.tags.includes(tag)) return movie;

  const updated = { ...movie, tags: [...movie.tags, tag] };
  const folderName = makeFolderName(updated.title, updated.releaseDate);
  const movieDir = getMovieDir(id, folderName);
  const metadataPath = getMetadataPath(movieDir);
  await writeQueue.enqueue(metadataPath, async () => {
    fs.writeFileSync(metadataPath, JSON.stringify(updated, null, 2), 'utf-8');
  });

  dataStore.setMovie(id, updated);
  return updated;
}

// 移除标签
export async function removeTag(id: string, tag: string): Promise<MovieMetadata> {
  const movie = dataStore.getMovie(id);
  if (!movie) {
    throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
  }

  const updated = { ...movie, tags: movie.tags.filter((t) => t !== tag) };
  const folderName = makeFolderName(updated.title, updated.releaseDate);
  const movieDir = getMovieDir(id, folderName);
  const metadataPath = getMetadataPath(movieDir);
  await writeQueue.enqueue(metadataPath, async () => {
    fs.writeFileSync(metadataPath, JSON.stringify(updated, null, 2), 'utf-8');
  });

  dataStore.setMovie(id, updated);
  return updated;
}

// 获取海报 base64（带内存缓存）
export function getPosterBase64(id: string, thumb: boolean = false): string | null {
  const movie = dataStore.getMovie(id);
  if (!movie) {
    return null;
  }

  const filename = thumb ? movie.posterThumbPath : movie.posterPath;
  if (!filename) {
    return null;
  }

  // 检查缓存
  const cacheKey = `${id}:${thumb ? 'thumb' : 'full'}:${filename}`;
  const cached = dataStore.getPoster(cacheKey);
  if (cached) return cached;

  const folderName = makeFolderName(movie.title, movie.releaseDate);
  const movieDir = getMovieDir(id, folderName);
  const posterPath = path.join(movieDir, filename);

  if (!fs.existsSync(posterPath)) {
    return null;
  }

  try {
    const ext = path.extname(filename).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const data = fs.readFileSync(posterPath);
    const base64Url = `data:${mimeType};base64,${data.toString('base64')}`;
    dataStore.setPoster(cacheKey, base64Url);
    return base64Url;
  } catch {
    return null;
  }
}

// 获取所有标签
export function getAllTags(): string[] {
  const tagSet = new Set<string>();
  dataStore.getAllMovies().forEach((m) => {
    m.tags.forEach((t) => tagSet.add(t));
  });
  return Array.from(tagSet).sort();
}

// 静默迁移：从原图重建所有缩略图（App 启动时自动执行）
let thumbnailMigrationDone = false;
export async function migrateThumbnails(): Promise<void> {
  if (thumbnailMigrationDone) return;
  thumbnailMigrationDone = true;

  const movies = dataStore.getAllMovies();
  let count = 0;

  for (const movie of movies) {
    if (!movie.posterPath) continue;
    try {
      const folderName = makeFolderName(movie.title, movie.releaseDate);
      const movieDir = getMovieDir(movie.id, folderName);
      const posterPath = path.join(movieDir, movie.posterPath);
      if (!fs.existsSync(posterPath)) continue;

      const ext = path.extname(movie.posterPath) || '.jpg';
      const thumbFilename = `poster_thumb${ext}`;
      const thumbPath = path.join(movieDir, thumbFilename);

      const needsRegen = await needsPosterThumbnailRegen(thumbPath);

      if (needsRegen) {
        await createPosterThumbnail(posterPath, thumbPath);
        // 统一 posterThumbPath（兼容旧数据）
        if (movie.posterThumbPath !== thumbFilename) {
          movie.posterThumbPath = thumbFilename;
          const metadataPath = getMetadataPath(movieDir);
          await writeQueue.enqueue(metadataPath, async () => {
            fs.writeFileSync(metadataPath, JSON.stringify(movie, null, 2), 'utf-8');
          });
        }
        count++;
      }
    } catch {
      // 静默跳过，单个失败不影响
    }
  }

}

// ==================== 截图管理 ====================

/** 截图时间戳元数据（存储在 screenshots.json 中） */
interface ScreenshotMetaEntry {
  episode?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

type ScreenshotMetaMap = Record<string, ScreenshotMetaEntry>;

function getMovieDirById(id: string): string {
  const movie = dataStore.getMovie(id);
  if (!movie) throw new AppError(ErrorCode.MOVIE_NOT_FOUND, '影视不存在');
  const folderName = makeFolderName(movie.title, movie.releaseDate);
  return getMovieDir(id, folderName);
}

function getScreenshotsMetaPath(screenshotsDir: string): string {
  return path.join(screenshotsDir, 'screenshots.json');
}

/** 读取截图元数据文件 */
function readScreenshotsMeta(screenshotsDir: string): ScreenshotMetaMap {
  const metaPath = getScreenshotsMetaPath(screenshotsDir);
  if (!fs.existsSync(metaPath)) return {};
  try {
    const raw = fs.readFileSync(metaPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // 防御：解析结果可能为 null 或非对象
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/** 写入截图元数据文件 */
function writeScreenshotsMeta(screenshotsDir: string, meta: ScreenshotMetaMap): void {
  const metaPath = getScreenshotsMetaPath(screenshotsDir);
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

/** 列出所有截图，返回缩略图 base64 + 元数据 */
export function listScreenshots(id: string, cachedMeta?: ScreenshotMetaMap): ScreenshotInfo[] {
  const movieDir = getMovieDirById(id);
  const screenshotsDir = getScreenshotsDir(movieDir);

  if (!fs.existsSync(screenshotsDir)) return [];

  const files = fs.readdirSync(screenshotsDir);
  // 筛出非缩略图的文件（不含 _thumb 后缀），也排除 screenshots.json
  const originals = files.filter(f => !f.includes('_thumb') && f !== 'screenshots.json');

  // 读取元数据（可复用已加载的缓存，避免重复磁盘读取）
  const meta = cachedMeta ?? readScreenshotsMeta(screenshotsDir);

  return originals.map(filename => {
    const ext = path.extname(filename);
    const baseName = path.basename(filename, ext);
    const thumbFilename = `${baseName}_thumb${ext}`;
    const thumbPath = path.join(screenshotsDir, thumbFilename);

    let thumbBase64 = '';
    if (fs.existsSync(thumbPath)) {
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const data = fs.readFileSync(thumbPath);
      thumbBase64 = `data:${mimeType};base64,${data.toString('base64')}`;
    }

    const entry = meta[filename];
    return {
      filename,
      thumbBase64,
      episode: entry?.episode,
      hours: entry?.hours,
      minutes: entry?.minutes,
      seconds: entry?.seconds,
    };
  });
}

/** 更新截图的时间戳元数据，返回更新后列表 */
export function updateScreenshotInfo(
  id: string,
  filename: string,
  info: ScreenshotMetaEntry
): ScreenshotInfo[] {
  const movieDir = getMovieDirById(id);
  const screenshotsDir = getScreenshotsDir(movieDir);

  const meta = readScreenshotsMeta(screenshotsDir);
  meta[filename] = info;
  writeScreenshotsMeta(screenshotsDir, meta);

  // 复用已加载的 meta 避免 listScreenshots 重复读盘
  return listScreenshots(id, meta);
}

/** 添加截图（base64 → 文件 + 缩略图），返回更新后列表 */
export async function addScreenshot(id: string, base64Data: string, ext: string): Promise<ScreenshotInfo[]> {
  const movieDir = getMovieDirById(id);
  const screenshotsDir = getScreenshotsDir(movieDir);
  fs.mkdirSync(screenshotsDir, { recursive: true });

  // 确定下一个序号
  const existing = fs.readdirSync(screenshotsDir).filter(f => !f.includes('_thumb') && f !== 'screenshots.json');
  let maxNum = 0;
  for (const f of existing) {
    const match = f.match(/^shot_(\d+)\./);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  const nextNum = maxNum + 1;
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
  const filename = `shot_${String(nextNum).padStart(3, '0')}${normalizedExt}`;
  const baseName = `shot_${String(nextNum).padStart(3, '0')}`;
  const thumbFilename = `${baseName}_thumb${normalizedExt}`;

  // 保存原图
  const base64Raw = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const buffer = Buffer.from(base64Raw, 'base64');
  fs.writeFileSync(path.join(screenshotsDir, filename), buffer);

  // 生成缩略图
  try {
    const sharp = (await import('sharp')).default;
    await sharp(buffer)
      .resize(500, 281, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toFile(path.join(screenshotsDir, thumbFilename));
  } catch {
    fs.writeFileSync(path.join(screenshotsDir, thumbFilename), buffer);
  }

  return listScreenshots(id);
}

/** 删除截图（含缩略图 + 元数据），返回更新后列表 */
export function deleteScreenshot(id: string, filename: string): ScreenshotInfo[] {
  const movieDir = getMovieDirById(id);
  const screenshotsDir = getScreenshotsDir(movieDir);

  const filePath = path.join(screenshotsDir, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  // 删除对应缩略图
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext);
  const thumbPath = path.join(screenshotsDir, `${baseName}_thumb${ext}`);
  if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

  // 清理元数据
  const meta = readScreenshotsMeta(screenshotsDir);
  if (meta[filename]) {
    delete meta[filename];
    writeScreenshotsMeta(screenshotsDir, meta);
  }

  return listScreenshots(id);
}

/** 获取原图 base64（灯箱查看） */
export function getScreenshotBase64(id: string, filename: string): string | null {
  const movieDir = getMovieDirById(id);
  const screenshotsDir = getScreenshotsDir(movieDir);
  const filePath = path.join(screenshotsDir, filename);

  if (!fs.existsSync(filePath)) return null;

  const ext = path.extname(filename).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const data = fs.readFileSync(filePath);
  return `data:${mimeType};base64,${data.toString('base64')}`;
}
