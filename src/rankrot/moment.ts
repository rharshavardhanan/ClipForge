/**
 * RankRot moment detection — isolate the strongest 3–8s of each harvested clip.
 * Motion and audio curves are normalized, fused, and the window holding the global
 * fused peak is chosen with ~35% pre-roll (the build-up) and post-roll (the reaction);
 * it extends toward 8s only while the fused signal stays hot.
 */
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { run } from '../utils/cmd.js';
import type { CurvePoint } from './signals.js';

export const MIN_MOMENT_SEC = 3;
export const MAX_MOMENT_SEC = 8;
const PRE_ROLL_FRACTION = 0.35;   // fraction of the window before the peak (build-up)
const HOT_FRACTION = 0.6;         // extend only while fused >= 60% of the peak

/** PURE: min-max normalize a curve to 0..1 (flat curve → all 0.5). */
export function normalizeCurve(points: CurvePoint[]): CurvePoint[] {
  if (points.length === 0) return [];
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  if (max - min < 1e-9) return points.map((p) => ({ time: p.time, v: 0.5 }));
  return points.map((p) => ({ time: p.time, v: (p.v - min) / (max - min) }));
}

/** PURE: fuse motion + audio into one curve on the motion timeline (60/40 motion-weighted). */
export function fuseCurves(motion: CurvePoint[], audio: CurvePoint[]): CurvePoint[] {
  const m = normalizeCurve(motion);
  const a = normalizeCurve(audio);
  const nearest = (t: number): number => {
    if (a.length === 0) return 0;
    let best = a[0];
    for (const p of a) if (Math.abs(p.time - t) < Math.abs(best.time - t)) best = p;
    return best.v;
  };
  return m.map((p) => ({ time: p.time, v: 0.6 * p.v + 0.4 * nearest(p.time) }));
}

/**
 * PURE: pick the strongest [start, end] window of a clip from its fused curve.
 * The global fused peak lands ~35% into the window; duration starts at MIN_MOMENT_SEC
 * and extends toward MAX_MOMENT_SEC only while the curve past the end stays >= 60% of peak.
 */
export function momentWindow(fused: CurvePoint[], clipDurSec: number): { start: number; end: number } {
  const dur = Math.max(0.5, clipDurSec);
  if (dur <= MAX_MOMENT_SEC || fused.length === 0) {
    return { start: 0, end: Math.min(dur, MAX_MOMENT_SEC) }; // already clip-sized: keep whole
  }

  let peak = fused[0];
  for (const p of fused) if (p.v > peak.v) peak = p;

  let len = MIN_MOMENT_SEC;
  while (len < MAX_MOMENT_SEC) {
    const probeT = peak.time - PRE_ROLL_FRACTION * len + len; // window end if we extend
    const at = fused.reduce((best, p) => (Math.abs(p.time - probeT) < Math.abs(best.time - probeT) ? p : best), fused[0]);
    if (at.v < peak.v * HOT_FRACTION) break;
    len += 1;
  }

  let start = peak.time - PRE_ROLL_FRACTION * len;
  start = Math.max(0, Math.min(start, dur - len));
  return { start: +start.toFixed(2), end: +(start + len).toFixed(2) };
}

/** Re-encode the moment into its own file (stream copy is unreliable mid-GOP). */
export async function extractMoment(srcPath: string, start: number, end: number, outPath: string): Promise<void> {
  await mkdir(join(outPath, '..'), { recursive: true });
  await run('ffmpeg', [
    '-y', '-ss', String(start), '-i', srcPath, '-t', String(Math.max(0.5, end - start)),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k',
    outPath,
  ]);
}
