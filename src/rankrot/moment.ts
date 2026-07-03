/**
 * RankRot moment detection — isolate each clip's strongest arc, ADAPTIVELY sized
 * (4–12s): starting at the fused motion+audio peak, the window grows in BOTH
 * directions while the signal stays hot — backward growth keeps the CONTEXT (the
 * build-up/cause), forward growth keeps the CONCLUSION (payoff + reaction) — and a
 * tail pad past the release point stops clips from ending mid-action. Each rank
 * gets its own length; nothing is forced to a fixed duration.
 */
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { run } from '../utils/cmd.js';
import { curveAt, type CurvePoint } from './signals.js';

export const MIN_MOMENT_SEC = 4;
export const MAX_MOMENT_SEC = 12;
const GROW_STEP_SEC = 0.5;     // window growth increment
const HOT_FRACTION = 0.5;      // keep growing while fused >= 50% of the peak
const TAIL_PAD_SEC = 0.75;     // breathing room after the release point (no mid-action cuts)
const PRE_PAD_SEC = 0.25;

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
 * PURE: adaptive strongest-arc window. Grows outward from the fused peak — each step
 * extends whichever side is hotter, while that side stays >= HOT_FRACTION of the peak —
 * then pads the tail so the action resolves on screen. Short sources are kept whole.
 */
export function momentWindow(fused: CurvePoint[], clipDurSec: number): { start: number; end: number } {
  const dur = Math.max(0.5, clipDurSec);
  if (dur <= MAX_MOMENT_SEC || fused.length === 0) {
    return { start: 0, end: dur }; // already clip-sized: it IS the arc
  }

  let peak = fused[0];
  for (const p of fused) if (p.v > peak.v) peak = p;
  const hot = peak.v * HOT_FRACTION;

  let start = peak.time;
  let end = peak.time;
  while (end - start < MAX_MOMENT_SEC - TAIL_PAD_SEC - PRE_PAD_SEC) {
    const backT = start - GROW_STEP_SEC;
    const fwdT = end + GROW_STEP_SEC;
    const backV = backT >= 0 ? curveAt(fused, backT) : -1;
    const fwdV = fwdT <= dur ? curveAt(fused, fwdT) : -1;
    const backOk = backV >= hot;
    const fwdOk = fwdV >= hot;
    if (!backOk && !fwdOk) break;                    // arc complete on both sides
    if (fwdOk && (!backOk || fwdV >= backV)) end = fwdT;   // conclusion first (payoff bias)
    else start = backT;
  }

  // Pads: context lead-in + let the action resolve; then enforce the minimum arc.
  start -= PRE_PAD_SEC;
  end += TAIL_PAD_SEC;
  if (end - start < MIN_MOMENT_SEC) {
    const grow = (MIN_MOMENT_SEC - (end - start)) / 2;
    start -= grow;
    end += grow;
  }

  // Clamp inside the source, respecting the max.
  start = Math.max(0, start);
  end = Math.min(dur, end);
  if (end - start > MAX_MOMENT_SEC) end = start + MAX_MOMENT_SEC;
  if (end - start < MIN_MOMENT_SEC) start = Math.max(0, end - MIN_MOMENT_SEC);
  return { start: +start.toFixed(2), end: +end.toFixed(2) };
}

/** Re-encode the moment into its own file (stream copy is unreliable mid-GOP). */
export async function extractMoment(srcPath: string, start: number, end: number, outPath: string): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  await run('ffmpeg', [
    '-y', '-ss', String(start), '-i', srcPath, '-t', String(Math.max(0.5, end - start)),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k',
    outPath,
  ]);
}
