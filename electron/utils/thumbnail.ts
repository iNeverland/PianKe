import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

export const POSTER_THUMB_WIDTH = 800;
export const POSTER_THUMB_HEIGHT = 1200;

function applyPosterOutputOptions(pipeline: ReturnType<typeof sharp>, outputPath: string) {
  const ext = path.extname(outputPath).toLowerCase();
  if (ext === '.webp') return pipeline.webp({ quality: 92 });
  if (ext === '.png') return pipeline.png({ quality: 90 });
  return pipeline.jpeg({ quality: 92, mozjpeg: true });
}

export async function createPosterThumbnail(input: Buffer | string, thumbPath: string): Promise<void> {
  const pipeline = sharp(input).resize(POSTER_THUMB_WIDTH, POSTER_THUMB_HEIGHT, {
    fit: 'cover',
    position: 'top',
  });
  await applyPosterOutputOptions(pipeline, thumbPath).toFile(thumbPath);
}

export async function needsPosterThumbnailRegen(thumbPath: string): Promise<boolean> {
  if (!fs.existsSync(thumbPath)) return true;

  const meta = await sharp(thumbPath).metadata();
  return (
    (meta.width ?? 0) < POSTER_THUMB_WIDTH ||
    (meta.height ?? 0) < POSTER_THUMB_HEIGHT ||
    fs.statSync(thumbPath).size < 10240
  );
}

export async function generateThumbnail(
  sourcePath: string,
  outputDir: string,
  originalFilename: string
): Promise<{ posterPath: string; posterThumbPath: string }> {
  const ext = path.extname(originalFilename) || '.jpg';
  const posterFilename = `poster${ext}`;
  const thumbFilename = `poster_thumb${ext}`;
  const posterPath = path.join(outputDir, posterFilename);
  const thumbPath = path.join(outputDir, thumbFilename);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Copy original poster
  fs.copyFileSync(sourcePath, posterPath);

  await createPosterThumbnail(sourcePath, thumbPath);

  return {
    posterPath: posterFilename,
    posterThumbPath: thumbFilename,
  };
}

export async function generateThumbnailFromBuffer(
  imageBuffer: Buffer,
  outputDir: string,
  ext: string = '.jpg'
): Promise<{ posterPath: string; posterThumbPath: string }> {
  const posterFilename = `poster${ext}`;
  const thumbFilename = `poster_thumb${ext}`;
  const posterPath = path.join(outputDir, posterFilename);
  const thumbPath = path.join(outputDir, thumbFilename);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save original
  fs.writeFileSync(posterPath, imageBuffer);

  await createPosterThumbnail(imageBuffer, thumbPath);

  return {
    posterPath: posterFilename,
    posterThumbPath: thumbFilename,
  };
}
