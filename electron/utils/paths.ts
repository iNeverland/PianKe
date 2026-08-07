import path from 'path';

let libraryRoot: string | null = null;

export function setLibraryRoot(rootPath: string): void {
  libraryRoot = rootPath;
}

export function getLibraryRoot(): string {
  if (!libraryRoot) {
    throw new Error('No library opened');
  }
  return libraryRoot;
}

export function isLibraryOpen(): boolean {
  return libraryRoot !== null;
}

export function getLibraryJsonPath(): string {
  return path.join(getLibraryRoot(), 'library.json');
}

export function getMoviesDir(): string {
  return path.join(getLibraryRoot(), 'movies');
}

export function getMovieDir(movieId: string, movieTitle: string): string {
  // 文件夹名使用标题（人类可读），ID 在 metadata.json 中
  const safeName = movieTitle.replace(/[<>:"/\\|?*]/g, '_');
  return path.join(getMoviesDir(), safeName);
}

export function getMetadataPath(movieDir: string): string {
  return path.join(movieDir, 'metadata.json');
}

export function getDiaryPath(movieDir: string): string {
  return path.join(movieDir, 'diary.json');
}

export function getWatchRecordsPath(movieDir: string): string {
  return path.join(movieDir, 'watch-records.json');
}

export function getDiaryImagesDir(movieDir: string): string {
  return path.join(movieDir, 'diary_images');
}

export function getPosterPath(movieDir: string, filename: string): string {
  return path.join(movieDir, filename);
}

export function getScreenshotsDir(movieDir: string): string {
  return path.join(movieDir, 'screenshots');
}
