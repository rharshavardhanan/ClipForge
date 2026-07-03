/**
 * Montage moment harvesting — motion/audio peaks become the segment pool, scene cuts
 * are preferred window boundaries, and PERIODIC motion (reps) is detected by
 * cycle-consistency on the YDIF curve (pure signal math, no LLM) to feed the counter.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { motionCurve, audioCurve, percentile, type CurvePoint } from '../rankrot/signals.js';
import { extractMoment } from '../rankrot/moment.js';
import { detectSceneCuts } from '../extraction/sceneCuts.js';
import { probe } from '../utils/ffmpeg.js';
import type { MontageMoment } from './types.js';

const MIN_WIN = 1.5, MAX_WIN = 6, SLIDE_WIN = 3, SLIDE_STEP = 1.5;

/** PURE: periodic peak times — ≥4 peaks above p60 whose gaps stay within 35% of the median gap. */
export function detectCycles(motion: CurvePoint[]): number[] {
  if (motion.length < 8) return [];
  const floor = percentile(motion, 60);
  const peaks: number[] = [];
  for (let i = 1; i < motion.length - 1; i++) {
    const p = motion[i];
    if (p.v > floor && p.v >= motion[i - 1].v && p.v >= motion[i + 1].v) {
      if (peaks.length === 0 || p.time - peaks[peaks.length - 1] >= 0.35) peaks.push(p.time);
    }
  }
  if (peaks.length < 4) return [];
  const gaps = peaks.slice(1).map((t, i) => t - peaks[i]);
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  if (gaps.some((g) => Math.abs(g - median) > median * 0.35)) return [];
  return peaks;
}

const meanIn = (c: CurvePoint[], a: number, b: number): number => {
  const xs = c.filter((p) => p.time >= a && p.time < b);
  return xs.length === 0 ? 0 : xs.reduce((s, p) => s + p.v, 0) / xs.length;
};

/** PURE: top `count` non-overlapping windows scored 0.6·motion + 0.4·audio (audio /10). */
export function pickMomentWindows(
  motion: CurvePoint[], audio: CurvePoint[], cuts: number[], duration: number, count: number,
): { start: number; end: number; motionScore: number; audioScore: number }[] {
  const cands: { start: number; end: number }[] = [];
  if (cuts.length > 0) {
    const bounds = [0, ...cuts, duration];
    for (let i = 0; i < bounds.length - 1; i++) {
      const len = bounds[i + 1] - bounds[i];
      if (len >= MIN_WIN) cands.push({ start: bounds[i], end: bounds[i] + Math.min(len, MAX_WIN) });
    }
  }
  for (let t = 0; t + SLIDE_WIN <= duration; t += SLIDE_STEP) cands.push({ start: t, end: t + SLIDE_WIN });

  const motionMax = Math.max(1e-6, percentile(motion, 95));
  const scored = cands.map((c) => {
    const m = Math.min(1, meanIn(motion, c.start, c.end) / motionMax);
    const a = Math.min(1, meanIn(audio, c.start, c.end) / 10);
    return { ...c, motionScore: m, audioScore: a, score: 0.6 * m + 0.4 * a };
  }).sort((x, y) => y.score - x.score);

  const picked: typeof scored = [];
  for (const c of scored) {
    if (picked.length >= count) break;
    if (picked.every((p) => c.start >= p.end + 1 || c.end <= p.start - 1)) picked.push(c);
  }
  return picked.sort((a, b) => a.start - b.start)
    .map(({ start, end, motionScore, audioScore }) => ({ start, end, motionScore, audioScore }));
}

/** Harvest `count` moment files from one video (windows extracted to outDir/mm_<i>.mp4). */
export async function harvestMoments(videoPath: string, outDir: string, count: number): Promise<MontageMoment[]> {
  await mkdir(outDir, { recursive: true });
  const p = await probe(videoPath);
  const [motion, audio, cuts] = [await motionCurve(videoPath), await audioCurve(videoPath), await detectSceneCuts(videoPath)];
  const wins = pickMomentWindows(motion, audio, cuts, p.duration, count);
  const out: MontageMoment[] = [];
  for (const [i, w] of wins.entries()) {
    const file = join(outDir, `mm_${i}_${w.start.toFixed(1)}.mp4`);
    await extractMoment(videoPath, w.start, w.end, file);
    const slice = motion.filter((pt) => pt.time >= w.start && pt.time <= w.end)
      .map((pt) => ({ time: pt.time - w.start, v: pt.v }));
    out.push({
      src: file, start: 0, dur: w.end - w.start,
      motionScore: w.motionScore, audioScore: w.audioScore,
      cycleEvents: detectCycles(slice),
    });
  }
  return out;
}
