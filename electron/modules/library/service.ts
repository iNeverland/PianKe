import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { z } from 'zod';
import { dataStore } from '../../store/dataStore.js';
import { setLibraryRoot, getLibraryRoot, getMoviesDir, getWatchRecordsPath } from '../../utils/paths.js';
import { writeQueue } from '../../utils/writeQueue.js';
import { AppError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';
import { migrateThumbnails } from '../movie/service.js';
import { LibraryInfoSchema, MovieMetadataSchema, DiaryEntrySchema, WatchRecordSchema } from '../../../shared/schemas/index.js';
import type { LibraryInfo, MovieSummary, DiaryEntry, WatchRecord } from '../../../shared/types/index.js';

const LATEST_VERSION = 4;

/** 迁移函数：每个函数处理一个版本的升级 */
const MIGRATIONS: Record<number, (movie: any) => void> = {
  // v1 → v2：Progress 旧格式 {totalSeasons, totalEpisodes} → 新格式 {seasonEpisodes}
  2: (movie: any) => {
    if (movie.progress && typeof movie.progress.totalSeasons === 'number' && !Array.isArray(movie.progress.seasonEpisodes)) {
      movie.progress.seasonEpisodes = Array(movie.progress.totalSeasons).fill(movie.progress.totalEpisodes);
      delete movie.progress.totalSeasons;
      delete movie.progress.totalEpisodes;
    }
  },
  // v2 → v3：Progress 多季格式 {season, episode, seasonEpisodes} → 单集格式 {episode, totalEpisodes}
  3: (movie: any) => {
    const p = movie.progress;
    if (p && Array.isArray(p.seasonEpisodes)) {
      const totalEpisodes = p.seasonEpisodes.reduce((a: number, b: number) => a + b, 0);
      let watched = p.episode || 0;
      for (let i = 0; i < (p.season || 1) - 1; i++) {
        watched += p.seasonEpisodes[i] || 0;
      }
      movie.progress = { episode: watched, totalEpisodes };
    }
  },
  // v3 → v4：手动感想从 diary.json 拆分到 watch-records.json。
  4: () => {},
};

/** 对单个电影数据按序执行迁移 */
function migrateMovie(movie: any, fromVersion: number): void {
  for (let v = fromVersion + 1; v <= LATEST_VERSION; v++) {
    if (MIGRATIONS[v]) MIGRATIONS[v](movie);
  }
}

// 打开已有库
export async function openLibrary(dirPath: string): Promise<LibraryInfo> {
  const libJsonPath = path.join(dirPath, 'library.json');
  if (!fs.existsSync(libJsonPath)) {
    throw new AppError(ErrorCode.LIBRARY_INVALID, '该文件夹不是有效的 PianKe 资源库');
  }

  try {
    const raw = fs.readFileSync(libJsonPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const info = LibraryInfoSchema.parse(parsed);

    setLibraryRoot(dirPath);
    dataStore.clear();
    dataStore.setLibraryInfo(info);

    // 异步生成图标，不阻塞
    generateFolderIcon(dirPath).catch(err => console.error('[folder-icon] async generation failed:', err));

    const fromVersion = info.version || 1;
    await loadAllMovies(fromVersion);
    dataStore.setLoaded();

    // 缩略图迁移放到后台异步执行，不阻塞 UI 展示
    void migrateThumbnails().catch(err => console.error('[thumbnail] background migration failed:', err));

    // 如果需要迁移，同步更新版本号（异步写回不阻塞）
    if (fromVersion < LATEST_VERSION) {
      info.version = LATEST_VERSION;
      fs.writeFileSync(libJsonPath, JSON.stringify(info, null, 2), 'utf-8');
      dataStore.setLibraryInfo(info);
    }

    return info;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(ErrorCode.LIBRARY_OPEN_FAILED, '打开资源库失败', err);
  }
}

/** 从 SVG 生成平台专用的资源库文件夹图标 */
async function generateFolderIcon(dirPath: string): Promise<void> {
  try {
    await hideFolderIconSupportFiles(dirPath);

    // 生产环境：extraResources 放在 resources/
    const prodPath = path.join(process.resourcesPath || '', '文件夹.svg');
    // 开发环境：单一品牌资源目录
    const devPath = path.join(app.getAppPath(), 'src/assets/brand/library-folder.svg');

    const svgPath = fs.existsSync(prodPath) ? prodPath
      : fs.existsSync(devPath) ? devPath
      : null;

    if (!svgPath) {
      console.warn('[folder-icon] SVG not found. prod:', prodPath, 'dev:', devPath);
      return;
    }

    if (process.platform === 'win32') {
      await writeWindowsFolderIcon(dirPath, svgPath);
    } else if (process.platform === 'darwin') {
      await writeMacFolderIcon(dirPath, svgPath);
    }

    await hideFolderIconSupportFiles(dirPath);
  } catch (err) {
    console.error('[folder-icon] generation failed:', err);
  }
}

function pngToIco(pngBuf: Buffer): Buffer {
  // ICO 格式：6字节头 + 16字节目录项 + PNG数据
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);   // reserved
  header.writeUInt16LE(1, 2);   // ico type
  header.writeUInt16LE(1, 4);   // image count

  const dir = Buffer.alloc(16);
  dir.writeUInt8(pngBuf.length > 256 ? 0 : 256, 0);  // width (0=256)
  dir.writeUInt8(pngBuf.length > 256 ? 0 : 256, 1);  // height (0=256)
  dir.writeUInt8(0, 2);    // palette
  dir.writeUInt8(0, 3);    // reserved
  dir.writeUInt16LE(1, 4); // color planes
  dir.writeUInt16LE(32, 6); // bits per pixel
  dir.writeUInt32LE(pngBuf.length, 8);  // image size
  dir.writeUInt32LE(22, 12); // offset (header + dir = 6 + 16 = 22)

  return Buffer.concat([header, dir, pngBuf]);
}

async function renderFolderIconPng(svgPath: string, size: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const svgBuf = fs.readFileSync(svgPath);
  return sharp(svgBuf).resize(size, size).png().toBuffer();
}

async function writeWindowsFolderIcon(dirPath: string, svgPath: string): Promise<void> {
  const icoPath = path.join(dirPath, 'folder-icon.ico');
  const iniPath = path.join(dirPath, 'desktop.ini');

  if (!fs.existsSync(icoPath)) {
    try {
      const pngBuf = await renderFolderIconPng(svgPath, 256);
      const icoBuf = pngToIco(pngBuf);
      fs.writeFileSync(icoPath, icoBuf);
    } catch (err) {
      console.warn('[folder-icon] sharp failed, skipped:', err instanceof Error ? err.message : err);
      return;
    }
  }

  if (!fs.existsSync(iniPath)) {
    const iniContent = '[.ShellClassInfo]\r\nIconResource=folder-icon.ico,0\r\nIconFile=folder-icon.ico\r\nIconIndex=0\r\n';
    fs.writeFileSync(iniPath, iniContent);
  }
}

async function hideFolderIconSupportFiles(dirPath: string): Promise<void> {
  try {
    const { execFileSync } = await import('child_process');
    const supportFiles = [
      path.join(dirPath, 'desktop.ini'),
      path.join(dirPath, 'folder-icon.ico'),
      path.join(dirPath, '.folder-icon.png'),
    ].filter(filePath => fs.existsSync(filePath));

    if (process.platform === 'win32') {
      for (const filePath of supportFiles) {
        execFileSync('attrib', ['+s', '+h', filePath], { stdio: 'ignore' });
      }
      execFileSync('attrib', ['+s', dirPath], { stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      for (const filePath of supportFiles) {
        execFileSync('chflags', ['hidden', filePath], { stdio: 'ignore' });
      }
    }

  } catch (err) {
    console.warn('[folder-icon] hiding support files failed:', err instanceof Error ? err.message : err);
  }
}

function toAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function writeMacFolderIcon(dirPath: string, svgPath: string): Promise<void> {
  const pngPath = path.join(dirPath, '.folder-icon.png');

  try {
    const pngBuf = await renderFolderIconPng(svgPath, 1024);
    fs.writeFileSync(pngPath, pngBuf);
  } catch (err) {
    console.warn('[folder-icon] sharp failed, skipped:', err instanceof Error ? err.message : err);
    return;
  }

  try {
    const { execFileSync } = await import('child_process');
    const iconArg = toAppleScriptString(pngPath);
    const dirArg = toAppleScriptString(dirPath);

    execFileSync('osascript', [
      '-e', 'use framework "AppKit"',
      '-e', 'use scripting additions',
      '-e', `set iconImage to current application's NSImage's alloc()'s initWithContentsOfFile:${iconArg}`,
      '-e', `set ok to current application's NSWorkspace's sharedWorkspace()'s setIcon:iconImage forFile:${dirArg} options:0`,
      '-e', 'if ok as boolean is false then error "setIcon failed"',
    ], { stdio: 'ignore' });

  } catch (err) {
    console.warn('[folder-icon] macOS folder icon setup failed:', err instanceof Error ? err.message : err);
  }
}

// 创建新库
export async function createLibrary(dirPath: string, name: string): Promise<LibraryInfo> {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.mkdirSync(path.join(dirPath, 'movies'), { recursive: true });

    const info: LibraryInfo = {
      name,
      version: LATEST_VERSION,
      createdAt: new Date().toISOString(),
      movieCount: 0,
    };

    fs.writeFileSync(
      path.join(dirPath, 'library.json'),
      JSON.stringify(info, null, 2),
      'utf-8'
    );

    // 异步生成文件夹图标，不阻塞
    generateFolderIcon(dirPath).catch(err => console.error('[folder-icon] async generation failed:', err));

    setLibraryRoot(dirPath);
    dataStore.clear();
    dataStore.setLibraryInfo(info);

    return info;
  } catch (err) {
    throw new AppError(ErrorCode.LIBRARY_OPEN_FAILED, '创建资源库失败', err);
  }
}

// 获取库信息
export function getLibraryInfo(): LibraryInfo | null {
  return dataStore.getLibraryInfo();
}

export interface FullBackupResult {
  backupPath: string;
  movieCount: number;
}

/**
 * 创建可直接重新打开的完整资源库副本，而不是只导出影视字段。
 * 海报、日记、截图与 library.json 都会随目录一并复制。
 */
export async function createFullBackup(destinationDir: string): Promise<FullBackupResult> {
  const sourceDir = path.resolve(getLibraryRoot());
  const targetRoot = path.resolve(destinationDir);
  const relative = path.relative(sourceDir, targetRoot);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new AppError(ErrorCode.FILE_WRITE_FAILED, '备份位置不能位于当前资源库内');
  }

  await writeQueue.drain();

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
  const libraryName = path.basename(sourceDir).replace(/\.pianke$/i, '') || 'PianKe';
  let backupPath = path.join(targetRoot, `${libraryName}-backup-${stamp}.pianke`);
  let suffix = 2;
  while (fs.existsSync(backupPath)) {
    backupPath = path.join(targetRoot, `${libraryName}-backup-${stamp}-${suffix}.pianke`);
    suffix++;
  }

  try {
    fs.cpSync(sourceDir, backupPath, { recursive: true, errorOnExist: true, force: false });
    return { backupPath, movieCount: dataStore.getAllMovies().length };
  } catch (err) {
    throw new AppError(ErrorCode.FILE_WRITE_FAILED, '完整备份失败', err);
  }
}

// 获取库摘要（轻量列表，按最近观看日期倒序）
export function getSummary(): MovieSummary[] {
  const allDiaries = dataStore.getAllDiaries();
  const allWatchRecords = dataStore.getAllWatchRecords();
  return dataStore.getAllMovies().map((m) => ({
    id: m.id,
    title: m.title,
    titleOriginal: m.titleOriginal,
    mediaType: m.mediaType,
    rating: m.rating,
    personalRating: getPersonalRating(m.id, allWatchRecords),
    posterThumbPath: m.posterThumbPath,
    releaseDate: m.releaseDate,
    genre: m.genre,
    tags: m.tags,
    status: m.status,
    progress: m.progress,
    latestWatchDate: getLatestWatchDate(m.id, allDiaries) || isoToLocalSortTime(m.createdAt),
    createdAt: m.createdAt,
  })).sort((a, b) => {
    const d = b.latestWatchDate!.localeCompare(a.latestWatchDate!);
    return d !== 0 ? d : (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

// 获取最近观影
export function getRecentWatches(days: number = 30): MovieSummary[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const recentMovieIds = new Set<string>();
  const allDiaries = dataStore.getAllDiaries();
  const allWatchRecords = dataStore.getAllWatchRecords();

  for (const [movieId, entries] of allDiaries) {
    const movie = dataStore.getMovie(movieId);
    if (!movie) continue;
	    // 不按状态过滤，所有影片只要有近期记录都展示

    for (const entry of entries) {
      if (entry.watchDate >= cutoffStr) {
        recentMovieIds.add(movieId);
        break;
      }
    }
  }

  return dataStore.getAllMovies()
    .filter((m) => recentMovieIds.has(m.id))
    .map((m) => ({
      id: m.id,
      title: m.title,
      titleOriginal: m.titleOriginal,
      mediaType: m.mediaType,
      rating: m.rating,
      personalRating: getPersonalRating(m.id, allWatchRecords),
      posterThumbPath: m.posterThumbPath,
      releaseDate: m.releaseDate,
      genre: m.genre,
      tags: m.tags,
      status: m.status,
      progress: m.progress,
      latestWatchDate: getLatestWatchDate(m.id, allDiaries) || isoToLocalSortTime(m.createdAt),
      createdAt: m.createdAt,
    }))
    .sort((a, b) => {
      const d = b.latestWatchDate!.localeCompare(a.latestWatchDate!);
      return d !== 0 ? d : (b.createdAt || '').localeCompare(a.createdAt || '');
    });
}

/** 从手动追剧记录中计算某部影视的平均个人评分，无评分返回 null */
function getPersonalRating(movieId: string, allWatchRecords: Map<string, WatchRecord[]>): number | null {
  const entries = allWatchRecords.get(movieId);
  if (!entries || entries.length === 0) return null;
  const rated = entries.filter(e => e.rating > 0);
  if (rated.length === 0) return null;
  return Math.round(rated.reduce((sum, e) => sum + e.rating, 0) / rated.length * 10) / 10;
}

/** 将 UTC ISO 时间转为本地 'YYYY-MM-DDTHH:mm' 排序键 */
function isoToLocalSortTime(isoString: string): string {
  if (!isoString) return '';
  const d = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getLatestWatchDate(movieId: string, allDiaries: Map<string, DiaryEntry[]>): string {
  const entries = allDiaries.get(movieId);
  if (!entries || entries.length === 0) return '';
  // 找最新的 (日期 + 时间) 组合，确保同日影片按时分排序
  const latest = entries.reduce((best, e) => {
    const dt = e.watchDate + (e.watchTime || '');
    const bestDt = best.watchDate + (best.watchTime || '');
    return dt > bestDt ? e : best;
  }, entries[0]);
  return latest.watchDate + (latest.watchTime ? 'T' + latest.watchTime : '');
}

// 加载所有影视数据到内存（并行 I/O，含版本迁移）
async function loadAllMovies(fromVersion: number): Promise<void> {
  const moviesDir = getMoviesDir();
  if (!fs.existsSync(moviesDir)) {
    dataStore.updateMovieCount();
    return; // setLoaded() 由调用方 finally 保证
  }

  const entries = fs.readdirSync(moviesDir, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory());
  const needsMigration = fromVersion < LATEST_VERSION;

  await Promise.all(dirs.map(async (entry) => {
    const movieDir = path.join(moviesDir, entry.name);
    const metadataPath = path.join(movieDir, 'metadata.json');
    const diaryPath = path.join(movieDir, 'diary.json');
    const watchRecordsPath = getWatchRecordsPath(movieDir);

    try {
      const raw = await fs.promises.readFile(metadataPath, 'utf-8');
      const parsed = JSON.parse(raw);

      // 版本迁移在同一遍历中完成，避免二次 I/O
      if (needsMigration) {
        migrateMovie(parsed, fromVersion);
        // 异步写回，不阻塞加载
        fs.promises.writeFile(metadataPath, JSON.stringify(parsed, null, 2), 'utf-8').catch(
          err => console.error(`Migration write failed: ${entry.name}`, err)
        );
      }

      const metadata = MovieMetadataSchema.parse(parsed);
      dataStore.setMovie(metadata.id, metadata);

      // 读取日记与追剧记录；旧库在此完成手动记录迁移。
      try {
        const diaryRaw = await fs.promises.readFile(diaryPath, 'utf-8');
        const diaryParsed = JSON.parse(diaryRaw);
        if (!Array.isArray(diaryParsed)) throw new Error('Invalid diary data');

        if (fromVersion < 4) {
          const automaticEntries: any[] = [];
          const manualEntries: any[] = [];
          const automaticReviewPattern = /^(第\d+集 · 进度 \d+%|状态变更为「(在看|已看完|追剧中)」)/;
          for (const item of diaryParsed) {
            const isAutomatic = item && (
              item.kind === 'progress' ||
              item.kind === 'status' ||
              item.rating === -1 ||
              (item.rating === 0 && automaticReviewPattern.test(item.review || ''))
            );
            if (isAutomatic) automaticEntries.push(item);
            else manualEntries.push(item);
          }
          const diaries = z.array(DiaryEntrySchema).parse(automaticEntries);
          const records = z.array(WatchRecordSchema).parse(manualEntries.map(({ kind: _kind, ...rest }: any) => rest));
          dataStore.setDiary(metadata.id, diaries);
          dataStore.setWatchRecords(metadata.id, records);
          fs.promises.writeFile(diaryPath, JSON.stringify(diaries, null, 2), 'utf-8').catch(
            (err) => console.error(`Diary migration write failed: ${entry.name}`, err)
          );
          fs.promises.writeFile(watchRecordsPath, JSON.stringify(records, null, 2), 'utf-8').catch(
            (err) => console.error(`Watch records migration write failed: ${entry.name}`, err)
          );
        } else {
          dataStore.setDiary(metadata.id, z.array(DiaryEntrySchema).parse(diaryParsed));
          try {
            const recordsRaw = await fs.promises.readFile(watchRecordsPath, 'utf-8');
            dataStore.setWatchRecords(metadata.id, z.array(WatchRecordSchema).parse(JSON.parse(recordsRaw)));
          } catch {
            dataStore.setWatchRecords(metadata.id, []);
          }
        }
      } catch {
        dataStore.setDiary(metadata.id, []);
        dataStore.setWatchRecords(metadata.id, []);
      }
    } catch (err) {
      console.error(`Failed to load movie: ${entry.name}`, err);
    }
  }));

  dataStore.updateMovieCount();
}
