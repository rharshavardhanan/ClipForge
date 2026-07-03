/**
 * Keyframes for the arc-completion vision call — a handful of ≤512px JPEGs at
 * structurally interesting times (start / peaks / midpoint / end). Frames ALWAYS
 * go through temp files (house gotcha: spawned-process stdout corrupts binary).
 */
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../utils/cmd.js';
import { logger } from '../utils/logger.js';
import type { CurvePoint } from '../rankrot/signals.js';
import type { ArcSpan } from '../types/index.js';
import type { VisionImage } from '../broll/llmJson.js';

/** PURE: time of the max value within the span; null when no points fall inside. */
export function peakTime(points: CurvePoint[], span: ArcSpan): number | null {
  let best: CurvePoint | null = null;
  for (const p of points) {
    if (p.time < span.start || p.time > span.end) continue;
    if (!best || p.v > best.v) best = p;
  }
  return best ? best.time : null;
}

const DEDUPE_SEC = 0.75;

/** PURE: 4-6 sorted unique frame times inside the span. */
export function keyframeTimes(span: ArcSpan, rmsPeakT: number | null, motionPeakT: number | null): number[] {
  const len = span.end - span.start;
  const clamp = (t: number) => Math.min(span.end - 0.1, Math.max(span.start + 0.1, t));
  const raw = [
    span.start + 0.3, span.start + len / 2, span.end - 0.3,
    ...(rmsPeakT !== null ? [rmsPeakT] : []),
    ...(motionPeakT !== null ? [motionPeakT] : []),
    span.start + len / 4, span.start + (3 * len) / 4,          // quartile padding pool
  ].map(clamp).sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of raw) {
    if (out.length >= 6) break;
    if (out.every((u) => Math.abs(u - t) >= DEDUPE_SEC)) out.push(t);
  }
  return out;
}

/** One temp JPEG per time via ffmpeg (never stdout); failed frames are skipped. */
export async function extractKeyframes(videoPath: string, times: number[], tmpDir: string): Promise<VisionImage[]> {
  await mkdir(tmpDir, { recursive: true });
  const out: VisionImage[] = [];
  for (const [i, t] of times.entries()) {
    const path = join(tmpDir, `kf_${i}.jpg`);
    try {
      await run('ffmpeg', [
        '-ss', String(t), '-i', videoPath, '-frames:v', '1',
        '-vf', 'scale=512:-2', '-q:v', '5', '-y', path,
      ]);
      out.push({ data: await readFile(path), mimeType: 'image/jpeg' });
    } catch (e) {
      logger.warn(`keyframe @${t.toFixed(1)}s failed (${e instanceof Error ? e.message : String(e)}) — skipping`);
    }
  }
  return out;
}
