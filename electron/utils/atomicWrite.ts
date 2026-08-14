import fs from 'fs';
import path from 'path';

/** Replace a file only after all bytes have been written. */
export function writeFileAtomicSync(filePath: string, data: string | Buffer): void {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    fs.writeFileSync(temporaryPath, data);
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // Preserve the original write failure.
      }
    }
  }
}

export function writeJsonAtomicSync(filePath: string, value: unknown): void {
  writeFileAtomicSync(filePath, JSON.stringify(value, null, 2));
}
