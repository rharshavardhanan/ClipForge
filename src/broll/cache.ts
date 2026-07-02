/**
 * B-roll segment download + cache (v6) — grabs only a short section of the matched video
 * (yt-dlp --download-sections) into ./broll_cache/, keyed by video id + section, so repeat
 * runs and repeated entities never re-download.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../utils/cmd.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import type { BrollCandidate } from '../types/index.js';

export const DEFAULT_BROLL_DIR = './broll_cache';
/** Longest segment worth pulling — overlays are ≤6s, padding gives trim slack. */
export const MAX_SEGMENT_SEC = 12;

/** PURE: which section of the source to pull: skip the intro (start ~15% in), pad the cue. */
export function segmentWindow(sourceDurationSec: number, cueDurSec: number): { start: number; len: number } {
  const len = Math.max(4, Math.min(MAX_SEGMENT_SEC, Math.ceil(cueDurSec + 4)));
  if (sourceDurationSec <= 0) return { start: 0, len };            // unknown duration: take the head
  const start = Math.min(Math.floor(sourceDurationSec * 0.15), Math.max(0, Math.floor(sourceDurationSec - len)));
  return { start: Math.max(0, start), len: Math.min(len, Math.max(4, Math.floor(sourceDurationSec))) };
}

/** PURE: stable cache filename for a video section. */
export function cacheKey(videoId: string, startSec: number, lenSec: number): string {
  return createHash('sha1').update(`${videoId}:${startSec}:${lenSec}`).digest('hex').slice(0, 16);
}

/** PURE: yt-dlp args to download just [start, start+len) as video-only mp4 (overlays are muted). */
export function buildSegmentArgs(url: string, startSec: number, lenSec: number, outPath: string): string[] {
  return [
    url,
    '-f', 'bestvideo[height<=720][ext=mp4]/bestvideo[height<=720]/best[height<=720]/best',
    '--download-sections', `*${startSec}-${startSec + lenSec}`,
    '--force-keyframes-at-cuts',
    '--no-playlist', '--no-warnings',
    '--remux-video', 'mp4',
    '-o', outPath,
  ];
}

/** Download (or reuse) a B-roll segment. Returns the cached file path, or null on failure. */
export async function downloadSegment(
  candidate: BrollCandidate, cueDurSec: number, cacheDir: string = DEFAULT_BROLL_DIR,
): Promise<string | null> {
  const { start, len } = segmentWindow(candidate.durationSec, cueDurSec);
  const file = join(cacheDir, `${cacheKey(candidate.id, start, len)}.mp4`);
  if (existsSync(file)) return file;
  try {
    await mkdir(cacheDir, { recursive: true });
    await withRetry(
      () => run('yt-dlp', buildSegmentArgs(candidate.url, start, len, file), { stallMs: 120_000 }),
      { attempts: 2, label: `broll-dl ${candidate.id}` },
    );
    return existsSync(file) ? file : null;
  } catch (e) {
    logger.warn(`[broll-dl] ${candidate.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
