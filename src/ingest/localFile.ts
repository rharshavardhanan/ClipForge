/**
 * Local-file input: `clipforge process <file>` (or a path passed to all/batch) skips yt-dlp
 * and copies the file into the workspace downloads dir. No info.json/subtitles exist, so
 * metadata falls back to ffprobe and the transcript falls through to whisper.
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import { logger } from '../utils/logger.js';

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov', '.webm', '.m4v']);

/** True when the input is an existing local file with a video extension. */
export function isLocalInput(input: string): boolean {
  return VIDEO_EXTS.has(extname(input).toLowerCase()) && existsSync(input);
}

/** Stable job id for a local file (absolute-path hash). */
export function localJobId(path: string): string {
  return 'local_' + createHash('sha1').update(resolve(path)).digest('hex').slice(0, 10);
}

/** Copy the source into the job downloads dir (cached), mirroring download()'s return shape. */
export async function ingestLocal(srcPath: string, outDir: string) {
  await mkdir(outDir, { recursive: true });
  const videoPath = join(outDir, 'video.mp4');
  const infoJsonPath = join(outDir, 'video.info.json'); // never written for local files
  if (existsSync(videoPath)) {
    logger.info('Reusing cached local ingest');
  } else {
    await copyFile(resolve(srcPath), videoPath);
  }
  return { videoPath, infoJsonPath, subtitlePath: null as string | null };
}
