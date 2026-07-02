/**
 * Thumbnail engine: grab the clip's loudest frame (shock face / action peak correlates with
 * audio energy) and render a MrBeast-style card via the Remotion ThumbCard still — face-punched
 * zoom, vignette, huge stroked title text. Falls back to the plain grabbed frame if the
 * Remotion still fails (never fails the clip). ffmpeg drawtext is NOT used (many builds lack it).
 */
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { run } from '../utils/cmd.js';
import { logger } from '../utils/logger.js';
import type { RmsPoint } from '../types/index.js';

const REMOTION_DIR = resolve('remotion');

/** PURE: loudest RMS time within [start+0.5, end-0.5]; midpoint fallback. Absolute source secs. */
export function pickThumbnailTime(clip: { start: number; end: number }, rms: RmsPoint[]): number {
  const usable = rms.filter((p) => p.time >= clip.start + 0.5 && p.time <= clip.end - 0.5);
  if (!usable.length) return (clip.start + clip.end) / 2;
  return usable.reduce((best, p) => (p.rms > best.rms ? p : best)).time;
}

/** PURE: ffmpeg args — seek, grab 1 clean frame with a contrast/saturation pop. */
export function buildThumbnailArgs(videoPath: string, timeSec: number, outPath: string): string[] {
  return [
    '-ss', String(timeSec), '-i', videoPath, '-frames:v', '1',
    '-vf', 'scale=1280:-2,eq=contrast=1.12:saturation=1.35', '-y', outPath,
  ];
}

/**
 * Grab + stamp the thumbnail. timeSec is relative to videoPath (the clip extract).
 * `face` is the zoom focus, normalized 0-1 in the frame (defaults to center).
 */
export async function generateThumbnail(
  videoPath: string, timeSec: number, text: string, outPath: string,
  opts: { accent?: string; face?: { x: number; y: number } } = {},
): Promise<void> {
  // 1. Plain frame grab (no drawtext — works on every ffmpeg build).
  const inputDir = join(REMOTION_DIR, 'public', 'thumb_input');
  await mkdir(inputDir, { recursive: true });
  const frameName = `frame_${randomUUID().slice(0, 8)}.png`;
  const framePath = join(inputDir, frameName);
  await run('ffmpeg', buildThumbnailArgs(videoPath, timeSec, framePath));

  // 2. Remotion still: MrBeast-style card. Fallback = the plain frame itself.
  try {
    const props = {
      framePath: join('thumb_input', frameName),
      text: text || 'WAIT FOR IT',
      accent: opts.accent ?? '#FFD700',
      ...(opts.face ? { faceX: opts.face.x, faceY: opts.face.y } : {}),
    };
    await run('npx', [
      'remotion', 'still', 'src/index.ts', 'ThumbCard', resolve(outPath),
      `--props=${JSON.stringify(props)}`,
    ], { cwd: REMOTION_DIR, stallMs: 120_000 });
  } catch (e) {
    logger.warn(`thumbnail: Remotion still failed (${e instanceof Error ? e.message.slice(0, 120) : e}) — using plain frame`);
    await copyFile(framePath, outPath);
  } finally {
    await rm(framePath, { force: true });
  }
}
