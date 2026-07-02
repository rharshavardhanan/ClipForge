/**
 * Thumbnail engine: grab the clip's loudest frame (shock face / action peak correlates with
 * audio energy), pop contrast/saturation, and stamp large bordered MrBeast-style text.
 * No usable system font → plain frame (never fails the clip).
 */
import { stat } from 'node:fs/promises';
import { run } from '../utils/cmd.js';
import { logger } from '../utils/logger.js';
import type { RmsPoint } from '../types/index.js';

/** PURE: loudest RMS time within [start+0.5, end-0.5]; midpoint fallback. Absolute source secs. */
export function pickThumbnailTime(clip: { start: number; end: number }, rms: RmsPoint[]): number {
  const usable = rms.filter((p) => p.time >= clip.start + 0.5 && p.time <= clip.end - 0.5);
  if (!usable.length) return (clip.start + clip.end) / 2;
  return usable.reduce((best, p) => (p.rms > best.rms ? p : best)).time;
}

/** PURE: escape \ ' : % for an ffmpeg drawtext value. */
export function escapeDrawtext(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/%/g, '\\%');
}

/** PURE: ffmpeg args — seek, grab 1 frame, contrast/saturation pop, optional drawtext. */
export function buildThumbnailArgs(
  videoPath: string, timeSec: number, outPath: string, text?: string, fontFile?: string,
): string[] {
  const filters = ['scale=1280:-2', 'eq=contrast=1.12:saturation=1.35'];
  if (text && fontFile) {
    filters.push(
      `drawtext=fontfile=${fontFile}:text='${escapeDrawtext(text)}':fontcolor=white:fontsize=110` +
      `:borderw=10:bordercolor=black:x=(w-text_w)/2:y=h*0.07`,
    );
  }
  return ['-ss', String(timeSec), '-i', videoPath, '-frames:v', '1', '-vf', filters.join(','), '-y', outPath];
}

const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Impact.ttf',
  '/System/Library/Fonts/Supplemental/Arial Black.ttf',
  '/Library/Fonts/Impact.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  'C:\\Windows\\Fonts\\impact.ttf',
];

let cachedFont: string | null | undefined;
export async function findThumbnailFont(): Promise<string | null> {
  if (cachedFont !== undefined) return cachedFont;
  for (const f of FONT_CANDIDATES) {
    try {
      await stat(f);
      cachedFont = f;
      return f;
    } catch { /* try next candidate */ }
  }
  cachedFont = null;
  logger.warn('thumbnail: no bold system font found — rendering plain frames (no text overlay)');
  return null;
}

/** Grab + stamp the thumbnail. timeSec is relative to videoPath (the clip extract). */
export async function generateThumbnail(videoPath: string, timeSec: number, text: string, outPath: string): Promise<void> {
  const font = await findThumbnailFont();
  try {
    await run('ffmpeg', buildThumbnailArgs(videoPath, timeSec, outPath, text || undefined, font ?? undefined));
  } catch (e) {
    // Some ffmpeg builds ship without drawtext (no libfreetype) — fall back to a plain frame.
    if (!(text && font)) throw e;
    logger.warn('thumbnail: text overlay failed (ffmpeg without drawtext?) — writing plain frame');
    await run('ffmpeg', buildThumbnailArgs(videoPath, timeSec, outPath));
  }
}
